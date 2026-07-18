// offline tests for the Aegis x402 signer - the EIP-3009 enforcement chokepoint.
// no network: the policy verdict is injected so we exercise the guard itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { createAegisSigner, AegisPaymentRefused } from '../src/x402/signer.js';
import { DECISION } from '../src/aegis.js';

// a throwaway well-known test key (anvil #0). signing is pure crypto, no chain.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const USDC = '0x3600000000000000000000000000000000000000';
const CHAIN_ID = 5042002;
const NOW = 1000;

const PAYTO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// build a TransferWithAuthorization typed-data payload, with knobs to break it.
function payment({ asset = USDC, chainId = CHAIN_ID, to = PAYTO, value = 10_000n, ttl = 60 } = {}) {
  return {
    domain: { name: 'USDC', version: '2', chainId, verifyingContract: asset },
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to,
      value,
      validAfter: 0n,
      validBefore: BigInt(NOW + ttl),
      nonce: '0x' + '11'.repeat(32),
    },
  };
}

// a signer whose policy verdict and clock are fixed, so tests are deterministic.
function signerWith(decision, extra = {}) {
  return createAegisSigner(account, {
    usdc: USDC,
    chainId: CHAIN_ID,
    now: () => NOW,
    check: async () => ({ decision, reasons: ['(injected)'] }),
    ...extra,
  });
}

test('signs a clean PAY payment (returns a real signature)', async () => {
  const sig = await signerWith(DECISION.PAY).signTypedData(payment());
  assert.match(sig, /^0x[0-9a-f]{130}$/i); // 65-byte ecdsa signature
});

test('refuses when the verdict is BLOCK', async () => {
  await assert.rejects(
    () => signerWith(DECISION.BLOCK).signTypedData(payment()),
    (e) => e instanceof AegisPaymentRefused && e.verdict === DECISION.BLOCK,
  );
});

test('refuses when the verdict is ASK_HUMAN', async () => {
  await assert.rejects(
    () => signerWith(DECISION.ASK_HUMAN).signTypedData(payment()),
    (e) => e instanceof AegisPaymentRefused && e.verdict === DECISION.ASK_HUMAN,
  );
});

test('refuses a foreign asset even when the verdict would be PAY', async () => {
  // the killer case: a hostile 402 names its own contract "USDC".
  const evilAsset = '0x000000000000000000000000000000000000dEaD';
  await assert.rejects(
    () => signerWith(DECISION.PAY).signTypedData(payment({ asset: evilAsset })),
    (e) => e instanceof AegisPaymentRefused && /canonical USDC/.test(e.reason),
  );
});

test('refuses an authorization scoped to another chain', async () => {
  await assert.rejects(
    () => signerWith(DECISION.PAY).signTypedData(payment({ chainId: 1 })),
    (e) => e instanceof AegisPaymentRefused && /chainId/.test(e.reason),
  );
});

test('refuses a long-lived authorization (delayed-drain guard)', async () => {
  await assert.rejects(
    () => signerWith(DECISION.PAY).signTypedData(payment({ ttl: 3600 })),
    (e) => e instanceof AegisPaymentRefused && /cap/.test(e.reason),
  );
});

test('non-payment typed data passes straight through', async () => {
  // a generic EIP-712 login should not be touched by the payment guard.
  const login = {
    domain: { name: 'Login', version: '1', chainId: CHAIN_ID },
    types: { Login: [{ name: 'user', type: 'address' }] },
    primaryType: 'Login',
    message: { user: account.address },
  };
  // verdict is BLOCK, but this isn't a payment, so it must still sign.
  const sig = await signerWith(DECISION.BLOCK).signTypedData(login);
  assert.match(sig, /^0x[0-9a-f]{130}$/i);
});
