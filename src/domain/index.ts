import type { Activity } from '../config.ts';

/**
 * The performance index (#10, glossary) as pure functions.
 * Standard time of a record = fixed + per line x lines + per kg x kg (seconds), weights set per activity.
 * Index of a set of records = (sum of standard time / sum of net time) divided by the same ratio of the team over the
 * same period and activity, times 100. The team's own index is therefore exactly 100 %.
 */

export interface Weights {
  fixedSeconds: number;
  perLineSeconds: number;
  perKgSeconds: number;
}

export type WeightsByActivity = Record<Activity, Weights>;

/** Placeholders until the weights are estimated from 2-4 weeks of measured data. */
export const DEFAULT_WEIGHTS: WeightsByActivity = {
  VYCH: { fixedSeconds: 60, perLineSeconds: 25, perKgSeconds: 0.5 },
  BAL: { fixedSeconds: 45, perLineSeconds: 12, perKgSeconds: 0.8 },
};

/** The part of a record the index needs; a missing snapshot counts as 0. Structurally a `MetricRecord`. */
export interface IndexRecord {
  netSeconds: number | null;
  lines: number | null;
  weightKg: number | null;
}

export function standardSeconds(w: Weights, r: IndexRecord): number {
  return w.fixedSeconds + w.perLineSeconds * (r.lines ?? 0) + w.perKgSeconds * (r.weightKg ?? 0);
}

/** Standard time over net time (1 = exactly on the norm); null without net time. */
function normPace(w: Weights, records: readonly IndexRecord[]): number | null {
  let standard = 0;
  let net = 0;
  for (const r of records) {
    standard += standardSeconds(w, r);
    net += r.netSeconds ?? 0;
  }
  return net > 0 && standard > 0 ? standard / net : null;
}

/** Index in percent of `records` against the `team` that contains them; null when either side cannot be measured. */
export function performanceIndex(w: Weights, records: readonly IndexRecord[], team: readonly IndexRecord[]): number | null {
  const mine = normPace(w, records);
  const all = normPace(w, team);
  return mine === null || all === null ? null : (mine / all) * 100;
}

// --- estimating the weights from measured data -------------------------------------------------------------------

export const MIN_ESTIMATE_RECORDS = 30;

type Key = keyof Weights;
const KEYS: readonly Key[] = ['fixedSeconds', 'perLineSeconds', 'perKgSeconds'];

export type Estimate =
  | {
      ok: true;
      weights: Weights;
      /** Share of the variance of net time the weights explain; null when all net times are equal. */
      r2: number | null;
      records: number;
      /** Weights that came out negative, were set to 0 and left out of the refit. */
      clamped: Key[];
    }
  | {
      ok: false;
      /** `too_few`: fewer than `MIN_ESTIMATE_RECORDS`. `singular`: lines and kg do not vary independently (or no weight came out positive). */
      reason: 'too_few' | 'singular';
      records: number;
    };

/** Gaussian elimination without pivoting on a symmetric positive semi-definite system; null when a pivot is ~0 relative to its original diagonal. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  const diag = a.map((row, i) => row[i] ?? 0);
  for (let k = 0; k < n; k++) {
    const pivot = m[k]?.[k] ?? 0;
    const d = diag[k] ?? 0;
    if (!(d > 0 && pivot > 1e-9 * d)) return null;
    for (let i = k + 1; i < n; i++) {
      const f = (m[i]?.[k] ?? 0) / pivot;
      for (let j = k; j <= n; j++) (m[i] as number[])[j] = (m[i]?.[j] ?? 0) - f * (m[k]?.[j] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i]?.[n] ?? 0;
    for (let j = i + 1; j < n; j++) s -= (m[i]?.[j] ?? 0) * (x[j] ?? 0);
    x[i] = s / (m[i]?.[i] ?? 1);
  }
  return x;
}

/**
 * Ordinary least squares of net seconds on (1, lines, kg) over the given counted records.
 * A negative coefficient is clamped to 0 and the fit is recomputed for the remaining ones, until none is negative.
 * A column that is 0 in every record (e.g. no weights known) is not fitted and gets weight 0.
 */
export function estimateWeights(records: readonly IndexRecord[]): Estimate {
  const rows = records.filter((r) => r.netSeconds !== null).map((r) => ({ x: [1, r.lines ?? 0, r.weightKg ?? 0], y: r.netSeconds ?? 0 }));
  const n = rows.length;
  if (n < MIN_ESTIMATE_RECORDS) return { ok: false, reason: 'too_few', records: n };

  let active = [0, 1, 2].filter((c) => rows.some((r) => r.x[c] !== 0));
  const w = [0, 0, 0];
  const clamped: Key[] = [];
  for (;;) {
    if (active.length === 0) return { ok: false, reason: 'singular', records: n };
    const xtx = active.map((i) => active.map((j) => rows.reduce((s, r) => s + (r.x[i] ?? 0) * (r.x[j] ?? 0), 0)));
    const xty = active.map((i) => rows.reduce((s, r) => s + (r.x[i] ?? 0) * r.y, 0));
    const beta = solve(xtx, xty);
    if (beta === null) return { ok: false, reason: 'singular', records: n };
    w.fill(0);
    active.forEach((c, k) => (w[c] = beta[k] ?? 0));
    const negative = active.filter((c) => (w[c] ?? 0) < 0);
    if (negative.length === 0) break;
    for (const c of negative) {
      w[c] = 0;
      clamped.push(KEYS[c] as Key);
    }
    active = active.filter((c) => !negative.includes(c));
  }

  const mean = rows.reduce((s, r) => s + r.y, 0) / n;
  const ssTot = rows.reduce((s, r) => s + (r.y - mean) ** 2, 0);
  const ssRes = rows.reduce((s, r) => s + (r.y - r.x.reduce((t, v, c) => t + v * (w[c] ?? 0), 0)) ** 2, 0);
  return {
    ok: true,
    weights: { fixedSeconds: w[0] ?? 0, perLineSeconds: w[1] ?? 0, perKgSeconds: w[2] ?? 0 },
    r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
    records: n,
    clamped,
  };
}
