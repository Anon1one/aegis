// ── Reputation lane — MOCK (V1) ────────────────────────────────────────
// In the real product this queries endpoint-reputation feeds (x402 settlement
// history, shared denylists, etc.). For the buildathon it's a hardcoded map.
// Roadmap: live reputation oracle.

const DENYLIST = new Map([
  // address(lowercase) -> reason
]);

const ALLOWLIST = new Map([
  // address(lowercase) -> reason
]);

/**
 * @param {`0x${string}`} recipient
 * @returns {{lane:'reputation', level:string, reason:string, listed:string|null}}
 */
export function checkReputation(recipient) {
  const key = recipient.toLowerCase();

  if (DENYLIST.has(key)) {
    return {
      lane: 'reputation',
      level: 'HIGH',
      listed: 'deny',
      reason: `On denylist: ${DENYLIST.get(key)}`,
    };
  }
  if (ALLOWLIST.has(key)) {
    return {
      lane: 'reputation',
      level: 'LOW',
      listed: 'allow',
      reason: `On allowlist: ${ALLOWLIST.get(key)}`,
    };
  }
  return {
    lane: 'reputation',
    level: 'LOW',
    listed: null,
    reason: 'No reputation record (mock lane — allow/deny lists are empty in V1).',
  };
}
