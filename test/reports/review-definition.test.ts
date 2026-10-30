import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmRecord, excludeRecord } from '../../src/store/corrections.ts';
import { buildDailyReport } from '../../src/reports/daily.ts';
import { listReviewItems } from '../../src/store/corrections.ts';
import { DEFAULT_WEIGHTS } from '../../src/domain/index.ts';
import { buildDailySummary } from '../../src/email/daily-summary.ts';
import { localDayRange } from '../../src/time.ts';
import { at, testEnv, TZ } from '../helpers.ts';
import { addRecord, addWorker, type SeedRecord } from './seed.ts';

const D = '2026-10-14';

/** One record of every kind that the review definition has to sort: 5 need review, the rest do not. */
function seedAll(env: ReturnType<typeof testEnv>) {
  const w = addWorker(env.db, 'Anna', 'Z0001');
  const r = (hhmm: string, dl: string, over: Partial<SeedRecord>) => addRecord(env.db, { worker: w, start: at(hhmm), dl, ...over });
  const needs = {
    unfinished: r('06:10', 'N1', { stav: 'neukoncene', method: 'koniec_zmeny' }),
    short: r('06:30', 'N2', { net: 5, podozrenie: 'kratky' }),
    long: r('07:00', 'N3', { net: 9000, podozrenie: 'dlhy' }),
    duplicate: r('09:00', 'N4', { duplicita: true }),
    noSnapshot: r('09:30', 'N5', { lines: null }),
  };
  const fine = [
    r('10:00', 'F1', {}),
    r('10:30', 'F2', { net: 5, podozrenie: 'kratky', potvrdene: true }),
    r('11:00', 'F3', { duplicita: true, potvrdene: true }),
    r('11:30', 'F4', { net: 5, podozrenie: 'kratky', stav: 'vylucene' }),
    r('12:00', 'F5', { duplicita: true, stav: 'vylucene' }),
    r('12:30', 'F6', { stav: 'bezi' }),
    r('13:00', 'F7', { stav: 'opravene', potvrdene: true }),
    r('13:30', 'F8', { lines: null, potvrdene: true }),
  ];
  return { needs: Object.values(needs), fine };
}

test('/kontrola, the "Na kontrolu" filter and the e-mail count use one definition of "needs review"', async () => {
  const env = testEnv({ baseUrl: 'http://sklad:3000', email: { enabled: true, recipients: ['a@b.sk'], attachExcel: false } });
  const { needs } = seedAll(env);

  const onReviewPage = listReviewItems(env.db, localDayRange(D, D, TZ)).map((i) => i.record.id);
  const onFilter = buildDailyReport(env.db, TZ, D, { workerId: null, activity: null, status: 'kontrola' }, DEFAULT_WEIGHTS).records.map((r) => r.id);
  assert.deepEqual(onReviewPage, needs);
  assert.deepEqual(onFilter, needs);
  const mail = await buildDailySummary(env.db, env.config, D);
  assert.match(mail.text, new RegExp(`Na kontrolu: ${needs.length} `));
});

test('everything that needs review is out of the counted records, everything else that ended ok is in', () => {
  const env = testEnv();
  const { needs, fine } = seedAll(env);
  const countedIds = (env.db.prepare('SELECT id FROM zaznam_hodnotene ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  for (const id of needs) assert.ok(!countedIds.includes(id), `record ${id} needs review but is counted`);
  // the fine list ends with excluded (F4, F5) and running (F6) records, which are no counted records either
  assert.deepEqual(countedIds, fine.filter((_, i) => ![3, 4, 5].includes(i)));
});

test('two workers on one note: both records wait on /kontrola, nothing counts until the manager confirms one and excludes the other', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  const first = addRecord(env.db, { worker: a, start: at('08:00'), dl: 'DL1', duplicita: true });
  const second = addRecord(env.db, { worker: b, start: at('08:05'), dl: 'DL1', duplicita: true });
  const countedBy = () => buildDailyReport(env.db, TZ, D, { workerId: null, activity: null, status: null }, DEFAULT_WEIGHTS).sections[0]?.total.notes ?? 0;
  assert.equal(countedBy(), 0);
  assert.deepEqual(listReviewItems(env.db, localDayRange(D, D, TZ)).map((i) => i.record.id), [first, second]);
  const by = { manager: 'Jana', now: at('12:00') };
  assert.deepEqual(confirmRecord(env.db, first, 'Robil on', by), { ok: true });
  assert.deepEqual(excludeRecord(env.db, second, 'Omyl', by), { ok: true });
  assert.equal(countedBy(), 1);
  assert.deepEqual(listReviewItems(env.db, localDayRange(D, D, TZ)), []);
});
