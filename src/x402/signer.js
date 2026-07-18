// The Aegis x402 signer - the enforcement chokepoint on the x402 rail.
//
// An x402 "exact" payment is not a transaction the agent broadcasts. It is an
// EIP-3009 TransferWithAuthorization signed with signTypedData; a facilitator
// later calls transferWithAuthorization() on USDC and moves the money. That
// means the payment NEVER passes through AegisGuard.guardedPay - the on-chain
// firewall can't see it. On this rail the irreversible act is *creating the
// signature*, so that is where Aegis has to stand.
//
// This wraps a viem account so the only way to produce an EIP-3009 signature is
// through Aegis policy. The idea (per Fable) is that the agent is handed THIS
// object, never the raw key - so a prompt-injected agent, which can only act
// through the tools it's given, cannot sign a payment Aegis would refuse. (If
// the whole process is compromised the raw key still leaks; that's what the
// out-of-process signer + the on-chain float cap are for. We don't overclaim.)
//
// Enforcement here is two things, both fail-closed:
//   1. hard invariants that don't need any network call - the signed authorization
//      MUST be for our canonical USDC, on our chain, and short-lived.
//   2. the same aegisCheck() verdict used everywhere else, run on the payTo.
import { aegisCheck, DECISION } from '../aegis.js';
import { chain, addresses, assertAddress } from '../config.js';

// EIP-3009 primary types that actually move value. Any of these is a payment.
const PAYMENT_TYPES = new Set(['TransferWithAuthorization', 'ReceiveWithAuthorization']);

// absolute cap on how far in the future a signed authorization may be valid.
// PaymentRequirements carry a maxTimeoutSeconds, but we don't trust the server to
// keep it small - a long-lived signature is a payment someone can settle weeks
// later, after the context that justified it is gone. honor the smaller of the two.
const MAX_TTL_SECONDS = 120;

export class AegisPaymentRefused extends Error {
  constructor(reason, verdict = DECISION.BLOCK) {
    super(`Aegis refused to sign this x402 payment: ${reason}`);
    this.name = 'AegisPaymentRefused';
    this.verdict = verdict;
    this.reason = reason;
  }
}

// value is USDC base units (6 decimals on the ERC-20 iface). aegisCheck's
// behavior lane thinks in whole USDC, so convert at this edge and keep every
// on-the-wire number in base units.
function baseUnitsToUsdc(value) {
  return Number(BigInt(value)) / 1e6;
}

// pull { to, value, validBefore } out of the typed-data message regardless of
// whether the fields arrive as strings, numbers or bigints.
function readAuthorization(message) {
  return {
    to: message.to,
    value: BigInt(message.value),
    validAfter: BigInt(message.validAfter ?? 0),
    validBefore: BigInt(message.validBefore ?? 0),
    nonce: message.nonce,
  };
}

// the guard that runs before we sign an EIP-3009 authorization.
async function assertPaymentAllowed({ domain, message }, { usdc, chainId, maxTtl, check, now }) {
  const auth = readAuthorization(message);

  // --- invariant 1: the asset. a hostile 402 can name any contract "USDC" and
  // have us sign EIP-712 against it. refuse unless the verifyingContract is the
  // exact USDC we guard. this is the single most important line here.
  const signedAsset = String(domain.verifyingContract || '').toLowerCase();
  if (signedAsset !== usdc.toLowerCase()) {
    throw new AegisPaymentRefused(
      `authorization is against ${domain.verifyingContract}, not the canonical USDC ${usdc}.`,
    );
  }

  // --- invariant 2: the chain. don't sign an authorization scoped to another
  // chain's USDC/domain.
  if (Number(domain.chainId) !== chainId) {
    throw new AegisPaymentRefused(
      `authorization is for chainId ${domain.chainId}, not our chain ${chainId}.`,
    );
  }

  // --- invariant 3: freshness. cap how long the signed payment stays spendable.
  const ttl = auth.validBefore - BigInt(now);
  if (auth.validBefore !== 0n && ttl > BigInt(maxTtl)) {
    throw new AegisPaymentRefused(
      `authorization valid for ${ttl}s, over the ${maxTtl}s cap - a long-lived signature is a delayed drain.`,
    );
  }

  // --- the policy verdict: run the same firewall on the payTo. a contract
  // recipient gets its bytecode read; a denylisted/known-bad one is refused.
  const verdict = await check(auth.to, baseUnitsToUsdc(auth.value));
  if (verdict.decision !== DECISION.PAY) {
    throw new AegisPaymentRefused(
      `verdict ${verdict.decision} on payTo ${auth.to}` +
        (verdict.reasons?.length ? ` - ${verdict.reasons[0]}` : ''),
      verdict.decision,
    );
  }

  return { auth, verdict };
}

// wrap a viem account into an Aegis-guarded signer. it stays a drop-in account
// (so it can be handed straight to x402's ExactEvmScheme(signer)), but any
// EIP-3009 payment authorization has to clear policy before it's signed.
// non-payment typed data (logins, generic EIP-712) passes straight through.
export function createAegisSigner(account, opts = {}) {
  const {
    usdc = assertAddress('USDC_ADDRESS', addresses.usdc),
    chainId = chain.id,
    maxTtl = MAX_TTL_SECONDS,
    check = (to, amount) => aegisCheck(to, amount),
    onRefuse = null, // optional hook so the CLI can print the refusal nicely
    now = () => Math.floor(Date.now() / 1000),
  } = opts;

  async function signTypedData(params) {
    if (PAYMENT_TYPES.has(params.primaryType)) {
      try {
        await assertPaymentAllowed(params, { usdc, chainId, maxTtl, check, now: now() });
      } catch (err) {
        if (err instanceof AegisPaymentRefused && onRefuse) onRefuse(err);
        throw err;
      }
    }
    return account.signTypedData(params);
  }

  // keep everything else the account exposes (address, publicKey, signMessage,
  // signTransaction, type, source) and only override the payment path.
  return { ...account, signTypedData };
}
