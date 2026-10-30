/**
 * Bands instead of an exact rank (#9, analysis section 5): top 30 % / middle 40 % / bottom 30 % by index.
 * Sizes are 30 % of the workers with an index, rounded half down so fewer workers are labelled top or bottom
 * (10 -> 3/4/3, 5 -> 1/3/1, 3 -> 1/1/1, 2 -> 1/0/1, 1 -> 0/1/0). A tie is never split: a group of equal indices that
 * touches more than one band goes wholly to the middle.
 */

export type Band = 'top' | 'middle' | 'bottom';

export function splitBands(workers: readonly { id: number; index: number | null }[]): Map<number, Band> {
  const ranked = workers.filter((w): w is { id: number; index: number } => w.index !== null).sort((a, b) => b.index - a.index);
  const n = ranked.length;
  const edge = Math.floor((3 * n + 4) / 10);
  const bandAt = (p: number): Band => (p < edge ? 'top' : p >= n - edge ? 'bottom' : 'middle');
  const out = new Map<number, Band>();
  for (let start = 0; start < n; ) {
    let end = start + 1;
    while (end < n && ranked[end]?.index === ranked[start]?.index) end++;
    const first = bandAt(start);
    const whole = new Set(Array.from({ length: end - start }, (_, i) => bandAt(start + i))).size === 1 ? first : 'middle';
    for (let p = start; p < end; p++) out.set((ranked[p] as { id: number }).id, whole);
    start = end;
  }
  return out;
}
