import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalsByWorkerAndActivity, totalsOf, type MetricRecord } from '../../src/reports/metrics.ts';

function rec(over: Partial<MetricRecord> = {}): MetricRecord {
  return { workerId: 1, activity: 'VYCH', netSeconds: 600, lines: 10, units: 20, weightKg: 5, ...over };
}

test('totals add up volume and net time and derive speeds per hour', () => {
  const t = totalsOf([rec({ netSeconds: 600, lines: 10, units: 20, weightKg: 5 }), rec({ netSeconds: 1200, lines: 20, units: 40, weightKg: 10 })]);
  assert.equal(t.notes, 2);
  assert.equal(t.lines, 30);
  assert.equal(t.units, 60);
  assert.equal(t.weightKg, 15);
  assert.equal(t.netSeconds, 1800);
  assert.equal(t.notesPerHour, 4);
  assert.equal(t.linesPerHour, 60);
  assert.equal(t.kgPerHour, 30);
  assert.equal(t.avgSecondsPerNote, 900);
  assert.equal(t.avgSecondsPerLine, 60);
});

test('speeds and averages are null when the divisor is zero, never NaN or Infinity', () => {
  const none = totalsOf([]);
  assert.equal(none.notes, 0);
  assert.equal(none.netSeconds, 0);
  for (const v of [none.notesPerHour, none.linesPerHour, none.kgPerHour, none.avgSecondsPerNote, none.avgSecondsPerLine]) assert.equal(v, null);

  const noTime = totalsOf([rec({ netSeconds: 0 })]);
  assert.equal(noTime.notesPerHour, null);
  assert.equal(noTime.kgPerHour, null);
  assert.equal(noTime.avgSecondsPerNote, 0);

  const noLines = totalsOf([rec({ lines: 0 })]);
  assert.equal(noLines.linesPerHour, 0);
  assert.equal(noLines.avgSecondsPerLine, null);
});

test('a missing snapshot counts as zero volume', () => {
  const t = totalsOf([rec({ lines: null, units: null, weightKg: null, netSeconds: null })]);
  assert.equal(t.notes, 1);
  assert.equal(t.lines, 0);
  assert.equal(t.weightKg, 0);
  assert.equal(t.netSeconds, 0);
});

test('totals are grouped per worker and activity, picking before packing, then by worker', () => {
  const rows = totalsByWorkerAndActivity([
    rec({ workerId: 2, activity: 'BAL' }),
    rec({ workerId: 2, activity: 'VYCH' }),
    rec({ workerId: 1, activity: 'BAL' }),
    rec({ workerId: 1, activity: 'VYCH' }),
    rec({ workerId: 1, activity: 'VYCH' }),
  ]);
  assert.deepEqual(rows.map((r) => [r.activity, r.workerId, r.notes]), [['VYCH', 1, 2], ['VYCH', 2, 1], ['BAL', 1, 1], ['BAL', 2, 1]]);
});
