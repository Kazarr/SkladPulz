import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../../src/db/db.ts';
import { confirmRecord, correctRecord, excludeRecord, listCorrectionLog, listReviewItems, restoreRecord } from '../../src/store/corrections.ts';
import { getRecord } from '../../src/store/records.ts';
import { createWorker } from '../../src/store/workers.ts';
import { at, testEnv } from '../helpers.ts';
import { counted, logCount, seed } from './seed.ts';

const NOW = at('12:00');
const by = { manager: 'Jana', now: NOW };
const RANGE = { from: at('00:00', '2026-10-01'), to: at('00:00', '2026-10-15') };

function setup() {
  const env = testEnv();
  const ján = createWorker(env.db, 'Ján Novák', 'Z0001').id;
  const eva = createWorker(env.db, 'Eva Malá', 'Z0002').id;
  return { db: env.db, ján, eva };
}

const change = (db: Db, id: number, over: Partial<Parameters<typeof correctRecord>[2]> = {}) => {
  const r = getRecord(db, id);
  assert.ok(r);
  return correctRecord(db, id, { start: r.start, end: r.end ?? 0, workerId: r.workerId, activity: r.activity, reason: 'Chyba skenera', ...over }, by);
};

function snapshot(db: Db, id: number): string {
  return JSON.stringify(db.prepare('SELECT * FROM zaznam WHERE id = ?').get(id));
}

test('the review list holds each reason and leaves out counted, confirmed, excluded and running rows', () => {
  const { db, ján } = setup();
  const unfinished = seed(db, { worker: ján, dl: 'DL1', start: at('06:00'), end: at('14:00'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  const tooShort = seed(db, { worker: ján, dl: 'DL2', start: at('08:00'), end: at('08:00') + 5000, suspicion: 'kratky' });
  const tooLong = seed(db, { worker: ján, dl: 'DL3', start: at('09:00'), end: at('12:00'), suspicion: 'dlhy' });
  const dup = seed(db, { worker: ján, dl: 'DL4', start: at('10:00'), duplicate: true });
  const both = seed(db, { worker: ján, dl: 'DL5', start: at('10:30'), end: at('10:30') + 5000, suspicion: 'kratky', duplicate: true });
  seed(db, { worker: ján, dl: 'OK1', start: at('07:00') });
  seed(db, { worker: ján, dl: 'OK2', start: at('07:20'), end: at('07:20') + 5000, suspicion: 'kratky', confirmed: true });
  seed(db, { worker: ján, dl: 'OK3', start: at('07:40'), end: at('07:40') + 5000, suspicion: 'kratky', status: 'vylucene' });
  seed(db, { worker: ján, dl: 'OK4', start: at('07:50'), duplicate: true, confirmed: true });
  seed(db, { worker: ján, dl: 'OK5', start: at('11:00'), end: null });
  seed(db, { worker: ján, dl: 'OLD', start: at('08:00', '2026-09-20'), status: 'neukoncene', endMethod: 'koniec_zmeny' });

  const items = listReviewItems(db, RANGE);
  const byDl = Object.fromEntries(items.map((i) => [i.record.dlNumber, i.reasons]));
  assert.deepEqual(byDl, {
    DL1: ['neukoncene'],
    DL2: ['kratky'],
    DL3: ['dlhy'],
    DL4: ['duplicita'],
    DL5: ['kratky', 'duplicita'],
  });
  assert.deepEqual(items.map((i) => i.record.id), [unfinished, tooShort, tooLong, dup, both]);
  assert.equal(items[0]?.workerName, 'Ján Novák');
  const wide = listReviewItems(db, { from: at('00:00', '2026-09-01'), to: RANGE.to });
  assert.ok(wide.some((i) => i.record.dlNumber === 'OLD'));
});

test('a correction sets the times, recomputes net time from the pauses inside the new window and vouches for the record', () => {
  const { db, ján } = setup();
  // Pause A (08:20-08:30) falls inside the new window, pause B (08:50-09:00) outside it.
  const id = seed(db, {
    worker: ján, dl: 'DL1', start: at('08:00'), end: at('09:00'), status: 'neukoncene', endMethod: 'koniec_zmeny',
    pauses: [[at('08:20'), at('08:30')], [at('08:50'), at('09:00')]],
  });
  const res = change(db, id, { end: at('08:40') });
  assert.deepEqual(res, { ok: true });
  const r = getRecord(db, id);
  assert.equal(r?.end, at('08:40'));
  assert.equal(r?.pauseSeconds, 600);
  assert.equal(r?.netSeconds, 2400 - 600);
  assert.equal(r?.status, 'opravene');
  assert.equal(r?.endMethod, 'oprava');
  assert.equal(r?.confirmed, true);
  assert.equal(r?.correctedBy, 'Jana');
  // Moving the start past pause A drops it from the net time.
  assert.deepEqual(change(db, id, { start: at('08:35') }), { ok: true });
  assert.equal(getRecord(db, id)?.netSeconds, 300);
  assert.equal(getRecord(db, id)?.pauseSeconds, 0);
});

test('a correction keeps the end method unless the record was closed by the shift end', () => {
  const { db, ján } = setup();
  const ended = seed(db, { worker: ján, dl: 'DL1', start: at('08:00'), end: at('08:10'), endMethod: 'dalsi_dl' });
  assert.deepEqual(change(db, ended, { end: at('08:12') }), { ok: true });
  assert.equal(getRecord(db, ended)?.endMethod, 'dalsi_dl');
});

test('a correction can move the record to another worker and activity', () => {
  const { db, ján, eva } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00') });
  assert.deepEqual(change(db, id, { workerId: eva, activity: 'BAL' }), { ok: true });
  assert.equal(getRecord(db, id)?.workerId, eva);
  assert.equal(getRecord(db, id)?.activity, 'BAL');
});

test('each refusal stores nothing', () => {
  const { db, ján, eva } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00'), end: at('08:10'), suspicion: 'kratky' });
  seed(db, { worker: ján, dl: 'NEXT', start: at('08:30'), end: at('08:40') });
  seed(db, { worker: eva, dl: 'EVA', start: at('09:00'), end: null });
  const running = seed(db, { worker: ján, dl: 'RUN', start: at('11:00'), end: null });
  const excluded = seed(db, { worker: ján, dl: 'EXC', start: at('07:00'), end: at('07:10'), status: 'vylucene' });
  const before = snapshot(db, id);

  const refused: [string, ReturnType<typeof correctRecord>][] = [
    ['end before start', change(db, id, { end: at('07:59') })],
    ['end equal to start', change(db, id, { end: at('08:00') })],
    ['end in the future', change(db, id, { end: at('12:00') + 1000 })],
    ['overlap with another record of the worker', change(db, id, { end: at('08:35') })],
    ['overlap with the running record of the new worker', change(db, id, { workerId: eva, end: at('09:30') })],
    ['no reason', change(db, id, { reason: '   ' })],
    ['unknown worker', change(db, id, { workerId: 999 })],
    ['running record', change(db, running, { start: at('11:00'), end: at('11:05') })],
    ['excluded record', change(db, excluded, { end: at('07:20') })],
    ['unknown record', correctRecord(db, 999, { start: 1, end: 2, workerId: ján, activity: 'VYCH', reason: 'x' }, by)],
  ];
  for (const [what, res] of refused) assert.equal(res.ok, false, what);
  assert.equal(snapshot(db, id), before);
  assert.equal(logCount(db), 0);
  const overlap = refused[3]?.[1];
  assert.ok(overlap && !overlap.ok && overlap.error.includes('NEXT'), 'the message names the overlapping DL');
  const running2 = refused[4]?.[1];
  assert.ok(running2 && !running2.ok && running2.error.includes('EVA'));
});

test('records that touch end to start do not overlap, and an excluded record never blocks', () => {
  const { db, ján } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00'), end: at('08:10') });
  seed(db, { worker: ján, dl: 'NEXT', start: at('08:10'), end: at('08:20') });
  seed(db, { worker: ján, dl: 'GONE', start: at('07:00'), end: at('07:58'), status: 'vylucene' });
  assert.deepEqual(change(db, id, { start: at('07:30'), end: at('08:10') }), { ok: true });
});

test('confirming a suspect record makes it a counted record; the times stay', () => {
  const { db, ján } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00'), end: at('08:00') + 5000, suspicion: 'kratky' });
  assert.deepEqual(counted(db), []);
  assert.deepEqual(confirmRecord(db, id, 'Naozaj krátky DL', by), { ok: true });
  assert.deepEqual(counted(db), [id]);
  const r = getRecord(db, id);
  assert.equal(r?.start, at('08:00'));
  assert.equal(r?.status, 'ok');
  assert.equal(r?.confirmed, true);
});

test('an unfinished record cannot be confirmed, a confirmed one is not confirmed twice, a running one is refused', () => {
  const { db, ján } = setup();
  const unfinished = seed(db, { worker: ján, dl: 'DL1', start: at('06:00'), end: at('14:00'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  const done = seed(db, { worker: ján, dl: 'DL2', start: at('08:00'), end: at('08:10'), suspicion: 'kratky', confirmed: true });
  const running = seed(db, { worker: ján, dl: 'DL3', start: at('11:00'), end: null });
  for (const id of [unfinished, done, running]) assert.equal(confirmRecord(db, id, 'x', by).ok, false);
  assert.equal(confirmRecord(db, 999, 'x', by).ok, false);
  assert.equal(confirmRecord(db, done, '', by).ok, false);
  assert.equal(getRecord(db, unfinished)?.confirmed, false);
  assert.equal(logCount(db), 0);
});

test('excluding removes a record from the counted records and restoring brings it back as it was', () => {
  const { db, ján } = setup();
  const ok = seed(db, { worker: ján, dl: 'DL1', start: at('08:00') });
  const unfinished = seed(db, { worker: ján, dl: 'DL2', start: at('09:00'), end: at('09:10'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  assert.deepEqual(counted(db), [ok]);
  assert.deepEqual(excludeRecord(db, ok, 'Skúška', by), { ok: true });
  assert.deepEqual(counted(db), []);
  assert.equal(getRecord(db, ok)?.status, 'vylucene');
  assert.equal(excludeRecord(db, ok, 'Ešte raz', by).ok, false, 'already excluded');
  assert.deepEqual(restoreRecord(db, ok, 'Omyl', by), { ok: true });
  assert.deepEqual(counted(db), [ok]);
  assert.equal(getRecord(db, ok)?.status, 'ok');
  assert.equal(restoreRecord(db, ok, 'Omyl', by).ok, false, 'not excluded');

  excludeRecord(db, unfinished, 'Skúška', by);
  restoreRecord(db, unfinished, 'Omyl', by);
  assert.equal(getRecord(db, unfinished)?.status, 'neukoncene');
  assert.equal(excludeRecord(db, 999, 'x', by).ok, false);
  assert.equal(excludeRecord(db, ok, '', by).ok, false);
});

test('every action writes the log with old and new values, the reason and the manager', () => {
  const { db, ján, eva } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00'), end: at('09:00'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  change(db, id, { end: at('08:30'), workerId: eva, reason: 'Karta bola omylom iná' });
  const log = listCorrectionLog(db, id);
  const row = (field: string) => log.find((l) => l.field === field);
  assert.deepEqual([row('koniec')?.oldValue, row('koniec')?.newValue], [String(at('09:00')), String(at('08:30'))]);
  assert.deepEqual([row('zamestnanec')?.oldValue, row('zamestnanec')?.newValue], ['Z0001 Ján Novák', 'Z0002 Eva Malá']);
  assert.deepEqual([row('stav')?.oldValue, row('stav')?.newValue], ['neukoncene', 'opravene']);
  assert.deepEqual([row('cisty_cas_s')?.oldValue, row('cisty_cas_s')?.newValue], ['3600', '1800']);
  assert.equal(row('zaciatok'), undefined, 'unchanged fields are not logged');
  assert.equal(row('cinnost'), undefined);
  assert.equal(row('akcia')?.newValue, 'oprava');
  for (const l of log) {
    assert.equal(l.manager, 'Jana');
    assert.equal(l.reason, 'Karta bola omylom iná');
    assert.equal(l.at, NOW);
  }

  excludeRecord(db, id, 'Nepatrí do merania', { manager: 'Peter', now: NOW + 1000 });
  restoreRecord(db, id, 'Vrátené', { manager: 'Peter', now: NOW + 2000 });
  const actions = listCorrectionLog(db, id).filter((l) => l.field === 'akcia').map((l) => [l.newValue, l.manager, l.reason]);
  assert.deepEqual(actions, [['oprava', 'Jana', 'Karta bola omylom iná'], ['vylucenie', 'Peter', 'Nepatrí do merania'], ['vratenie', 'Peter', 'Vrátené']]);
  const stav = listCorrectionLog(db, id).filter((l) => l.field === 'stav').map((l) => [l.oldValue, l.newValue]);
  assert.deepEqual(stav, [['neukoncene', 'opravene'], ['opravene', 'vylucene'], ['vylucene', 'opravene']]);

  const c = seed(db, { worker: ján, dl: 'DL9', start: at('10:00'), end: at('10:00') + 5000, suspicion: 'kratky' });
  confirmRecord(db, c, 'Overené', by);
  const cl = listCorrectionLog(db, c);
  assert.deepEqual(cl.map((l) => [l.field, l.oldValue, l.newValue, l.manager]), [
    ['potvrdene', '0', '1', 'Jana'],
    ['akcia', null, 'potvrdenie', 'Jana'],
  ]);
});

test('the correction log cannot be changed or deleted', () => {
  const { db, ján } = setup();
  const id = seed(db, { worker: ján, dl: 'DL1', start: at('08:00') });
  excludeRecord(db, id, 'x', by);
  assert.throws(() => db.prepare("UPDATE oprava_zaznamu SET dovod = 'iný'").run());
  assert.throws(() => db.prepare('DELETE FROM oprava_zaznamu').run());
  assert.throws(() => db.prepare('DELETE FROM zaznam WHERE id = ?').run(id));
});
