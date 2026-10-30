import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page, type Html } from '../layout.ts';
import { ACTIVITIES, type Activity } from '../../config.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { buildDailyReport, END_METHOD_LABEL, recordRowClass, recordTags, STATUS_LABEL, type DailyReport, type ReportFilter, type StatusFilter, type SummaryRow } from '../../reports/daily.ts';
import { dailyWorkbookBytes } from '../../reports/daily-export.ts';
import { formatNumber, formatPercent, formatSeconds } from '../../reports/format.ts';
import { listNoteRecords, type ReportRecord } from '../../reports/queries.ts';
import { getNote } from '../../store/delivery-notes.ts';
import { getIndexWeights } from '../../store/index-weights.ts';
import { listWorkers } from '../../store/workers.ts';
import { addDays, formatDuration, isDate, localDate, localDateTime, localTime } from '../../time.ts';

const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['kontrola', 'Na kontrolu (neukončené a podozrivé)'],
  ['ok', STATUS_LABEL.ok],
  ['opravene', STATUS_LABEL.opravene],
  ['neukoncene', STATUS_LABEL.neukoncene],
  ['vylucene', STATUS_LABEL.vylucene],
  ['bezi', STATUS_LABEL.bezi],
];

function parseFilter(q: (name: string) => string | undefined): ReportFilter {
  const worker = q('zamestnanec') ?? '';
  const activity = q('cinnost') ?? '';
  const status = q('stav') ?? '';
  return {
    workerId: /^\d{1,9}$/.test(worker) ? Number(worker) : null,
    activity: (ACTIVITIES as readonly string[]).includes(activity) ? (activity as Activity) : null,
    status: STATUS_OPTIONS.some(([k]) => k === status) ? (status as StatusFilter) : null,
  };
}

function query(date: string, f: ReportFilter): string {
  const p = new URLSearchParams({ datum: date });
  if (f.workerId !== null) p.set('zamestnanec', String(f.workerId));
  if (f.activity) p.set('cinnost', f.activity);
  if (f.status) p.set('stav', f.status);
  return p.toString();
}

const dlLink = (n: string): string => `/dl/${encodeURIComponent(n)}`;

function tags(r: ReportRecord): Html {
  return html`${recordTags(r).map((t) => html` <span class="tag ${t.kind}">${t.label}</span>`)}`;
}

function summaryRow(r: SummaryRow): Html {
  return html`<td>${r.workerName}</td>
    <td class="num">${formatNumber(r.notes, 0)}</td><td class="num">${formatNumber(r.lines, 0)}</td><td class="num">${formatNumber(r.units, 0)}</td><td class="num">${formatNumber(r.weightKg)}</td>
    <td class="num">${formatSeconds(r.netSeconds)}</td>
    <td class="num">${formatNumber(r.notesPerHour)}</td><td class="num">${formatNumber(r.linesPerHour)}</td><td class="num">${formatNumber(r.kgPerHour)}</td>
    <td class="num">${formatSeconds(r.avgSecondsPerNote)}</td><td class="num">${formatSeconds(r.avgSecondsPerLine)}</td>
    <td class="num">${formatPercent(r.index)}</td>
    <td class="num">${r.unfinished}</td><td class="num">${r.suspect}</td>`;
}

function summaryTable(report: DailyReport): Html {
  if (report.sections.length === 0) return html`<p class="empty">Za tento deň nie sú žiadne záznamy.</p>`;
  return html`${report.sections.map(
    (s) => html`<h2>${ACTIVITY_LABEL[s.activity]}</h2>
      <table>
        <thead><tr><th>Zamestnanec</th><th class="num">DL</th><th class="num">Položky</th><th class="num">Kusy</th><th class="num">kg</th><th class="num">Čistý čas</th>
          <th class="num">DL / hod</th><th class="num">Položky / hod</th><th class="num">kg / hod</th><th class="num">Ø čas na DL</th><th class="num">Ø čas na položku</th>
          <th class="num" title="Výkonový index: norma času ÷ skutočný čas, priemer tímu = 100 %. Vysvetlenie je na stránke Index.">Index</th>
          <th class="num" title="Zatvorené automaticky na konci zmeny, do výpočtu nevstupujú">Neukončené</th>
          <th class="num" title="Krátke alebo dlhé záznamy, ktoré vedúci ešte nepotvrdil; do výpočtu nevstupujú">Podozrivé</th></tr></thead>
        <tbody>${s.rows.map((r) => html`<tr>${summaryRow(r)}</tr>`)}</tbody>
        <tfoot><tr>${summaryRow(s.total)}</tr></tfoot>
      </table>`,
  )}
  <p class="muted">Do súhrnu vstupujú len hodnotené záznamy. Neukončené a podozrivé záznamy čakajú na kontrolu vedúcim. <a href="/index">Ako sa počíta index</a>.</p>`;
}

function recordsTable(records: ReportRecord[], tz: string): Html {
  if (records.length === 0) return html`<p class="empty">Žiadne záznamy podľa zvoleného filtra.</p>`;
  return html`<table>
    <thead><tr><th>Začiatok</th><th>Koniec</th><th>Zamestnanec</th><th>Činnosť</th><th>DL</th><th class="num">Položky</th><th class="num">kg</th>
      <th class="num">Čistý čas</th><th class="num">Pauza</th><th>Ukončenie</th><th>Stav</th></tr></thead>
    <tbody>${records.map(
      (r) => html`<tr class="${recordRowClass(r)}"><td>${localTime(r.start, tz)}</td><td>${r.end === null ? '–' : localTime(r.end, tz)}</td>
        <td>${r.workerName}</td><td><span class="tag ${r.activity}">${ACTIVITY_LABEL[r.activity]}</span></td>
        <td><a href="${dlLink(r.dlNumber)}">${r.dlNumber}</a></td>
        <td class="num">${r.lines ?? '–'}</td><td class="num">${formatNumber(r.weightKg)}</td>
        <td class="num">${formatSeconds(r.netSeconds)}</td><td class="num">${formatDuration(r.pauseSeconds)}</td>
        <td>${r.endMethod ? END_METHOD_LABEL[r.endMethod] : '–'}</td><td>${STATUS_LABEL[r.status]}${tags(r)}</td></tr>`,
    )}</tbody>
  </table>`;
}

export function reportRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const tz = deps.config.timezone;

  /** The requested day, today by default; null when the parameter is not a date. */
  const dayOf = (raw: string | undefined): string | null => (raw === undefined || raw === '' ? localDate(deps.now(), tz) : isDate(raw) ? raw : null);

  r.get('/prehlad', (c) => {
    const date = dayOf(c.req.query('datum'));
    if (date === null) return c.text('Neplatný dátum, použite tvar RRRR-MM-DD.', 400);
    const filter = parseFilter((n) => c.req.query(n));
    const report = buildDailyReport(deps.db, tz, date, filter, getIndexWeights(deps.db));
    const [y, m, d] = date.split('-').map(Number);
    const body = html`
      <form class="filters no-print" method="get" action="/prehlad">
        <label>Dátum<input type="date" name="datum" value="${date}"></label>
        <label>Zamestnanec<select name="zamestnanec"><option value="">Všetci</option>
          ${listWorkers(deps.db).map((w) => html`<option value="${w.id}" ${filter.workerId === w.id ? 'selected' : ''}>${w.name}</option>`)}</select></label>
        <label>Činnosť<select name="cinnost"><option value="">Všetky</option>
          ${ACTIVITIES.map((a) => html`<option value="${a}" ${filter.activity === a ? 'selected' : ''}>${ACTIVITY_LABEL[a]}</option>`)}</select></label>
        <label>Stav<select name="stav"><option value="">Všetky</option>
          ${STATUS_OPTIONS.map(([k, label]) => html`<option value="${k}" ${filter.status === k ? 'selected' : ''}>${label}</option>`)}</select></label>
        <button type="submit">Zobraziť</button>
        <a class="button secondary" href="/prehlad/export.xlsx?${query(date, filter)}">Export do Excelu</a>
      </form>
      <p class="no-print"><a href="/prehlad?${query(addDays(date, -1), filter)}">← Predchádzajúci deň</a>
        · <strong>${d}. ${m}. ${y}</strong> ·
        <a href="/prehlad?${query(addDays(date, 1), filter)}">Nasledujúci deň →</a></p>
      <h2>Súhrn po zamestnancoch</h2>
      ${summaryTable(report)}
      <h2>Záznamy dňa</h2>
      ${recordsTable(report.records, tz)}`;
    return c.html(page({ title: `Denný prehľad ${d}. ${m}. ${y}`, active: '/prehlad', body, user: c.get('manager') }));
  });

  r.get('/prehlad/export.xlsx', async (c) => {
    const date = dayOf(c.req.query('datum'));
    if (date === null) return c.text('Neplatný dátum, použite tvar RRRR-MM-DD.', 400);
    const bytes = await dailyWorkbookBytes(buildDailyReport(deps.db, tz, date, parseFilter((n) => c.req.query(n)), getIndexWeights(deps.db)), tz);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="skladpulz-prehlad-${date}.xlsx"`,
    });
  });

  r.get('/dl/:cislo', (c) => {
    const number = c.req.param('cislo');
    const note = getNote(deps.db, number);
    const records = listNoteRecords(deps.db, number);
    if (!note && records.length === 0) return c.text('Dodací list sa nenašiel.', 404);
    const body = html`
      ${note
        ? html`<table><tbody>
            <tr><th>Odberateľ</th><td>${note.customer ?? '–'}</td></tr>
            <tr><th>Dátum</th><td>${note.date ?? '–'}</td></tr>
            <tr><th>Stav v ONIXe</th><td>${note.state ?? '–'}</td></tr>
            <tr><th>Položky</th><td>${note.lines ?? '–'}</td></tr>
            <tr><th>Kusy</th><td>${formatNumber(note.units, 0)}</td></tr>
            <tr><th>Hmotnosť (kg)</th><td>${formatNumber(note.weightKg)}</td></tr></tbody></table>`
        : html`<p class="empty">Údaje o dodacom liste ešte nie sú v SkladPulz (ONIX ich zatiaľ nedodal).</p>`}
      ${ACTIVITIES.map((a) => {
        const mine = records.filter((r) => r.activity === a);
        return html`<h2>${ACTIVITY_LABEL[a]}</h2>
          ${mine.length === 0
            ? html`<p class="empty">Zatiaľ nikto.</p>`
            : html`<table><thead><tr><th>Zamestnanec</th><th>Začiatok</th><th>Koniec</th><th class="num">Čistý čas</th><th class="num">Pauza</th><th>Ukončenie</th><th>Stav</th></tr></thead>
              <tbody>${mine.map(
                (r) => html`<tr class="${recordRowClass(r)}"><td>${r.workerName}</td><td>${localDateTime(r.start, tz)}</td>
                  <td>${r.end === null ? '–' : localDateTime(r.end, tz)}</td><td class="num">${formatSeconds(r.netSeconds)}</td><td class="num">${formatDuration(r.pauseSeconds)}</td>
                  <td>${r.endMethod ? END_METHOD_LABEL[r.endMethod] : '–'}</td><td>${STATUS_LABEL[r.status]}${tags(r)}</td></tr>`,
              )}</tbody></table>`}`;
      })}
      <p class="no-print"><a href="/prehlad">← Denný prehľad</a></p>`;
    return c.html(page({ title: `Dodací list ${number}`, active: '/prehlad', body, user: c.get('manager') }));
  });

  return r;
}
