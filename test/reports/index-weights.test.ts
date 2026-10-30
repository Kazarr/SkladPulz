import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { DEFAULT_WEIGHTS } from '../../src/domain/index.ts';
import { buildDailyReport } from '../../src/reports/daily.ts';
import { getIndexWeights, loadIndexWeights, saveIndexWeights } from '../../src/store/index-weights.ts';
import { at, testEnv, TZ, type TestEnv } from '../helpers.ts';
import { addRecord, addWorker } from './seed.ts';

const NO_FILTER = { workerId: null, activity: null, status: null };

function post(env: TestEnv, path: string, fields: Record<string, string>): Promise<Response> {
  return Promise.resolve(createApp(env).request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));
}
const get = async (env: TestEnv, path: string): Promise<string> => (await createApp(env).request(path)).text();

test('before calibration the defaults apply; a saved weight set replaces them per activity and remembers who and when', () => {
  const env = testEnv();
  assert.deepEqual(getIndexWeights(env.db), DEFAULT_WEIGHTS);
  assert.equal(loadIndexWeights(env.db).VYCH.changedAt, null);
  saveIndexWeights(env.db, 'VYCH', { fixedSeconds: 30, perLineSeconds: 20, perKgSeconds: 1.5 }, 'vedúci', 1234);
  assert.deepEqual(getIndexWeights(env.db).VYCH, { fixedSeconds: 30, perLineSeconds: 20, perKgSeconds: 1.5 });
  assert.deepEqual(getIndexWeights(env.db).BAL, DEFAULT_WEIGHTS.BAL);
  saveIndexWeights(env.db, 'VYCH', { fixedSeconds: 31, perLineSeconds: 20, perKgSeconds: 1.5 }, null, 5678);
  const v = loadIndexWeights(env.db).VYCH;
  assert.equal(v.weights.fixedSeconds, 31);
  assert.equal(v.changedBy, null);
  assert.equal(v.changedAt, 5678);
  assert.equal((env.db.prepare('SELECT count(*) AS n FROM vahy_indexu').get() as { n: number }).n, 1);
});

test('the index is in the daily summary: a column per worker and activity, the team at 100 %', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  // standard (default VYCH) of 10 lines / 0 kg = 60 + 250 = 310 s
  addRecord(env.db, { worker: a, start: at('08:00'), net: 310, lines: 10, kg: 0, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 620, lines: 10, kg: 0, dl: 'DL2' });
  const sec = buildDailyReport(env.db, TZ, '2026-10-14', NO_FILTER, DEFAULT_WEIGHTS).sections[0];
  // team: 620 standard / 930 net; Anna 1.0, Boris 0.5 on the norm
  const team = 620 / 930;
  assert.ok(Math.abs((sec?.rows.find((r) => r.workerName === 'Anna')?.index ?? 0) - (1 / team) * 100) < 1e-9);
  assert.ok(Math.abs((sec?.rows.find((r) => r.workerName === 'Boris')?.index ?? 0) - (0.5 / team) * 100) < 1e-9);
  assert.equal(sec?.total.index, 100);
});

test('filtering the daily report to one worker keeps the team as the base of the index', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 310, lines: 10, kg: 0, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 620, lines: 10, kg: 0, dl: 'DL2' });
  const all = buildDailyReport(env.db, TZ, '2026-10-14', NO_FILTER, DEFAULT_WEIGHTS).sections[0]?.rows.find((r) => r.workerName === 'Anna')?.index;
  const only = buildDailyReport(env.db, TZ, '2026-10-14', { ...NO_FILTER, workerId: a }, DEFAULT_WEIGHTS).sections[0]?.rows[0]?.index;
  assert.equal(only, all);
});

test('saved weights are used by the daily summary and show on the page', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 100, lines: 1, kg: 0, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 100, lines: 20, kg: 0, dl: 'DL2' });
  const before = await get(env, '/prehlad?datum=2026-10-14');
  assert.match(before, /Index/);
  // only per-line time counts: Boris did 20x the lines in the same time, so his index is 20x Anna's
  assert.equal((await post(env, '/index/vahy', { cinnost: 'VYCH', pevny: '0', polozka: '10', kg: '0' })).status, 303);
  const sec = buildDailyReport(env.db, TZ, '2026-10-14', NO_FILTER, getIndexWeights(env.db)).sections[0];
  const ia = sec?.rows.find((r) => r.workerName === 'Anna')?.index ?? 0;
  const ib = sec?.rows.find((r) => r.workerName === 'Boris')?.index ?? 0;
  assert.ok(Math.abs(ib / ia - 20) < 1e-9);
  const after = await get(env, '/prehlad?datum=2026-10-14');
  assert.match(after, /190,5\s%/); // Boris 200 s of standard in 100 s = 2.0, team 210 / 200 = 1.05, so 2.0 / 1.05 = 190.5 %
});

test('/index shows the current weights as placeholders and explains the calculation with a 2-line and a 40-line note', async () => {
  const env = testEnv();
  const html = await get(env, '/index');
  assert.match(html, /zástupné/);
  assert.match(html, /60/);
  assert.match(html, /2 položk/);
  assert.match(html, /40 položk/);
  assert.match(html, /chýbajúc/i);
  // 2 lines, 3 kg: 60 + 2 x 25 + 3 x 0,5 = 111,5 s
  assert.match(html, /111,5/);
});

test('"Vypočítať z dát" suggests weights next to the current ones with R² and the number of counted records only', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  for (let i = 0; i < 40; i++) {
    const lines = 1 + ((i * 7) % 25);
    const kg = 0.5 + ((i * 13) % 17) * 1.3;
    addRecord(env.db, { worker: a, start: at('08:00', `2026-10-${String(1 + (i % 12)).padStart(2, '0')}`) + i * 3600_000, net: 50 + 20 * lines + 0.7 * kg, lines, kg, dl: `DL${i}` });
  }
  // records that would wreck the fit if they were counted
  addRecord(env.db, { worker: a, start: at('09:00', '2026-10-05'), net: 99999, lines: 1, kg: 1, stav: 'vylucene', dl: 'X1' });
  addRecord(env.db, { worker: a, start: at('09:30', '2026-10-05'), net: 5, lines: 30, kg: 1, podozrenie: 'kratky', dl: 'X2' });
  addRecord(env.db, { worker: a, start: at('10:00', '2026-10-05'), stav: 'neukoncene', method: 'koniec_zmeny', lines: 30, kg: 1, dl: 'X3' });
  const html = await get(env, '/index?od=2026-09-16&do=2026-10-13');
  assert.match(html, /Navrhnuté/);
  assert.match(html, /50,0/); // fixed
  assert.match(html, /20,0/); // per line
  assert.match(html, /0,7/); // per kg
  assert.match(html, /R²[^0-9]*1,00/);
  assert.match(html, /40 záznamov/);
  // BAL has no records: refused with a reason, nothing suggested
  assert.match(html, /málo záznamov/i);
});

test('accepting a suggestion and saving manual weights both store them with the manager; bad input is refused', async () => {
  const env = testEnv();
  const res = await post(env, '/index/vahy', { cinnost: 'BAL', pevny: '40,5', polozka: '10', kg: '0,25' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/index');
  assert.deepEqual(getIndexWeights(env.db).BAL, { fixedSeconds: 40.5, perLineSeconds: 10, perKgSeconds: 0.25 });
  assert.match(await get(env, '/index'), /Zmenil/);
  for (const bad of [{ cinnost: 'XX', pevny: '1', polozka: '1', kg: '1' }, { cinnost: 'BAL', pevny: '-1', polozka: '1', kg: '1' }, { cinnost: 'BAL', pevny: 'abc', polozka: '1', kg: '1' }, { cinnost: 'BAL', pevny: '1', polozka: '', kg: '1' }]) {
    assert.equal((await post(env, '/index/vahy', bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(getIndexWeights(env.db).BAL, { fixedSeconds: 40.5, perLineSeconds: 10, perKgSeconds: 0.25 });
});
