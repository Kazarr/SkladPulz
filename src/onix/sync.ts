import { transaction, type Db } from '../db/db.ts';
import { upsertNote, type DeliveryNote } from '../store/delivery-notes.ts';
import { lastSyncRuns, recordSyncRun } from '../store/onix-sync.ts';
import { notesWithoutSnapshot } from '../store/records.ts';
import { localDateTime } from '../time.ts';
import type { DeliveryNoteSource } from './source.ts';

export type SyncResult = { ok: true; count: number } | { ok: false; error: string };

/** Notes of snapshot-less records looked up by number per run. */
export const MAX_LOOKUPS_PER_RUN = 50;

const EMPTY_LIST = 'ONIX vrátil prázdny zoznam DL; údaje sa nezmenili.';

/**
 * Reads the active delivery notes from ONIX into the cache (#3). Never throws for an ONIX problem: the run is recorded
 * (home page, `lastSyncRuns`) and returned, and the caller logs a failure. Stations keep working from the cache.
 *
 * - Notes missing from the list become inactive but stay cached; records keep their snapshot.
 * - An empty list changes nothing (safety fuse: a wrong filter or an ONIX hiccup must not deactivate every note).
 * - Records that ended before their note was known get their snapshot as soon as the note arrives (`upsertNote`). Notes that are not
 *   in the active list are fetched by number, at most `MAX_LOOKUPS_PER_RUN` per run, newest records first, and cached as inactive.
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
      for (const n of notes) upsertNote(db, n, now, true);
    });
    const missing: DeliveryNote[] = [];
    for (const number of notesWithoutSnapshot(db, MAX_LOOKUPS_PER_RUN).filter((n) => !numbers.has(n))) {
      try {
        const n = await source.fetchByNumber(number);
        if (n) missing.push(n);
      } catch {
        // ponytail: a number that cannot be fetched (unknown, malformed row) is tried again next run; it can crowd out older ones only while 50 such numbers exist.
      }
    }
    transaction(db, () => {
      for (const n of missing) upsertNote(db, n, now, false);
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
