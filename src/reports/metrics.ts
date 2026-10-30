import { ACTIVITIES, type Activity } from '../config.ts';

/**
 * The arithmetic of #1 section 4 as a function of records, not of a date: the day report (#7), the week and
 * month comparison (#9) and the performance index (#10) feed it the counted records they selected.
 */

export interface MetricRecord {
  workerId: number;
  activity: Activity;
  netSeconds: number | null;
  lines: number | null;
  units: number | null;
  weightKg: number | null;
}

export interface Totals {
  /** Counted records, i.e. delivery notes. */
  notes: number;
  lines: number;
  units: number;
  weightKg: number;
  netSeconds: number;
  /** Volume per net hour; null when there is no net time. */
  notesPerHour: number | null;
  linesPerHour: number | null;
  kgPerHour: number | null;
  /** Net seconds per note / per line; null when there are none. */
  avgSecondsPerNote: number | null;
  avgSecondsPerLine: number | null;
}

export interface WorkerActivityTotals extends Totals {
  workerId: number;
  activity: Activity;
}

function perHour(volume: number, netSeconds: number): number | null {
  return netSeconds > 0 ? volume / (netSeconds / 3600) : null;
}

function average(netSeconds: number, count: number): number | null {
  return count > 0 ? netSeconds / count : null;
}

/** Totals of the given records; a missing snapshot or net time counts as zero. */
export function totalsOf(records: readonly MetricRecord[]): Totals {
  let lines = 0;
  let units = 0;
  let weightKg = 0;
  let netSeconds = 0;
  for (const r of records) {
    lines += r.lines ?? 0;
    units += r.units ?? 0;
    weightKg += r.weightKg ?? 0;
    netSeconds += r.netSeconds ?? 0;
  }
  const notes = records.length;
  return {
    notes,
    lines,
    units,
    weightKg,
    netSeconds,
    notesPerHour: perHour(notes, netSeconds),
    linesPerHour: perHour(lines, netSeconds),
    kgPerHour: perHour(weightKg, netSeconds),
    avgSecondsPerNote: average(netSeconds, notes),
    avgSecondsPerLine: average(netSeconds, lines),
  };
}

/** One entry per worker and activity that has records: picking before packing, then by worker id. */
export function totalsByWorkerAndActivity(records: readonly MetricRecord[]): WorkerActivityTotals[] {
  const groups = new Map<string, MetricRecord[]>();
  for (const r of records) {
    const key = `${r.activity}:${r.workerId}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: WorkerActivityTotals[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    if (first) out.push({ workerId: first.workerId, activity: first.activity, ...totalsOf(g) });
  }
  return out.sort((a, b) => ACTIVITIES.indexOf(a.activity) - ACTIVITIES.indexOf(b.activity) || a.workerId - b.workerId);
}
