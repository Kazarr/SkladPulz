import type { Db } from '../db/db.ts';
import type { Outcome } from '../domain/station.ts';

export interface ScanLogEntry {
  at: number;
  stationId: number | null;
  raw: string;
  code: string | null;
  outcome: Outcome;
  message: string;
  workerId: number | null;
}

export function logScan(db: Db, e: ScanLogEntry): void {
  db.prepare('INSERT INTO scan_log (cas, stanica_id, surovy_kod, kod, vysledok, sprava, zamestnanec_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    e.at,
    e.stationId,
    e.raw,
    e.code,
    e.outcome,
    e.message,
    e.workerId,
  );
}

export function listScans(db: Db, from: number, to: number, stationId?: number): ScanLogEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM scan_log WHERE cas >= ? AND cas < ? ${stationId === undefined ? '' : 'AND stanica_id = ?'} ORDER BY cas DESC, id DESC LIMIT 1000`,
    )
    .all(...(stationId === undefined ? [from, to] : [from, to, stationId])) as unknown as {
    cas: number;
    stanica_id: number | null;
    surovy_kod: string;
    kod: string | null;
    vysledok: Outcome;
    sprava: string;
    zamestnanec_id: number | null;
  }[];
  return rows.map((r) => ({ at: r.cas, stationId: r.stanica_id, raw: r.surovy_kod, code: r.kod, outcome: r.vysledok, message: r.sprava, workerId: r.zamestnanec_id }));
}
