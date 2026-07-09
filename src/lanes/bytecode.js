// bytecode lane - the real one.
// pull the recipient's code with eth_getCode and scan the opcodes for
// stuff that's usually bad news. this is the ethereum-native check: we're
// reading the actual EVM instructions the recipient would run.
import { publicClient } from '../config.js';

// opcodes we flag + how much risk each adds
const DANGER = {
  0xff: { name: 'SELFDESTRUCT', score: 60, note: 'contract can self-destruct - classic honeypot / rug pattern' },
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

// eip-1167 minimal proxy: a fixed runtime shape that just delegatecalls to a
// hardcoded implementation address baked into the middle. the real logic lives
// in another contract we can't see from here, so it's opaque by design.
//   363d3d373d3d3d363d73 <20-byte impl> 5af43d82803e903d91602b57fd5bf3
const PROXY_HEAD = '363d3d373d3d3d363d73';
const PROXY_TAIL = '5af43d82803e903d91602b57fd5bf3';

function isMinimalProxy(hex) {
  const h = hex.slice(2).toLowerCase();
  return h.startsWith(PROXY_HEAD) && h.includes(PROXY_TAIL);
}

function levelFromScore(score) {
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export async function checkBytecode(recipient) {
  const code = await publicClient.getCode({ address: recipient });

  // no code = a normal wallet (EOA). nothing to run, low risk.
  if (!code || code === '0x') {
    return {
      lane: 'bytecode',
      level: 'LOW',
      score: 0,
      isContract: false,
      code: '0x',
      reason: 'Recipient is a normal wallet (EOA) — no contract code to run.',
      hits: {},
    };
  }

  const hits = scanOpcodes(code);

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
      ([name, h]) => `${name}×${h.count} (${h.note})`,
    );
    reason = `Contract bytecode contains: ${parts.join('; ')}.`;
  }

  return { lane: 'bytecode', level, score, isContract: true, code, reason, hits };
}
