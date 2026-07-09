// reputation lane - mock for now.
// real version would hit endpoint-reputation feeds (x402 history, shared
// denylists). for the demo it's just two maps. roadmap: live reputation oracle.

const DENYLIST = new Map([
  // address(lowercase) -> reason
]);

const ALLOWLIST = new Map([
  // address(lowercase) -> reason
]);

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
