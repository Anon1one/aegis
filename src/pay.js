// ── Execute a real USDC (ERC-20) transfer on Sepolia ───────────────────
import { parseUnits, erc20Abi } from 'viem';
import { publicClient, requireWallet, addresses, assertAddress } from './config.js';

// USDC has 6 decimals. Cache it after the first read so we don't refetch.
let _decimals = null;
async function usdcDecimals(usdc) {
  if (_decimals !== null) return _decimals;
  try {
    _decimals = await publicClient.readContract({
      address: usdc, abi: erc20Abi, functionName: 'decimals',
    });
  } catch {
    _decimals = 6; // USDC default
  }
  return _decimals;
}

/**
 * Send `amount` USDC to `recipient`. Returns the tx hash after 1 confirmation.
 * @param {`0x${string}`} recipient
 * @param {number|string} amount  human USDC amount
 */
export async function payUSDC(recipient, amount) {
  const { walletClient, account } = requireWallet();
  const usdc = assertAddress('USDC_ADDRESS', addresses.usdc);
  assertAddress('recipient', recipient);

  const decimals = await usdcDecimals(usdc);
  const value = parseUnits(String(amount), decimals);

  console.log(`  → sending ${amount} USDC to ${recipient} ...`);
  const hash = await walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, value],
    account,
  });

  console.log(`  → tx submitted: ${hash}`);
  console.log('  → waiting for confirmation ...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const url = `https://sepolia.etherscan.io/tx/${hash}`;
  console.log(`  → ${receipt.status === 'success' ? 'CONFIRMED ✅' : 'REVERTED ❌'}  ${url}`);

  return { hash, status: receipt.status, url };
}
