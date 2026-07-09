// bytecode lane - the real one.
// pull the recipient's code with eth_getCode and scan the opcodes for
// stuff that's usually bad news. this is the ethereum-native check: we're
// reading the actual EVM instructions the recipient would run.
//
// note: it's a linear walk, so "present" != "reachable". we over-flag on
// purpose and let the llm second pass sort out the false alarms.
import { publicClient } from '../config.js';

// danger opcodes -> how much risk each one adds to the score
const DANGER = {
  0xff: { name: 'SELFDESTRUCT', score: 60, note: 'selfdestruct present - funds sent here can get stranded (honeypot / dead-end pattern)' },
  0xf4: { name: 'DELEGATECALL', score: 40, note: 'delegatecall - upgradeable/proxy, logic can be swapped out under you' },
  0xf2: { name: 'CALLCODE',     score: 40, note: 'callcode - deprecated delegatecall variant, drainer-adjacent' },
  0xf5: { name: 'CREATE2',      score: 35, note: 'create2 - can redeploy different code at the same address (metamorphic rug)' },
  0xf0: { name: 'CREATE',       score: 20, note: 'create - can spawn child contracts at runtime' },
  0x32: { name: 'ORIGIN',       score: 15, note: 'tx.origin - phishing / auth-bypass anti-pattern' },
};

// PUSH1..PUSH32 (0x60-0x7f) carry 1-32 data bytes right after them.
// have to skip those or we'd read pushed data as if it were opcodes.
function isPush(op) {
  return op >= 0x60 && op <= 0x7f;
}
function pushLen(op) {
  return op - 0x60 + 1;
}

// solc appends a CBOR metadata blob after the runtime code. the last 2 bytes
// are its length, and the blob starts with 0xa2 (a cbor map). trim it so we
// don't walk the ipfs hash bytes as if they were opcodes and false-alarm.
function stripMetadata(hex) {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  if (bytes.length < 4) return hex;
  const len = bytes[bytes.length - 2] * 256 + bytes[bytes.length - 1];
  const start = bytes.length - 2 - len;
  if (start > 0 && bytes[start] === 0xa2) {
    return '0x' + bytes.subarray(0, start).toString('hex');
  }
  return hex;
}

// walk the code instruction by instruction, counting danger opcodes
function scanOpcodes(hex) {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  const hits = {};
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (isPush(op)) {
      i += pushLen(op); // skip the immediate data
      continue;
    }
    const d = DANGER[op];
    if (d) {
      if (!hits[d.name]) hits[d.name] = { count: 0, score: d.score, note: d.note };
      hits[d.name].count += 1;
    }
  }
  return hits;
}

// eip-1167 minimal proxy: a fixed 45-byte runtime that just delegatecalls to a
// hardcoded implementation baked into the middle. exact shape, nothing after -
// the real logic lives in another contract we can't see from here.
//   363d3d373d3d3d363d73 <20-byte impl> 5af43d82803e903d91602b57fd5bf3
const PROXY_HEAD = '363d3d373d3d3d363d73';
const PROXY_TAIL = '5af43d82803e903d91602b57fd5bf3';

function isMinimalProxy(hex) {
  const h = hex.slice(2).toLowerCase();
  return h.length === 90 && h.startsWith(PROXY_HEAD) && h.endsWith(PROXY_TAIL);
}

function levelFromScore(score) {
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export async function checkBytecode(recipient) {
  const code = await publicClient.getCode({ address: recipient });
  const lower = (code || '0x').toLowerCase();

  // eip-7702: a delegated EOA returns 0xef0100 || <20-byte address>. it's not a
  // real contract, execution is just forwarded to that address, so don't scan
  // the address bytes as opcodes. flag it so a human can look at the delegate.
  if (lower.startsWith('0xef0100') && lower.length === 48) {
    const target = '0x' + lower.slice(8);
    return {
      lane: 'bytecode',
      level: 'MEDIUM',
      score: 40,
      isContract: false,
      code,
      reason: `EOA with an EIP-7702 delegation to ${target}. Execution is forwarded to that contract.`,
      hits: {},
    };
  }

  // no code = a normal wallet (EOA). nothing to run, low risk.
  if (!code || code === '0x') {
    return {
      lane: 'bytecode',
      level: 'LOW',
      score: 0,
      isContract: false,
      code: '0x',
      reason: 'Recipient is a normal wallet (EOA) - no contract code to run.',
      hits: {},
    };
  }

  const hits = scanOpcodes(stripMetadata(code));

  // if it's a recognized minimal proxy, report that precisely instead of a
  // bare delegatecall - the real signal is "logic is hidden elsewhere".
  if (isMinimalProxy(code)) {
    delete hits.DELEGATECALL;
    hits.MINIMAL_PROXY = {
      count: 1,
      score: 40,
      note: 'eip-1167 minimal proxy - forwards every call to a hidden implementation you cannot inspect here',
    };
  }

  const score = Object.values(hits).reduce((s, h) => s + h.score, 0);
  const level = levelFromScore(score);
  const byteLen = code.length / 2 - 1;

  let reason;
  if (score === 0) {
    reason = `Recipient is a contract (${byteLen} bytes) with no known danger opcodes.`;
  } else {
    const parts = Object.entries(hits).map(
      ([name, h]) => `${name} x${h.count} (${h.note})`,
    );
    reason = `Contract bytecode contains: ${parts.join('; ')}.`;
  }

  return { lane: 'bytecode', level, score, isContract: true, code, reason, hits };
}
