import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page } from '../layout.ts';
import { ACTIVITIES, type Activity } from '../../config.ts';
import { type ReviewReason } from '../../domain/record.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { confirmRecord, correctRecord, excludeRecord, listCorrectionLog, listReviewItems, restoreRecord, type Result } from '../../store/corrections.ts';
import { getRecord, type WorkRecord } from '../../store/records.ts';
import { getWorker, listWorkers } from '../../store/workers.ts';
import { addDays, formatDuration, isDate, localDate, localDateTime, localDayRange, localParts, localToEpoch, pad } from '../../time.ts';

type Ctx = Context<AppEnv>;

const NO_MANAGER = '(bez prihlásenia)';
const DEFAULT_DAYS = 14;

const STATUS_LABEL: Record<string, string> = { bezi: 'Beží', ok: 'Ukončený', neukoncene: 'Neukončený', opravene: 'Opravený', vylucene: 'Vylúčený' };
const REASON_LABEL: Record<ReviewReason, string> = {
  neukoncene: 'Neukončený',
  kratky: 'Podozrivo krátky',
  dlhy: 'Podozrivo dlhý',
  duplicita: 'Duplicita',
};
const ACTION_LABEL: Record<string, string> = {
  oprava: 'Oprava',
  potvrdenie: 'Potvrdenie',
  vylucenie: 'Vylúčenie z hodnotenia',
  vratenie: 'Vrátenie do hodnotenia',
};
const FIELD_LABEL: Record<string, string> = {
  zaciatok: 'Začiatok',
  koniec: 'Koniec',
  zamestnanec: 'Zamestnanec',
  cinnost: 'Činnosť',
  pauza_s: 'Pauzy',
  cisty_cas_s: 'Čistý čas',
  sposob_ukoncenia: 'Spôsob ukončenia',
  stav: 'Stav',
  potvrdene: 'Potvrdené',
  akcia: 'Akcia',
};

const recordId = (text: string): number | null => (/^\d{1,9}$/.test(text) ? Number(text) : null);

/** "D. M. YYYY HH:MM:SS" in local time. */
const withSeconds = (ms: number, tz: string): string => `${localDateTime(ms, tz)}:${pad(localParts(ms, tz).second)}`;

/** Value of a `datetime-local` input with seconds: "YYYY-MM-DDTHH:MM:SS". */
function inputDateTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Epoch ms of a `datetime-local` value ("YYYY-MM-DDTHH:MM" or with ":SS"), null when it is not a real local time. */
function parseInputDateTime(text: string, tz: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
  if (!m || !isDate(m[1] ?? '')) return null;
  const [y, mo, d] = (m[1] ?? '').split('-').map(Number);
  // ponytail: in the autumn clock overlap an hour maps to its first occurrence.
  return localToEpoch(y ?? 0, mo ?? 0, d ?? 0, Number(m[2]), Number(m[3]), tz) + Number(m[4] ?? 0) * 1000;
}

function logValue(field: string, v: string | null, tz: string): string {
  if (v === null) return '—';
  switch (field) {
    case 'zaciatok':
    case 'koniec':
      return withSeconds(Number(v), tz);
    case 'pauza_s':
    case 'cisty_cas_s':
      return formatDuration(Number(v));
    case 'potvrdene':
      return v === '1' ? 'áno' : 'nie';
    case 'stav':
      return STATUS_LABEL[v] ?? v;
    case 'cinnost':
      return ACTIVITY_LABEL[v as Activity] ?? v;
    case 'akcia':
      return ACTION_LABEL[v] ?? v;
    default:
      return v;
  }
}

interface FormValues {
  start: string;
  end: string;
  worker: string;
  activity: string;
  reason: string;
}

export function correctionRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = deps;
  const tz = deps.config.timezone;

  r.get('/kontrola', (c) => {
    const today = localDate(deps.now(), tz);
    const od = c.req.query('od') ?? '';
    const do_ = c.req.query('do') ?? '';
    const ok = isDate(od) && isDate(do_) && od <= do_;
    const [from, to] = ok ? [od, do_] : [addDays(today, 1 - DEFAULT_DAYS), today];
    const items = listReviewItems(db, localDayRange(from, to, tz));
    const body = html`
      <form method="get" action="/kontrola" class="filters">
        <label>Od<input type="date" name="od" value="${from}" required></label>
        <label>Do<input type="date" name="do" value="${to}" required></label>
        <button type="submit">Zobraziť</button>
      </form>
      ${items.length === 0
        ? html`<p class="empty">Nič na kontrolu v tomto období.</p>`
        : html`<table>
            <thead><tr><th>Dôvod</th><th>Zamestnanec</th><th>Činnosť</th><th>DL</th><th>Začiatok</th><th>Koniec</th><th class="num">Čistý čas</th><th></th></tr></thead>
            <tbody>
              ${items.map(
                (i) => html`<tr>
                  <td>${i.reasons.map((x) => html`<span class="tag ${x === 'duplicita' ? 'warn' : 'err'}">${REASON_LABEL[x]}</span> `)}</td>
                  <td>${i.workerName}</td>
                  <td><span class="tag ${i.record.activity}">${ACTIVITY_LABEL[i.record.activity]}</span></td>
                  <td>${i.record.dlNumber}</td>
                  <td>${localDateTime(i.record.start, tz)}</td>
                  <td>${i.record.end === null ? '—' : localDateTime(i.record.end, tz)}</td>
                  <td class="num">${i.record.netSeconds === null ? '—' : formatDuration(i.record.netSeconds)}</td>
                  <td><a class="button secondary" href="/zaznam/${i.record.id}">Opraviť</a></td>
                </tr>`,
              )}
            </tbody>
          </table>`}`;
    return c.html(page({ title: 'Záznamy na kontrolu', active: '/kontrola', body, user: c.get('manager') }));
  });

  const initialValues = (rec: WorkRecord): FormValues => ({
    start: inputDateTime(rec.start, tz),
    end: rec.end === null ? '' : inputDateTime(rec.end, tz),
    worker: String(rec.workerId),
    activity: rec.activity,
    reason: '',
  });

  const recordPage = (c: Ctx, rec: WorkRecord, v: FormValues, opts: { error?: string; saved?: boolean } = {}, status: 200 | 400 = 200) => {
    const worker = getWorker(db, rec.workerId);
    const log = listCorrectionLog(db, rec.id);
    const canCorrect = rec.status !== 'bezi' && rec.status !== 'vylucene';
    const canConfirm = canCorrect && rec.status !== 'neukoncene' && !rec.confirmed;
    const body = html`
      ${opts.error ? html`<p class="notice err" role="alert">${opts.error}</p>` : ''}
      ${opts.saved ? html`<p class="notice ok" role="status">Zmena je uložená.</p>` : ''}
      <p><a href="/kontrola">← Späť na záznamy na kontrolu</a></p>
      <table>
        <tbody>
          <tr><th>DL</th><td>${rec.dlNumber}</td><th>Stav</th><td>${STATUS_LABEL[rec.status]}</td></tr>
          <tr><th>Zamestnanec</th><td>${worker ? `${worker.name} (${worker.code})` : rec.workerId}</td><th>Podozrenie</th><td>${rec.suspicion === 'kratky' ? 'krátky záznam' : rec.suspicion === 'dlhy' ? 'dlhý záznam' : 'žiadne'}</td></tr>
          <tr><th>Činnosť</th><td>${ACTIVITY_LABEL[rec.activity]}</td><th>Potvrdené</th><td>${rec.confirmed ? 'áno' : 'nie'}${rec.duplicate ? ' · duplicita' : ''}</td></tr>
          <tr><th>Čistý čas</th><td>${rec.netSeconds === null ? '—' : formatDuration(rec.netSeconds)}</td><th>Pauzy</th><td>${formatDuration(rec.pauseSeconds)}</td></tr>
        </tbody>
      </table>
      ${rec.status === 'bezi'
        ? html`<p class="notice">Záznam práve beží. Upraviť ho možno až po ukončení pracovníkom.</p>`
        : html`<form method="post" action="/zaznam/${rec.id}" class="form">
            ${canCorrect
              ? html`<label>Začiatok<input type="datetime-local" name="start" value="${v.start}" step="1" required></label>
                <label>Koniec<input type="datetime-local" name="end" value="${v.end}" step="1" required></label>
                <label>Zamestnanec<select name="worker">${listWorkers(db).map((w) => html`<option value="${w.id}" ${String(w.id) === v.worker ? 'selected' : ''}>${w.name} (${w.code})</option>`)}</select></label>
                <label>Činnosť<select name="activity">${ACTIVITIES.map((a) => html`<option value="${a}" ${a === v.activity ? 'selected' : ''}>${ACTIVITY_LABEL[a]}</option>`)}</select></label>`
              : html`<p class="notice">Vylúčený záznam najprv vráťte do hodnotenia, potom ho možno opraviť.</p>`}
            <label>Dôvod (povinný)<textarea name="reason" rows="2" maxlength="500" required>${v.reason}</textarea></label>
            <div>
              ${canCorrect ? html`<button type="submit" name="akcia" value="oprava">Uložiť opravu</button> ` : ''}
              ${canConfirm ? html`<button type="submit" name="akcia" value="potvrdit" class="secondary">Potvrdiť</button> ` : ''}
              ${canCorrect ? html`<button type="submit" name="akcia" value="vylucit" class="danger">Vylúčiť z hodnotenia</button>` : ''}
              ${rec.status === 'vylucene' ? html`<button type="submit" name="akcia" value="vratit">Vrátiť do hodnotenia</button>` : ''}
            </div>
          </form>`}
      <h2>História opráv</h2>
      ${log.length === 0
        ? html`<p class="empty">Záznam zatiaľ nikto neopravoval.</p>`
        : html`<table>
            <thead><tr><th>Kedy</th><th>Vedúci</th><th>Pole</th><th>Pôvodná hodnota</th><th>Nová hodnota</th><th>Dôvod</th></tr></thead>
            <tbody>${log.map((l) => html`<tr><td>${withSeconds(l.at, tz)}</td><td>${l.manager}</td><td>${FIELD_LABEL[l.field] ?? l.field}</td><td>${logValue(l.field, l.oldValue, tz)}</td><td>${logValue(l.field, l.newValue, tz)}</td><td>${l.reason}</td></tr>`)}</tbody>
          </table>`}`;
    return c.html(page({ title: `Záznam DL ${rec.dlNumber}`, active: '/kontrola', body, user: c.get('manager') }), status);
  };

  r.get('/zaznam/:id', (c) => {
    const rec = getRecord(db, recordId(c.req.param('id')) ?? 0);
    if (!rec) return c.text('Záznam neexistuje.', 404);
    return recordPage(c, rec, initialValues(rec), { saved: c.req.query('ulozene') === '1' });
  });

  r.post('/zaznam/:id', async (c) => {
    const rec = getRecord(db, recordId(c.req.param('id')) ?? 0);
    if (!rec) return c.text('Záznam neexistuje.', 404);
    const form = await c.req.parseBody();
    const text = (k: string): string => (typeof form[k] === 'string' ? form[k] : '');
    const typed: FormValues = { start: text('start'), end: text('end'), worker: text('worker'), activity: text('activity'), reason: text('reason') };
    const by = { manager: c.get('manager') ?? NO_MANAGER, now: deps.now() };
    const refuse = (error: string) => recordPage(c, rec, typed.start === '' && typed.end === '' ? { ...initialValues(rec), reason: typed.reason } : typed, { error }, 400);

    let result: Result;
    switch (text('akcia')) {
      case 'oprava': {
        // The input shows whole seconds, so a value equal to the shown one means "unchanged" and keeps the stored milliseconds.
        const start = typed.start === inputDateTime(rec.start, tz) ? rec.start : parseInputDateTime(typed.start, tz);
        const end = rec.end !== null && typed.end === inputDateTime(rec.end, tz) ? rec.end : parseInputDateTime(typed.end, tz);
        const activity = ACTIVITIES.find((a) => a === typed.activity);
        const workerId = /^\d{1,9}$/.test(typed.worker) ? Number(typed.worker) : null;
        if (start === null || end === null) return refuse('Zadajte začiatok aj koniec v tvare dátum a čas.');
        if (activity === undefined) return refuse('Neplatná činnosť.');
        if (workerId === null) return refuse('Vyberte zamestnanca.');
        result = correctRecord(db, rec.id, { start, end, workerId, activity, reason: typed.reason }, by);
        break;
      }
      case 'potvrdit':
        result = confirmRecord(db, rec.id, typed.reason, by);
        break;
      case 'vylucit':
        result = excludeRecord(db, rec.id, typed.reason, by);
        break;
      case 'vratit':
        result = restoreRecord(db, rec.id, typed.reason, by);
        break;
      default:
        return refuse('Neznáma akcia.');
    }
    if (!result.ok) return refuse(result.error);
    return c.redirect(`/zaznam/${rec.id}?ulozene=1`, 303);
  });

  return r;
}
