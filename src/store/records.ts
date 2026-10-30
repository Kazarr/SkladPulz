import type { Activity } from '../config.ts';
import type { Db } from '../db/db.ts';
import { netSeconds, pausedSeconds, suspicionOf, type PauseSpan, type Suspicion } from '../domain/record.ts';

export type RecordStatus = 'bezi' | 'ok' | 'neukoncene' | 'opravene' | 'vylucene';
export type EndMethod = 'dalsi_dl' | 'koniec' | 'odhlas' | 'zmena_cinnosti' | 'koniec_zmeny' | 'oprava';

export interface WorkRecord {
  id: number;
  workerId: number;
  activity: Activity;
  dlNumber: string;
  stationId: number | null;
  start: number;
  end: number | null;
  pauseSeconds: number;
  netSeconds: number | null;
  lines: number | null;
  units: number | null;
  weightKg: number | null;
  endMethod: EndMethod | null;
  status: RecordStatus;
  suspicion: Suspicion | null;
  confirmed: boolean;
  duplicate: boolean;
  correctedBy: string | null;
  note: string | null;
}

export interface RecordRow {
  id: number;
  zamestnanec_id: number;
  cinnost: Activity;
  cislo_dl: string;
  stanica_id: number | null;
  zaciatok: number;
  koniec: number | null;
  pauza_s: number;
  cisty_cas_s: number | null;
  pocet_poloziek: number | null;
  pocet_mj: number | null;
  hmotnost_kg: number | null;
  sposob_ukoncenia: EndMethod | null;
  stav: RecordStatus;
  podozrenie: Suspicion | null;
  potvrdene: number;
  duplicita: number;
  opravil: string | null;
  poznamka: string | null;
}

export function toRecord(r: RecordRow): WorkRecord {
  return {
    id: r.id,
    workerId: r.zamestnanec_id,
    activity: r.cinnost,
    dlNumber: r.cislo_dl,
    stationId: r.stanica_id,
    start: r.zaciatok,
    end: r.koniec,
    pauseSeconds: r.pauza_s,
    netSeconds: r.cisty_cas_s,
    lines: r.pocet_poloziek,
    units: r.pocet_mj,
    weightKg: r.hmotnost_kg,
    endMethod: r.sposob_ukoncenia,
    status: r.stav,
    suspicion: r.podozrenie,
    confirmed: r.potvrdene === 1,
    duplicate: r.duplicita === 1,
    correctedBy: r.opravil,
    note: r.poznamka,
  };
}

export function getRecord(db: Db, id: number): WorkRecord | null {
  const r = db.prepare('SELECT * FROM zaznam WHERE id = ?').get(id) as RecordRow | undefined;
  return r ? toRecord(r) : null;
}

export function getRunningRecord(db: Db, workerId: number): (WorkRecord & { paused: boolean }) | null {
  const r = db.prepare('SELECT * FROM zaznam WHERE zamestnanec_id = ? AND koniec IS NULL').get(workerId) as RecordRow | undefined;
  if (!r) return null;
  const open = db.prepare('SELECT 1 FROM pauza WHERE zaznam_id = ? AND "do" IS NULL').get(r.id);
  return { ...toRecord(r), paused: open !== undefined };
}

export function listRunningRecords(db: Db): WorkRecord[] {
  return (db.prepare('SELECT * FROM zaznam WHERE koniec IS NULL ORDER BY zaciatok').all() as unknown as RecordRow[]).map(toRecord);
}

/**
 * Who already has a non-excluded record of this activity on this note: the names of other workers, and whether `workerId` themself
 * has an ended one. The worker's running record is left out: re-scanning it is answered by "already running".
 */
export function priorWorkOnNote(db: Db, dlNumber: string, activity: Activity, workerId: number): { others: string[]; own: boolean } {
  const rows = db
    .prepare(
      `SELECT DISTINCT z.meno, r.zamestnanec_id = ? AS own FROM zaznam r JOIN zamestnanec z ON z.id = r.zamestnanec_id
       WHERE r.cislo_dl = ? AND r.cinnost = ? AND r.stav NOT IN ('vylucene') AND (r.zamestnanec_id <> ? OR r.koniec IS NOT NULL) ORDER BY z.meno`,
    )
    .all(workerId, dlNumber, activity, workerId) as unknown as { meno: string; own: number }[];
  return { others: rows.filter((r) => r.own === 0).map((r) => r.meno), own: rows.some((r) => r.own === 1) };
}

export function startRecord(
  db: Db,
  r: { workerId: number; stationId: number | null; activity: Activity; dlNumber: string; at: number; duplicate: boolean },
): number {
  const row = db
    .prepare('INSERT INTO zaznam (zamestnanec_id, stanica_id, cinnost, cislo_dl, zaciatok, duplicita) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .get(r.workerId, r.stationId, r.activity, r.dlNumber, r.at, r.duplicate ? 1 : 0) as { id: number };
  // The earlier records of other workers on this note and activity are duplicates of the new one just as much: the manager decides which stays.
  if (r.duplicate) {
    db.prepare("UPDATE zaznam SET duplicita = 1 WHERE cislo_dl = ? AND cinnost = ? AND zamestnanec_id <> ? AND stav <> 'vylucene'").run(r.dlNumber, r.activity, r.workerId);
  }
  return row.id;
}

export function startPause(db: Db, recordId: number, at: number): void {
  db.prepare('INSERT INTO pauza (zaznam_id, od) VALUES (?, ?)').run(recordId, at);
}

/** Closes the open pause of the record at `at` (never before the pause began). */
export function endPause(db: Db, recordId: number, at: number): void {
  db.prepare('UPDATE pauza SET "do" = max(od, ?) WHERE zaznam_id = ? AND "do" IS NULL').run(at, recordId);
}

export function listPauses(db: Db, recordId: number): PauseSpan[] {
  const rows = db.prepare('SELECT od, "do" FROM pauza WHERE zaznam_id = ? ORDER BY od').all(recordId) as unknown as { od: number; do: number | null }[];
  return rows.map((p) => ({ from: p.od, to: p.do }));
}

export interface EndOptions {
  at: number;
  method: EndMethod;
  status: 'ok' | 'neukoncene';
  limits: { shortSeconds: number; longSeconds: number };
}

/**
 * Ends a running record: closes its open pause, computes net time and suspicion,
 * and copies the note's line count, units and weight from the cache as the snapshot.
 */
export function endRecord(db: Db, recordId: number, o: EndOptions): void {
  const rec = getRecord(db, recordId);
  if (!rec || rec.end !== null) return;
  const at = Math.max(o.at, rec.start);
  endPause(db, recordId, at);
  const paused = pausedSeconds(listPauses(db, recordId), rec.start, at);
  const net = netSeconds(rec.start, at, paused);
  const suspicion = o.status === 'ok' ? suspicionOf(net, o.limits) : null;
  db.prepare(
    `UPDATE zaznam SET koniec = ?, pauza_s = ?, cisty_cas_s = ?, sposob_ukoncenia = ?, stav = ?, podozrenie = ?,
       pocet_poloziek = d.pocet_poloziek, pocet_mj = d.pocet_mj, hmotnost_kg = d.hmotnost_kg
     FROM (SELECT ? AS cislo) k LEFT JOIN dodaci_list d ON d.cislo = k.cislo
     WHERE zaznam.id = ?`,
  ).run(at, paused, net, o.method, o.status, suspicion, rec.dlNumber, recordId);
}

/** Fills the snapshot of ended records of a note that ended before its details were known (ONIX was down). */
export function backfillSnapshots(db: Db, dlNumber: string): number {
  const res = db
    .prepare(
      `UPDATE zaznam SET pocet_poloziek = d.pocet_poloziek, pocet_mj = d.pocet_mj, hmotnost_kg = d.hmotnost_kg
       FROM dodaci_list d WHERE d.cislo = zaznam.cislo_dl AND zaznam.cislo_dl = ?
         AND zaznam.koniec IS NOT NULL AND zaznam.pocet_poloziek IS NULL AND d.pocet_poloziek IS NOT NULL`,
    )
    .run(dlNumber);
  return Number(res.changes);
}
