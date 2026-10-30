import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { openDb } from './db/db.ts';
import { createApp } from './web/app.ts';
import { closeExpiredRecords } from './station/auto-close.ts';
import { createOnixSource, pgQuery } from './onix/onix-source.ts';
import { syncActiveNotes } from './onix/sync.ts';
import { sendDueSummaries } from './email/scheduler.ts';
import { createSmtpTransport } from './email/transport.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
const now = (): number => Date.now();

function logError(message: string, error: unknown): void {
  console.error(`[${new Date().toISOString()}] ${message}:`, error instanceof Error ? error.message : error);
}

const source = config.onix.connectionString
  ? createOnixSource(pgQuery(config.onix.connectionString, config.onix.timeoutMs), config.onix, { onBadRow: (problem) => logError('ONIX data problem', problem) })
  : null;
if (!source) console.log('ONIX nie je pripojený (onix.connectionString je prázdny): doklady sa nenačítavajú.');

const app = createApp({ db, config, source, now, logError });

/** Runs `job` every `ms`, logging failures instead of stopping. */
function every(ms: number, name: string, job: () => unknown): void {
  const run = async (): Promise<void> => {
    try {
      await job();
    } catch (e) {
      logError(`${name} failed`, e);
    }
  };
  void run();
  setInterval(() => void run(), ms).unref();
}

every(60_000, 'auto-close of unfinished records', () => {
  const closed = closeExpiredRecords(db, config, now());
  if (closed.length > 0) console.log(`Auto-closed ${closed.length} unfinished record(s).`);
});

if (source) {
  every(config.onix.syncIntervalMin * 60_000, 'ONIX synchronization', async () => {
    const result = await syncActiveNotes(db, source, now());
    if (!result.ok) logError('ONIX synchronization failed; stations keep working from the cache', result.error);
  });
}

if (config.email.enabled) {
  const mail = createSmtpTransport(config.email.smtp);
  let sending = false; // a slow SMTP server must not overlap the next run
  every(5 * 60_000, 'daily summary e-mail', async () => {
    if (sending) return;
    sending = true;
    try {
      for (const r of await sendDueSummaries(db, config, now(), mail)) {
        if (!r.ok) logError(`daily summary e-mail for ${r.date} failed`, r.error);
      }
    } finally {
      sending = false;
    }
  });
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`SkladPulz beží na http://localhost:${info.port}`);
});
