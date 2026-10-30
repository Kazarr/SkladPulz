import pg from 'pg';
import type { OnixConfig } from '../config.ts';
import type { DeliveryNote } from '../store/delivery-notes.ts';
import type { DeliveryNoteSource } from './source.ts';

/** The only database seam: runs one read-only SQL statement with positional parameters and returns its rows. */
export type QueryFn = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export interface OnixSourceOptions {
  /** Called for every row that failed validation; the row is dropped. */
  onBadRow?: (problem: string) => void;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class BadRow extends Error {}

/** A number from a JS number, a bigint or the decimal string pg uses for bigint and numeric; anything else is refused. */
function toNumber(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'bigint') n = Number(v);
  else if (typeof v === 'string' && DECIMAL.test(v)) n = Number(v);
  else throw new BadRow(`${field} is not a number: ${JSON.stringify(v)}`);
  if (!Number.isFinite(n)) throw new BadRow(`${field} is not finite: ${String(v)}`);
  return n;
}

function toNonNegative(v: unknown, field: string, integer: boolean): number | null {
  const n = toNumber(v, field);
  if (n === null) return null;
  if (n < 0 || (integer && !Number.isInteger(n))) throw new BadRow(`${field} must be a non-negative ${integer ? 'integer' : 'number'}: ${String(v)}`);
  return n;
}

function toText(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new BadRow(`${field} is not text: ${JSON.stringify(v)}`);
  return v;
}

function toNote(r: Record<string, unknown>): DeliveryNote {
  const number = toText(r['ns_number'], 'ns_number');
  if (!number || number.trim() === '') throw new BadRow('ns_number is empty');
  const date = toText(r['date_document'], 'date_document');
  if (date !== null && !ISO_DATE.test(date)) throw new BadRow(`date_document is not YYYY-MM-DD: ${date}`);
  const idMaster = toNumber(r['id_master'], 'id_master');
  if (idMaster !== null && !Number.isInteger(idMaster)) throw new BadRow(`id_master is not an integer: ${String(r['id_master'])}`);
  return {
    number,
    onixIdMaster: idMaster,
    date,
    customer: toText(r['partner_name'], 'partner_name'),
    state: toText(r['stav'], 'stav'),
    type: toText(r['druh'], 'druh'),
    lines: toNonNegative(r['pocet_poloziek'], 'pocet_poloziek', true),
    units: toNonNegative(r['pocet_mj'], 'pocet_mj', false),
    weightKg: toNonNegative(r['hmotnost_kg'], 'hmotnost_kg', false),
  };
}

/**
 * Reads delivery notes from the ONIX view (docs/onix-view.sql) through `query`. Read-only.
 * Rows are validated by type; a malformed row is dropped and reported, never returned.
 */
export function createOnixSource(query: QueryFn, config: OnixConfig, opts: OnixSourceOptions = {}): DeliveryNoteSource {
  if (!IDENTIFIER.test(config.view)) throw new Error(`onix.view must be a view name, got: ${config.view}`);
  // to_char: the date arrives as text whatever the driver's date parsing or time zone does.
  const select = `SELECT id_master, ns_number, to_char(date_document, 'YYYY-MM-DD') AS date_document, partner_name, stav, druh, hmotnost_kg, pocet_poloziek, pocet_mj FROM ${config.view}`;

  function parse(rows: Record<string, unknown>[]): DeliveryNote[] {
    const notes: DeliveryNote[] = [];
    for (const r of rows) {
      try {
        notes.push(toNote(r));
      } catch (e) {
        if (!(e instanceof BadRow)) throw e;
        opts.onBadRow?.(`ONIX row ${JSON.stringify(r['ns_number'])} skipped: ${e.message}`);
      }
    }
    return notes;
  }

  return {
    async fetchActive() {
      const rows = await query(
        `${select}
         WHERE (cardinality($1::text[]) = 0 OR stav = ANY($1::text[]))
           AND (cardinality($2::text[]) = 0 OR druh = ANY($2::text[]))
           AND date_document >= current_date - $3::int
         ORDER BY ns_number`,
        [config.activeStates, config.documentTypes, config.daysBack],
      );
      return parse(rows);
    },
    async fetchByNumber(number) {
      const rows = await query(`${select} WHERE ns_number = $1 ORDER BY id_master DESC LIMIT 1`, [number]);
      return parse(rows)[0] ?? null;
    },
  };
}

/** A read-only PostgreSQL connection to ONIX for production; `close` ends the pool (CLI tools). */
export function pgQuery(connectionString: string, timeoutMs: number): QueryFn & { close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    // Defence in depth: even a user with write rights cannot change ONIX through this connection.
    options: '-c default_transaction_read_only=on',
  });
  // An idle client dropped by the server must not crash the process; the next query reports the failure.
  pool.on('error', () => {});
  const query: QueryFn = async (sql, params) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  return Object.assign(query, { close: () => pool.end() });
}
