// talks to the deployed AegisGuard contract.
// assess() is a read (the contract's own verdict), guardedPay() actually moves
// USDC from the treasury through the guard, and setupGuard() does the one-time
// wiring: treasury approves the guard for USDC and the owner whitelists the
// caller as an agent.
import { parseUnits, erc20Abi } from 'viem';
import { publicClient, requireWallet, addresses, assertAddress } from './config.js';
import { compileGuard } from './compile.js';

const VERDICT = ['PAY', 'BLOCK', 'REVIEW']; // matches enum Verdict order

let _abi = null;
function guardAbi() {
  if (!_abi) _abi = compileGuard().abi;
  return _abi;
}

function guardAddress() {
  return assertAddress('AEGIS_GUARD', addresses.guard);
}

// the contract's own verdict for this payment, read-only (no tx).
export async function assessOnChain(to, amount) {
  const guard = guardAddress();
  const value = parseUnits(String(amount), 6);
  const [verdict, reason] = await publicClient.readContract({
    address: guard,
    abi: guardAbi(),
    functionName: 'assess',
    args: [to, value],
  });
  return { verdict: VERDICT[verdict] ?? String(verdict), reason };
}

// one-time setup: approve the guard to pull USDC from us (the treasury) and
// whitelist us as an agent allowed to trigger payments.
export async function setupGuard(allowanceUSDC = 1000) {
  const { walletClient, account } = requireWallet();
  const guard = guardAddress();
  const usdc = assertAddress('USDC_ADDRESS', addresses.usdc);

  console.log(`  -> approving guard ${guard} for ${allowanceUSDC} USDC ...`);
  const approveHash = await walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [guard, parseUnits(String(allowanceUSDC), 6)],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  console.log(`  -> authorizing agent ${account.address} ...`);
  const agentHash = await walletClient.writeContract({
    address: guard,
    abi: guardAbi(),
    functionName: 'setAgent',
    args: [account.address, true],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: agentHash });

  console.log('  -> guard ready.');
}

// move `amount` USDC from the treasury to `to` through the guard. reverts
// on-chain if the guard's policy is not PAY.
export async function guardedPay(to, amount) {
  const { walletClient, account } = requireWallet();
  const guard = guardAddress();
  const value = parseUnits(String(amount), 6);

  console.log(`  -> guardedPay ${amount} USDC to ${to} via guard ${guard} ...`);
  const hash = await walletClient.writeContract({
    address: guard,
    abi: guardAbi(),
    functionName: 'guardedPay',
    args: [to, value],
    account,
  });

  console.log(`  -> tx submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const url = `https://sepolia.etherscan.io/tx/${hash}`;
  console.log(`  -> ${receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED'}  ${url}`);

  return { hash, status: receipt.status, url };
}
