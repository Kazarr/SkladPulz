import { Hono, type Context } from 'hono';
import { html, raw } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page, type Html } from '../layout.ts';
import { ACTIVITIES, type Activity } from '../../config.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { barcodeSvg } from '../../print/barcode.ts';
import { CONTROL_CODES } from '../../print/control-codes.ts';
import { createStation, getStation, listStations, updateStation, type Station } from '../../store/stations.ts';
import { createWorker, getWorker, listWorkers, updateWorker, type Worker } from '../../store/workers.ts';

const MAX_NAME = 100;
const CONTROL_MODULE_MM = 0.45;

type Ctx = Context<AppEnv>;

function id(text: string): number | null {
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

function nameError(raw: unknown, what: string): { name: string } | { error: string } {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === '') return { error: `Zadajte ${what}.` };
  if (name.length > MAX_NAME) return { error: `${what[0]?.toUpperCase()}${what.slice(1)} môže mať najviac ${MAX_NAME} znakov.` };
  return { name };
}

/** '' means no default activity; anything but '', VYCH, BAL is invalid (undefined). */
function parseActivity(raw: unknown): Activity | null | undefined {
  if (raw === '' || raw === undefined) return null;
  return ACTIVITIES.find((a) => a === raw);
}

const notice = (error?: string) => (error ? html`<p class="notice err" role="alert">${error}</p>` : '');

export function adminRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = deps;

  const workersPage = (c: Ctx, error?: string, status: 200 | 400 = 200) => {
    const workers = listWorkers(db);
    const body = html`
      ${notice(error)}
      <form method="post" action="/zamestnanci" class="filters">
        <label>Meno nového zamestnanca<input name="name" maxlength="${MAX_NAME}" required></label>
        <button type="submit">Pridať</button>
        <span class="muted">Kód karty (Z + číslo) sa vygeneruje sám.</span>
      </form>
      <p class="no-print">
        <a class="button secondary" href="/zamestnanci/karty">Tlač kariet</a>
        <a class="button secondary" href="/tlac/kody">Tlač riadiacich kódov</a>
      </p>
      ${workers.length === 0 ? html`<p class="empty">Zatiaľ nie je založený žiadny zamestnanec.</p>` : workerTable(workers)}`;
    return c.html(page({ title: 'Zamestnanci', active: '/zamestnanci', body, user: c.get('manager') }), status);
  };

  const workerTable = (workers: Worker[]): Html => html`
    <form id="cards-form" method="get" action="/zamestnanci/karty"></form>
    <table>
      <thead><tr><th>Tlač</th><th>Kód</th><th>Meno</th><th>Stav</th><th></th></tr></thead>
      <tbody>
        ${workers.map(
          (w) => html`<tr>
            <td><input type="checkbox" name="id" value="${w.id}" form="cards-form" ${w.active ? '' : 'disabled'} aria-label="Vybrať ${w.name} na tlač"></td>
            <td>${w.code}</td>
            <td><form method="post" action="/zamestnanci/${w.id}" class="inline"><input name="name" value="${w.name}" maxlength="${MAX_NAME}" required aria-label="Meno ${w.code}"> <button type="submit" class="secondary">Uložiť</button></form></td>
            <td>${w.active ? html`<span class="tag ok">Aktívny</span>` : html`<span class="tag warn">Neaktívny</span>`}</td>
            <td><form method="post" action="/zamestnanci/${w.id}/aktivny" class="inline"><input type="hidden" name="active" value="${w.active ? '0' : '1'}"><button type="submit" class="${w.active ? 'danger' : 'secondary'}">${w.active ? 'Deaktivovať' : 'Aktivovať'}</button></form></td>
          </tr>`,
        )}
      </tbody>
    </table>
    <p><button type="submit" form="cards-form">Tlačiť vybrané karty</button></p>`;

  r.get('/zamestnanci', (c) => workersPage(c));

  r.post('/zamestnanci', async (c) => {
    const form = await c.req.parseBody();
    const parsed = nameError(form['name'], 'meno zamestnanca');
    if ('error' in parsed) return workersPage(c, parsed.error, 400);
    createWorker(db, parsed.name);
    return c.redirect('/zamestnanci', 303);
  });

  r.get('/zamestnanci/karty', (c) => {
    const picked = c.req.queries('id');
    const wanted = picked && picked.length > 0 ? new Set(picked.map(id)) : null;
    const workers = listWorkers(db, { activeOnly: true }).filter((w) => wanted === null || wanted.has(w.id));
    const body = html`
      <div class="toolbar no-print"><button type="button" onclick="window.print()">Tlačiť</button><a href="/zamestnanci">Späť na zamestnancov</a>
        <span class="muted">Tlačte na A4 v mierke 100 % (bez „prispôsobiť stránke“), karty vystrihnite po okrajoch.</span></div>
      ${workers.length === 0
        ? html`<p class="empty">Nie je koho tlačiť. Vyberte aktívnych zamestnancov na stránke <a href="/zamestnanci">Zamestnanci</a>.</p>`
        : html`<div class="cards-sheet">${workers.map((w) => html`<div class="card-print"><div class="name">${w.name}</div>${raw(barcodeSvg(w.code))}</div>`)}</div>`}`;
    return c.html(page({ title: 'Karty zamestnancov', active: '/zamestnanci', body, user: c.get('manager'), head: html`<link rel="stylesheet" href="/static/print.css">` }));
  });

  r.post('/zamestnanci/:id', async (c) => {
    const worker = getWorker(db, id(c.req.param('id')) ?? 0);
    if (!worker) return c.text('Zamestnanec neexistuje.', 404);
    const parsed = nameError((await c.req.parseBody())['name'], 'meno zamestnanca');
    if ('error' in parsed) return workersPage(c, parsed.error, 400);
    updateWorker(db, worker.id, { name: parsed.name });
    return c.redirect('/zamestnanci', 303);
  });

  r.post('/zamestnanci/:id/aktivny', async (c) => {
    const worker = getWorker(db, id(c.req.param('id')) ?? 0);
    if (!worker) return c.text('Zamestnanec neexistuje.', 404);
    updateWorker(db, worker.id, { active: (await c.req.parseBody())['active'] === '1' });
    return c.redirect('/zamestnanci', 303);
  });

  const stationsPage = (c: Ctx, error?: string, status: 200 | 400 = 200) => {
    const options = (selected: Activity | null) => html`
      <option value="" ${selected === null ? 'selected' : ''}>Žiadna</option>
      ${ACTIVITIES.map((a) => html`<option value="${a}" ${selected === a ? 'selected' : ''}>${ACTIVITY_LABEL[a]}</option>`)}`;
    const row = (s: Station) => html`<tr>
      <td colspan="2"><form method="post" action="/nastavenia/stanice/${s.id}" class="inline">
        <input name="name" value="${s.name}" maxlength="${MAX_NAME}" required aria-label="Názov stanice ${s.id}">
        <select name="activity" aria-label="Predvolená činnosť stanice ${s.id}">${options(s.defaultActivity)}</select>
        <button type="submit" class="secondary">Uložiť</button></form></td>
      <td><a class="button secondary" href="/stanica/${s.id}" target="_blank" rel="noopener">Otvoriť stanicu</a></td>
    </tr>`;
    const stations = listStations(db);
    const body = html`
      ${notice(error)}
      <form method="post" action="/nastavenia/stanice" class="filters">
        <label>Názov novej stanice<input name="name" maxlength="${MAX_NAME}" required></label>
        <label>Predvolená činnosť<select name="activity">${options(null)}</select></label>
        <button type="submit">Pridať stanicu</button>
      </form>
      ${stations.length === 0
        ? html`<p class="empty">Zatiaľ nie je založená žiadna stanica.</p>`
        : html`<table><thead><tr><th colspan="2">Stanica a predvolená činnosť</th><th></th></tr></thead><tbody>${stations.map(row)}</tbody></table>`}`;
    return c.html(page({ title: 'Nastavenia staníc', active: '/nastavenia/stanice', body, user: c.get('manager') }), status);
  };

  const parseStationForm = async (c: Ctx): Promise<{ name: string; defaultActivity: Activity | null } | { error: string }> => {
    const form = await c.req.parseBody();
    const parsed = nameError(form['name'], 'názov stanice');
    if ('error' in parsed) return parsed;
    const activity = parseActivity(form['activity']);
    if (activity === undefined) return { error: 'Neplatná činnosť.' };
    return { name: parsed.name, defaultActivity: activity };
  };

  r.get('/nastavenia/stanice', (c) => stationsPage(c));

  r.post('/nastavenia/stanice', async (c) => {
    const parsed = await parseStationForm(c);
    if ('error' in parsed) return stationsPage(c, parsed.error, 400);
    createStation(db, parsed.name, parsed.defaultActivity);
    return c.redirect('/nastavenia/stanice', 303);
  });

  r.post('/nastavenia/stanice/:id', async (c) => {
    const station = getStation(db, id(c.req.param('id')) ?? 0);
    if (!station) return c.text('Stanica neexistuje.', 404);
    const parsed = await parseStationForm(c);
    if ('error' in parsed) return stationsPage(c, parsed.error, 400);
    updateStation(db, station.id, parsed);
    return c.redirect('/nastavenia/stanice', 303);
  });

  r.get('/tlac/kody', (c) => {
    const body = html`
      <div class="toolbar no-print"><button type="button" onclick="window.print()">Tlačiť</button><a href="/zamestnanci">Späť na zamestnancov</a></div>
      <div class="codes-sheet">
        <ol class="howto">
          <li>Pípnite svoju kartu – prihlásite sa na stanici.</li>
          <li>Pípnite činnosť (Vychystanie alebo Balenie) a potom dodací list – začne sa merať čas.</li>
          <li>Na konci pípnite Koniec DL alebo Odhlásiť; na obed Pauza a po návrate Pokračovať.</li>
        </ol>
        <table>
          <tbody>
            ${CONTROL_CODES.map((k) => html`<tr><td class="label">${k.label}<span class="hint">${k.hint}</span></td><td>${raw(barcodeSvg(k.code, CONTROL_MODULE_MM))}</td></tr>`)}
          </tbody>
        </table>
      </div>`;
    return c.html(page({ title: 'Riadiace kódy', active: '/zamestnanci', body, user: c.get('manager'), head: html`<link rel="stylesheet" href="/static/print.css">` }));
  });

  return r;
}
