import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { lastShiftEnd } from '../domain/shifts.ts';
import { addDays, localDate } from '../time.ts';
import { buildDailySummary } from './daily-summary.ts';
import type { MailTransport } from './transport.ts';

/** A day is given up on after this many failed sends. */
export const MAX_FAILURES = 5;

export interface SendLogEntry {
  date: string;
  at: number;
  recipients: string[];
  ok: boolean;
  error: string | null;
  /** Sent from the preview page; does not count for the day. */
  test: boolean;
}

interface LogRow {
  den: string;
  cas: number;
  prijemcovia: string;
  ok: number;
  chyba: string | null;
  skusobny: number;
}

export function listSendLog(db: Db, limit: number): SendLogEntry[] {
  const rows = db.prepare('SELECT * FROM email_odoslanie ORDER BY id DESC LIMIT ?').all(limit) as unknown as LogRow[];
  return rows.map((r) => ({ date: r.den, at: r.cas, recipients: JSON.parse(r.prijemcovia) as string[], ok: r.ok === 1, error: r.chyba, test: r.skusobny === 1 }));
}

/** Builds and sends the summary of `date`, logs the outcome and returns it. Never throws on a send failure. */
export async function sendSummary(db: Db, config: Config, date: string, now: number, transport: MailTransport, test: boolean): Promise<SendLogEntry> {
  const recipients = config.email.recipients;
  let error: string | null = null;
  try {
    await transport.send(await buildDailySummary(db, config, date));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  db.prepare('INSERT INTO email_odoslanie (den, cas, prijemcovia, ok, chyba, skusobny) VALUES (?, ?, ?, ?, ?, ?)').run(date, now, JSON.stringify(recipients), error === null ? 1 : 0, error, test ? 1 : 0);
  return { date, at: now, recipients, ok: error === null, error, test };
}

/**
 * Sends the summary of yesterday and of today once each is due: `lastShiftEnd + delayMin` has passed.
 * ponytail: only yesterday and today are considered, so a server that was off for days sends no backlog.
 */
export async function sendDueSummaries(db: Db, config: Config, now: number, transport: MailTransport): Promise<SendLogEntry[]> {
  const { enabled, recipients, delayMin } = config.email;
  if (!enabled || recipients.length === 0) return [];
  const today = localDate(now, config.timezone);
  const sent: SendLogEntry[] = [];
  for (const date of [addDays(today, -1), today]) {
    if (now < lastShiftEnd(date, config.shifts, config.timezone) + delayMin * 60_000) continue;
    const counts = db.prepare('SELECT coalesce(sum(ok), 0) AS ok, count(*) - coalesce(sum(ok), 0) AS failed FROM email_odoslanie WHERE den = ? AND skusobny = 0').get(date) as { ok: number; failed: number };
    if (counts.ok > 0 || counts.failed >= MAX_FAILURES) continue;
    sent.push(await sendSummary(db, config, date, now, transport, false));
  }
  return sent;
}
