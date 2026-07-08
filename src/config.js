// env + viem clients for sepolia
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const {
  RPC_URL,
  PRIVATE_KEY,
  USDC_ADDRESS,
  GOOD_RECIPIENT,
  BAD_RECIPIENT,
} = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing in .env — copy .env.example to .env and fill it in.');
}

// read-only client, always available
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
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
    chain: sepolia,
    transport: http(RPC_URL),
  });
}

export const account = _account;
export const walletClient = _walletClient;

// call this before sending anything
export function requireWallet() {
  if (!_walletClient || !_account) {
    throw new Error('PRIVATE_KEY missing in .env — needed to send transactions.');
  }
  return { walletClient: _walletClient, account: _account };
}

export const addresses = {
  usdc: USDC_ADDRESS,
  good: GOOD_RECIPIENT,
  bad: BAD_RECIPIENT,
};

export function assertAddress(label, value) {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value ?? '(empty)'} — check your .env`);
  }
  return value;
}
