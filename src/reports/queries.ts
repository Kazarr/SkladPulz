import type { Activity } from '../config.ts';
import type { Db } from '../db/db.ts';
import { toRecord, type RecordRow, type WorkRecord } from '../store/records.ts';
import { localDayRange } from '../time.ts';

export interface ReportRecord extends WorkRecord {
  workerName: string;
}

type Row = RecordRow & { meno: string };

function toReportRecord(r: Row): ReportRecord {
  return { ...toRecord(r), workerName: r.meno };
}

function rangeQuery(db: Db, source: 'zaznam' | 'zaznam_hodnotene', tz: string, fromDate: string, toDate: string, f: { workerId: number | null; activity: Activity | null }): ReportRecord[] {
  const { from, to } = localDayRange(fromDate, toDate, tz);
  const rows = db
    .prepare(
      `SELECT r.*, z.meno FROM ${source} r JOIN zamestnanec z ON z.id = r.zamestnanec_id
       WHERE r.zaciatok >= ? AND r.zaciatok < ?
         AND (? IS NULL OR r.zamestnanec_id = ?) AND (? IS NULL OR r.cinnost = ?)
       ORDER BY r.zaciatok, r.id`,
    )
    .all(from, to, f.workerId, f.workerId, f.activity, f.activity) as unknown as Row[];
  return rows.map(toReportRecord);
}

/** Records of any status that started on the local day `date`. */
export function listDayRecords(db: Db, tz: string, date: string, f: { workerId: number | null; activity: Activity | null }): ReportRecord[] {
  return rangeQuery(db, 'zaznam', tz, date, date, f);
}

/** Counted records (glossary) that started on the local day `date`. */
export function listCountedDayRecords(db: Db, tz: string, date: string, f: { workerId: number | null; activity: Activity | null }): ReportRecord[] {
  return rangeQuery(db, 'zaznam_hodnotene', tz, date, date, f);
}

/** Records of any status or only counted ones (glossary) that started on the local days `fromDate`..`toDate` inclusive. */
export function listRangeRecords(db: Db, source: 'zaznam' | 'zaznam_hodnotene', tz: string, fromDate: string, toDate: string, f: { workerId: number | null; activity: Activity | null }): ReportRecord[] {
  return rangeQuery(db, source, tz, fromDate, toDate, f);
}

/** Every record of one delivery note, any status, oldest first. */
export function listNoteRecords(db: Db, dlNumber: string): ReportRecord[] {
  const rows = db
    .prepare(
      `SELECT r.*, z.meno FROM zaznam r JOIN zamestnanec z ON z.id = r.zamestnanec_id
       WHERE r.cislo_dl = ? ORDER BY r.zaciatok, r.id`,
    )
    .all(dlNumber) as unknown as Row[];
  return rows.map(toReportRecord);
}
