/**
 * Deterministic demo data: workers, stations, delivery notes and about four weeks of history.
 * Nothing here is customer data; names and companies are invented.
 */
import type { Activity } from '../src/config.ts';
import { addDays, isoWeekday, localToEpoch, parseDate } from '../src/time.ts';

export const TZ = 'Europe/Bratislava';

/** Mulberry32: small seeded PRNG so every demo run produces the same data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoWorker {
  code: string;
  name: string;
  /** Usual activity. */
  activity: Activity;
  /** Time multiplier: below 1 is faster than the team. */
  pace: number;
  /** Morning (0) or afternoon (1) shift. */
  shift: 0 | 1;
}

export const WORKERS: DemoWorker[] = [
  { code: 'Z0001', name: 'Ján Kováč', activity: 'VYCH', pace: 0.85, shift: 0 },
  { code: 'Z0002', name: 'Peter Baláž', activity: 'VYCH', pace: 1.05, shift: 0 },
  { code: 'Z0003', name: 'Mária Horváthová', activity: 'BAL', pace: 0.9, shift: 0 },
  { code: 'Z0004', name: 'Lukáš Varga', activity: 'VYCH', pace: 1.25, shift: 1 },
  { code: 'Z0005', name: 'Zuzana Tóthová', activity: 'BAL', pace: 1.0, shift: 1 },
  { code: 'Z0006', name: 'Martin Szabó', activity: 'VYCH', pace: 0.95, shift: 1 },
  { code: 'Z0007', name: 'Eva Nagyová', activity: 'BAL', pace: 1.15, shift: 0 },
  { code: 'Z0008', name: 'Tomáš Molnár', activity: 'BAL', pace: 0.8, shift: 1 },
];

export const STATIONS: { name: string; defaultActivity: Activity | null }[] = [
  { name: 'Vychystávanie – regály A', defaultActivity: null },
  { name: 'Vychystávanie – regály B', defaultActivity: null },
  { name: 'Baliaci stôl 1', defaultActivity: 'BAL' },
  { name: 'Baliaci stôl 2', defaultActivity: 'BAL' },
];

const CUSTOMERS = [
  'Stavebniny Horák s.r.o.', 'ELEKTRO-MONT Žilina', 'Kúpeľne Novák', 'AGRO Trenčín a.s.', 'Farby-laky Pospíšil',
  'TechnoServis Martin', 'Domáce potreby Kráľ', 'Záhradníctvo Lipa', 'Inštalatér Bednár', 'Hobby Market Púchov',
  'Autodiely Kubica', 'Nábytok Orava s.r.o.', 'Železiarstvo Mikuláš', 'Strechy Hudec', 'Kancelária Plus',
];

export interface DemoNote {
  number: string;
  idMaster: number;
  date: string;
  customer: string;
  /** Stock lines: [stock item id, amount]. */
  lines: { item: number; amount: number }[];
  /** Number of non-stock lines (transport, service) that must not count. */
  serviceLines: number;
  state: string;
}

export interface DemoItem {
  id: number;
  name: string;
  weightKg: number;
}

/** 300 stock items; about 6 % have no weight on the card (an open question in #1). */
export function items(): DemoItem[] {
  const r = rng(7);
  return Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    name: `Tovar ${i + 1}`,
    weightKg: r() < 0.06 ? 0 : Math.round((0.05 + r() ** 2 * 24) * 100) / 100,
  }));
}

export function noteWeight(n: DemoNote, its: DemoItem[]): number {
  return Math.round(n.lines.reduce((s, l) => s + Math.abs(l.amount) * (its[l.item - 1]?.weightKg ?? 0), 0) * 100) / 100;
}

export function noteUnits(n: DemoNote): number {
  return n.lines.reduce((s, l) => s + Math.abs(l.amount), 0);
}

function makeNote(r: () => number, seq: number, date: string, state: string): DemoNote {
  const year = date.slice(0, 4);
  // Most notes are small, a few are large: the reason the performance index exists.
  const count = Math.max(1, Math.round(r() < 0.15 ? 18 + r() * 30 : 1 + r() ** 1.6 * 14));
  const lines = Array.from({ length: count }, () => ({ item: 1 + Math.floor(r() * 300), amount: 1 + Math.floor(r() ** 2 * 12) }));
  return {
    number: `DL${year}${String(seq).padStart(5, '0')}`,
    idMaster: 100000 + seq,
    date,
    customer: CUSTOMERS[Math.floor(r() * CUSTOMERS.length)] ?? 'Odberateľ',
    lines,
    serviceLines: r() < 0.3 ? 1 : 0,
    state,
  };
}

export interface DemoRecord {
  worker: string;
  activity: Activity;
  note: string;
  station: number;
  start: number;
  end: number;
  pauseSeconds: number;
  status: 'ok' | 'neukoncene';
  method: 'dalsi_dl' | 'koniec' | 'odhlas' | 'koniec_zmeny';
}

export interface DemoHistory {
  notes: DemoNote[];
  records: DemoRecord[];
  /** Notes created today that nobody has touched yet: the live scenario scans these. */
  openNotes: DemoNote[];
}

function at(date: string, minutes: number): number {
  const { year, month, day } = parseDate(date);
  return localToEpoch(year, month, day, 0, 0, TZ) + minutes * 60_000;
}

/**
 * Work days from `today - days` up to yesterday, plus the morning of `today` until `nowMinutes`.
 * Each note is picked by a picker, then packed by a packer.
 */
export function history(today: string, days: number, nowMinutes: number, its: DemoItem[]): DemoHistory {
  const r = rng(42);
  const notes: DemoNote[] = [];
  const records: DemoRecord[] = [];
  let seq = 1;
  const pickers = WORKERS.filter((w) => w.activity === 'VYCH');
  const packers = WORKERS.filter((w) => w.activity === 'BAL');

  for (let d = -days; d <= 0; d++) {
    const date = addDays(today, d);
    if (isoWeekday(date) > 5) continue;
    const isToday = d === 0;
    for (const shift of [0, 1] as const) {
      const shiftStart = shift === 0 ? 6 * 60 : 14 * 60;
      const shiftEnd = shiftStart + 8 * 60;
      if (isToday && shiftStart >= nowMinutes) continue;
      const limit = isToday ? Math.min(shiftEnd, nowMinutes) : shiftEnd;
      // Pickers work from the shift start; packers follow 20 minutes later.
      const queue: { note: DemoNote; ready: number }[] = [];
      for (const [i, w] of pickers.filter((p) => p.shift === shift).entries()) {
        let t = shiftStart + 5 + r() * 8;
        let lunch = false;
        while (t < limit - 5) {
          const note = makeNote(r, seq++, date, 'Vychystáva sa');
          notes.push(note);
          const kg = noteWeight(note, its);
          const sec = (70 + 28 * note.lines.length + 0.6 * kg) * w.pace * (0.8 + r() * 0.45);
          let pause = 0;
          if (!lunch && t > shiftStart + 210) {
            pause = 30 * 60;
            lunch = true;
          }
          const end = t + (sec + pause) / 60;
          if (end > limit) break;
          const lastOfShift = end + 10 > shiftEnd;
          const forgot = !isToday && lastOfShift && r() < 0.35;
          records.push({
            worker: w.code,
            activity: 'VYCH',
            note: note.number,
            station: 1 + (i % 2),
            start: at(date, t),
            end: forgot ? at(date, shiftEnd) : at(date, end),
            pauseSeconds: Math.round(pause),
            status: forgot ? 'neukoncene' : 'ok',
            method: forgot ? 'koniec_zmeny' : 'dalsi_dl',
          });
          queue.push({ note, ready: end });
          // A few mis-scans: the same note scanned twice within seconds.
          if (r() < 0.02) {
            records.push({ worker: w.code, activity: 'VYCH', note: note.number, station: 1 + (i % 2), start: at(date, end), end: at(date, end) + 8_000, pauseSeconds: 0, status: 'ok', method: 'dalsi_dl' });
          }
          t = end + (0.5 + r() * 2.5);
        }
      }
      queue.sort((a, b) => a.ready - b.ready);
      const shiftPackers = packers.filter((p) => p.shift === shift);
      const free = shiftPackers.map(() => shiftStart + 20);
      for (const q of queue) {
        const idx = free.indexOf(Math.min(...free));
        const w = shiftPackers[idx];
        if (!w) break;
        const t = Math.max(free[idx] ?? 0, q.ready + 2);
        const kg = noteWeight(q.note, its);
        const sec = (55 + 14 * q.note.lines.length + 0.9 * kg) * w.pace * (0.8 + r() * 0.45);
        const end = t + sec / 60;
        if (end > limit) continue;
        records.push({ worker: w.code, activity: 'BAL', note: q.note.number, station: 3 + (idx % 2), start: at(date, t), end: at(date, end), pauseSeconds: 0, status: 'ok', method: 'dalsi_dl' });
        q.note.state = 'Zabalený';
        free[idx] = end + 0.3 + r() * 1.5;
      }
    }
  }
  const openNotes = Array.from({ length: 12 }, () => makeNote(r, seq++, today, 'Na vychystanie'));
  notes.push(...openNotes);
  return { notes, records, openNotes };
}
