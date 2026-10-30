import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { QueryFn } from '../../src/onix/onix-source.ts';

export const SCHEMA_SQL = readFileSync(new URL('../fixtures/onix-schema.sql', import.meta.url), 'utf8');

export interface OnixDb {
  pg: PGlite;
  query: QueryFn;
  seq: number;
}

/** A PGlite database holding the fixture's ONIX tables and the view. */
export async function onixDb(): Promise<OnixDb> {
  const pg = new PGlite();
  await pg.exec(SCHEMA_SQL);
  return { pg, query: (sql, params) => pg.query<Record<string, unknown>>(sql, params).then((r) => r.rows), seq: 0 };
}

export interface DlSeed {
  number: string;
  /** Whole days before today (the database's current_date). Default 0. */
  daysAgo?: number;
  state?: string;
  type?: string;
  partner?: string;
  weight?: number | null;
  baseType?: number;
  version?: number;
  draft?: number;
  /** Shares the master id (and so the cache key) with an older or newer version of the same document. */
  idMaster?: number;
  /** `stock: false` is a line without a stock item (transport, services). Default: one stock line of 1. */
  lines?: { amount: number; stock?: boolean }[];
}

async function idOf(db: OnixDb, table: 'document_states' | 'document_types', column: string, name: string): Promise<number> {
  const found = await db.pg.query<{ id: number }>(`SELECT ${column} AS id FROM ${table} WHERE name = $1`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  const id = ++db.seq;
  await db.pg.query(table === 'document_states' ? 'INSERT INTO document_states (id_master, name) VALUES ($1, $2)' : 'INSERT INTO document_types (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

/** Inserts one delivery note (documents row, its lines, its current state) into the fixture database. Returns its id_master. */
export async function addDl(db: OnixDb, d: DlSeed): Promise<number> {
  const id = ++db.seq;
  const master = d.idMaster ?? id;
  const stateId = await idOf(db, 'document_states', 'id_master', d.state ?? 'Na vychystanie');
  const typeId = await idOf(db, 'document_types', 'id', d.type ?? 'Predajný DL');
  await db.pg.query(
    `INSERT INTO documents (id, id_master, ns_number, document_base_type, history_version, draft, date_document, partner_name, id_document_types, weight_stock_items)
     VALUES ($1, $2, $3, $4, $5, $6, current_date - $7::int, $8, $9, $10)`,
    [id, master, d.number, d.baseType ?? 2050, d.version ?? 1, d.draft ?? 0, d.daysAgo ?? 0, d.partner ?? `Odberateľ ${d.number}`, typeId, d.weight === undefined ? 12.5 : d.weight],
  );
  for (const l of d.lines ?? [{ amount: 1 }]) {
    const itemId = ++db.seq;
    let stock: number | null = null;
    if (l.stock !== false) {
      stock = ++db.seq;
      await db.pg.query('INSERT INTO stock_items (id, weight) VALUES ($1, 1)', [stock]);
    }
    await db.pg.query('INSERT INTO document_items (id, id_documents, amount, id_stock_items) VALUES ($1, $2, $3, $4)', [itemId, id, l.amount, stock]);
  }
  await db.pg.query('INSERT INTO document_current_state (doc_id_master, id_document_states) VALUES ($1, $2) ON CONFLICT (doc_id_master) DO UPDATE SET id_document_states = $2', [master, stateId]);
  return master;
}
