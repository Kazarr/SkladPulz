import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page, type Html } from '../layout.ts';
import { ACTIVITIES, type Activity } from '../../config.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { BAND_LABEL, buildComparison, orderRows, rankOf, type Comparison, type ComparisonRow, type ComparisonView } from '../../reports/comparison.ts';
import { comparisonWorkbookBytes } from '../../reports/comparison-export.ts';
import { formatNumber, formatPercent, formatSeconds } from '../../reports/format.ts';
import { customPeriod, periodAround, periodLabel, PERIOD_KINDS, shiftPeriod, type Period, type PeriodKind } from '../../reports/period.ts';
import { getIndexWeights } from '../../store/index-weights.ts';
import { isDate, localDate } from '../../time.ts';

const PERIOD_LABEL: Record<PeriodKind, string> = { den: 'Deň', tyzden: 'Týždeň', mesiac: 'Mesiac', vlastne: 'Vlastný rozsah' };
const VIEW_LABEL: Record<ComparisonView, string> = { poradie: 'Poradie podľa indexu', pasma: 'Pásma (bez poradia)' };

interface Params {
  period: Period;
  activity: Activity;
  view: ComparisonView;
}

/** Period, activity and view of a request; a string is the reason the dates are unusable. */
function parseParams(q: (name: string) => string | undefined, today: string): Params | string {
  const kindRaw = q('obdobie') ?? '';
  const kind: PeriodKind = (PERIOD_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as PeriodKind) : 'tyzden';
  const anchor = q('datum') ? (q('datum') as string) : today;
  const bad = 'Neplatné obdobie, použite dátumy v tvare RRRR-MM-DD a začiatok pred koncom.';
  if (!isDate(anchor)) return bad;
  let period: Period | null;
  if (kind === 'vlastne') {
    const week = periodAround('tyzden', anchor);
    const from = q('od') || week.from;
    const to = q('do') || week.to;
    period = isDate(from) && isDate(to) ? customPeriod(from, to) : null;
  } else {
    period = periodAround(kind, anchor);
  }
  if (period === null) return bad;
  const activityRaw = q('cinnost') ?? '';
  return {
    period,
    activity: (ACTIVITIES as readonly string[]).includes(activityRaw) ? (activityRaw as Activity) : 'VYCH',
    view: q('zobrazenie') === 'pasma' ? 'pasma' : 'poradie',
  };
}

/** Query string that reproduces a period (a day anchor for day, week and month; both ends for a custom range). */
function query(p: Params, period: Period = p.period): string {
  const q = new URLSearchParams({ obdobie: period.kind, cinnost: p.activity, zobrazenie: p.view });
  if (period.kind === 'vlastne') {
    q.set('od', period.from);
    q.set('do', period.to);
  } else {
    q.set('datum', period.from);
  }
  return q.toString();
}

function trend(change: number | null): string {
  if (change === null) return '–';
  const text = formatPercent(change, 1, true);
  return `${Math.abs(change) < 0.05 ? '→' : change > 0 ? '↑' : '↓'} ${text}`;
}

function tableRow(c: Comparison, view: ComparisonView, r: ComparisonRow, isTeam: boolean): Html {
  const first = isTeam ? '' : view === 'pasma' ? (r.band ? BAND_LABEL[r.band] : '–') : (rankOf(c.rows, r) ?? '–');
  return html`<td>${first}</td><td>${r.workerName}</td>
    <td class="num">${formatNumber(r.notes, 0)}</td><td class="num">${formatNumber(r.lines, 0)}</td><td class="num">${formatNumber(r.weightKg)}</td><td class="num">${formatSeconds(r.netSeconds)}</td>
    <td class="num">${formatNumber(r.notesPerHour)}</td><td class="num">${formatNumber(r.linesPerHour)}</td><td class="num">${formatNumber(r.kgPerHour)}</td>
    <td class="num">${formatSeconds(r.avgSecondsPerNote)}</td><td class="num">${formatSeconds(r.avgSecondsPerLine)}</td>
    <td class="num">${formatPercent(r.index)}</td><td class="num">${formatPercent(r.linesPerHourDeviation, 1, true)}</td><td class="num">${formatPercent(r.indexDeviation, 1, true)}</td>
    <td class="num">${trend(r.linesPerHourTrend)}</td><td class="num">${trend(r.indexTrend)}</td>
    <td class="num">${r.unfinished}</td><td class="num">${r.suspect}</td><td class="num">${r.excluded}</td>`;
}

function comparisonTable(c: Comparison, view: ComparisonView): Html {
  if (c.rows.length === 0) return html`<p class="empty">Za toto obdobie nie sú žiadne záznamy.</p>`;
  return html`<table>
    <thead><tr><th>${view === 'pasma' ? 'Pásmo' : 'Poradie'}</th><th>Zamestnanec</th><th class="num">DL</th><th class="num">Položky</th><th class="num">kg</th><th class="num">Čistý čas</th>
      <th class="num">DL / hod</th><th class="num">Položky / hod</th><th class="num">kg / hod</th><th class="num">Ø čas na DL</th><th class="num">Ø čas na položku</th>
      <th class="num" title="Norma času ÷ skutočný čas, priemer tímu = 100 %">Index</th>
      <th class="num" title="Položky za hodinu oproti priemeru tímu">Odchýlka položiek / hod (%)</th><th class="num" title="Index mínus 100">Odchýlka indexu (%)</th>
      <th class="num" title="Zmena oproti predchádzajúcemu obdobiu rovnakej dĺžky; „–“ ak vtedy nemal údaje">Trend položiek / hod</th><th class="num">Trend indexu</th>
      <th class="num" title="Zatvorené automaticky na konci zmeny, do výpočtu nevstupujú">Neukončené</th>
      <th class="num" title="Krátke alebo dlhé záznamy, ktoré vedúci ešte nepotvrdil; do výpočtu nevstupujú">Podozrivé</th>
      <th class="num" title="Záznamy vylúčené vedúcim, do výpočtu nevstupujú">Vylúčené</th></tr></thead>
    <tbody>${orderRows(c.rows, view).map((r) => html`<tr>${tableRow(c, view, r, false)}</tr>`)}</tbody>
    <tfoot><tr>${tableRow(c, view, c.team, true)}</tr></tfoot>
  </table>`;
}

export function comparisonRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const tz = deps.config.timezone;
  const run = (p: Params): Comparison => buildComparison(deps.db, tz, p.period, p.activity, getIndexWeights(deps.db)[p.activity]);

  r.get('/porovnanie', (c) => {
    const p = parseParams((n) => c.req.query(n), localDate(deps.now(), tz));
    if (typeof p === 'string') return c.text(p, 400);
    const cmp = run(p);
    const body = html`
      <form class="filters no-print" method="get" action="/porovnanie">
        <label>Obdobie<select name="obdobie">${PERIOD_KINDS.map((k) => html`<option value="${k}" ${p.period.kind === k ? 'selected' : ''}>${PERIOD_LABEL[k]}</option>`)}</select></label>
        <label>Dátum (deň, týždeň, mesiac)<input type="date" name="datum" value="${p.period.from}"></label>
        <label>Od (vlastný rozsah)<input type="date" name="od" value="${p.period.from}"></label>
        <label>Do<input type="date" name="do" value="${p.period.to}"></label>
        <label>Činnosť<select name="cinnost">${ACTIVITIES.map((a) => html`<option value="${a}" ${p.activity === a ? 'selected' : ''}>${ACTIVITY_LABEL[a]}</option>`)}</select></label>
        <label>Zobrazenie<select name="zobrazenie">${(['poradie', 'pasma'] as const).map((v) => html`<option value="${v}" ${p.view === v ? 'selected' : ''}>${VIEW_LABEL[v]}</option>`)}</select></label>
        <button type="submit">Zobraziť</button>
        <a class="button secondary" href="/porovnanie/export.xlsx?${query(p)}">Export do Excelu</a>
      </form>
      <p class="no-print"><a href="/porovnanie?${query(p, shiftPeriod(p.period, -1))}">← Predchádzajúce obdobie</a>
        · <strong>${PERIOD_LABEL[p.period.kind]}: ${periodLabel(p.period)}</strong> ·
        <a href="/porovnanie?${query(p, shiftPeriod(p.period, 1))}">Nasledujúce obdobie →</a></p>
      <h2>${ACTIVITY_LABEL[p.activity]}</h2>
      ${comparisonTable(cmp, p.view)}
      <p class="muted">Do porovnania vstupujú len hodnotené záznamy; neukončené, podozrivé a vylúčené záznamy sú uvedené zvlášť a do čísel nevstupujú.
        Trend je zmena oproti predchádzajúcemu obdobiu (${periodLabel(cmp.previous)}); index je vždy vzhľadom na tím v danom období, takže tím má 100 %.
        <a href="/index">Ako sa počíta index a nastavenie váh</a>.</p>`;
    return c.html(page({ title: 'Porovnanie zamestnancov', active: '/porovnanie', body, user: c.get('manager') }));
  });

  r.get('/porovnanie/export.xlsx', async (c) => {
    const p = parseParams((n) => c.req.query(n), localDate(deps.now(), tz));
    if (typeof p === 'string') return c.text(p, 400);
    const bytes = await comparisonWorkbookBytes(run(p), p.view, tz);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="skladpulz-porovnanie-${p.period.from}_${p.period.to}.xlsx"`,
    });
  });

  return r;
}
