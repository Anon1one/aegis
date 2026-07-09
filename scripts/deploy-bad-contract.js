// deploys recipient B: a tiny contract whose code contains SELFDESTRUCT, so
// the bytecode lane flags it HIGH -> BLOCK. no solc needed, just raw bytecode.
//
// runtime we want on-chain is 0x6000ff:
//   60 00   PUSH1 0x00
//   ff      SELFDESTRUCT   <- what the lane catches
//
// and the constructor that returns that runtime:
//   6003        PUSH1 0x03   (runtime length = 3)
//   600c        PUSH1 0x0c   (runtime starts at byte 12)
//   6000        PUSH1 0x00
//   39          CODECOPY     (copy runtime into memory[0])
//   6003        PUSH1 0x03
//   6000        PUSH1 0x00
//   f3          RETURN       (return memory[0..3] as the deployed code)
//
// full payload = constructor (12 bytes) + runtime (3 bytes):
const DEPLOY_BYTECODE = '0x6003600c60003960036000f36000ff';

import { publicClient, requireWallet } from '../src/config.js';

async function main() {
  const { walletClient, account } = requireWallet();

  console.log('\nDeploying malicious (SELFDESTRUCT) contract as Recipient B ...');
  const hash = await walletClient.sendTransaction({
    account,
    data: DEPLOY_BYTECODE,
    // no `to` => contract creation
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const addr = receipt.contractAddress;

  // double-check the deployed code is what we expect
  const code = await publicClient.getCode({ address: addr });
  console.log(`\nDeployed at: ${addr}`);
  console.log(`   runtime code: ${code}  ${code === '0x6000ff' ? '(contains SELFDESTRUCT)' : ''}`);
  console.log(`   etherscan: https://sepolia.etherscan.io/address/${addr}`);
  console.log(`\nPut this in your .env:\n   BAD_RECIPIENT="${addr}"\n`);
}

main().catch((err) => {
  console.error('\nerror:', err.shortMessage || err.message);
  process.exit(1);
});
