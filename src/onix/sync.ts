import { transaction, type Db } from '../db/db.ts';
import { getNote, upsertNote } from '../store/delivery-notes.ts';
import { lastSyncRuns, recordSyncRun } from '../store/onix-sync.ts';
import { backfillSnapshots } from '../store/records.ts';
import { localDateTime } from '../time.ts';
import type { DeliveryNoteSource } from './source.ts';

export type SyncResult = { ok: true; count: number } | { ok: false; error: string };

const EMPTY_LIST = 'ONIX vrátil prázdny zoznam DL; údaje sa nezmenili.';

/**
 * Reads the active delivery notes from ONIX into the cache (#3). Never throws for an ONIX problem: the run is recorded
 * (home page, `lastSyncRuns`) and returned, and the caller logs a failure. Stations keep working from the cache.
 *
 * - Notes missing from the list become inactive but stay cached; records keep their snapshot.
 * - An empty list changes nothing (safety fuse: a wrong filter or an ONIX hiccup must not deactivate every note).
 * - Records that ended before their note was known get their snapshot as soon as the note arrives.
 * - Cache changes are one transaction: all or nothing.
 */
export async function syncActiveNotes(db: Db, source: DeliveryNoteSource, now: number): Promise<SyncResult> {
  const fail = (e: unknown): SyncResult => {
    const error = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    recordSyncRun(db, { at: now, ok: false, count: null, error });
    return { ok: false, error };
  };
  try {
    const notes = await source.fetchActive();
    if (notes.length === 0) return fail(EMPTY_LIST);
    const numbers = new Set(notes.map((n) => n.number));
    transaction(db, () => {
      db.exec('UPDATE dodaci_list SET aktivny = 0 WHERE aktivny = 1');
      for (const n of notes) {
        const known = getNote(db, n.number)?.lines != null;
        upsertNote(db, n, now, true);
        if (!known && n.lines !== null) backfillSnapshots(db, n.number);
      }
    });
    recordSyncRun(db, { at: now, ok: true, count: numbers.size, error: null });
    return { ok: true, count: numbers.size };
  } catch (e) {
    return fail(e);
  }
}

/** The status line of the home page (Slovak): when ONIX was last read, or that it failed. */
export function describeSync(db: Db, connected: boolean, timezone: string): string {
  if (!connected) return 'ONIX nie je pripojený. Doklady sa nenačítavajú.';
  const { last, lastOk } = lastSyncRuns(db);
  if (!last) return 'ONIX: zatiaľ nesynchronizované.';
  if (last.ok) return `ONIX: posledná synchronizácia ${localDateTime(last.at, timezone)} (${last.count} DL).`;
  const since = lastOk ? `posledná úspešná ${localDateTime(lastOk.at, timezone)}` : 'zatiaľ bez úspešnej synchronizácie';
  return `ONIX: synchronizácia zlyhala ${localDateTime(last.at, timezone)}, ${since}. Stanice pracujú s uloženými údajmi. Detail: ${last.error ?? ''}`;
}
