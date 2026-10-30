import type { Activity } from '../config.ts';
import type { Db } from '../db/db.ts';

export interface Station {
  id: number;
  name: string;
  defaultActivity: Activity | null;
  currentWorkerId: number | null;
}

interface StationRow {
  id: number;
  nazov: string;
  predvolena_cinnost: Activity | null;
  aktualny_zamestnanec_id: number | null;
}

function toStation(r: StationRow): Station {
  return { id: r.id, name: r.nazov, defaultActivity: r.predvolena_cinnost, currentWorkerId: r.aktualny_zamestnanec_id };
}

export function listStations(db: Db): Station[] {
  return (db.prepare('SELECT * FROM stanica ORDER BY id').all() as unknown as StationRow[]).map(toStation);
}

export function getStation(db: Db, id: number): Station | null {
  const r = db.prepare('SELECT * FROM stanica WHERE id = ?').get(id) as StationRow | undefined;
  return r ? toStation(r) : null;
}

export function createStation(db: Db, name: string, defaultActivity: Activity | null): Station {
  const r = db.prepare('INSERT INTO stanica (nazov, predvolena_cinnost) VALUES (?, ?) RETURNING *').get(name.trim(), defaultActivity) as unknown as StationRow;
  return toStation(r);
}

export function updateStation(db: Db, id: number, changes: { name: string; defaultActivity: Activity | null }): void {
  db.prepare('UPDATE stanica SET nazov = ?, predvolena_cinnost = ? WHERE id = ?').run(changes.name.trim(), changes.defaultActivity, id);
}

export interface SignIn {
  workerId: number;
  stationId: number;
  activity: Activity | null;
  since: number;
}

interface SignInRow {
  zamestnanec_id: number;
  stanica_id: number;
  cinnost: Activity | null;
  od: number;
}

function toSignIn(r: SignInRow): SignIn {
  return { workerId: r.zamestnanec_id, stationId: r.stanica_id, activity: r.cinnost, since: r.od };
}

export function getSignIn(db: Db, workerId: number): SignIn | null {
  const r = db.prepare('SELECT * FROM prihlasenie WHERE zamestnanec_id = ?').get(workerId) as SignInRow | undefined;
  return r ? toSignIn(r) : null;
}

export function listSignInsAt(db: Db, stationId: number): SignIn[] {
  return (db.prepare('SELECT * FROM prihlasenie WHERE stanica_id = ? ORDER BY od').all(stationId) as unknown as SignInRow[]).map(toSignIn);
}

/** Signs the worker in at the station; a sign-in elsewhere moves here and that station forgets them as current worker. */
export function signIn(db: Db, workerId: number, stationId: number, activity: Activity | null, at: number): void {
  db.prepare(
    `INSERT INTO prihlasenie (zamestnanec_id, stanica_id, cinnost, od) VALUES (?, ?, ?, ?)
     ON CONFLICT (zamestnanec_id) DO UPDATE SET
       cinnost = excluded.cinnost,
       od = CASE WHEN prihlasenie.stanica_id = excluded.stanica_id THEN prihlasenie.od ELSE excluded.od END,
       stanica_id = excluded.stanica_id`,
  ).run(workerId, stationId, activity, at);
  db.prepare('UPDATE stanica SET aktualny_zamestnanec_id = NULL WHERE aktualny_zamestnanec_id = ? AND id <> ?').run(workerId, stationId);
}

export function setActivity(db: Db, workerId: number, activity: Activity): void {
  db.prepare('UPDATE prihlasenie SET cinnost = ? WHERE zamestnanec_id = ?').run(activity, workerId);
}

export function signOut(db: Db, workerId: number): void {
  db.prepare('DELETE FROM prihlasenie WHERE zamestnanec_id = ?').run(workerId);
  db.prepare('UPDATE stanica SET aktualny_zamestnanec_id = NULL WHERE aktualny_zamestnanec_id = ?').run(workerId);
}

export function setStationWorker(db: Db, stationId: number, workerId: number | null): void {
  db.prepare('UPDATE stanica SET aktualny_zamestnanec_id = ? WHERE id = ?').run(workerId, stationId);
}
