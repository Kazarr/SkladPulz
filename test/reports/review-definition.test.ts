import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReport } from '../../src/reports/daily.ts';
import { listReviewItems } from '../../src/store/corrections.ts';
import { DEFAULT_WEIGHTS } from '../../src/domain/index.ts';
import { buildDailySummary } from '../../src/email/daily-summary.ts';
import { localDayRange } from '../../src/time.ts';
import { at, testEnv, TZ } from '../helpers.ts';
import { addRecord, addWorker, type SeedRecord } from './seed.ts';

const D = '2026-10-14';

/** One record of every kind that the review definition has to sort: 4 need review, the rest do not. */
function seedAll(env: ReturnType<typeof testEnv>) {
  const w = addWorker(env.db, 'Anna', 'Z0001');
  const r = (hhmm: string, dl: string, over: Partial<SeedRecord>) => addRecord(env.db, { worker: w, start: at(hhmm), dl, ...over });
  const needs = {
    unfinished: r('06:10', 'N1', { stav: 'neukoncene', method: 'koniec_zmeny' }),
    short: r('06:30', 'N2', { net: 5, podozrenie: 'kratky' }),
    long: r('07:00', 'N3', { net: 9000, podozrenie: 'dlhy' }),
    duplicate: r('09:00', 'N4', { duplicita: true }),
  };
  const fine = [
    r('10:00', 'F1', {}),
    r('10:30', 'F2', { net: 5, podozrenie: 'kratky', potvrdene: true }),
    r('11:00', 'F3', { duplicita: true, potvrdene: true }),
    r('11:30', 'F4', { net: 5, podozrenie: 'kratky', stav: 'vylucene' }),
    r('12:00', 'F5', { duplicita: true, stav: 'vylucene' }),
    r('12:30', 'F6', { stav: 'bezi' }),
    r('13:00', 'F7', { stav: 'opravene', potvrdene: true }),
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
