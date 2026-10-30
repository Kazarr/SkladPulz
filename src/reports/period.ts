import { addDays, isoWeekday, parseDate, pad } from '../time.ts';

/** A reporting period as inclusive local dates "YYYY-MM-DD". */
export type PeriodKind = 'den' | 'tyzden' | 'mesiac' | 'vlastne';
export const PERIOD_KINDS: readonly PeriodKind[] = ['den', 'tyzden', 'mesiac', 'vlastne'];

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

function monthPeriod(year: number, month: number): Period {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const head = `${String(year).padStart(4, '0')}-${pad(month)}`;
  return { kind: 'mesiac', from: `${head}-01`, to: `${head}-${pad(last)}` };
}

/** The day, ISO week (Monday-Sunday) or calendar month that contains `date`. `vlastne` has no anchor: use `customPeriod`. */
export function periodAround(kind: Exclude<PeriodKind, 'vlastne'>, date: string): Period {
  if (kind === 'den') return { kind, from: date, to: date };
  if (kind === 'tyzden') {
    const monday = addDays(date, 1 - isoWeekday(date));
    return { kind, from: monday, to: addDays(monday, 6) };
  }
  const { year, month } = parseDate(date);
  return monthPeriod(year, month);
}

/** A custom range; null when the end is before the start. */
export function customPeriod(from: string, to: string): Period | null {
  return from <= to ? { kind: 'vlastne', from, to } : null;
}

/** Length of a period in days. */
function lengthDays(p: Period): number {
  const { year: y1, month: m1, day: d1 } = parseDate(p.from);
  const { year: y2, month: m2, day: d2 } = parseDate(p.to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/**
 * The previous (-1) or next (1) period. Day, week and custom ranges move by their own length, so the previous one has equal
 * length; a month moves to the neighbouring calendar month (its length differs, which does not matter for rates per hour).
 */
export function shiftPeriod(p: Period, direction: -1 | 1): Period {
  if (p.kind === 'mesiac') {
    const { year, month } = parseDate(p.from);
    const m = month - 1 + direction;
    return monthPeriod(year + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1);
  }
  const n = lengthDays(p) * direction;
  return { kind: p.kind, from: addDays(p.from, n), to: addDays(p.to, n) };
}
