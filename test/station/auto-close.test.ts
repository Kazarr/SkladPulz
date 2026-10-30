import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeExpiredRecords } from '../../src/station/auto-close.ts';
import { handleScan } from '../../src/station/scan-service.ts';
import { createStation, getSignIn } from '../../src/store/stations.ts';
import { createWorker } from '../../src/store/workers.ts';
import { upsertNote } from '../../src/store/delivery-notes.ts';
import { getRecord } from '../../src/store/records.ts';
import { at, note, testEnv } from '../helpers.ts';

test('a record running past its shift is closed as neukoncene at the shift end, after the grace period', async () => {
  const env = testEnv({ autoCloseGraceMin: 30 }, at('13:10'));
  const st = createStation(env.db, 'Baliaci stôl', 'BAL').id;
  const w = createWorker(env.db, 'Ján', 'Z0001').id;
  upsertNote(env.db, note('DL1'), env.clock.t);
  await handleScan(env, st, 'Z0001');
  await handleScan(env, st, 'DL1');
  await handleScan(env, st, 'C-PAUZA');

  assert.deepEqual(closeExpiredRecords(env.db, env.config, at('14:29')), []);
  assert.deepEqual(closeExpiredRecords(env.db, env.config, at('14:30')), [1]);
  const r = getRecord(env.db, 1);
  assert.equal(r?.status, 'neukoncene');
  assert.equal(r?.endMethod, 'koniec_zmeny');
  assert.equal(r?.end, at('14:00'));
  assert.equal(r?.netSeconds, 0);
  assert.equal(r?.pauseSeconds, 50 * 60);
  assert.equal(r?.suspicion, null);
  assert.equal(getSignIn(env.db, w), null);
  const counted = env.db.prepare('SELECT count(*) AS n FROM zaznam_hodnotene').get() as { n: number };
  assert.equal(counted.n, 0);
});

test('a record that ends within the grace period stays ok', async () => {
  const env = testEnv({}, at('13:50'));
  const st = createStation(env.db, 'Baliaci stôl', 'BAL').id;
  createWorker(env.db, 'Ján', 'Z0001');
  upsertNote(env.db, note('DL1'), env.clock.t);
  await handleScan(env, st, 'Z0001');
  await handleScan(env, st, 'DL1');
  env.clock.set(at('14:05'));
  await handleScan(env, st, 'C-KONIEC');
  assert.deepEqual(closeExpiredRecords(env.db, env.config, at('15:00')), []);
  assert.equal(getRecord(env.db, 1)?.status, 'ok');
  assert.equal(getRecord(env.db, 1)?.netSeconds, 15 * 60);
});

test('a worker signed in without a running record is signed out after the shift', async () => {
  const env = testEnv({}, at('07:00'));
  const st = createStation(env.db, 'Baliaci stôl', 'BAL').id;
  const w = createWorker(env.db, 'Ján', 'Z0001').id;
  await handleScan(env, st, 'Z0001');
  closeExpiredRecords(env.db, env.config, at('14:10'));
  assert.ok(getSignIn(env.db, w));
  closeExpiredRecords(env.db, env.config, at('14:31'));
  assert.equal(getSignIn(env.db, w), null);
});
