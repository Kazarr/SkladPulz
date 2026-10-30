import type { Db } from '../../src/db/db.ts';
import type { Activity } from '../../src/config.ts';
import type { RecordStatus } from '../../src/store/records.ts';
import { startPause, endPause } from '../../src/store/records.ts';

export interface Seed {
  worker: number;
  dl: string;
  start: number;
  /** null: a running record. */
  end?: number | null;
  activity?: Activity;
  status?: RecordStatus;
  suspicion?: 'kratky' | 'dlhy' | null;
  confirmed?: boolean;
  duplicate?: boolean;
  endMethod?: string | null;
  pauses?: [number, number][];
  /** Snapshot line count (default 5); null = the note's details were never known. */
  lines?: number | null;
}

/** Inserts a record the way the station would have left it, with pauses and the paused/net seconds filled in. */
export function seed(db: Db, o: Seed): number {
  const end = o.end === undefined ? o.start + 600_000 : o.end;
  const status = o.status ?? (end === null ? 'bezi' : 'ok');
  const paused = Math.round((o.pauses ?? []).reduce((s, [a, b]) => s + (b - a), 0) / 1000);
  const net = end === null ? null : Math.round((end - o.start) / 1000) - paused;
  const method = o.endMethod === undefined ? (end === null ? null : 'koniec') : o.endMethod;
  const row = db
    .prepare(
      `INSERT INTO zaznam (zamestnanec_id, cinnost, cislo_dl, zaciatok, koniec, pauza_s, cisty_cas_s, sposob_ukoncenia, stav, podozrenie, potvrdene, duplicita, pocet_poloziek)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(o.worker, o.activity ?? 'VYCH', o.dl, o.start, end, paused, net, method, status, o.suspicion ?? null, o.confirmed ? 1 : 0, o.duplicate ? 1 : 0, o.lines === undefined ? 5 : o.lines) as { id: number };
  for (const [a, b] of o.pauses ?? []) {
    startPause(db, row.id, a);
    endPause(db, row.id, b);
  }
  return row.id;
}

export function counted(db: Db): number[] {
  return (db.prepare('SELECT id FROM zaznam_hodnotene ORDER BY id').all() as unknown as { id: number }[]).map((r) => r.id);
}

export function logCount(db: Db): number {
  return (db.prepare('SELECT count(*) AS n FROM oprava_zaznamu').get() as { n: number }).n;
}
