import type { Db } from '../db/db.ts';

export interface Worker {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface WorkerRow {
  id: number;
  kod: string;
  meno: string;
  aktivny: number;
}

function toWorker(r: WorkerRow): Worker {
  return { id: r.id, code: r.kod, name: r.meno, active: r.aktivny === 1 };
}

export function listWorkers(db: Db, opts: { activeOnly?: boolean } = {}): Worker[] {
  const sql = `SELECT * FROM zamestnanec ${opts.activeOnly ? 'WHERE aktivny = 1' : ''} ORDER BY meno COLLATE NOCASE, kod`;
  return (db.prepare(sql).all() as unknown as WorkerRow[]).map(toWorker);
}

export function getWorker(db: Db, id: number): Worker | null {
  const r = db.prepare('SELECT * FROM zamestnanec WHERE id = ?').get(id) as WorkerRow | undefined;
  return r ? toWorker(r) : null;
}

export function findWorkerByCode(db: Db, code: string): Worker | null {
  const r = db.prepare('SELECT * FROM zamestnanec WHERE kod = ?').get(code) as WorkerRow | undefined;
  return r ? toWorker(r) : null;
}

/** Next free card code: "Z" + the highest number in use plus one, four digits at least. */
export function nextWorkerCode(db: Db): string {
  const rows = db.prepare('SELECT kod FROM zamestnanec').all() as unknown as { kod: string }[];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.kod.slice(1)) || 0), 0);
  return `Z${String(max + 1).padStart(4, '0')}`;
}

export function createWorker(db: Db, name: string, code = nextWorkerCode(db)): Worker {
  const r = db.prepare('INSERT INTO zamestnanec (kod, meno) VALUES (?, ?) RETURNING *').get(code, name.trim()) as unknown as WorkerRow;
  return toWorker(r);
}

export function updateWorker(db: Db, id: number, changes: { name?: string; active?: boolean }): void {
  if (changes.name !== undefined) db.prepare('UPDATE zamestnanec SET meno = ? WHERE id = ?').run(changes.name.trim(), id);
  if (changes.active !== undefined) db.prepare('UPDATE zamestnanec SET aktivny = ? WHERE id = ?').run(changes.active ? 1 : 0, id);
}
