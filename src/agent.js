// demo entrypoint. the "agent" is just a script that wants to move money, but
// runs it past aegis first and only goes through if the verdict is PAY.
//
//   node src/agent.js good                    pay recipient A (GOOD_RECIPIENT)
//   node src/agent.js bad                     pay recipient B (BAD_RECIPIENT)
//   node src/agent.js <0xaddr> [amt]          pay any address
//   node src/agent.js approve <good|bad|0x>   approve a spender to move our USDC
//   node src/agent.js guard <good|bad|0x>     pay THROUGH the on-chain AegisGuard
//
// the approve path matters: agents usually lose funds not by sending to a trap
// but by approving a malicious spender that drains them later. so we check the
// spender's code the same way we'd check a recipient.
//
// the guard path routes the payment through the deployed AegisGuard contract,
// so the same policy is enforced on-chain and can't be skipped by the agent.
import { aegisCheck, printVerdict, DECISION } from './aegis.js';
import { payUSDC } from './pay.js';
import { approveUSDC } from './approve.js';
import { guardedPay, assessOnChain, recordVerdictOnChain } from './guard.js';
import { addresses, assertAddress } from './config.js';

const DEFAULT_AMOUNT = 10;
const MODES = new Set(['approve', 'guard']);

function resolveTarget(arg) {
  if (arg === 'good') return { recipient: assertAddress('GOOD_RECIPIENT', addresses.good), label: 'Recipient A (good EOA)' };
  if (arg === 'bad') return { recipient: assertAddress('BAD_RECIPIENT', addresses.bad), label: 'Recipient B (malicious contract)' };
  return { recipient: assertAddress('recipient', arg), label: 'custom address' };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = MODES.has(args[0]) ? args[0] : 'pay';
  const isApprove = mode === 'approve';
  const isGuard = mode === 'guard';
  const [targetArg, amountArg] = mode === 'pay' ? args : args.slice(1);

  if (!targetArg) {
    console.log('usage: node src/agent.js [approve|guard] <good|bad|0xADDRESS> [amount]');
    process.exit(1);
  }

  // in approve mode the target is the spender we'd hand an allowance to
  const { recipient, label } = resolveTarget(targetArg);
  const amount = amountArg ? Number(amountArg) : DEFAULT_AMOUNT;
  if (!Number.isFinite(amount) || amount <= 0) {
    console.log(`bad amount: ${amountArg} (must be a positive number)`);
    process.exit(1);
  }

  const intent = isApprove
    ? `approve ${label} to spend ${amount} USDC`
    : isGuard
      ? `pay ${amount} USDC to ${label} through AegisGuard`
      : `pay ${amount} USDC to ${label}`;
  console.log(`\nAgent wants to ${intent}`);
  console.log(`   ${recipient}`);
  console.log('   ...asking Aegis first.');

  // same risk check either way - who are we trusting with our money?
  const result = await aegisCheck(recipient, amount, { isApprove });
  printVerdict(result);

  // guard mode has its own flow: it routes the decision through the deployed
  // AegisGuard, and teaches the guard when the recipient is bad (see runGuard).
  if (isGuard) {
    await runGuard(recipient, amount, result);
    return;
  }

  if (result.decision === DECISION.PAY) {
    if (isApprove) {
      console.log('Aegis cleared it, sending the approval.\n');
      await approveUSDC(recipient, amount);
    } else {
      console.log('Aegis said PAY, firing the transaction.\n');
      await payUSDC(recipient, amount);
    }
  } else if (result.decision === DECISION.BLOCK) {
    const what = isApprove ? 'approval' : 'transaction';
    console.log(`Aegis said BLOCK. ${what} NOT sent, money saved.\n`);
  } else {
    console.log('Aegis said ASK_HUMAN, pausing for human approval (not auto-sent).\n');
  }
}

// guard mode. show the contract's own verdict too, then act on the off-chain
// decision through the on-chain guard:
//   PAY       -> settle the payment via guardedPay (a real transfer).
//   BLOCK     -> record the recipient into the guard's on-chain lists, so the
//                contract will block it by itself from now on, and watch the
//                on-chain verdict flip. no payment is sent.
//   ASK_HUMAN -> stop and leave it for a person.
async function runGuard(recipient, amount, result) {
  const before = await assessOnChain(recipient, amount);
  console.log(`  On-chain AegisGuard.assess(): ${before.verdict} (${before.reason})`);

  if (result.decision === DECISION.PAY) {
    console.log('\nAegis said PAY, routing the payment through the guard.\n');
    await guardedPay(recipient, amount);
    return;
  }

  if (result.decision === DECISION.BLOCK) {
    console.log('\nAegis said BLOCK. teaching the guard so it enforces this on-chain too...');
    const rec = await recordVerdictOnChain(recipient);
    console.log(`  ${rec.message}`);
    if (rec.changed) {
      const after = await assessOnChain(recipient, amount);
      console.log(`  On-chain AegisGuard.assess() now: ${after.verdict} (${after.reason})`);
    }
    console.log('\ntransaction NOT sent, money saved - and the guard now blocks it on its own.\n');
    return;
  }

  console.log('\nAegis said ASK_HUMAN, pausing for a human (not auto-sent).\n');
}

main().catch((err) => {
  console.error('\nerror:', err.shortMessage || err.message);
  process.exit(1);
});
