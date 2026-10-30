import type { Db } from '../db/db.ts';

/** A delivery note as SkladPulz caches it from ONIX. */
export interface DeliveryNote {
  number: string;
  onixIdMaster: number | null;
  date: string | null;
  customer: string | null;
  state: string | null;
  type: string | null;
  lines: number | null;
  units: number | null;
  weightKg: number | null;
}

interface NoteRow {
  cislo: string;
  onix_id_master: number | null;
  datum: string | null;
  odberatel: string | null;
  stav: string | null;
  druh: string | null;
  pocet_poloziek: number | null;
  pocet_mj: number | null;
  hmotnost_kg: number | null;
  aktivny: number;
  synchronizovane: number;
}

function toNote(r: NoteRow): DeliveryNote {
  return {
    number: r.cislo,
    onixIdMaster: r.onix_id_master,
    date: r.datum,
    customer: r.odberatel,
    state: r.stav,
    type: r.druh,
    lines: r.pocet_poloziek,
    units: r.pocet_mj,
    weightKg: r.hmotnost_kg,
  };
}

export function getNote(db: Db, number: string): DeliveryNote | null {
  const r = db.prepare('SELECT * FROM dodaci_list WHERE cislo = ?').get(number) as NoteRow | undefined;
  return r ? toNote(r) : null;
}

/** Inserts or refreshes one note in the cache. */
export function upsertNote(db: Db, n: DeliveryNote, syncedAt: number, active = true): void {
  db.prepare(
    `INSERT INTO dodaci_list (cislo, onix_id_master, datum, odberatel, stav, druh, pocet_poloziek, pocet_mj, hmotnost_kg, aktivny, synchronizovane)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cislo) DO UPDATE SET
       onix_id_master = excluded.onix_id_master, datum = excluded.datum, odberatel = excluded.odberatel,
       stav = excluded.stav, druh = excluded.druh, pocet_poloziek = excluded.pocet_poloziek,
       pocet_mj = excluded.pocet_mj, hmotnost_kg = excluded.hmotnost_kg, aktivny = excluded.aktivny,
       synchronizovane = excluded.synchronizovane`,
  ).run(n.number, n.onixIdMaster, n.date, n.customer, n.state, n.type, n.lines, n.units, n.weightKg, active ? 1 : 0, syncedAt);
}

export function countActiveNotes(db: Db): number {
  return (db.prepare('SELECT count(*) AS n FROM dodaci_list WHERE aktivny = 1').get() as { n: number }).n;
}
