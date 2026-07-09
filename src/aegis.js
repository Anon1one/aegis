// the decision engine. deterministic lanes first, llm only if we're
// alarmed or unsure. spits out one of PAY / BLOCK / ASK_HUMAN.
//
//   all clean            -> PAY   (no llm, fast + free)
//   reputation denylist  -> BLOCK (hard rule, no llm)
//   bytecode HIGH        -> ask llm to reason over the code
//        confirms bad    -> BLOCK
//        says benign      -> ASK_HUMAN (deterministic + llm disagree, let a human look)
//   uncertain (amount)   -> llm explains it -> ASK_HUMAN
import { checkBytecode } from './lanes/bytecode.js';
import { checkReputation } from './lanes/reputation.js';
import { checkBehavior } from './lanes/behavior.js';
import { reason } from './reasoning.js';

export const DECISION = {
  PAY: 'PAY',
  BLOCK: 'BLOCK',
  ASK_HUMAN: 'ASK_HUMAN',
};

export async function aegisCheck(recipient, amount) {
  // lane 1 is a real on-chain call, 2 and 3 are sync mocks
  const bytecode = await checkBytecode(recipient);
  const reputation = checkReputation(recipient);
  const behavior = checkBehavior(recipient, amount);

  const lanes = { bytecode, reputation, behavior };
  const reasons = [];
  let decision;
  let llm = null;

  if (reputation.listed === 'deny') {
    // known bad, no point spending an llm call
    decision = DECISION.BLOCK;
    reasons.push(`Reputation: ${reputation.reason}`);
  } else if (bytecode.level === 'HIGH') {
    // alarmed -> let the llm decide if it's a real trap or a false alarm
    reasons.push(`Bytecode flagged HIGH: ${bytecode.reason}`);
    reasons.push('Escalating to LLM to reason over the bytecode...');
    llm = await reason({ recipient, bytecode: bytecode.code, hits: bytecode.hits, mode: 'confirm' });

    if (!llm.available) {
      // llm down -> trust the deterministic alarm rather than crash
      decision = DECISION.BLOCK;
      reasons.push(`LLM unavailable (${llm.error}); falling back to deterministic BLOCK.`);
    } else if (llm.malicious) {
      decision = DECISION.BLOCK;
      reasons.push(`LLM confirms malicious (${llm.confidence}): ${llm.reason}`);
    } else {
      // llm thinks it's fine but the filter didn't - don't auto-block, ask a human
      decision = DECISION.ASK_HUMAN;
      reasons.push(`LLM says likely benign (${llm.confidence}): ${llm.reason}`);
      reasons.push('   (deterministic filter disagreed - surfacing both views to a human.)');
    }
  } else if (behavior.escalate) {
    // unsure -> have the llm explain the recipient so the human decides informed
    reasons.push(`Behavior: ${behavior.reason}`);
    reasons.push('Asking LLM to analyze the recipient for the human...');
    llm = await reason({ recipient, bytecode: bytecode.code, hits: bytecode.hits, mode: 'analyze' });
    decision = DECISION.ASK_HUMAN;
    if (llm.available) {
      reasons.push(`LLM summary (${llm.confidence}): ${llm.reason}`);
    } else {
      reasons.push(`   (LLM unavailable: ${llm.error} - escalating on deterministic grounds.)`);
    }
  } else {
    // nothing tripped -> just pay
    decision = DECISION.PAY;
    reasons.push(`Bytecode: ${bytecode.reason}`);
    if (reputation.listed === 'allow') reasons.push(`Reputation: ${reputation.reason}`);
  }

  return { decision, reasons, lanes, llm, recipient, amount };
}

function banner(decision) {
  return {
    PAY: '\x1b[42m\x1b[30m  PAY  \x1b[0m',
    BLOCK: '\x1b[41m\x1b[37m  BLOCK  \x1b[0m',
    ASK_HUMAN: '\x1b[43m\x1b[30m  ASK_HUMAN  \x1b[0m',
  }[decision];
}

export function printVerdict(result) {
  const { decision, reasons, recipient, amount } = result;
  console.log('\n----------------------------------------------');
  console.log(`  AEGIS verdict for ${recipient}`);
  console.log(`  amount: ${amount} USDC`);
  console.log('----------------------------------------------');
  console.log(`  ${banner(decision)}\n`);
  for (const r of reasons) console.log(`  ${r}`);
  console.log('----------------------------------------------\n');
}
