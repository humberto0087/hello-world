import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amortizedPayment, fixAndFlip, construction, dscr } from '../../docs/js/finance.js';

const close = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('amortizedPayment matches standard mortgage math', () => {
  close(amortizedPayment(500000, 7, 30), 3326.51, 0.01);
  close(amortizedPayment(120000, 0, 10), 1000, 0.001);
});

test('fix & flip loan capped by ARV', () => {
  const r = fixAndFlip({ purchase: 800000, rehab: 200000, arv: 1200000 });
  // requested = 720k + 200k = 920k; cap = 900k
  assert.equal(r.loan, 900000);
  assert.equal(r.limitedByArv, true);
  assert.equal(r.maxOffer70, 640000);
  close(r.cashNeeded, 800000 + 200000 + 16000 + 18000 - 900000);
  assert.ok(r.profit < 1200000);
});

test('construction loan sized by lower of LTC and LTV', () => {
  const r = construction({ land: 1000000, hard: 2000000, soft: 300000, completedValue: 4000000 });
  assert.equal(r.byLtc, 2640000);
  assert.equal(r.byLtv, 2800000);
  assert.equal(r.loan, 2640000);
  assert.equal(r.limitedByLtv, false);
});

test('dscr', () => {
  const r = dscr({ price: 2000000, downPct: 25, ratePct: 7, monthlyRent: 14000, insuranceAnnual: 6000 });
  assert.equal(r.loan, 1500000);
  close(r.monthlyPI, 9979.54, 0.05);
  assert.ok(r.dscrRent > 1 && r.dscrRent < 1.3);
  assert.ok(r.capRatePct > 4 && r.capRatePct < 7);
});
