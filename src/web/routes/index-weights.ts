import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page, type Html } from '../layout.ts';
import { ACTIVITIES, type Activity } from '../../config.ts';
import { estimateWeights, MIN_ESTIMATE_RECORDS, standardSeconds, type Estimate, type Weights } from '../../domain/index.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { formatNumber } from '../../reports/format.ts';
import { listRangeRecords } from '../../reports/queries.ts';
import { loadIndexWeights, saveIndexWeights, type StoredWeights } from '../../store/index-weights.ts';
import { addDays, isDate, localDate, localDateTime } from '../../time.ts';

const MAX_WEIGHT = 100_000;

/** "12,5" or "12.5"; null for anything else (negative, text, empty, absurdly large). */
function parseWeight(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+([.,]\d+)?$/.test(v.trim())) return null;
  const n = Number(v.trim().replace(',', '.'));
  return n <= MAX_WEIGHT ? n : null;
}

/** Slovak number without trailing zeros: 111,5 and 1 090. */
const plain = (n: number): string => n.toLocaleString('sk-SK', { maximumFractionDigits: 2 });
/** Value for a text input: decimal comma, at most two decimals. */
const inputValue = (n: number): string => n.toLocaleString('sk-SK', { maximumFractionDigits: 2, useGrouping: false });

function refusal(e: Extract<Estimate, { ok: false }>): string {
  return e.reason === 'too_few'
    ? `Príliš málo záznamov (${e.records} z potrebných ${MIN_ESTIMATE_RECORDS}). Počkajte na viac dát alebo zvoľte dlhšie obdobie.`
    : 'Z týchto dát sa váhy nedajú vypočítať: všetky DL majú rovnaký počet položiek a hmotnosť, alebo nevyšla žiadna kladná váha.';
}

const recordsLabel = (n: number): string => `${n} ${n === 1 ? 'záznam' : n >= 2 && n <= 4 ? 'záznamy' : 'záznamov'}`;

function weightFields(w: Weights): Html {
  return html`<label>Pevný čas na DL (s)<input name="pevny" value="${inputValue(w.fixedSeconds)}" inputmode="decimal" required></label>
    <label>Čas na položku (s)<input name="polozka" value="${inputValue(w.perLineSeconds)}" inputmode="decimal" required></label>
    <label>Príplatok za kg (s)<input name="kg" value="${inputValue(w.perKgSeconds)}" inputmode="decimal" required></label>`;
}

function activitySection(a: Activity, stored: StoredWeights, estimate: Estimate | null, tz: string): Html {
  const cur = stored.weights;
  const sug = estimate?.ok ? estimate.weights : null;
  const row = (label: string, c: number, s: number | undefined): Html =>
    html`<tr><th>${label}</th><td class="num">${formatNumber(c, 2)}</td>${estimate ? html`<td class="num">${s === undefined ? '–' : formatNumber(s, 2)}</td>` : ''}</tr>`;
  return html`<h2>${ACTIVITY_LABEL[a]}</h2>
    <table class="narrow"><thead><tr><th></th><th class="num">Aktuálne</th>${estimate ? html`<th class="num">Navrhnuté z dát</th>` : ''}</tr></thead>
      <tbody>${row('Pevný čas na DL (s)', cur.fixedSeconds, sug?.fixedSeconds)}${row('Čas na položku (s)', cur.perLineSeconds, sug?.perLineSeconds)}${row('Príplatok za kg (s/kg)', cur.perKgSeconds, sug?.perKgSeconds)}</tbody></table>
    ${stored.changedAt === null
      ? html`<p class="muted"><span class="tag warn">zástupné hodnoty</span> Váhy sú zástupné, kým sa nenastavia z nameraných dát (po 2–4 týždňoch merania).</p>`
      : html`<p class="muted">Zmenil: ${stored.changedBy ?? 'neznámy'}, ${localDateTime(stored.changedAt, tz)}.</p>`}
    ${estimate === null
      ? ''
      : estimate.ok
        ? html`<p>Návrh z ${recordsLabel(estimate.records)}, R² = ${estimate.r2 === null ? '–' : formatNumber(estimate.r2, 2)}.
            ${estimate.clamped.length > 0 ? html`Záporná váha bola nastavená na 0 a ostatné prepočítané.` : ''}</p>`
        : html`<p class="empty">${refusal(estimate)}</p>`}
    <div class="filters">
      <form method="post" action="/index/vahy" class="filters"><input type="hidden" name="cinnost" value="${a}">${weightFields(cur)}<button type="submit">Uložiť váhy</button></form>
      ${sug ? html`<form method="post" action="/index/vahy"><input type="hidden" name="cinnost" value="${a}">
        <input type="hidden" name="pevny" value="${inputValue(sug.fixedSeconds)}"><input type="hidden" name="polozka" value="${inputValue(sug.perLineSeconds)}"><input type="hidden" name="kg" value="${inputValue(sug.perKgSeconds)}">
        <button type="submit" class="secondary">Prevziať návrh</button></form>` : ''}
    </div>`;
}

function explanation(w: Weights): Html {
  const small = standardSeconds(w, { netSeconds: null, lines: 2, weightKg: 3 });
  const big = standardSeconds(w, { netSeconds: null, lines: 40, weightKg: 60 });
  return html`<h2>Ako sa počíta výkonový index</h2>
    <ol class="explain">
      <li>DL s 2 položkami a DL so 40 položkami nemožno porovnať podľa času. Preto každý DL dostane <strong>normu času</strong>: pevný čas na DL + čas na každú položku + príplatok za každý kilogram. Váhy sa nastavujú zvlášť pre vychystanie a balenie (vyššie).</li>
      <li>Príklad s aktuálnymi váhami vychystania: DL s 2 položkami a 3 kg má normu ${plain(w.fixedSeconds)} + 2 × ${plain(w.perLineSeconds)} + 3 × ${plain(w.perKgSeconds)} = <strong>${plain(small)} s</strong>.
        DL so 40 položkami a 60 kg má normu ${plain(w.fixedSeconds)} + 40 × ${plain(w.perLineSeconds)} + 60 × ${plain(w.perKgSeconds)} = <strong>${plain(big)} s</strong>.
        Kto malý DL vybaví za ${plain(small)} s a veľký za ${plain(big)} s, je presne na norme, hoci veľký DL trvá násobne dlhšie.</li>
      <li>Index pracovníka = súčet noriem jeho DL ÷ súčet jeho skutočných čistých časov (bez pauz). Aby bol priemer tímu presne 100 %, toto číslo sa ešte vydelí rovnakým podielom celého tímu za to isté obdobie a činnosť a vynásobí 100.</li>
      <li>Index 100 % znamená tempo tímu pri rovnako náročných DL, 110 % tempo o desatinu rýchlejšie, 90 % o desatinu pomalšie. Pracovník s mnohými malými DL a pracovník s málo veľkými DL môžu mať rovnaký index, hoci počet DL za hodinu majú veľmi odlišný.</li>
      <li>Vstupujú len hodnotené záznamy. Neukončené, vylúčené a podozrivé záznamy, ktoré vedúci nepotvrdil, sa nepočítajú. Chýbajúce počty položiek alebo hmotnosť DL sa počítajú ako 0 (norma je potom len pevný čas).</li>
      <li>Váhy sa po 2–4 týždňoch merania vypočítajú z dát (tlačidlo „Vypočítať z dát“): hľadá sa pevný čas, čas na položku a príplatok za kg, s ktorými norma čo najlepšie sedí so skutočnými časmi (lineárna regresia, metóda najmenších štvorcov). Záporná váha sa nastaví na 0 a ostatné sa prepočítajú. R² ukazuje, ako dobre norma vysvetľuje namerané časy (1 = dokonale). Pri menej ako ${MIN_ESTIMATE_RECORDS} záznamoch sa výpočet odmietne. Vedúci môže váhy kedykoľvek upraviť ručne.</li>
    </ol>`;
}

export function indexWeightsRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const tz = deps.config.timezone;

  r.get('/index', (c) => {
    const today = localDate(deps.now(), tz);
    const od = c.req.query('od');
    const doo = c.req.query('do');
    const asked = od !== undefined && doo !== undefined && od !== '' && doo !== '';
    if (asked && (!isDate(od) || !isDate(doo) || od > doo)) return c.text('Neplatné obdobie, použite tvar RRRR-MM-DD a začiatok pred koncom.', 400);
    const stored = loadIndexWeights(deps.db);
    const estimates = (a: Activity): Estimate | null => (asked ? estimateWeights(listRangeRecords(deps.db, 'zaznam_hodnotene', tz, od, doo, { workerId: null, activity: a })) : null);
    const body = html`
      <p><a href="/porovnanie">← Porovnanie zamestnancov</a></p>
      <form class="filters" method="get" action="/index">
        <label>Obdobie od<input type="date" name="od" value="${asked ? od : addDays(today, -28)}"></label>
        <label>do<input type="date" name="do" value="${asked ? doo : addDays(today, -1)}"></label>
        <button type="submit">Vypočítať z dát</button>
      </form>
      <p class="muted">Návrh váh sa počíta z hodnotených záznamov zvoleného obdobia (predvolene posledných 28 dní). Nič sa neuloží, kým návrh neprevezmete.</p>
      ${ACTIVITIES.map((a) => activitySection(a, stored[a], estimates(a), tz))}
      ${explanation(stored.VYCH.weights)}`;
    return c.html(page({ title: 'Výkonový index', active: '/porovnanie', body, user: c.get('manager') }));
  });

  r.post('/index/vahy', async (c) => {
    const form = await c.req.parseBody();
    const activity = String(form['cinnost'] ?? '');
    const w = { fixedSeconds: parseWeight(form['pevny']), perLineSeconds: parseWeight(form['polozka']), perKgSeconds: parseWeight(form['kg']) };
    if (!(ACTIVITIES as readonly string[]).includes(activity) || w.fixedSeconds === null || w.perLineSeconds === null || w.perKgSeconds === null) {
      return c.text('Neplatné váhy: zadajte nezáporné čísla (pevný čas, čas na položku, príplatok za kg).', 400);
    }
    saveIndexWeights(deps.db, activity as Activity, { fixedSeconds: w.fixedSeconds, perLineSeconds: w.perLineSeconds, perKgSeconds: w.perKgSeconds }, c.get('manager'), deps.now());
    return c.redirect('/index', 303);
  });

  return r;
}
