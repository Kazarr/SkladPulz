import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page } from '../layout.ts';
import { handleScan, stationView, UnknownStationError } from '../../station/scan-service.ts';
import { getStation, listStations } from '../../store/stations.ts';
import { ACTIVITY_LABEL } from '../../domain/station.ts';
import { describeSync } from '../../onix/sync.ts';
import { formatDuration, localTime } from '../../time.ts';

const MAX_SCAN_LENGTH = 100;

function stationId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

export function stationRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => {
    const now = deps.now();
    const tz = deps.config.timezone;
    const stations = listStations(deps.db).map((s) => stationView(deps.db, s.id, now));
    const body = html`
      <p class="muted onix-status">${describeSync(deps.db, deps.source !== null, tz)}</p>
      <p class="lead">Otvorte stanicu na počítači alebo termináli pri skeneri. Stránka stanice beží na celú obrazovku a reaguje len na pípnutia.</p>
      ${stations.length === 0 ? html`<p class="empty">Zatiaľ nie je založená žiadna stanica. Založte ju v <a href="/nastavenia/stanice">nastaveniach</a>.</p>` : ''}
      <div class="cards">
        ${stations.map(
          (v) => html`<section class="card">
            <h2>${v.stationName}</h2>
            <p class="muted">${v.defaultActivity ? `Predvolená činnosť: ${ACTIVITY_LABEL[v.defaultActivity]}` : 'Bez predvolenej činnosti'}</p>
            <ul class="plain">
              ${[v.current, ...v.others]
                .filter((w) => w !== null)
                .map(
                  (w) => html`<li><strong>${w.name}</strong>${w.running
                    ? html` – ${ACTIVITY_LABEL[w.running.activity]} DL ${w.running.dlNumber} od ${localTime(w.running.start, tz)}
                        (${formatDuration((now - w.running.start) / 1000 - w.running.pausedSeconds)}${w.running.pausedSince ? ', pauza' : ''})`
                    : html` – nič nerobí`}</li>`,
                )}
            </ul>
            <a class="button" href="/stanica/${v.stationId}">Otvoriť stanicu</a>
          </section>`,
        )}
      </div>`;
    return c.html(page({ title: 'Stanice', active: '/', body, user: c.get('manager') }));
  });

  r.get('/stanica/:id', (c) => {
    const id = stationId(c.req.param('id'));
    const station = id === null ? null : getStation(deps.db, id);
    if (!station) return c.text('Stanica neexistuje.', 404);
    return c.html(html`<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${station.name} · SkladPulz</title>
<link rel="stylesheet" href="/static/station.css">
</head>
<body data-station="${station.id}">
<div id="screen" class="screen">
  <header class="bar">
    <span class="station-name">${station.name}</span>
    <span id="clock" class="clock"></span>
  </header>
  <section id="status" class="status idle">
    <div id="message" class="message">Pípnite svoju kartu.</div>
  </section>
  <section class="work">
    <div class="who">
      <div id="worker" class="worker">—</div>
      <div id="activity" class="activity"></div>
    </div>
    <div id="note" class="note hidden">
      <div class="dl"><span class="label">DL</span> <span id="dl"></span></div>
      <div id="customer" class="customer"></div>
      <div class="facts"><span id="lines"></span><span id="weight"></span></div>
    </div>
    <div id="timer" class="timer hidden">0:00</div>
  </section>
  <section id="others" class="others"></section>
  <form id="scan-form" class="scan-form" autocomplete="off">
    <label for="scan">Kód</label>
    <input id="scan" name="kod" maxlength="${MAX_SCAN_LENGTH}" autofocus autocomplete="off" spellcheck="false" inputmode="none">
  </form>
</div>
<script type="module" src="/static/js/station.js"></script>
</body>
</html>`);
  });

  r.get('/api/stanica/:id/stav', (c) => {
    const id = stationId(c.req.param('id'));
    if (id === null || !getStation(deps.db, id)) return c.json({ error: 'Stanica neexistuje.' }, 404);
    return c.json(stationView(deps.db, id, deps.now()));
  });

  r.post('/api/stanica/:id/scan', async (c) => {
    const id = stationId(c.req.param('id'));
    if (id === null) return c.json({ error: 'Stanica neexistuje.' }, 404);
    let kod: unknown;
    try {
      kod = ((await c.req.json()) as { kod?: unknown }).kod;
    } catch {
      return c.json({ error: 'Telo požiadavky musí byť JSON {"kod": "..."}.' }, 400);
    }
    if (typeof kod !== 'string' || kod.length > MAX_SCAN_LENGTH) return c.json({ error: `Kód musí byť text do ${MAX_SCAN_LENGTH} znakov.` }, 400);
    try {
      return c.json(await handleScan(deps, id, kod));
    } catch (e) {
      if (e instanceof UnknownStationError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  return r;
}
