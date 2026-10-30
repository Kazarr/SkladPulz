import type { Db } from '../../src/db/db.ts';
import { createWorker } from '../../src/store/workers.ts';

export function addWorker(db: Db, name: string, code: string): number {
  return createWorker(db, name, code).id;
}

export interface SeedRecord {
  worker: number;
  start: number;
  activity?: 'VYCH' | 'BAL';
  dl?: string;
  /** Net seconds (default 600). */
  net?: number;
  pause?: number;
  /** Snapshot line count (default 5); null = the note's details were never known. */
  lines?: number | null;
  units?: number;
  kg?: number;
  stav?: 'bezi' | 'ok' | 'neukoncene' | 'opravene' | 'vylucene';
  podozrenie?: 'kratky' | 'dlhy';
  potvrdene?: boolean;
  duplicita?: boolean;
  method?: string;
}

/** Inserts a record straight into `zaznam`; the end is start + net + pause unless the record is still running. */
export function addRecord(db: Db, o: SeedRecord): number {
  const stav = o.stav ?? 'ok';
  const net = o.net ?? 600;
  const pause = o.pause ?? 0;
  const end = stav === 'bezi' ? null : o.start + (net + pause) * 1000;
  const row = db
    .prepare(
      `INSERT INTO zaznam (zamestnanec_id, cinnost, cislo_dl, zaciatok, koniec, pauza_s, cisty_cas_s, pocet_poloziek, pocet_mj, hmotnost_kg,
         sposob_ukoncenia, stav, podozrenie, potvrdene, duplicita)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      o.worker,
      o.activity ?? 'VYCH',
      o.dl ?? 'DL1',
      o.start,
      end,
      pause,
      stav === 'bezi' ? null : net,
      o.lines === undefined ? 5 : o.lines,
      o.units ?? 10,
      o.kg ?? 2.5,
      stav === 'bezi' ? null : (o.method ?? 'koniec'),
      stav,
      o.podozrenie ?? null,
      o.potvrdene ? 1 : 0,
      o.duplicita ? 1 : 0,
    ) as { id: number };
  return row.id;
}
