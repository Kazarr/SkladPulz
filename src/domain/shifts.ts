import type { Shift } from '../config.ts';
import { addDays, localDate, localToEpoch, parseDate } from '../time.ts';

export interface ShiftWindow {
  name: string;
  /** Local date the shift starts on. */
  date: string;
  from: number;
  to: number;
}

function hm(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

/** The concrete windows of every shift starting on local day `date`. */
export function shiftWindowsOn(date: string, shifts: readonly Shift[], tz: string): ShiftWindow[] {
  const { year, month, day } = parseDate(date);
  return shifts.map((s) => {
    const a = hm(s.from);
    const b = hm(s.to);
    const from = localToEpoch(year, month, day, a.h, a.m, tz);
    const overnight = b.h * 60 + b.m <= a.h * 60 + a.m;
    const end = overnight ? parseDate(addDays(date, 1)) : { year, month, day };
    const to = localToEpoch(end.year, end.month, end.day, b.h, b.m, tz);
    return { name: s.name, date, from, to };
  });
}

/**
 * When a record that started at `start` must be closed automatically:
 * the end of the shift it started in, else the end of the next shift to start after it,
 * else (no shifts configured, or none starts within a day) the next local midnight.
 */
export function autoCloseAt(start: number, shifts: readonly Shift[], tz: string): number {
  const today = localDate(start, tz);
  const windows = [-1, 0, 1].flatMap((d) => shiftWindowsOn(addDays(today, d), shifts, tz));
  const containing = windows.filter((w) => w.from <= start && start < w.to).sort((a, b) => b.to - a.to)[0];
  if (containing) return containing.to;
  const next = windows.filter((w) => w.from > start).sort((a, b) => a.from - b.from)[0];
  if (next) return next.to;
  const { year, month, day } = parseDate(addDays(today, 1));
  return localToEpoch(year, month, day, 0, 0, tz);
}

/** End of the last shift that starts on local day `date`, or the end of that day without shifts. */
export function lastShiftEnd(date: string, shifts: readonly Shift[], tz: string): number {
  const ends = shiftWindowsOn(date, shifts, tz).map((w) => w.to);
  if (ends.length > 0) return Math.max(...ends);
  const { year, month, day } = parseDate(addDays(date, 1));
  return localToEpoch(year, month, day, 0, 0, tz);
}
