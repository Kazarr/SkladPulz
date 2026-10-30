import type { Config } from '../config.ts';
import { transaction, type Db } from '../db/db.ts';
import { autoCloseAt } from '../domain/shifts.ts';
import { endRecord, listRunningRecords } from '../store/records.ts';
import { signOut } from '../store/stations.ts';

/**
 * Closes every record still running `autoCloseGraceMin` after the end of its shift as `neukoncene` (#4), ending it at the shift end,
 * and signs out workers whose sign-in began in a shift that is over. Returns the ids of the closed records.
 */
export function closeExpiredRecords(db: Db, config: Config, now: number): number[] {
  return transaction(db, () => {
    const closed: number[] = [];
    for (const r of listRunningRecords(db)) {
      const end = autoCloseAt(r.start, config.shifts, config.timezone);
      if (now < end + config.autoCloseGraceMin * 60_000) continue;
      endRecord(db, r.id, { at: end, method: 'koniec_zmeny', status: 'neukoncene', limits: config.limits });
      closed.push(r.id);
    }
    // A worker still working across the shift boundary stays signed in until their record ends.
    const signIns = db
      .prepare('SELECT p.zamestnanec_id, p.od FROM prihlasenie p WHERE NOT EXISTS (SELECT 1 FROM zaznam r WHERE r.zamestnanec_id = p.zamestnanec_id AND r.koniec IS NULL)')
      .all() as unknown as { zamestnanec_id: number; od: number }[];
    for (const s of signIns) {
      if (now >= autoCloseAt(s.od, config.shifts, config.timezone) + config.autoCloseGraceMin * 60_000) signOut(db, s.zamestnanec_id);
    }
    return closed;
  });
}
