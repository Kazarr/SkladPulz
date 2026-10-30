import type { Db } from '../db/db.ts';

/** One run of the ONIX synchronisation. `count` is the number of active notes read; null when the run failed. */
export interface SyncRun {
  at: number;
  ok: boolean;
  count: number | null;
  error: string | null;
}

export function recordSyncRun(db: Db, run: SyncRun): void {
  db.prepare('INSERT INTO onix_synchronizacia (cas, uspesna, pocet, chyba) VALUES (?, ?, ?, ?)').run(run.at, run.ok ? 1 : 0, run.count, run.error);
}

interface RunRow {
  cas: number;
  uspesna: number;
  pocet: number | null;
  chyba: string | null;
}

function toRun(r: RunRow | undefined): SyncRun | null {
  return r ? { at: r.cas, ok: r.uspesna === 1, count: r.pocet, error: r.chyba } : null;
}

/** The newest run and the newest successful run (the same row when the newest succeeded). */
export function lastSyncRuns(db: Db): { last: SyncRun | null; lastOk: SyncRun | null } {
  const last = db.prepare('SELECT * FROM onix_synchronizacia ORDER BY id DESC LIMIT 1').get() as RunRow | undefined;
  const lastOk = db.prepare('SELECT * FROM onix_synchronizacia WHERE uspesna = 1 ORDER BY id DESC LIMIT 1').get() as RunRow | undefined;
  return { last: toRun(last), lastOk: toRun(lastOk) };
}
