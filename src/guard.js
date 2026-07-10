// talks to the deployed AegisGuard contract.
// assess() is a read (the contract's own verdict), guardedPay() actually moves
// USDC from the treasury through the guard, and setupGuard() does the one-time
// wiring: treasury approves the guard for USDC and the owner whitelists the
// caller as an agent.
import { parseUnits, erc20Abi, keccak256 } from 'viem';
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

// the bridge between the two layers. once the off-chain analyzer (opcode scan +
// llm) is sure a recipient is malicious, we write that conclusion into the
// guard's own on-chain state, so from now on the contract blocks it by itself -
// even for an agent that never runs the off-chain check. note this only ever
// *tightens* policy (it writes blocklists, never the allowlist), so the worst a
// bad call can do is a false block, which the owner can undo with one tx.
//
// a real contract is blocked by codehash: that kills every address running the
// exact same bytecode, not just this one deployment. a plain wallet (or an
// EIP-7702 delegated EOA, which also carries code) has no code family we'd want
// to block wholesale, so it's denylisted by address instead. both setters are
// onlyOwner on-chain, so this needs the guard owner's key - in the demo the
// deployer is owner + treasury + agent.
export async function recordVerdictOnChain(to) {
  const { walletClient, account } = requireWallet();
  const guard = guardAddress();

  const code = await publicClient.getCode({ address: to });
  // eip-7702 delegated EOA: getCode returns 0xef0100 || <delegate>. that
  // "codehash" is shared by every account pointing at the same delegate, so
  // blocking it would take out unrelated wallets. treat it as an EOA.
  const lower = (code || '0x').toLowerCase();
  const isRealContract = lower !== '0x' && !lower.startsWith('0xef0100');

  try {
    if (isRealContract) {
      const codehash = keccak256(code);
      // idempotency: read the exact slot we're about to write, not assess() - the
      // address could already be blocked for some other reason while this
      // codehash isn't, and we'd wrongly skip recording the code family.
      const already = await publicClient.readContract({
        address: guard, abi: guardAbi(), functionName: 'blockedCodehash', args: [codehash],
      });
      if (already) {
        return { changed: false, message: `already blocked on-chain (bytecode ${codehash.slice(0, 10)}...) - recorded on an earlier run.` };
      }
      console.log(`  -> setBlockedCodehash(${codehash.slice(0, 10)}...) ...`);
      const hash = await walletClient.writeContract({
        address: guard, abi: guardAbi(), functionName: 'setBlockedCodehash', args: [codehash, true], account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { changed: true, message: `blocked its bytecode ${codehash.slice(0, 10)}... on-chain (kills every clone of this exact code).`, hash };
    }

    const already = await publicClient.readContract({
      address: guard, abi: guardAbi(), functionName: 'denylisted', args: [to],
    });
    if (already) {
      return { changed: false, message: `already denylisted on-chain - recorded on an earlier run.` };
    }
    console.log(`  -> setDenylisted(${to}) ...`);
    const hash = await walletClient.writeContract({
      address: guard, abi: guardAbi(), functionName: 'setDenylisted', args: [to, true], account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { changed: true, message: `denylisted ${to} on-chain.`, hash };
  } catch (err) {
    // e.g. run by someone who isn't the guard owner - degrade instead of crash.
    return { changed: false, message: `could not record on-chain: ${err.shortMessage || err.message}` };
  }
}

// true when `to` is a contract the guard hasn't been told to trust yet - which is
// exactly the on-chain condition behind a REVIEW of "unvetted contract recipient".
// we recompute it from state (has code, not allowlisted) rather than string-match
// the revert reason, so the two don't drift apart. an EIP-7702 EOA (0xef0100...)
// carries code but isn't a contract we'd allowlist, so it's excluded.
export async function needsVetting(to) {
  const guard = guardAddress();
  const code = await publicClient.getCode({ address: to });
  const lower = (code || '0x').toLowerCase();
  if (lower === '0x' || lower.startsWith('0xef0100')) return false;

  const allowed = await publicClient.readContract({
    address: guard, abi: guardAbi(), functionName: 'allowedContract', args: [to],
  });
  return !allowed;
}

// the allow direction of the bridge, and the mirror image of recordVerdictOnChain.
// it marks a contract as vetted (setAllowedContract) so the guard will auto-pay
// it from now on. this GRANTS trust, which is the dangerous direction - a wrong
// allow lets money out, where a wrong block only refuses a payment. so unlike
// blocking, this is never called silently: the caller (see agent.js runGuard)
// gets an explicit owner confirmation first. here we just do the owner-only write.
export async function allowlistOnChain(to) {
  const { walletClient, account } = requireWallet();
  const guard = guardAddress();

  const already = await publicClient.readContract({
    address: guard, abi: guardAbi(), functionName: 'allowedContract', args: [to],
  });
  if (already) {
    return { changed: false, message: `already allowlisted on-chain.` };
  }

  try {
    console.log(`  -> setAllowedContract(${to}) ...`);
    const hash = await walletClient.writeContract({
      address: guard, abi: guardAbi(), functionName: 'setAllowedContract', args: [to, true], account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { changed: true, message: `allowlisted ${to} on-chain.`, hash };
  } catch (err) {
    return { changed: false, message: `could not allowlist on-chain: ${err.shortMessage || err.message}` };
  }
}
