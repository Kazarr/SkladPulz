/** Rules of one record that do not depend on storage. */

export type Suspicion = 'kratky' | 'dlhy';

export interface PauseSpan {
  from: number;
  /** null while the pause is open. */
  to: number | null;
}

/** Whole seconds paused before `end`; an open pause counts up to `end`. Pauses are clipped to [start, end]. */
export function pausedSeconds(pauses: readonly PauseSpan[], start: number, end: number): number {
  let ms = 0;
  for (const p of pauses) {
    const a = Math.max(p.from, start);
    const b = Math.min(p.to ?? end, end);
    if (b > a) ms += b - a;
  }
  return Math.round(ms / 1000);
}

/** Net time in whole seconds: end minus start minus pauses, never below zero. */
export function netSeconds(start: number, end: number, pauseSeconds: number): number {
  return Math.max(0, Math.round((end - start) / 1000) - pauseSeconds);
}

/** A net time under the short limit or over the long limit makes the record suspect. */
export function suspicionOf(net: number, limits: { shortSeconds: number; longSeconds: number }): Suspicion | null {
  if (net < limits.shortSeconds) return 'kratky';
  if (net > limits.longSeconds) return 'dlhy';
  return null;
}

/** Why a record waits for a manager. */
export type ReviewReason = 'neukoncene' | Suspicion | 'duplicita' | 'chybaju_data';

export interface Reviewable {
  status: string;
  suspicion: Suspicion | null;
  confirmed: boolean;
  duplicate: boolean;
  /** Snapshot line count; null when the note's details were never known (ONIX was down). */
  lines: number | null;
}

/**
 * The one definition of "needs review", used by /kontrola, the "Na kontrolu" filter and the e-mail count:
 * closed automatically at shift end, or suspect, a duplicate or without a snapshot of its note and not confirmed by a manager.
 * Running and excluded records never need review.
 */
export function reviewReasons(r: Reviewable): ReviewReason[] {
  if (r.status !== 'neukoncene' && r.status !== 'ok' && r.status !== 'opravene') return [];
  const reasons: ReviewReason[] = [];
  if (r.status === 'neukoncene') reasons.push('neukoncene');
  if (r.suspicion !== null && !r.confirmed) reasons.push(r.suspicion);
  if (r.duplicate && !r.confirmed) reasons.push('duplicita');
  if (r.status !== 'neukoncene' && r.lines === null && !r.confirmed) reasons.push('chybaju_data');
  return reasons;
}
