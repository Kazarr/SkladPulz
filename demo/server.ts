/**
 * Demo: SkladPulz with four weeks of invented history and a fake ONIX running on PGlite
 * (the ONIX tables of test/fixtures/onix-schema.sql with the real view from docs/onix-view.sql).
 *
 *   node --disable-warning=ExperimentalWarning demo/server.ts [port]
 *
 * Sign in as "veduci" with password "demo". Every start builds a fresh database in demo/out/.
 */
import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, rmSync } from 'node:fs';
import { hashPassword } from '../src/auth.ts';
import { buildConfig } from '../src/config.ts';
import { openDb } from '../src/db/db.ts';
import { createOnixSource } from '../src/onix/onix-source.ts';
import { syncActiveNotes } from '../src/onix/sync.ts';
import { closeExpiredRecords } from '../src/station/auto-close.ts';
import { localDate, localParts } from '../src/time.ts';
import { createApp } from '../src/web/app.ts';
import { items, TZ, type DemoNote } from './data.ts';
import { seedDemo } from './seed.ts';

const port = Number(process.argv[2] ?? 3300);
const dbPath = 'demo/out/demo.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

const now = Date.now();
const today = localDate(now, TZ);
const p = localParts(now, TZ);
const config = buildConfig({
  port,
  dbPath,
  managers: [{ name: 'veduci', passwordHash: hashPassword('demo') }],
  sessionSecret: 'demo-session-secret-not-for-production-use',
  baseUrl: `http://localhost:${port}`,
  // The video's live scans last seconds, not minutes; the default 20 s would flag every one as suspect.
  limits: { shortSeconds: 5, longSeconds: 2 * 60 * 60 },
  email: { enabled: false, recipients: ['veduci.skladu@firma.sk'] },
  onix: { connectionString: 'pglite://demo' },
});

const db = openDb(dbPath);
const history = seedDemo(db, today, p.hour * 60 + p.minute);

// --- fake ONIX ----------------------------------------------------------------
const onix = new PGlite();
await onix.exec(readFileSync('test/fixtures/onix-schema.sql', 'utf8'));
const STATES = ['Na vychystanie', 'Vychystáva sa', 'Zabalený'];
await onix.exec(`INSERT INTO document_types (id, name) VALUES (1, 'Dodací list');
  INSERT INTO document_states (id_master, name) VALUES ${STATES.map((s, i) => `(${i + 1}, '${s}')`).join(', ')};`);
const its = items();
await onix.exec(`INSERT INTO stock_items (id, weight) VALUES ${its.map((i) => `(${i.id}, ${i.weightKg})`).join(', ')};`);

function q(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

async function insertNotes(notes: DemoNote[]): Promise<void> {
  let itemId = (await onix.query<{ m: number | null }>('SELECT max(id) AS m FROM document_items')).rows[0]?.m ?? 0;
  for (let i = 0; i < notes.length; i += 300) {
    const chunk = notes.slice(i, i + 300);
    const docs: string[] = [];
    const lines: string[] = [];
    const states: string[] = [];
    for (const n of chunk) {
      const weight = n.lines.reduce((s, l) => s + l.amount * (its[l.item - 1]?.weightKg ?? 0), 0);
      docs.push(`(${n.idMaster}, ${n.idMaster}, ${q(n.number)}, 2050, 1, 0, ${q(n.date)}, ${q(n.customer)}, 1, ${weight.toFixed(4)})`);
      for (const l of n.lines) lines.push(`(${++itemId}, ${n.idMaster}, ${-l.amount}, ${l.item})`);
      for (let s = 0; s < n.serviceLines; s++) lines.push(`(${++itemId}, ${n.idMaster}, 1, NULL)`);
      states.push(`(${n.idMaster}, ${STATES.indexOf(n.state) + 1})`);
    }
    await onix.exec(`INSERT INTO documents (id, id_master, ns_number, document_base_type, history_version, draft, date_document, partner_name, id_document_types, weight_stock_items) VALUES ${docs.join(', ')};
      INSERT INTO document_items (id, id_documents, amount, id_stock_items) VALUES ${lines.join(', ')};
      INSERT INTO document_current_state (doc_id_master, id_document_states) VALUES ${states.join(', ')};`);
  }
}
await insertNotes(history.notes);

const source = createOnixSource(async (sql, params) => (await onix.query<Record<string, unknown>>(sql, params)).rows, {
  ...config.onix,
  activeStates: ['Na vychystanie', 'Vychystáva sa'],
});
const logError = (m: string, e: unknown): void => console.error(m, e instanceof Error ? e.message : e);
const sync = async (): Promise<void> => {
  const r = await syncActiveNotes(db, source, Date.now());
  if (!r.ok) logError('demo ONIX sync failed', r.error);
};
await sync();
setInterval(() => void sync(), 60_000).unref();
setInterval(() => closeExpiredRecords(db, config, Date.now()), 60_000).unref();

const app = createApp({ db, config, source, now: () => Date.now(), logError });
serve({ fetch: app.fetch, port }, () => {
  console.log(`SkladPulz demo: http://localhost:${port} (vedúci: veduci / demo)`);
  console.log(`Nové DL v ONIXe na skenovanie: ${history.openNotes.map((n) => n.number).join(', ')}`);
});
