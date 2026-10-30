import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../../src/config.ts';
import { syncActiveNotes } from '../../src/onix/sync.ts';
import { createOnixSource } from '../../src/onix/onix-source.ts';
import { getNote, upsertNote } from '../../src/store/delivery-notes.ts';
import { lastSyncRuns } from '../../src/store/onix-sync.ts';
import { endRecord, getRecord, startRecord } from '../../src/store/records.ts';
import { createWorker } from '../../src/store/workers.ts';
import { createApp } from '../../src/web/app.ts';
import { at, note, testEnv } from '../helpers.ts';
import { addDl, onixDb } from './helpers.ts';

const LIMITS = { shortSeconds: 20, longSeconds: 7200 };

function active(env: ReturnType<typeof testEnv>): string[] {
  return (env.db.prepare('SELECT cislo FROM dodaci_list WHERE aktivny = 1 ORDER BY cislo').all() as { cislo: string }[]).map((r) => r.cislo);
}

test('every active note is cached as active and the run is recorded', async () => {
  const env = testEnv();
  env.source.add(note('DL1', { lines: 3, weightKg: 9 }), note('DL2'));
  const result = await syncActiveNotes(env.db, env.source, env.clock.t);
  assert.deepEqual(result, { ok: true, count: 2 });
  assert.deepEqual(active(env), ['DL1', 'DL2']);
  assert.equal(getNote(env.db, 'DL1')?.weightKg, 9);
  assert.deepEqual(lastSyncRuns(env.db).last, { at: env.clock.t, ok: true, count: 2, error: null });
});

test('a note that left the active list becomes inactive but stays cached; a changed note is refreshed', async () => {
  const env = testEnv();
  env.source.add(note('DL1'), note('DL2', { lines: 1 }));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  env.source.notes.delete('DL1');
  env.source.add(note('DL2', { lines: 8 }));
  await syncActiveNotes(env.db, env.source, env.clock.advance(120));
  assert.deepEqual(active(env), ['DL2']);
  assert.equal(getNote(env.db, 'DL1')?.customer, 'Odberateľ DL1');
  assert.equal(getNote(env.db, 'DL2')?.lines, 8);
});

test('a note cached by number (inactive) joins the active list when ONIX lists it', async () => {
  const env = testEnv();
  upsertNote(env.db, note('DL1'), env.clock.t, false);
  env.source.add(note('DL1'));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  assert.deepEqual(active(env), ['DL1']);
});

test('records keep their snapshot when the note changes or vanishes', async () => {
  const env = testEnv();
  const worker = createWorker(env.db, 'Ján', 'Z0001').id;
  env.source.add(note('DL1', { lines: 4, weightKg: 10 }));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  const id = startRecord(env.db, { workerId: worker, stationId: null, activity: 'VYCH', dlNumber: 'DL1', at: at('08:00'), duplicate: false });
  endRecord(env.db, id, { at: at('08:05'), method: 'koniec', status: 'ok', limits: LIMITS });
  env.source.add(note('DL1', { lines: 99, weightKg: 99 }));
  await syncActiveNotes(env.db, env.source, env.clock.advance(60));
  env.source.notes.clear();
  env.source.add(note('OTHER'));
  await syncActiveNotes(env.db, env.source, env.clock.advance(60));
  assert.deepEqual([getRecord(env.db, id)?.lines, getRecord(env.db, id)?.weightKg], [4, 10]);
});

test('a record that ended while the note was unknown gets its snapshot when the note arrives', async () => {
  const env = testEnv();
  const worker = createWorker(env.db, 'Ján', 'Z0001').id;
  const id = startRecord(env.db, { workerId: worker, stationId: null, activity: 'VYCH', dlNumber: 'DL1', at: at('08:00'), duplicate: false });
  endRecord(env.db, id, { at: at('08:05'), method: 'koniec', status: 'ok', limits: LIMITS });
  assert.equal(getRecord(env.db, id)?.lines, null);
  env.source.add(note('DL1', { lines: 6, units: 20, weightKg: 12 }));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  const r = getRecord(env.db, id);
  assert.deepEqual([r?.lines, r?.units, r?.weightKg], [6, 20, 12]);
});

function endedWithoutSnapshot(env: ReturnType<typeof testEnv>, worker: number, dl: string, minute: number): number {
  const id = startRecord(env.db, { workerId: worker, stationId: null, activity: 'VYCH', dlNumber: dl, at: at('08:00') + minute * 60_000, duplicate: false });
  endRecord(env.db, id, { at: at('08:00') + minute * 60_000 + 300_000, method: 'koniec', status: 'ok', limits: LIMITS });
  return id;
}

test('a sync fetches by number the notes of ended records without a snapshot that are not in the active list', async () => {
  const env = testEnv();
  const worker = createWorker(env.db, 'Ján', 'Z0001').id;
  const id = endedWithoutSnapshot(env, worker, 'OLD1', 0);
  env.source.add(note('DL1'));
  env.source.inactive.set('OLD1', note('OLD1', { lines: 7, units: 21, weightKg: 8 }));
  assert.deepEqual(await syncActiveNotes(env.db, env.source, env.clock.t), { ok: true, count: 1 });
  const r = getRecord(env.db, id);
  assert.deepEqual([r?.lines, r?.units, r?.weightKg], [7, 21, 8]);
  assert.deepEqual(active(env), ['DL1']); // the fetched note is cached as inactive
  assert.equal(getNote(env.db, 'OLD1')?.lines, 7);
  const calls = env.source.calls.length;
  await syncActiveNotes(env.db, env.source, env.clock.advance(60));
  assert.deepEqual(env.source.calls.slice(calls), ['active']); // nothing left to look up
});

test('at most 50 notes are looked up per run, newest records first; one that cannot be fetched does not fail the run', async () => {
  const env = testEnv();
  const worker = createWorker(env.db, 'Ján', 'Z0001').id;
  env.source.add(note('DL1'));
  const ids: number[] = [];
  for (let i = 0; i < 52; i++) {
    env.source.inactive.set(`OLD${i}`, note(`OLD${i}`, { lines: 3 }));
    ids.push(endedWithoutSnapshot(env, worker, `OLD${i}`, i));
  }
  env.source.failFor.add('OLD51'); // the newest record's note throws
  assert.equal((await syncActiveNotes(env.db, env.source, env.clock.t)).ok, true);
  assert.equal(env.source.calls.filter((c) => c !== 'active').length, 50);
  const filled = ids.filter((id) => getRecord(env.db, id)?.lines === 3).length;
  assert.equal(filled, 49); // 50 looked up, one of them failed
  env.source.failFor.clear();
  await syncActiveNotes(env.db, env.source, env.clock.advance(60));
  assert.equal(ids.filter((id) => getRecord(env.db, id)?.lines === 3).length, 52);
});

test('an empty list from ONIX changes nothing and is reported as a failed run', async () => {
  const env = testEnv();
  env.source.add(note('DL1'));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  env.source.notes.clear();
  const result = await syncActiveNotes(env.db, env.source, env.clock.advance(120));
  assert.equal(result.ok, false);
  assert.deepEqual(active(env), ['DL1']);
  const { last, lastOk } = lastSyncRuns(env.db);
  assert.equal(last?.ok, false);
  assert.match(last?.error ?? '', /prázdny/);
  assert.equal(lastOk?.count, 1);
});

test('ONIX throwing leaves the cache untouched and records an error run; the next good run recovers', async () => {
  const env = testEnv();
  env.source.add(note('DL1'));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  env.source.down = true;
  const result = await syncActiveNotes(env.db, env.source, env.clock.advance(120));
  assert.deepEqual(result, { ok: false, error: 'ONIX down' });
  assert.deepEqual(active(env), ['DL1']);
  assert.deepEqual(lastSyncRuns(env.db).last, { at: env.clock.t, ok: false, count: null, error: 'ONIX down' });
  assert.equal(lastSyncRuns(env.db).lastOk?.count, 1);
  env.source.down = false;
  assert.equal((await syncActiveNotes(env.db, env.source, env.clock.advance(120))).ok, true);
  assert.equal(lastSyncRuns(env.db).last?.ok, true);
});

test('a write failure midway rolls the whole sync back', async () => {
  const env = testEnv();
  env.source.add(note('DL1'), note('DL2'));
  await syncActiveNotes(env.db, env.source, env.clock.t);
  env.source.notes.clear();
  env.source.add(note('DL1', { lines: 50 }), note('DL3'));
  env.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON dodaci_list WHEN new.cislo = 'DL3' BEGIN SELECT raise(ABORT, 'boom'); END`);
  const result = await syncActiveNotes(env.db, env.source, env.clock.advance(120));
  assert.equal(result.ok, false);
  assert.deepEqual(active(env), ['DL1', 'DL2']);
  assert.equal(getNote(env.db, 'DL1')?.lines, 5);
});

test('against the ONIX view on PGlite: sync caches the filtered notes and drops a note that was invoiced', async () => {
  const onix = await onixDb();
  await addDl(onix, { number: 'DL-1', state: 'Na vychystanie', lines: [{ amount: 2 }, { amount: 1 }] });
  await addDl(onix, { number: 'DL-2', state: 'Na vychystanie' });
  await addDl(onix, { number: 'DL-3', state: 'Vyfakturovaný' });
  const env = testEnv();
  const source = createOnixSource(onix.query, buildConfig({ onix: { activeStates: ['Na vychystanie'] } }).onix);
  assert.deepEqual(await syncActiveNotes(env.db, source, env.clock.t), { ok: true, count: 2 });
  assert.deepEqual([getNote(env.db, 'DL-1')?.lines, getNote(env.db, 'DL-1')?.units, getNote(env.db, 'DL-1')?.weightKg], [2, 3, 12.5]);
  await onix.pg.query(`UPDATE document_current_state SET id_document_states = (SELECT id_master FROM document_states WHERE name = 'Vyfakturovaný') WHERE doc_id_master = (SELECT id_master FROM documents WHERE ns_number = 'DL-2')`);
  await syncActiveNotes(env.db, source, env.clock.advance(120));
  assert.deepEqual(active(env), ['DL-1']);
});

test('the home page tells when ONIX was last synchronised, and when it failed', async () => {
  const env = testEnv();
  const app = createApp(env);
  assert.match(await (await app.request('/')).text(), /ONIX: zatiaľ nesynchronizované/);
  env.source.add(note('DL1'), note('DL2'));
  await syncActiveNotes(env.db, env.source, at('08:00'));
  assert.match(await (await app.request('/')).text(), /ONIX: posledná synchronizácia 14\. 10\. 2026 08:00 \(2 DL\)/);
  env.source.down = true;
  await syncActiveNotes(env.db, env.source, at('08:02'));
  const failed = await (await app.request('/')).text();
  assert.match(failed, /ONIX: synchronizácia zlyhala 14\. 10\. 2026 08:02/);
  assert.match(failed, /posledná úspešná 14\. 10\. 2026 08:00/);
  assert.match(failed, /ONIX down/);
});

test('the home page says ONIX is not connected when there is no source', async () => {
  const app = createApp({ ...testEnv(), source: null });
  assert.match(await (await app.request('/')).text(), /ONIX nie je pripojený/);
});
