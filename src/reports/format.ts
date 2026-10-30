import { formatDuration } from '../time.ts';

/** Slovak number format: decimal comma. `null` (no data to divide by) shows as a dash. */
export function formatNumber(n: number | null, digits = 1): string {
  return n === null ? '–' : n.toLocaleString('sk-SK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSeconds(n: number | null): string {
  return n === null ? '–' : formatDuration(n);
}
