/** Batch-tier e2e server: a fresh database with one station, two workers and two cached notes. */
import { serve } from '@hono/node-server';
import { rmSync } from 'node:fs';
import { buildConfig } from '../src/config.ts';
import { openDb } from '../src/db/db.ts';
import { createStation } from '../src/store/stations.ts';
import { createWorker } from '../src/store/workers.ts';
import { upsertNote } from '../src/store/delivery-notes.ts';
import { createApp } from '../src/web/app.ts';

const dbPath = 'data/e2e.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const config = buildConfig({ port: 3199, dbPath });
const db = openDb(dbPath);
createStation(db, 'Baliaci stôl E2E', 'BAL');
createWorker(db, 'Ján Testovací', 'Z0001');
createWorker(db, 'Eva Testovacia', 'Z0002');
for (const n of ['DL-E2E-1', 'DL-E2E-2']) {
  upsertNote(db, { number: n, onixIdMaster: null, date: null, customer: `Odberateľ ${n}`, state: null, type: null, lines: 3, units: 5, weightKg: 4.2 }, Date.now());
}
const app = createApp({ db, config, source: null, now: () => Date.now(), logError: (m, e) => console.error(m, e) });
serve({ fetch: app.fetch, port: config.port }, () => console.log('e2e server ready'));
