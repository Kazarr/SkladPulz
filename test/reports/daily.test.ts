import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/web/app.ts';
import { DEFAULT_WEIGHTS } from '../../src/domain/index.ts';
import { buildDailyReport, type ReportFilter } from '../../src/reports/daily.ts';
import { upsertNote } from '../../src/store/delivery-notes.ts';
import { localDayRange } from '../../src/time.ts';
import { at, note, testEnv, TZ } from '../helpers.ts';
import { addRecord, addWorker } from './seed.ts';

const NO_FILTER: ReportFilter = { workerId: null, activity: null, status: null };
const D = '2026-10-14';

function ids(report: ReturnType<typeof buildDailyReport>): number[] {
  return report.records.map((r) => r.id);
}

test('only counted records enter the summary; the others stay in the list and are counted as "na kontrolu"', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const counted = addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 10, kg: 4 });
  const confirmed = addRecord(env.db, { worker: a, start: at('09:00'), net: 3 * 3600, lines: 20, kg: 6, podozrenie: 'dlhy', potvrdene: true });
  const unfinished = addRecord(env.db, { worker: a, start: at('10:00'), stav: 'neukoncene', method: 'koniec_zmeny' });
  const excluded = addRecord(env.db, { worker: a, start: at('11:00'), stav: 'vylucene' });
  const suspect = addRecord(env.db, { worker: a, start: at('12:00'), net: 5, podozrenie: 'kratky' });
  const corrected = addRecord(env.db, { worker: a, start: at('13:00'), net: 300, lines: 2, kg: 1, stav: 'opravene' });

  const report = buildDailyReport(env.db, TZ, D, NO_FILTER, DEFAULT_WEIGHTS);
  assert.deepEqual(ids(report), [counted, confirmed, unfinished, excluded, suspect, corrected]);
  const vych = report.sections.find((s) => s.activity === 'VYCH');
  assert.equal(vych?.rows.length, 1);
  const row = vych?.rows[0];
  assert.equal(row?.workerName, 'Anna');
  assert.equal(row?.notes, 3);
  assert.equal(row?.lines, 32);
  assert.equal(row?.weightKg, 11);
  assert.equal(row?.netSeconds, 600 + 3 * 3600 + 300);
  assert.equal(row?.unfinished, 1);
  assert.equal(row?.suspect, 1);
  assert.equal(vych?.total.notes, 3);
  assert.equal(vych?.total.unfinished, 1);
});

test('a worker with only unfinished records still gets a summary row, without speeds', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), stav: 'neukoncene', method: 'koniec_zmeny' });
  const row = buildDailyReport(env.db, TZ, D, NO_FILTER, DEFAULT_WEIGHTS).sections[0]?.rows[0];
  assert.equal(row?.notes, 0);
  assert.equal(row?.notesPerHour, null);
  assert.equal(row?.unfinished, 1);
});

test('a record belongs to the local day it started on, even when it ends after midnight', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const late = addRecord(env.db, { worker: a, start: at('23:50'), net: 1200 });
  const midnight = addRecord(env.db, { worker: a, start: at('00:00', '2026-10-15') });
  const before = addRecord(env.db, { worker: a, start: at('23:59', '2026-10-13') });
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, D, NO_FILTER, DEFAULT_WEIGHTS)), [late]);
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, '2026-10-15', NO_FILTER, DEFAULT_WEIGHTS)), [midnight]);
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, '2026-10-13', NO_FILTER, DEFAULT_WEIGHTS)), [before]);
});

test('the 25-hour day of the autumn time change holds all 25 hours', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const range = localDayRange('2026-10-25', '2026-10-25', TZ);
  assert.equal((range.to - range.from) / 3600000, 25);
  const first = addRecord(env.db, { worker: a, start: range.from });
  const lastHour = addRecord(env.db, { worker: a, start: range.to - 1000 });
  const beforeDay = addRecord(env.db, { worker: a, start: range.from - 1000 });
  const nextDay = addRecord(env.db, { worker: a, start: range.to });
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, '2026-10-25', NO_FILTER, DEFAULT_WEIGHTS)), [first, lastHour]);
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, '2026-10-24', NO_FILTER, DEFAULT_WEIGHTS)), [beforeDay]);
  assert.deepEqual(ids(buildDailyReport(env.db, TZ, '2026-10-26', NO_FILTER, DEFAULT_WEIGHTS)), [nextDay]);
});

test('each filter leaves out a row it must leave out', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  const annaPick = addRecord(env.db, { worker: a, start: at('08:00') });
  const annaPack = addRecord(env.db, { worker: a, start: at('09:00'), activity: 'BAL' });
  const borisPick = addRecord(env.db, { worker: b, start: at('10:00') });
  const unfinished = addRecord(env.db, { worker: b, start: at('11:00'), stav: 'neukoncene', method: 'koniec_zmeny' });
  const suspect = addRecord(env.db, { worker: b, start: at('12:00'), net: 5, podozrenie: 'kratky' });
  const confirmed = addRecord(env.db, { worker: b, start: at('13:00'), net: 5, podozrenie: 'kratky', potvrdene: true });
  const excluded = addRecord(env.db, { worker: b, start: at('14:00'), stav: 'vylucene' });
  const running = addRecord(env.db, { worker: a, start: at('15:00'), stav: 'bezi' });
  const run = (f: Partial<ReportFilter>) => ids(buildDailyReport(env.db, TZ, D, { ...NO_FILTER, ...f }, DEFAULT_WEIGHTS));

  assert.deepEqual(run({ workerId: a }), [annaPick, annaPack, running]);
  assert.deepEqual(run({ activity: 'BAL' }), [annaPack]);
  assert.deepEqual(run({ status: 'neukoncene' }), [unfinished]);
  assert.deepEqual(run({ status: 'vylucene' }), [excluded]);
  assert.deepEqual(run({ status: 'bezi' }), [running]);
  assert.deepEqual(run({ status: 'ok' }), [annaPick, annaPack, borisPick, suspect, confirmed]);
  assert.deepEqual(run({ status: 'kontrola' }), [unfinished, suspect]);
  assert.deepEqual(run({ workerId: b, activity: 'VYCH', status: 'kontrola' }), [unfinished, suspect]);
  assert.deepEqual(run({ workerId: a, status: 'kontrola' }), []);
});

test('worker and activity filters also narrow the summary', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00') });
  addRecord(env.db, { worker: b, start: at('09:00') });
  addRecord(env.db, { worker: b, start: at('10:00'), activity: 'BAL' });
  const only = buildDailyReport(env.db, TZ, D, { ...NO_FILTER, workerId: b, activity: 'VYCH' }, DEFAULT_WEIGHTS);
  assert.deepEqual(only.sections.map((s) => [s.activity, s.rows.map((r) => r.workerName)]), [['VYCH', ['Boris']]]);
});

test('the team row stays the whole team under a worker filter: totals, index and review counts', () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 600, lines: 4, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('09:00'), net: 600, lines: 6, dl: 'DL2' });
  addRecord(env.db, { worker: b, start: at('10:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'DL3' });
  addRecord(env.db, { worker: b, start: at('11:00'), net: 5, podozrenie: 'kratky', dl: 'DL4' });
  const all = buildDailyReport(env.db, TZ, D, NO_FILTER, DEFAULT_WEIGHTS).sections[0]?.total;
  const only = buildDailyReport(env.db, TZ, D, { ...NO_FILTER, workerId: a }, DEFAULT_WEIGHTS).sections[0];
  assert.deepEqual(only?.rows.map((r) => r.workerName), ['Anna']);
  assert.equal(only?.total.notes, 2);
  assert.equal(only?.total.lines, 10);
  assert.deepEqual(only?.total, all);
});

test('the day page shows the summary in Slovak number format, highlights rows and links to the DL detail', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), net: 1800, lines: 10, kg: 7.5, dl: 'DL/1' });
  addRecord(env.db, { worker: a, start: at('09:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'DL2' });
  addRecord(env.db, { worker: a, start: at('10:00'), net: 5, podozrenie: 'kratky', dl: 'DL3' });
  addRecord(env.db, { worker: a, start: at('11:00'), podozrenie: 'dlhy', net: 9000, dl: 'DL4' });
  addRecord(env.db, { worker: a, start: at('12:00'), duplicita: true, potvrdene: true, dl: 'DL5' }); // a confirmed duplicate counts, an unconfirmed one does not
  const res = await createApp(env).request(`/prehlad?datum=${D}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Vychystanie/);
  assert.match(body, /Anna/);
  assert.match(body, /<td class="num">10,0<\/td>/); // 7.5 + 2.5 kg of the two counted records
  assert.match(body, /<td class="num">22,5<\/td>/); // 15 lines in 2400 s
  assert.match(body, /href="\/dl\/DL%2F1"/);
  assert.match(body, /class="err"/);
  assert.match(body, /class="warn"/);
  for (const tag of ['neukončený', 'krátky', 'dlhý', 'duplicita']) assert.ok(body.includes(tag), tag);
  assert.match(body, /href="\/prehlad\?datum=2026-10-13"/);
  assert.match(body, /href="\/prehlad\?datum=2026-10-15"/);
  assert.match(body, /href="\/prehlad\/export.xlsx\?datum=2026-10-14"/);
});

test('the day page defaults to today in local time and rejects a malformed date', async () => {
  const env = testEnv({}, at('00:30', '2026-10-15'));
  const app = createApp(env);
  assert.match(await (await app.request('/prehlad')).text(), /15\. 10\. 2026/);
  assert.equal((await app.request('/prehlad?datum=2026-13-40')).status, 400);
  assert.equal((await app.request('/prehlad/export.xlsx?datum=zle')).status, 400);
});

test('names and delivery note numbers are HTML-escaped', async () => {
  const env = testEnv();
  const a = addWorker(env.db, '<script>alert(1)</script>', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), dl: '<b>DL</b>' });
  upsertNote(env.db, note('<b>DL</b>', { customer: '<i>Firma</i>' }), at('07:00'));
  const app = createApp(env);
  for (const url of [`/prehlad?datum=${D}`, `/dl/${encodeURIComponent('<b>DL</b>')}`]) {
    const body = await (await app.request(url)).text();
    assert.ok(!body.includes('<script>alert(1)</script>'), url);
    assert.ok(!body.includes('<b>DL</b>'), url);
    assert.ok(!body.includes('<i>Firma</i>'), url);
    assert.ok(body.includes('&lt;'), url);
  }
});

test('the delivery note detail shows who picked and who packed it, all statuses, and the cached note', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  upsertNote(env.db, note('DL7', { customer: 'Firma Alfa', lines: 12, weightKg: 33.5 }), at('07:00'));
  addRecord(env.db, { worker: a, start: at('08:00'), net: 754, dl: 'DL7', activity: 'VYCH' });
  addRecord(env.db, { worker: b, start: at('13:10'), net: 300, dl: 'DL7', activity: 'BAL' });
  addRecord(env.db, { worker: b, start: at('14:10'), dl: 'DL7', activity: 'BAL', stav: 'vylucene' });
  addRecord(env.db, { worker: a, start: at('08:00'), dl: 'OTHER' });
  const app = createApp(env);
  const body = await (await app.request('/dl/DL7')).text();
  assert.match(body, /Firma Alfa/);
  assert.match(body, /33,5/);
  assert.match(body, /Vychystanie/);
  assert.match(body, /Balenie/);
  assert.match(body, /Anna/);
  assert.match(body, /Boris/);
  assert.match(body, /12:34/); // 754 s
  assert.match(body, /vylúčený/);
  assert.ok(!body.includes('OTHER'));
  assert.equal((await app.request('/dl/NEEXISTUJE')).status, 404);
});

test('a note with records but no cached details still has a detail page', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), dl: 'DL9' });
  const res = await createApp(env).request('/dl/DL9');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /DL9/);
});

async function readBook(res: Response): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  return wb;
}

test('the Excel export holds a summary sheet and a records sheet with real dates and durations', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  const b = addWorker(env.db, 'Boris', 'Z0002');
  addRecord(env.db, { worker: a, start: at('08:15'), net: 1800, lines: 10, kg: 7.5, dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('09:00'), net: 600, activity: 'BAL', dl: 'DL1' });
  addRecord(env.db, { worker: b, start: at('10:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'DL2' });
  const res = await createApp(env).request(`/prehlad/export.xlsx?datum=${D}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
  assert.match(res.headers.get('content-disposition') ?? '', /filename="skladpulz-prehlad-2026-10-14\.xlsx"/);

  const wb = await readBook(res);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Súhrn', 'Záznamy']);

  const sum = wb.getWorksheet('Súhrn');
  assert.ok(sum);
  const sumHeaders = (sum.getRow(1).values as unknown[]).slice(1);
  for (const h of ['Činnosť', 'Zamestnanec', 'DL', 'Položky', 'Hmotnosť (kg)', 'Čistý čas', 'DL / hod', 'Položky / hod', 'kg / hod']) {
    assert.ok(sumHeaders.some((x) => typeof x === 'string' && x.startsWith(h)), h);
  }
  const col = (name: string) => sumHeaders.findIndex((x) => typeof x === 'string' && x.startsWith(name)) + 1;
  const annaRow = sum.getRows(2, sum.rowCount - 1)?.find((r) => r.getCell(col('Zamestnanec')).value === 'Anna');
  assert.ok(annaRow);
  assert.equal(annaRow.getCell(col('Položky')).value, 10);
  assert.equal(annaRow.getCell(col('Hmotnosť (kg)')).value, 7.5);
  assert.equal(annaRow.getCell(col('Položky / hod')).value, 20);
  // exceljs reads a [h]:mm:ss cell back as a Date counted from the Excel epoch
  const duration = annaRow.getCell(col('Čistý čas')).value;
  assert.ok(duration instanceof Date);
  assert.equal(Math.round((duration.getTime() - Date.UTC(1899, 11, 30)) / 1000), 1800);
  const teamRows = sum.getRows(2, sum.rowCount - 1)?.filter((r) => String(r.getCell(col('Zamestnanec')).value).startsWith('Tím'));
  assert.equal(teamRows?.length, 2);
  assert.equal(sum.views[0]?.state, 'frozen');
  assert.equal((sum.views[0] as { ySplit?: number }).ySplit, 1);
  assert.ok(sum.autoFilter);

  const recs = wb.getWorksheet('Záznamy');
  assert.ok(recs);
  assert.equal(recs.rowCount, 4);
  const h = (recs.getRow(1).values as unknown[]).slice(1) as string[];
  assert.ok(h.includes('Začiatok') && h.includes('Koniec') && h.includes('DL') && h.includes('Stav'));
  const first = recs.getRow(2);
  const start = first.getCell(h.indexOf('Začiatok') + 1).value;
  assert.ok(start instanceof Date);
  // local wall-clock time stored as the Excel date: 08:15 Bratislava, not 06:15 UTC
  assert.equal(start.toISOString(), '2026-10-14T08:15:00.000Z');
  assert.equal(first.getCell(h.indexOf('Zamestnanec') + 1).value, 'Anna');
  assert.equal(first.getCell(h.indexOf('DL') + 1).value, 'DL1');
  const neukoncene = recs.getRow(4);
  assert.equal(neukoncene.getCell(h.indexOf('Stav') + 1).value, 'neukončený');
});

test('the Excel export honours the same filters as the page', async () => {
  const env = testEnv();
  const a = addWorker(env.db, 'Anna', 'Z0001');
  addRecord(env.db, { worker: a, start: at('08:00'), dl: 'DL1' });
  addRecord(env.db, { worker: a, start: at('09:00'), dl: 'DL2', activity: 'BAL' });
  const wb = await readBook(await createApp(env).request(`/prehlad/export.xlsx?datum=${D}&cinnost=BAL`));
  const recs = wb.getWorksheet('Záznamy');
  assert.equal(recs?.rowCount, 2);
  assert.equal(recs?.getRow(2).getCell(5).value, 'DL2');
});
