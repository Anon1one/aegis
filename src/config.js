// env + viem clients. defaults to Arc (Circle's stablecoin L1), the chain we're
// building the hackathon MVP on; set CHAIN=sepolia to fall back to the original
// Ethereum testnet deployment.
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, isAddress, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Arc testnet, verified against docs.arc.io. USDC is the native gas token (18
// decimals) AND is exposed as a 6-decimal ERC-20 at the address below - that
// ERC-20 is the USDC the guard actually moves via transferFrom.
export const ARC_USDC = '0x3600000000000000000000000000000000000000';
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
});

const CHAINS = { arc: arcTestnet, sepolia };
const CHAIN = (process.env.CHAIN || 'arc').toLowerCase();
export const chain = CHAINS[CHAIN] ?? arcTestnet;

const {
  RPC_URL,
  PRIVATE_KEY,
  USDC_ADDRESS,
  GOOD_RECIPIENT,
  BAD_RECIPIENT,
  AEGIS_GUARD,
} = process.env;

// Arc has a public RPC baked into the chain def, so RPC_URL is optional there;
// Sepolia has no default we'd want to hardcode, so it stays required.
const rpcUrl = RPC_URL || chain.rpcUrls.default.http[0];
if (!rpcUrl) {
  throw new Error('RPC_URL missing in .env - copy .env.example to .env and fill it in.');
}

// read-only client, always available
export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

// only build the wallet if a key is present, so balance/bytecode checks
// still run before the key is filled in
let _account = null;
let _walletClient = null;
if (PRIVATE_KEY && PRIVATE_KEY.trim() !== '') {
  const key = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  _account = privateKeyToAccount(key);
  _walletClient = createWalletClient({
    account: _account,
    chain,
    transport: http(rpcUrl),
  });
}

export const account = _account;
export const walletClient = _walletClient;

// call this before sending anything
export function requireWallet() {
  if (!_walletClient || !_account) {
    throw new Error('PRIVATE_KEY missing in .env - needed to send transactions.');
  }
  return { walletClient: _walletClient, account: _account };
}

export const addresses = {
  // on Arc the USDC ERC-20 iface lives at a known fixed address, so default to it
  // and let .env override; on any other chain it must be set explicitly.
  usdc: USDC_ADDRESS || (chain.id === arcTestnet.id ? ARC_USDC : undefined),
  good: GOOD_RECIPIENT,
  bad: BAD_RECIPIENT,
  guard: AEGIS_GUARD, // the deployed AegisGuard, set after deploy-guard
};

export function assertAddress(label, value) {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value ?? '(empty)'} - check your .env`);
  }
  return value;
}

// block-explorer links for the active chain (arcscan on Arc, etherscan on
// sepolia) so demo output always points at the right explorer.
const explorer = chain.blockExplorers.default.url;
export function txUrl(hash) {
  return `${explorer}/tx/${hash}`;
}
export function addressUrl(addr) {
  return `${explorer}/address/${addr}`;
}
