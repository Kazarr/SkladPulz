import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, estimateWeights, MIN_ESTIMATE_RECORDS, performanceIndex, standardSeconds, type IndexRecord, type Weights } from '../../src/domain/index.ts';
import { totalsOf } from '../../src/reports/metrics.ts';

const W: Weights = { fixedSeconds: 60, perLineSeconds: 25, perKgSeconds: 0.5 };
const rec = (lines: number | null, kg: number | null, net: number): IndexRecord => ({ netSeconds: net, lines, weightKg: kg });

test('defaults are the agreed placeholders', () => {
  assert.deepEqual(DEFAULT_WEIGHTS.VYCH, { fixedSeconds: 60, perLineSeconds: 25, perKgSeconds: 0.5 });
  assert.deepEqual(DEFAULT_WEIGHTS.BAL, { fixedSeconds: 45, perLineSeconds: 12, perKgSeconds: 0.8 });
});

test('standard time = fixed + per line x lines + per kg x kg; a missing snapshot counts as 0', () => {
  assert.equal(standardSeconds(W, rec(2, 3, 0)), 60 + 50 + 1.5);
  assert.equal(standardSeconds(W, rec(40, 60, 0)), 60 + 1000 + 30);
  assert.equal(standardSeconds(W, rec(null, null, 0)), 60);
});

test('the index of the whole team is exactly 100 %', () => {
  const team = [rec(2, 1, 90), rec(40, 20, 1000), rec(10, 5, 400), rec(7, 3, 123)];
  assert.equal(performanceIndex(W, team, team), 100);
});

test('a worker on big notes and one on small notes at the same pace get the same index, while their notes/h differ', () => {
  // standard 110.5 s for 2 lines / 1 kg and 1070 s for 40 lines / 20 kg
  const small = Array.from({ length: 10 }, () => rec(2, 1, 88.4)); // pace 1.25 x norm
  const big = [rec(40, 20, 856)]; // pace 1.25 x norm
  const slow = [rec(40, 20, 1337.5)]; // pace 0.8 x norm
  const team = [...small, ...big, ...slow];
  const teamRaw = (10 * 110.5 + 1070 + 1070) / (884 + 856 + 1337.5);
  const expected = (1.25 / teamRaw) * 100;
  assert.ok(Math.abs((performanceIndex(W, small, team) ?? 0) - expected) < 1e-9);
  assert.ok(Math.abs((performanceIndex(W, big, team) ?? 0) - expected) < 1e-9);
  assert.ok(expected > 100);
  assert.ok((performanceIndex(W, slow, team) ?? 999) < 100);
  assert.ok((totalsOf([{ workerId: 1, activity: 'VYCH', netSeconds: 88.4, lines: 2, units: 0, weightKg: 1 }]).notesPerHour ?? 0) > 10 * (totalsOf([{ workerId: 2, activity: 'VYCH', netSeconds: 856, lines: 40, units: 0, weightKg: 20 }]).notesPerHour ?? 0));
});

test('the index is null when there is no net time, no records or the team has no standard time', () => {
  assert.equal(performanceIndex(W, [], [rec(1, 1, 10)]), null);
  assert.equal(performanceIndex(W, [rec(1, 1, 0)], [rec(1, 1, 0)]), null);
  assert.equal(performanceIndex({ fixedSeconds: 0, perLineSeconds: 0, perKgSeconds: 0 }, [rec(1, 1, 10)], [rec(1, 1, 10)]), null);
});

function synthetic(n: number, f: (lines: number, kg: number) => number): IndexRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const lines = 1 + ((i * 7) % 25);
    const kg = 0.5 + ((i * 13) % 17) * 1.3;
    return rec(lines, kg, f(lines, kg));
  });
}
const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('regression recovers known weights from noiseless data', () => {
  const r = estimateWeights(synthetic(40, (l, kg) => 50 + 20 * l + 0.7 * kg));
  assert.ok(r.ok);
  close(r.weights.fixedSeconds, 50);
  close(r.weights.perLineSeconds, 20);
  close(r.weights.perKgSeconds, 0.7);
  close(r.r2 ?? 0, 1);
  assert.equal(r.records, 40);
  assert.deepEqual(r.clamped, []);
});

test('regression refuses fewer than the minimum number of records and accepts exactly the minimum', () => {
  assert.equal(MIN_ESTIMATE_RECORDS, 30);
  const few = estimateWeights(synthetic(29, (l) => 50 + 20 * l));
  assert.deepEqual(few, { ok: false, reason: 'too_few', records: 29 });
  assert.ok(estimateWeights(synthetic(30, (l, kg) => 50 + 20 * l + 0.7 * kg)).ok);
});

test('regression refuses a singular matrix: every note has the same line count and kg', () => {
  const same = Array.from({ length: 40 }, (_, i) => rec(5, 10, 300 + (i % 7)));
  assert.deepEqual(estimateWeights(same), { ok: false, reason: 'singular', records: 40 });
  // weight proportional to lines is just as degenerate
  const proportional = synthetic(40, (l) => 50 + 20 * l).map((r) => ({ ...r, weightKg: (r.lines ?? 0) * 2 }));
  assert.equal(estimateWeights(proportional).ok, false);
});

test('a kg column that is zero everywhere (no weights known) is fitted as weight 0 instead of refusing', () => {
  const r = estimateWeights(synthetic(40, (l) => 50 + 20 * l).map((x) => ({ ...x, weightKg: null })));
  assert.ok(r.ok);
  close(r.weights.perKgSeconds, 0);
  close(r.weights.perLineSeconds, 20);
  close(r.weights.fixedSeconds, 50);
});

test('a negative coefficient is clamped to 0 and the fit is recomputed for the rest', () => {
  const data = synthetic(40, (l, kg) => 50 + 20 * l - 0.5 * kg);
  const r = estimateWeights(data);
  assert.ok(r.ok);
  assert.equal(r.weights.perKgSeconds, 0);
  assert.deepEqual(r.clamped, ['perKgSeconds']);
  assert.ok((r.r2 ?? 1) < 1);
  // the rest equals the fit that never had the kg column
  const without = estimateWeights(data.map((x) => ({ ...x, weightKg: null })));
  assert.ok(without.ok);
  close(r.weights.fixedSeconds, without.weights.fixedSeconds);
  close(r.weights.perLineSeconds, without.weights.perLineSeconds);
});

test('a negative intercept is clamped too: the fit then passes through the origin', () => {
  const data = synthetic(40, (l) => -30 + 20 * l).map((x) => ({ ...x, weightKg: null }));
  const r = estimateWeights(data);
  assert.ok(r.ok);
  assert.equal(r.weights.fixedSeconds, 0);
  assert.deepEqual(r.clamped, ['fixedSeconds']);
  const sxy = data.reduce((s, x) => s + (x.lines ?? 0) * (x.netSeconds ?? 0), 0);
  const sxx = data.reduce((s, x) => s + (x.lines ?? 0) ** 2, 0);
  close(r.weights.perLineSeconds, sxy / sxx);
});
