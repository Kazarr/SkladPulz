import { buildConfig, type Config } from '../src/config.ts';
import { openDb, type Db } from '../src/db/db.ts';
import type { DeliveryNoteSource } from '../src/onix/source.ts';
import type { DeliveryNote } from '../src/store/delivery-notes.ts';
import { localToEpoch } from '../src/time.ts';
import type { AppDeps } from '../src/web/app.ts';

export const TZ = 'Europe/Bratislava';

/** Epoch ms of a Bratislava wall-clock time on 2026-10-14 (a Wednesday, CEST) unless another date is given. */
export function at(hhmm: string, date = '2026-10-14'): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return localToEpoch(y ?? 0, mo ?? 0, d ?? 0, h ?? 0, mi ?? 0, TZ);
}

export function note(number: string, over: Partial<DeliveryNote> = {}): DeliveryNote {
  return { number, onixIdMaster: null, date: '2026-10-14', customer: `Odberateľ ${number}`, state: 'Na vychystanie', type: null, lines: 5, units: 12, weightKg: 7.5, ...over };
}

export class FakeSource implements DeliveryNoteSource {
  notes = new Map<string, DeliveryNote>();
  down = false;
  calls: string[] = [];
  add(...ns: DeliveryNote[]): this {
    for (const n of ns) this.notes.set(n.number, n);
    return this;
  }
  async fetchActive(): Promise<DeliveryNote[]> {
    this.calls.push('active');
    if (this.down) throw new Error('ONIX down');
    return [...this.notes.values()];
  }
  async fetchByNumber(number: string): Promise<DeliveryNote | null> {
    this.calls.push(number);
    if (this.down) throw new Error('ONIX down');
    return this.notes.get(number) ?? null;
  }
}

export class Clock {
  t: number;
  constructor(t: number) {
    this.t = t;
  }
  now = (): number => this.t;
  advance(seconds: number): number {
    this.t += seconds * 1000;
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

export interface TestEnv extends AppDeps {
  db: Db;
  config: Config;
  clock: Clock;
  source: FakeSource;
  errors: string[];
}

export function testEnv(configOver: Parameters<typeof buildConfig>[0] = {}, start = at('08:00')): TestEnv {
  const clock = new Clock(start);
  const errors: string[] = [];
  return {
    db: openDb(':memory:'),
    config: buildConfig(configOver),
    clock,
    now: clock.now,
    source: new FakeSource(),
    errors,
    logError: (m: string) => errors.push(m),
  };
}
