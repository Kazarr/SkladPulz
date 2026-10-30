import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCloseAt, lastShiftEnd } from '../../src/domain/shifts.ts';
import { localDate, localDayRange, localToEpoch } from '../../src/time.ts';
import { at, TZ } from '../helpers.ts';

const SHIFTS = [
  { name: 'Ranná', from: '06:00', to: '14:00' },
  { name: 'Poobedná', from: '14:00', to: '22:00' },
];

test('a record closes at the end of the shift it started in', () => {
  assert.equal(autoCloseAt(at('06:00'), SHIFTS, TZ), at('14:00'));
  assert.equal(autoCloseAt(at('13:59'), SHIFTS, TZ), at('14:00'));
  assert.equal(autoCloseAt(at('14:00'), SHIFTS, TZ), at('22:00'));
});

test('a record started outside every shift closes at the end of the next shift', () => {
  assert.equal(autoCloseAt(at('23:00'), SHIFTS, TZ), at('14:00', '2026-10-15'));
  assert.equal(autoCloseAt(at('05:00'), SHIFTS, TZ), at('14:00'));
});

test('a night shift ends the next day', () => {
  const night = [{ name: 'Nočná', from: '22:00', to: '06:00' }];
  assert.equal(autoCloseAt(at('23:30'), night, TZ), at('06:00', '2026-10-15'));
  assert.equal(autoCloseAt(at('02:00', '2026-10-15'), night, TZ), at('06:00', '2026-10-15'));
});

test('without shifts a record closes at the next local midnight', () => {
  assert.equal(autoCloseAt(at('15:00'), [], TZ), at('00:00', '2026-10-15'));
});

test('the last shift of a day ends at its latest end', () => {
  assert.equal(lastShiftEnd('2026-10-14', SHIFTS, TZ), at('22:00'));
});

test('local days follow daylight saving time in Bratislava', () => {
  // 2026-10-25: clocks go back from 03:00 CEST to 02:00 CET, so the day has 25 hours.
  const r = localDayRange('2026-10-25', '2026-10-25', TZ);
  assert.equal(r.to - r.from, 25 * 3600 * 1000);
  assert.equal(localDate(r.from, TZ), '2026-10-25');
  assert.equal(localDate(r.to - 1, TZ), '2026-10-25');
  assert.equal(localToEpoch(2026, 10, 14, 8, 0, TZ), Date.UTC(2026, 9, 14, 6, 0));
  assert.equal(localToEpoch(2026, 12, 14, 8, 0, TZ), Date.UTC(2026, 11, 14, 7, 0));
});
