/** Local-time helpers for one IANA time zone. All instants are epoch milliseconds. */

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out['year'] ?? 0,
    month: out['month'] ?? 0,
    day: out['day'] ?? 0,
    hour: out['hour'] ?? 0,
    minute: out['minute'] ?? 0,
    second: out['second'] ?? 0,
  };
}

function offsetAt(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of a local wall-clock time. In the autumn overlap the earlier instant wins; in the spring gap the time moves forward. */
export function localToEpoch(year: number, month: number, day: number, hour = 0, minute = 0, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return Math.min(first, second);
}

/** "YYYY-MM-DD" of the local day that contains `ms`. */
export function localDate(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Neplatný dátum: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Adds whole calendar days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Start of the local day `date` as epoch ms. */
export function startOfLocalDay(date: string, tz: string): number {
  const { year, month, day } = parseDate(date);
  return localToEpoch(year, month, day, 0, 0, tz);
}

/** [from, to) epoch range covering local days `fromDate`..`toDate` inclusive. */
export function localDayRange(fromDate: string, toDate: string, tz: string): { from: number; to: number } {
  return { from: startOfLocalDay(fromDate, tz), to: startOfLocalDay(addDays(toDate, 1), tz) };
}

/** "HH:MM" local time of `ms`. */
export function localTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "D. M. YYYY HH:MM" in local time, Slovak style. */
export function localDateTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.day}. ${p.month}. ${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Seconds as "H:MM:SS" or "M:SS". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** ISO weekday 1 (Monday) .. 7 (Sunday) of a "YYYY-MM-DD" date. */
export function isoWeekday(date: string): number {
  const { year, month, day } = parseDate(date);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}
