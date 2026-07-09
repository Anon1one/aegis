// demo entrypoint. the "agent" is just a script that wants to move money, but
// runs it past aegis first and only goes through if the verdict is PAY.
//
//   node src/agent.js good                    pay recipient A (GOOD_RECIPIENT)
//   node src/agent.js bad                     pay recipient B (BAD_RECIPIENT)
//   node src/agent.js <0xaddr> [amt]          pay any address
//   node src/agent.js approve <good|bad|0x>   approve a spender to move our USDC
//
// the approve path matters: agents usually lose funds not by sending to a trap
// but by approving a malicious spender that drains them later. so we check the
// spender's code the same way we'd check a recipient.
import { aegisCheck, printVerdict, DECISION } from './aegis.js';
import { payUSDC } from './pay.js';
import { approveUSDC } from './approve.js';
import { addresses, assertAddress } from './config.js';

const DEFAULT_AMOUNT = 10;

function resolveTarget(arg) {
  if (arg === 'good') return { recipient: assertAddress('GOOD_RECIPIENT', addresses.good), label: 'Recipient A (good EOA)' };
  if (arg === 'bad') return { recipient: assertAddress('BAD_RECIPIENT', addresses.bad), label: 'Recipient B (malicious contract)' };
  return { recipient: assertAddress('recipient', arg), label: 'custom address' };
}

async function main() {
  const args = process.argv.slice(2);
  const isApprove = args[0] === 'approve';
  const [targetArg, amountArg] = isApprove ? args.slice(1) : args;

  if (!targetArg) {
    console.log('usage: node src/agent.js [approve] <good|bad|0xADDRESS> [amount]');
    process.exit(1);
  }

  // in approve mode the target is the spender we'd hand an allowance to
  const { recipient, label } = resolveTarget(targetArg);
  const amount = amountArg ? Number(amountArg) : DEFAULT_AMOUNT;

  const intent = isApprove
    ? `approve ${label} to spend ${amount} USDC`
    : `pay ${amount} USDC to ${label}`;
  console.log(`\n🤖 Agent wants to ${intent}`);
  console.log(`   ${recipient}`);
  console.log('   ...asking Aegis first.');

  // same risk check either way - who are we trusting with our money?
  const result = await aegisCheck(recipient, amount);
  printVerdict(result);

  if (result.decision === DECISION.PAY) {
    if (isApprove) {
      console.log('🤖 Aegis cleared it — sending the approval.\n');
      await approveUSDC(recipient, amount);
    } else {
      console.log('🤖 Aegis said PAY — firing the transaction.\n');
      await payUSDC(recipient, amount);
    }
  } else if (result.decision === DECISION.BLOCK) {
    const what = isApprove ? 'approval' : 'transaction';
    console.log(`🛡️  Aegis said BLOCK — ${what} NOT sent. Money saved.\n`);
  } else {
    console.log('🙋 Aegis said ASK_HUMAN — pausing for human approval (not auto-sent).\n');
  }
}

main().catch((err) => {
  console.error('\n❌ error:', err.shortMessage || err.message);
  process.exit(1);
});
