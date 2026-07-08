// ── Behavior lane — MOCK (V1) ──────────────────────────────────────────
// In the real product this models spend velocity, anomaly detection, etc.
// For the buildathon: a simple amount threshold + first-time-recipient nudge
// toward ASK_HUMAN. Roadmap: full behavioral risk model.

// USDC amounts here are plain numbers (e.g. 50 = 50 USDC), not base units.
const AMOUNT_THRESHOLD = 50; // over this to an unknown recipient → escalate

// Recipients we've "seen before" (mock memory).
const KNOWN = new Set([
  // lowercase addresses we consider familiar
]);

/**
 * @param {`0x${string}`} recipient
 * @param {number} amount  human USDC amount
 * @returns {{lane:'behavior', level:string, reason:string, escalate:boolean}}
 */
export function checkBehavior(recipient, amount) {
  const firstTime = !KNOWN.has(recipient.toLowerCase());
  const large = amount > AMOUNT_THRESHOLD;

  if (large && firstTime) {
    return {
      lane: 'behavior',
      level: 'MEDIUM',
      escalate: true,
      reason: `Large payment (${amount} USDC > ${AMOUNT_THRESHOLD}) to a first-time recipient — worth a human glance.`,
    };
  }
  return {
    lane: 'behavior',
    level: 'LOW',
    escalate: false,
    reason: `Amount ${amount} USDC within normal range for this recipient.`,
  };
}
