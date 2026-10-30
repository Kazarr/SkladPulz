import { ACTIVITIES, type Activity } from '../config.ts';
import { transaction, type Db } from '../db/db.ts';
import { netSeconds, pausedSeconds } from '../domain/record.ts';
import { getWorker } from './workers.ts';
import { listPauses, toRecord, type RecordRow, type WorkRecord } from './records.ts';

/** Why a record is on the review list. */
export type ReviewReason = 'neukoncene' | 'kratky' | 'dlhy' | 'duplicita';

export interface ReviewItem {
  record: WorkRecord;
  workerName: string;
  reasons: ReviewReason[];
}

/**
 * Records a manager has to look at, among those that started in [from, to): unfinished ones, suspect ones not yet confirmed,
 * and duplicates not yet confirmed. Counted, confirmed, excluded and running records are left out.
 */
export function listReviewItems(db: Db, range: { from: number; to: number }): ReviewItem[] {
  const rows = db
    .prepare(
      `SELECT r.*, z.meno AS meno FROM zaznam r JOIN zamestnanec z ON z.id = r.zamestnanec_id
       WHERE r.zaciatok >= ? AND r.zaciatok < ?
         AND (r.stav = 'neukoncene' OR (r.stav IN ('ok', 'opravene') AND r.potvrdene = 0 AND (r.podozrenie IS NOT NULL OR r.duplicita = 1)))
       ORDER BY r.zaciatok, r.id`,
    )
    .all(range.from, range.to) as unknown as (RecordRow & { meno: string })[];
  return rows.map((r) => {
    const reasons: ReviewReason[] = [];
    if (r.stav === 'neukoncene') reasons.push('neukoncene');
    if (r.podozrenie !== null && r.potvrdene === 0) reasons.push(r.podozrenie);
    if (r.duplicita === 1 && r.potvrdene === 0) reasons.push('duplicita');
    return { record: toRecord(r), workerName: r.meno, reasons };
  });
}

export interface CorrectionLogEntry {
  id: number;
  at: number;
  manager: string;
  /** A record column (`zaciatok`, `koniec`, `zamestnanec`, `cinnost`, `pauza_s`, `cisty_cas_s`, `sposob_ukoncenia`, `stav`, `potvrdene`) or `akcia`. */
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
}

export function listCorrectionLog(db: Db, recordId: number): CorrectionLogEntry[] {
  const rows = db.prepare('SELECT * FROM oprava_zaznamu WHERE zaznam_id = ? ORDER BY id').all(recordId) as unknown as {
    id: number; cas: number; veduci: string; pole: string; stara_hodnota: string | null; nova_hodnota: string | null; dovod: string;
  }[];
  return rows.map((l) => ({ id: l.id, at: l.cas, manager: l.veduci, field: l.pole, oldValue: l.stara_hodnota, newValue: l.nova_hodnota, reason: l.dovod }));
}

export type Result = { ok: true } | { ok: false; error: string };

export interface Actor {
  /** Name of the signed-in manager, written to the log and to `opravil`. */
  manager: string;
  now: number;
}

export interface CorrectionInput {
  start: number;
  end: number;
  workerId: number;
  activity: Activity;
  reason: string;
}

const MAX_REASON = 500;
const fail = (error: string): Result => ({ ok: false, error });

/** Record columns a manager's action may change, with the name they carry in the log. */
const TRACKED = {
  zaciatok: 'zaciatok',
  koniec: 'koniec',
  zamestnanec_id: 'zamestnanec',
  cinnost: 'cinnost',
  pauza_s: 'pauza_s',
  cisty_cas_s: 'cisty_cas_s',
  sposob_ukoncenia: 'sposob_ukoncenia',
  stav: 'stav',
  potvrdene: 'potvrdene',
} as const;
type Tracked = keyof typeof TRACKED;
type Changes = { [K in Tracked]?: RecordRow[K] };

function load(db: Db, id: number): RecordRow | null {
  return (db.prepare('SELECT * FROM zaznam WHERE id = ?').get(id) as RecordRow | undefined) ?? null;
}

function shown(db: Db, col: Tracked, v: string | number | null): string | null {
  if (v === null) return null;
  if (col !== 'zamestnanec_id') return String(v);
  const w = getWorker(db, Number(v));
  return w ? `${w.code} ${w.name}` : String(v);
}

/** Writes the changed columns, the manager and the reason on the record, and one log row per changed field plus one for the action. */
function apply(db: Db, row: RecordRow, changes: Changes, action: string, reason: string, by: Actor): void {
  const insert = db.prepare('INSERT INTO oprava_zaznamu (zaznam_id, cas, veduci, pole, stara_hodnota, nova_hodnota, dovod) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const col of Object.keys(changes) as Tracked[]) {
    const next = changes[col] ?? null;
    if (row[col] === next) continue;
    db.prepare(`UPDATE zaznam SET ${col} = ? WHERE id = ?`).run(next, row.id);
    insert.run(row.id, by.now, by.manager, TRACKED[col], shown(db, col, row[col]), shown(db, col, next), reason);
  }
  db.prepare('UPDATE zaznam SET opravil = ?, poznamka = ? WHERE id = ?').run(by.manager, reason, row.id);
  insert.run(row.id, by.now, by.manager, 'akcia', null, action, reason);
}

/** Runs a manager's action on a record that is not running, in one transaction, after checking the reason; `run` returns an error message or applies the change. */
function withRecord(db: Db, id: number, reason: string, by: Actor, run: (row: RecordRow, reason: string) => string | void): Result {
  const why = reason.trim();
  if (why === '') return fail('Zadajte dôvod.');
  if (why.length > MAX_REASON) return fail(`Dôvod môže mať najviac ${MAX_REASON} znakov.`);
  return transaction(db, () => {
    const row = load(db, id);
    if (!row) return fail('Záznam neexistuje.');
    if (row.stav === 'bezi') return fail('Bežiaci záznam nemožno upravovať; počkajte, kým ho pracovník ukončí.');
    const error = run(row, why);
    return error === undefined ? { ok: true } : fail(error);
  });
}

export function correctRecord(db: Db, id: number, input: CorrectionInput, by: Actor): Result {
  return withRecord(db, id, input.reason, by, (row, reason) => {
    if (row.stav === 'vylucene') return 'Vylúčený záznam najprv vráťte do hodnotenia.';
    if (!ACTIVITIES.includes(input.activity)) return 'Neplatná činnosť.';
    if (!getWorker(db, input.workerId)) return 'Zamestnanec neexistuje.';
    if (!Number.isFinite(input.start) || !Number.isFinite(input.end)) return 'Zadajte začiatok aj koniec.';
    if (input.end <= input.start) return 'Koniec musí byť po začiatku.';
    if (input.end > by.now) return 'Koniec nemôže byť v budúcnosti.';
    const clash = db
      .prepare(
        `SELECT cislo_dl FROM zaznam WHERE zamestnanec_id = ? AND id <> ? AND stav <> 'vylucene' AND zaciatok < ? AND (koniec IS NULL OR koniec > ?) ORDER BY zaciatok LIMIT 1`,
      )
      .get(input.workerId, id, input.end, input.start) as { cislo_dl: string } | undefined;
    if (clash) return `Čas sa prekrýva s iným záznamom tohto zamestnanca (DL ${clash.cislo_dl}).`;
    const paused = pausedSeconds(listPauses(db, id), input.start, input.end);
    apply(db, row, {
      zaciatok: input.start,
      koniec: input.end,
      zamestnanec_id: input.workerId,
      cinnost: input.activity,
      pauza_s: paused,
      cisty_cas_s: netSeconds(input.start, input.end, paused),
      sposob_ukoncenia: row.sposob_ukoncenia === 'koniec_zmeny' ? 'oprava' : row.sposob_ukoncenia,
      stav: 'opravene',
      potvrdene: 1,
    }, 'oprava', reason, by);
  });
}

/** The manager vouches for the record as it is. An unfinished record needs a real end first (correctRecord). */
export function confirmRecord(db: Db, id: number, reason: string, by: Actor): Result {
  return withRecord(db, id, reason, by, (row, why) => {
    if (row.stav === 'neukoncene') return 'Neukončený záznam najprv opravte: zadajte skutočný koniec.';
    if (row.stav === 'vylucene') return 'Vylúčený záznam najprv vráťte do hodnotenia.';
    if (row.potvrdene === 1) return 'Záznam je už potvrdený.';
    apply(db, row, { potvrdene: 1 }, 'potvrdenie', why, by);
  });
}

export function excludeRecord(db: Db, id: number, reason: string, by: Actor): Result {
  return withRecord(db, id, reason, by, (row, why) => {
    if (row.stav === 'vylucene') return 'Záznam je už vylúčený.';
    apply(db, row, { stav: 'vylucene' }, 'vylucenie', why, by);
  });
}

/** Puts an excluded record back into the status it had before it was excluded (found in the log). */
export function restoreRecord(db: Db, id: number, reason: string, by: Actor): Result {
  return withRecord(db, id, reason, by, (row, why) => {
    if (row.stav !== 'vylucene') return 'Záznam nie je vylúčený.';
    const last = db.prepare(`SELECT stara_hodnota FROM oprava_zaznamu WHERE zaznam_id = ? AND pole = 'stav' AND nova_hodnota = 'vylucene' ORDER BY id DESC LIMIT 1`).get(id) as
      | { stara_hodnota: string | null }
      | undefined;
    const before = last?.stara_hodnota;
    apply(db, row, { stav: before === 'neukoncene' || before === 'opravene' ? before : 'ok' }, 'vratenie', why, by);
  });
}
