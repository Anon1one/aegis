// Sanity check: print wallet USDC + ETH balance, and verify the USDC address.
// Run this FIRST after filling .env — proves the connection before any logic.
import { formatUnits, formatEther, erc20Abi } from 'viem';
import { publicClient, account, addresses, assertAddress } from '../src/config.js';

async function main() {
  if (!account) {
    throw new Error('No account — fill PRIVATE_KEY in .env first.');
  }
  const usdc = assertAddress('USDC_ADDRESS', addresses.usdc);

  console.log(`\nWallet: ${account.address}`);
  console.log('Chain:  Sepolia\n');

  // ETH (gas)
  const wei = await publicClient.getBalance({ address: account.address });
  console.log(`ETH balance:  ${formatEther(wei)} ETH`);

  // USDC — read symbol/decimals to confirm we're pointing at real USDC
  const [symbol, decimals, raw] = await Promise.all([
    publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
  ]);

  console.log(`Token @ ${usdc}`);
  console.log(`  symbol:   ${symbol}   (expect USDC)`);
  console.log(`  decimals: ${decimals}`);
  console.log(`  balance:  ${formatUnits(raw, decimals)} ${symbol}`);

  const ok = symbol.toUpperCase().includes('USDC') && Number(formatUnits(raw, decimals)) > 0;
  console.log(`\n${ok ? '✅ Looks right — USDC address confirmed and wallet funded.' : '⚠️  Check the USDC_ADDRESS / balance above.'}\n`);
}

main().catch((err) => {
  console.error('\n❌ error:', err.shortMessage || err.message);
  process.exit(1);
});
