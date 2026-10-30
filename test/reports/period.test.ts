import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodAround, customPeriod, shiftPeriod } from '../../src/reports/period.ts';

test('a day is itself', () => {
  assert.deepEqual(periodAround('den', '2026-10-14'), { kind: 'den', from: '2026-10-14', to: '2026-10-14' });
});

test('a week is the ISO week, Monday to Sunday, wherever the date falls in it', () => {
  for (const d of ['2026-10-12', '2026-10-14', '2026-10-18']) assert.deepEqual(periodAround('tyzden', d), { kind: 'tyzden', from: '2026-10-12', to: '2026-10-18' });
  assert.equal(periodAround('tyzden', '2026-10-19').from, '2026-10-19');
});

test('an ISO week across a month end and across a year end', () => {
  assert.deepEqual(periodAround('tyzden', '2026-10-02'), { kind: 'tyzden', from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodAround('tyzden', '2026-12-31'), { kind: 'tyzden', from: '2026-12-28', to: '2027-01-03' });
});

test('a month is the calendar month with its real length', () => {
  assert.deepEqual(periodAround('mesiac', '2026-10-14'), { kind: 'mesiac', from: '2026-10-01', to: '2026-10-31' });
  assert.equal(periodAround('mesiac', '2026-09-30').to, '2026-09-30');
  assert.equal(periodAround('mesiac', '2026-02-10').to, '2026-02-28');
  assert.equal(periodAround('mesiac', '2028-02-10').to, '2028-02-29');
});

test('previous and next period: day and week move by their length, a month by calendar months', () => {
  assert.deepEqual(shiftPeriod(periodAround('den', '2026-10-01'), -1), { kind: 'den', from: '2026-09-30', to: '2026-09-30' });
  assert.deepEqual(shiftPeriod(periodAround('tyzden', '2026-10-14'), -1), { kind: 'tyzden', from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(shiftPeriod(periodAround('tyzden', '2026-10-14'), 1), { kind: 'tyzden', from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(shiftPeriod(periodAround('mesiac', '2026-03-10'), -1), { kind: 'mesiac', from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(shiftPeriod(periodAround('mesiac', '2026-01-10'), -1), { kind: 'mesiac', from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(shiftPeriod(periodAround('mesiac', '2026-12-10'), 1), { kind: 'mesiac', from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(shiftPeriod(periodAround('mesiac', '2026-01-31'), 1), { kind: 'mesiac', from: '2026-02-01', to: '2026-02-28' });
});

test('a custom range shifts by its own length, so the previous period has equal length', () => {
  const p = customPeriod('2026-10-10', '2026-10-16'); // 7 days
  assert.deepEqual(shiftPeriod(p, -1), { kind: 'vlastne', from: '2026-10-03', to: '2026-10-09' });
  assert.deepEqual(shiftPeriod(p, 1), { kind: 'vlastne', from: '2026-10-17', to: '2026-10-23' });
  const one = customPeriod('2026-10-10', '2026-10-10');
  assert.deepEqual(shiftPeriod(one, -1), { kind: 'vlastne', from: '2026-10-09', to: '2026-10-09' });
});

test('a custom range with the end before the start is refused', () => {
  assert.equal(customPeriod('2026-10-16', '2026-10-10'), null);
});
