// behavior lane - mock for now.
// real version would model spend velocity / anomalies. here it's just an
// amount threshold + a first-time-recipient nudge toward ASK_HUMAN.

// amounts are plain USDC numbers here (50 = 50 USDC), not base units
const AMOUNT_THRESHOLD = 50;

// recipients we've "seen before" (fake memory)
const KNOWN = new Set([
  // lowercase addresses we treat as familiar
]);

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
