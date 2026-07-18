// offline tests for the JIT-float top-up decision (floatPlan). the branch logic
// - when to refill, and by how much - is pure and chain-free; the on-chain half
// (ensureFloat actually calling guardedPay, metered by the daily cap) is covered
// against anvil in guard.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import { floatPlan } from '../src/guard.js';

const usd = (n) => parseUnits(String(n), 6); // 6-dec base units, same as the guard

test('no top-up while the float is at or above the refill threshold', () => {
  assert.deepEqual(floatPlan({ balance: usd(5), target: usd(5), min: usd(2) }), { topUp: false, amount: 0n });
  // exactly at min still counts as enough - don't churn a guard tx on the boundary
  assert.deepEqual(floatPlan({ balance: usd(2), target: usd(5), min: usd(2) }), { topUp: false, amount: 0n });
});

test('tops back up to target (not just to min) once below the threshold', () => {
  const plan = floatPlan({ balance: usd(1), target: usd(5), min: usd(2) });
  assert.equal(plan.topUp, true);
  assert.equal(plan.amount, usd(4)); // 5 - 1, refill to the full target
});

test('an empty float asks for the whole target', () => {
  assert.deepEqual(floatPlan({ balance: 0n, target: usd(5), min: usd(2) }), { topUp: true, amount: usd(5) });
});

test('min defaulting to target refills on any shortfall', () => {
  // callers can pass min == target; then any dip below target triggers a refill
  assert.deepEqual(floatPlan({ balance: usd(3), target: usd(5), min: usd(5) }), { topUp: true, amount: usd(2) });
});

test('a min above target is a misconfiguration, not a silent pass', () => {
  assert.throws(() => floatPlan({ balance: 0n, target: usd(2), min: usd(5) }), /cannot exceed target/);
});
