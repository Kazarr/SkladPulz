import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/web/app.ts';
import { DEFAULT_WEIGHTS } from '../../src/domain/index.ts';
import { buildComparison, orderRows } from '../../src/reports/comparison.ts';
import { customPeriod, periodAround } from '../../src/reports/period.ts';
import { saveIndexWeights } from '../../src/store/index-weights.ts';
import { localDayRange } from '../../src/time.ts';
import { at, testEnv, TZ, type TestEnv } from '../helpers.ts';
import { addRecord, addWorker } from './seed.ts';

const WEEK = periodAround('tyzden', '2026-10-14'); // 12.-18. 10. 2026
const build = (env: TestEnv, period = WEEK, activity: 'VYCH' | 'BAL' = 'VYCH') => buildComparison(env.db, TZ, period, activity, DEFAULT_WEIGHTS);
const rowOf = (c: ReturnType<typeof build>, name: string) => c.rows.find((r) => r.workerName === name);

/** Texts of the cells of the table row that starts with `name`, keyed by header text. */
function tableRow(html: string, name: string): Record<string, string> {
  const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').trim();
  const headers = [...(/<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1] ?? ''));
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(tr[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1] ?? ''));
    if (cells.includes(name)) return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  }
  assert.fail(`no row for ${name}`);
}
const page = async (env: TestEnv, qs = ''): Promise<string> => (await createApp(env).request(`/porovnanie${qs}`)).text();

test('per worker and for the team: volume, speeds, averages and the deviation of lines/h from the team', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, kg: 4, dl: 'DL1' });
  addRecord(env.db, { worker: a, start: at('09:00', '2026-10-15'), net: 600, lines: 10, kg: 6, dl: 'DL2' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 1200, lines: 10, kg: 5, dl: 'DL3' });
  const c = build(env);
  const anna = rowOf(c, 'Anna');
  assert.equal(anna?.notes, 2);
  assert.equal(anna?.lines, 20);
  assert.equal(anna?.weightKg, 10);
  assert.equal(anna?.netSeconds, 1200);
  assert.equal(anna?.linesPerHour, 60);
  assert.equal(anna?.notesPerHour, 6);
  assert.equal(anna?.avgSecondsPerNote, 600);
  assert.equal(anna?.avgSecondsPerLine, 60);
  // team: 30 lines in 2400 s = 45 lines/h; Anna +33.3 %, Boris -33.3 %
  assert.equal(c.team.linesPerHour, 45);
  assert.ok(Math.abs((anna?.linesPerHourDeviation ?? 0) - 100 / 3) < 1e-9);
  assert.ok(Math.abs((rowOf(c, 'Boris')?.linesPerHourDeviation ?? 0) + 100 / 3) < 1e-9);
  assert.equal(c.team.index, 100);
  assert.equal(c.team.linesPerHourDeviation, null);
  // index deviation is index - 100
  assert.ok(Math.abs((anna?.indexDeviation ?? 0) - ((anna?.index ?? 0) - 100)) < 1e-9);
});

test('picking and packing are compared separately', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, activity: 'VYCH', dl: 'DL1' });
  addRecord(env.db, { worker: a, start: at('09:00'), net: 300, activity: 'BAL', dl: 'DL1' });
  assert.equal(rowOf(build(env), 'Anna')?.netSeconds, 600);
  assert.equal(rowOf(build(env, WEEK, 'BAL'), 'Anna')?.netSeconds, 300);
});

test('an ISO week across a month end holds exactly Monday 00:00 to Sunday 23:59', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const p = periodAround('tyzden', '2026-10-02'); // 28. 9. - 4. 10.
  addRecord(env.db, { worker: a, start: at('23:59', '2026-09-27'), dl: 'before' });
  addRecord(env.db, { worker: a, start: at('00:00', '2026-09-28'), dl: 'in1' });
  addRecord(env.db, { worker: a, start: at('23:59', '2026-10-04'), dl: 'in2' });
  addRecord(env.db, { worker: a, start: at('00:00', '2026-10-05'), dl: 'after' });
  assert.equal(rowOf(build(env, p), 'Anna')?.notes, 2);
});

test('the week of the autumn time change is 169 hours long and holds the extra hour', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const p = periodAround('tyzden', '2026-10-25'); // 19.-25. 10.
  const range = localDayRange(p.from, p.to, TZ);
  assert.equal((range.to - range.from) / 3600000, 169);
  addRecord(env.db, { worker: a, start: range.to - 60_000, dl: 'last minute' });
  addRecord(env.db, { worker: a, start: range.to, dl: 'next week' });
  addRecord(env.db, { worker: a, start: range.from, dl: 'first' });
  assert.equal(rowOf(build(env, p), 'Anna')?.notes, 2);
  assert.equal(rowOf(build(env, periodAround('tyzden', '2026-10-26')), 'Anna')?.notes, 1);
});

test('a month holds its real length and the previous month is the calendar month before', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('23:00', '2026-02-28'), net: 600, lines: 10, dl: 'feb' });
  addRecord(env.db, { worker: a, start: at('00:00', '2026-03-01'), net: 300, lines: 10, dl: 'mar' });
  const feb = build(env, periodAround('mesiac', '2026-02-10'));
  assert.equal(rowOf(feb, 'Anna')?.notes, 1);
  const mar = build(env, periodAround('mesiac', '2026-03-10'));
  assert.equal(rowOf(mar, 'Anna')?.notes, 1);
  assert.equal(rowOf(mar, 'Anna')?.linesPerHour, 120);
  // trend: 120 lines/h against the 60 of February
  assert.equal(rowOf(mar, 'Anna')?.linesPerHourTrend, 100);
});

test('only counted records enter the figures; the left-out ones are counted per worker, and a record that would change the numbers is not in them', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, kg: 5, dl: 'DL1' });
  addRecord(env.db, { worker: a, start: at('09:00'), stav: 'neukoncene', method: 'koniec_zmeny', lines: 500, kg: 500, dl: 'DL2' });
  addRecord(env.db, { worker: a, start: at('10:00'), net: 5, lines: 300, kg: 300, podozrenie: 'kratky', dl: 'DL3' });
  addRecord(env.db, { worker: a, start: at('11:00'), net: 99999, lines: 1, kg: 1, stav: 'vylucene', dl: 'DL4' });
  addRecord(env.db, { worker: a, start: at('12:00'), net: 3 * 3600, lines: 20, kg: 5, podozrenie: 'dlhy', potvrdene: true, dl: 'DL5' });
  addRecord(env.db, { worker: b, start: at('08:00'), stav: 'vylucene', dl: 'DL6' });
  const c = build(env);
  const anna = rowOf(c, 'Anna');
  assert.equal(anna?.notes, 2);
  assert.equal(anna?.lines, 30);
  assert.equal(anna?.netSeconds, 600 + 3 * 3600);
  assert.equal(anna?.unfinished, 1);
  assert.equal(anna?.suspect, 1);
  assert.equal(anna?.excluded, 1);
  // a worker with only excluded records still shows up, with no figures
  const boris = rowOf(c, 'Boris');
  assert.equal(boris?.notes, 0);
  assert.equal(boris?.excluded, 1);
  assert.equal(boris?.index, null);
  assert.equal(boris?.linesPerHour, null);
  assert.equal(c.team.notes, 2);
});

test('trend against the previous period: % change of lines/h and of the index, "–" (null) when the worker had no data then', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  const c = addWorker(env.db, 'Cyril', 'Z0003');
  // previous week 5.-11. 10.: Anna 30 lines/h, Cyril 30 lines/h; Boris absent
  addRecord(env.db, { worker: a, start: at('08:00', '2026-10-06'), net: 1200, lines: 10, dl: 'P1' });
  addRecord(env.db, { worker: c, start: at('08:00', '2026-10-06'), net: 1200, lines: 10, dl: 'P2' });
  // an excluded record of Boris last week must not give him a "previous"
  addRecord(env.db, { worker: b, start: at('08:00', '2026-10-06'), net: 600, lines: 10, stav: 'vylucene', dl: 'P3' });
  // this week: Anna 60 lines/h, Boris 20 lines/h, Cyril 30 lines/h
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, dl: 'T1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 1800, lines: 10, dl: 'T2' });
  addRecord(env.db, { worker: c, start: at('08:00'), net: 1200, lines: 10, dl: 'T3' });
  const cmp = build(env);
  assert.equal(rowOf(cmp, 'Anna')?.linesPerHourTrend, 100);
  assert.equal(rowOf(cmp, 'Cyril')?.linesPerHourTrend, 0);
  assert.equal(rowOf(cmp, 'Boris')?.linesPerHourTrend, null);
  assert.equal(rowOf(cmp, 'Boris')?.indexTrend, null);
  // Anna's index against the team rose, Cyril's fell
  assert.ok((rowOf(cmp, 'Anna')?.indexTrend ?? 0) > 0);
  assert.ok((rowOf(cmp, 'Cyril')?.indexTrend ?? 0) < 0);
  // team: 30 lines/h before, 30 lines in 3600 s = 30 now
  assert.equal(cmp.team.linesPerHourTrend, 0);
});

test('a custom period is compared with the equally long period right before it', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00', '2026-10-08'), net: 1200, lines: 10, dl: 'P' }); // 3 days before
  addRecord(env.db, { worker: a, start: at('08:00', '2026-10-11'), net: 600, lines: 10, dl: 'T' });
  const p = customPeriod('2026-10-10', '2026-10-12');
  assert.ok(p);
  assert.equal(rowOf(build(env, p), 'Anna')?.linesPerHourTrend, 100);
});

test('the saved weights are used by the comparison page', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 100, lines: 1, kg: 0, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 100, lines: 20, kg: 0, dl: 'DL2' });
  const before = tableRow(await page(env), 'Anna')['Index'];
  saveIndexWeights(env.db, 'VYCH', { fixedSeconds: 0, perLineSeconds: 10, perKgSeconds: 0 }, null, 1);
  // only time per line counts: Anna 10 s of standard in 100 s = 0.1, Boris 2.0, team 210 / 200 = 1.05, so Anna 0.1 / 1.05 = 9.5 %
  const after = tableRow(await page(env), 'Anna')['Index'];
  assert.equal(after, '9,5 %');
  assert.notEqual(before, after);
});

test('ranking orders by index with the unmeasured last; bands order by band and then by name, never by index', () => {
  const env = testEnv();
  const names = ['Anna', 'Boris', 'Cyril', 'Dana', 'Eva', 'Fero', 'Gabo', 'Hana', 'Ivo', 'Jana'];
  names.forEach((n, i) => {
    const w = addWorker(env.db, n, `Z000${i}`);
    // Anna is the slowest, Jana the fastest
    addRecord(env.db, { worker: w, start: at('08:00'), net: 1000 - i * 50, lines: 10, kg: 0, dl: `DL${i}` });
  });
  const lonely = addWorker(env.db, 'Zora', 'Z0099');
  addRecord(env.db, { worker: lonely, start: at('09:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'U' });
  const c = build(env);
  assert.deepEqual(orderRows(c.rows, 'poradie').map((r) => r.workerName), ['Jana', 'Ivo', 'Hana', 'Gabo', 'Fero', 'Eva', 'Dana', 'Cyril', 'Boris', 'Anna', 'Zora']);
  const bands = orderRows(c.rows, 'pasma');
  assert.deepEqual(bands.map((r) => r.band), ['top', 'top', 'top', 'middle', 'middle', 'middle', 'middle', 'bottom', 'bottom', 'bottom', null]);
  assert.deepEqual(bands.slice(0, 3).map((r) => r.workerName), ['Hana', 'Ivo', 'Jana']);
});

test('the page defaults to this week for picking, ranks by index and links to the neighbouring weeks and to the index explanation', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, kg: 4, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 1200, lines: 10, kg: 5, dl: 'DL2' });
  addRecord(env.db, { worker: a, start: at('08:00', '2026-10-20'), net: 600, lines: 10, kg: 4, dl: 'next week' });
  const html = await page(env);
  assert.match(html, /12\. 10\. 2026 – 18\. 10\. 2026/);
  assert.match(html, /Vychystanie/);
  const anna = tableRow(html, 'Anna');
  assert.equal(anna['Poradie'], '1');
  assert.equal(anna['DL'], '1');
  assert.equal(anna['Položky / hod'], '60,0');
  assert.equal(anna['Odchýlka položiek / hod (%)'], '+33,3 %');
  assert.equal(anna['Trend položiek / hod'], '–');
  assert.equal(tableRow(html, 'Boris')['Odchýlka položiek / hod (%)'], '-33,3 %');
  assert.equal(tableRow(html, 'Boris')['Poradie'], '2');
  assert.equal(tableRow(html, 'Tím spolu')['Index'], '100,0 %');
  assert.match(html, /datum=2026-10-05/);
  assert.match(html, /datum=2026-10-19/);
  assert.match(html, /href="\/index"/);
});

test('the trend shows an arrow and the change; the bands view shows band names and no rank', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00', '2026-10-06'), net: 1200, lines: 10, dl: 'P1' });
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, dl: 'T1' });
  const html = await page(env, '?zobrazenie=pasma');
  const anna = tableRow(html, 'Anna');
  assert.equal(anna['Trend položiek / hod'], '↑ +100,0 %');
  assert.equal(anna['Pásmo'], 'Stred 40 %'); // one worker: middle
  assert.equal(anna['Poradie'], undefined);
});

test('the period and the activity come from the query; bad dates are refused', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00', '2026-09-30'), net: 600, activity: 'BAL', dl: 'DL1' });
  const month = await page(env, '?obdobie=mesiac&datum=2026-09-15&cinnost=BAL');
  assert.match(month, /1\. 9\. 2026 – 30\. 9\. 2026/);
  assert.match(month, /Balenie/);
  assert.equal(tableRow(month, 'Anna')['DL'], '1');
  const custom = await page(env, '?obdobie=vlastne&od=2026-09-30&do=2026-09-30&cinnost=BAL');
  assert.equal(tableRow(custom, 'Anna')['DL'], '1');
  const day = await page(env, '?obdobie=den&datum=2026-09-29&cinnost=BAL');
  assert.match(day, /Za toto obdobie nie sú žiadne záznamy/);
  for (const bad of ['?datum=2026-13-40', '?obdobie=vlastne&od=zle&do=2026-10-01', '?obdobie=vlastne&od=2026-10-05&do=2026-10-01']) {
    assert.equal((await createApp(env).request(`/porovnanie${bad}`)).status, 400, bad);
  }
});

test('the Excel export holds the same table and parses back', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, kg: 4, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('08:00'), net: 1200, lines: 10, kg: 5, dl: 'DL2' });
  addRecord(env.db, { worker: b, start: at('09:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'DL3' });
  const res = await createApp(env).request('/porovnanie/export.xlsx?obdobie=tyzden&datum=2026-10-14&cinnost=VYCH');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
  assert.match(res.headers.get('content-disposition') ?? '', /skladpulz-porovnanie-2026-10-12_2026-10-18\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  assert.ok(ws);
  const headers = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  const col = (name: string) => headers.indexOf(name) + 1;
  for (const h of ['Poradie', 'Zamestnanec', 'DL', 'Položky', 'Index (%)', 'Odchýlka položiek / hod (%)', 'Trend položiek / hod (%)', 'Neukončené', 'Podozrivé', 'Vylúčené']) assert.ok(col(h) > 0, h);
  assert.equal(ws.rowCount, 4); // header, Anna, Boris, team
  const anna = ws.getRow(2);
  assert.equal(anna.getCell(col('Zamestnanec')).value, 'Anna');
  assert.equal(anna.getCell(col('Poradie')).value, 1);
  assert.equal(anna.getCell(col('Položky / hod')).value, 60);
  assert.ok(Math.abs(Number(anna.getCell(col('Odchýlka položiek / hod (%)')).value) - 100 / 3) < 1e-9);
  assert.equal(anna.getCell(col('Trend položiek / hod (%)')).value, null);
  assert.equal(ws.getRow(3).getCell(col('Neukončené')).value, 1);
  assert.equal(ws.getRow(4).getCell(col('Zamestnanec')).value, 'Tím spolu');
  assert.equal(ws.getRow(4).getCell(col('Index (%)')).value, 100);
  const bands = new ExcelJS.Workbook();
  await bands.xlsx.load(Buffer.from(await (await createApp(env).request('/porovnanie/export.xlsx?zobrazenie=pasma&datum=2026-10-14')).arrayBuffer()) as unknown as ArrayBuffer);
  const bh = (bands.worksheets[0]?.getRow(1).values as unknown[]).slice(1) as string[];
  assert.ok(bh.includes('Pásmo') && !bh.includes('Poradie'));
});
