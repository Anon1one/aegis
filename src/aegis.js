// ── Aegis decision engine ──────────────────────────────────────────────
// Runs the three lanes and combines them into ONE decision:
//   PAY | BLOCK | ASK_HUMAN
// Kept deliberately readable — a judge should follow this in 10 seconds.
import { checkBytecode } from './lanes/bytecode.js';
import { checkReputation } from './lanes/reputation.js';
import { checkBehavior } from './lanes/behavior.js';

export const DECISION = {
  PAY: 'PAY',
  BLOCK: 'BLOCK',
  ASK_HUMAN: 'ASK_HUMAN',
};

/**
 * @param {`0x${string}`} recipient
 * @param {number} amount  human USDC amount (e.g. 10 = 10 USDC)
 */
export async function aegisCheck(recipient, amount) {
  // Lane 1 is real (on-chain), lanes 2 & 3 are synchronous mocks.
  const bytecode = await checkBytecode(recipient);
  const reputation = checkReputation(recipient);
  const behavior = checkBehavior(recipient, amount);

  const lanes = { bytecode, reputation, behavior };
  let decision;
  const reasons = [];

  // ── Combine (first matching rule wins) ────────────────────────────────
  if (bytecode.level === 'HIGH') {
    decision = DECISION.BLOCK;
    reasons.push(`🛑 Bytecode: ${bytecode.reason}`);
  } else if (reputation.listed === 'deny') {
    decision = DECISION.BLOCK;
    reasons.push(`🛑 Reputation: ${reputation.reason}`);
  } else if (behavior.escalate) {
    decision = DECISION.ASK_HUMAN;
    reasons.push(`🙋 Behavior: ${behavior.reason}`);
  } else {
    decision = DECISION.PAY;
    reasons.push(`✅ Bytecode: ${bytecode.reason}`);
    if (reputation.listed === 'allow') reasons.push(`✅ Reputation: ${reputation.reason}`);
  }

  return { decision, reasons, lanes, recipient, amount };
}

// Pretty-print a verdict for the CLI.
export function printVerdict(result) {
  const { decision, reasons, recipient, amount } = result;
  const banner = {
    PAY: '\x1b[42m\x1b[30m  PAY  \x1b[0m',
    BLOCK: '\x1b[41m\x1b[37m  BLOCK  \x1b[0m',
    ASK_HUMAN: '\x1b[43m\x1b[30m  ASK_HUMAN  \x1b[0m',
  }[decision];

  console.log('\n──────────────────────────────────────────────');
  console.log(`  AEGIS verdict for ${recipient}`);
  console.log(`  paying ${amount} USDC`);
  console.log('──────────────────────────────────────────────');
  console.log(`  ${banner}\n`);
  for (const r of reasons) console.log(`  ${r}`);
  console.log('──────────────────────────────────────────────\n');
}
