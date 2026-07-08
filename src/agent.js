// ── Demo entrypoint: an AI agent tries to pay, but asks Aegis first ────
//
// Usage:
//   node src/agent.js good            # pay Recipient A (env GOOD_RECIPIENT)
//   node src/agent.js bad             # pay Recipient B (env BAD_RECIPIENT)
//   node src/agent.js <0xaddr> [amt]  # pay an arbitrary address
//
// The "agent" here is just a script: it decides it wants to pay, runs the
// payment through Aegis, and only fires the real on-chain transfer if the
// verdict is PAY.
import { aegisCheck, printVerdict, DECISION } from './aegis.js';
import { payUSDC } from './pay.js';
import { addresses, assertAddress } from './config.js';

const DEFAULT_AMOUNT = 10;

function resolveTarget(arg) {
  if (arg === 'good') return { recipient: assertAddress('GOOD_RECIPIENT', addresses.good), label: 'Recipient A (good EOA)' };
  if (arg === 'bad') return { recipient: assertAddress('BAD_RECIPIENT', addresses.bad), label: 'Recipient B (malicious contract)' };
  return { recipient: assertAddress('recipient', arg), label: 'custom address' };
}

async function main() {
  const [, , targetArg, amountArg] = process.argv;
  if (!targetArg) {
    console.log('usage: node src/agent.js <good|bad|0xADDRESS> [amount]');
    process.exit(1);
  }

  const { recipient, label } = resolveTarget(targetArg);
  const amount = amountArg ? Number(amountArg) : DEFAULT_AMOUNT;

  console.log(`\n🤖 Agent wants to pay ${amount} USDC to ${label}`);
  console.log(`   ${recipient}`);
  console.log('   ...asking Aegis first.');

  const result = await aegisCheck(recipient, amount);
  printVerdict(result);

  if (result.decision === DECISION.PAY) {
    console.log('🤖 Aegis said PAY — firing the transaction.\n');
    await payUSDC(recipient, amount);
  } else if (result.decision === DECISION.BLOCK) {
    console.log('🛡️  Aegis said BLOCK — transaction NOT sent. Money saved.\n');
  } else {
    console.log('🙋 Aegis said ASK_HUMAN — pausing for human approval (not auto-sent).\n');
  }
}

main().catch((err) => {
  console.error('\n❌ error:', err.shortMessage || err.message);
  process.exit(1);
});
