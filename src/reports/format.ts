import { formatDuration } from '../time.ts';

/** Slovak number format: decimal comma. `null` (no data to divide by) shows as a dash. */
export function formatNumber(n: number | null, digits = 1): string {
  return n === null ? '–' : n.toLocaleString('sk-SK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSeconds(n: number | null): string {
  return n === null ? '–' : formatDuration(n);
}

/** A percentage with the % sign: "110,5 %"; `signed` adds + to positive values ("+5,2 %"). */
export function formatPercent(n: number | null, digits = 1, signed = false): string {
  if (n === null) return '–';
  const text = formatNumber(n, digits);
  return `${signed && n > 0 ? '+' : ''}${text}\u00a0%`;
}
