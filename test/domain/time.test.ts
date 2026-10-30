import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localParts, localToEpoch } from '../../src/time.ts';

const TZ = 'Europe/Bratislava';
const HOUR = 3_600_000;

test('every quarter hour of 2026 round-trips through local parts; only the second pass of the autumn overlap maps to the earlier instant', () => {
  const start = Date.UTC(2025, 11, 31, 12);
  const end = Date.UTC(2027, 0, 1, 12);
  let overlapSecondPass = 0;
  for (let t = start; t < end; t += 15 * 60_000) {
    const p = localParts(t, TZ);
    if (p.year !== 2026) continue;
    const back = localToEpoch(p.year, p.month, p.day, p.hour, p.minute, TZ);
    if (back === t) continue;
    // Not the same instant: it must be the first pass of the same wall time, one hour earlier.
    assert.equal(back, t - HOUR, `instant ${new Date(t).toISOString()} came back as ${new Date(back).toISOString()}`);
    assert.deepEqual(localParts(back, TZ), p);
    overlapSecondPass++;
  }
  assert.equal(overlapSecondPass, 4); // 02:00-02:45 on 2026-10-25, second pass
});

test('spring: 01:00-01:59 on 2026-03-29 is still winter time', () => {
  assert.equal(localToEpoch(2026, 3, 29, 1, 0, TZ), Date.UTC(2026, 2, 29, 0, 0));
  assert.equal(localToEpoch(2026, 3, 29, 1, 59, TZ), Date.UTC(2026, 2, 29, 0, 59));
});

test('spring gap: a time that does not exist moves forward', () => {
  assert.equal(localToEpoch(2026, 3, 29, 2, 30, TZ), Date.UTC(2026, 2, 29, 1, 30)); // 03:30 CEST
  assert.equal(localToEpoch(2026, 3, 29, 3, 0, TZ), Date.UTC(2026, 2, 29, 1, 0));
});

test('autumn overlap: the earlier instant wins', () => {
  assert.equal(localToEpoch(2026, 10, 25, 2, 30, TZ), Date.UTC(2026, 9, 25, 0, 30)); // 02:30 CEST, not 02:30 CET
  assert.equal(localToEpoch(2026, 10, 25, 3, 0, TZ), Date.UTC(2026, 9, 25, 2, 0));
});
