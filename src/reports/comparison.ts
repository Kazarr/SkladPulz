import type { Activity } from '../config.ts';
import type { Db } from '../db/db.ts';
import { splitBands, type Band } from '../domain/bands.ts';
import { performanceIndex, type Weights } from '../domain/index.ts';
import { isSuspectUnconfirmed } from './daily.ts';
import { totalsOf, type Totals } from './metrics.ts';
import { shiftPeriod, type Period } from './period.ts';
import { listRangeRecords, type ReportRecord } from './queries.ts';

/** The employee comparison of #9: per worker and activity over a period, against the team and against the previous period. */

export type ComparisonView = 'poradie' | 'pasma';

export const BAND_LABEL: Record<Band, string> = { top: 'Horných 30 %', middle: 'Stred 40 %', bottom: 'Dolných 30 %' };

export interface ComparisonRow extends Totals {
  workerId: number | null;
  workerName: string;
  /** Performance index in percent; the team's is 100. Null without net time. */
  index: number | null;
  /** Percent above (+) or below (-) the team's lines per hour; null for the team row and without data. */
  linesPerHourDeviation: number | null;
  /** Index minus 100. */
  indexDeviation: number | null;
  /** Percent change of lines per hour against the previous period; null (shown as "–") when there was no data then. */
  linesPerHourTrend: number | null;
  indexTrend: number | null;
  /** Records left out of every figure: closed automatically at shift end, suspect and not confirmed, excluded by a manager. */
  unfinished: number;
  suspect: number;
  excluded: number;
  band: Band | null;
}

export interface Comparison {
  period: Period;
  previous: Period;
  activity: Activity;
  rows: ComparisonRow[];
  team: ComparisonRow;
}

/** Percent change from `previous` to `current`; null when either is missing or the previous is 0. */
function change(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous === 0 ? null : (current / previous - 1) * 100;
}

interface Measured {
  totals: Totals;
  index: number | null;
}

function measure(w: Weights, mine: readonly ReportRecord[], team: readonly ReportRecord[]): Measured {
  return { totals: totalsOf(mine), index: performanceIndex(w, mine, team) };
}

export function buildComparison(db: Db, tz: string, period: Period, activity: Activity, weights: Weights): Comparison {
  const previous = shiftPeriod(period, -1);
  const filter = { workerId: null, activity };
  const all = listRangeRecords(db, 'zaznam', tz, period.from, period.to, filter);
  const counted = listRangeRecords(db, 'zaznam_hodnotene', tz, period.from, period.to, filter);
  const before = listRangeRecords(db, 'zaznam_hodnotene', tz, previous.from, previous.to, filter);

  const names = new Map(all.map((r) => [r.workerId, r.workerName]));
  const teamTotals = totalsOf(counted);
  const prevOf = (workerId: number | null): Measured =>
    measure(weights, workerId === null ? before : before.filter((r) => r.workerId === workerId), before);

  const row = (workerId: number | null, name: string, mine: ReportRecord[], left: ReportRecord[]): ComparisonRow => {
    const { totals, index } = measure(weights, mine, counted);
    const prev = prevOf(workerId);
    return {
      ...totals,
      workerId,
      workerName: name,
      index,
      linesPerHourDeviation: workerId === null ? null : change(totals.linesPerHour, teamTotals.linesPerHour),
      indexDeviation: index === null ? null : index - 100,
      linesPerHourTrend: change(totals.linesPerHour, prev.totals.linesPerHour),
      indexTrend: change(index, prev.index),
      unfinished: left.filter((r) => r.status === 'neukoncene').length,
      suspect: left.filter(isSuspectUnconfirmed).length,
      excluded: left.filter((r) => r.status === 'vylucene').length,
      band: null,
    };
  };

  const rows = [...names].map(([id, name]) =>
    row(id, name, counted.filter((r) => r.workerId === id), all.filter((r) => r.workerId === id)),
  );
  const bands = splitBands(rows.map((r) => ({ id: r.workerId ?? 0, index: r.index })));
  for (const r of rows) r.band = bands.get(r.workerId ?? 0) ?? null;
  return { period, previous, activity, rows, team: row(null, 'Tím spolu', counted, all) };
}

const BAND_ORDER: Record<Band, number> = { top: 0, middle: 1, bottom: 2 };
const byName = (a: ComparisonRow, b: ComparisonRow): number => a.workerName.localeCompare(b.workerName, 'sk');

/** `poradie`: best index first, workers without an index last. `pasma`: top, middle, bottom band, each in name order so no rank shows. */
export function orderRows(rows: readonly ComparisonRow[], view: ComparisonView): ComparisonRow[] {
  const sorted = [...rows];
  if (view === 'pasma') return sorted.sort((a, b) => (a.band === null ? 3 : BAND_ORDER[a.band]) - (b.band === null ? 3 : BAND_ORDER[b.band]) || byName(a, b));
  return sorted.sort((a, b) => (b.index ?? -Infinity) - (a.index ?? -Infinity) || byName(a, b));
}

/** Rank by index; equal indices share a rank. Null for a worker without an index. */
export function rankOf(rows: readonly ComparisonRow[], row: ComparisonRow): number | null {
  return row.index === null ? null : rows.filter((r) => (r.index ?? -Infinity) > (row.index ?? 0)).length + 1;
}
