import type { Activity } from '../config.ts';
import type { ScannedCode } from './scan-code.ts';

/**
 * The scan station's rules (#1 section 2, #4) as one pure function: facts in, outcome and effects out.
 * The shell (src/station/scan-service.ts) gathers the facts, applies the effects in one transaction and logs the scan.
 */

export type Outcome = 'ok' | 'upozornenie' | 'chyba';
export type EndReason = 'dalsi_dl' | 'koniec' | 'odhlas' | 'zmena_cinnosti';

export interface WorkerFact {
  id: number;
  name: string;
  active: boolean;
}

export interface RunningFact {
  id: number;
  activity: Activity;
  dlNumber: string;
  paused: boolean;
}

export interface DeliveryNoteFact {
  number: string;
  customer: string | null;
  lines: number | null;
  weightKg: number | null;
}

/** What the scan lookup found for a delivery-note scan. */
export type DeliveryNoteLookup =
  | { status: 'found'; note: DeliveryNoteFact }
  /** ONIX answered and does not know the number. */
  | { status: 'unknown' }
  /** Not in the cache and ONIX could not be asked: the record starts and the details follow with the next sync. */
  | { status: 'unverified' };

export interface ScanFacts {
  now: number;
  station: { id: number; defaultActivity: Activity | null };
  scan: ScannedCode;
  /** For a worker scan: the worker with that code (null when unknown). Otherwise: the station's current worker. */
  worker: WorkerFact | null;
  /** The worker's chosen activity at this station, from their sign-in (null when none chosen). */
  activity: Activity | null;
  /** Whether the worker is signed in at this station. */
  signedInHere: boolean;
  running: RunningFact | null;
  /** Only for delivery-note scans. */
  lookup?: DeliveryNoteLookup;
  /** Only for delivery-note scans: names of other workers with a record of the same activity on this note. */
  doneByOthers?: string[];
  /** Only for delivery-note scans: the worker already finished this note with this activity. */
  doneByYou?: boolean;
  repeatScanEnds: boolean;
}

export type Effect =
  | { type: 'signIn'; workerId: number; stationId: number; activity: Activity | null }
  | { type: 'setActivity'; workerId: number; activity: Activity }
  | { type: 'signOut'; workerId: number }
  | { type: 'setStationWorker'; stationId: number; workerId: number | null }
  | { type: 'endRecord'; recordId: number; at: number; reason: EndReason }
  | { type: 'startRecord'; workerId: number; stationId: number; activity: Activity; dlNumber: string; at: number; duplicate: boolean }
  | { type: 'startPause'; recordId: number; at: number }
  | { type: 'endPause'; recordId: number; at: number };

export interface Decision {
  outcome: Outcome;
  message: string;
  effects: Effect[];
}

export const ACTIVITY_LABEL: Record<Activity, string> = { VYCH: 'Vychystanie', BAL: 'Balenie' };

function fail(message: string): Decision {
  return { outcome: 'chyba', message, effects: [] };
}

export function decideScan(f: ScanFacts): Decision {
  const scan = f.scan;
  switch (scan.kind) {
    case 'empty':
      return fail('Prázdny kód.');
    case 'unknownControl':
      return fail(`Neznámy riadiaci kód ${scan.code}.`);
    case 'worker':
      return decideWorker(f);
    case 'activity':
      return decideActivity(f, scan.activity);
    case 'control':
      return decideControl(f, scan.control);
    case 'deliveryNote':
      return decideDeliveryNote(f, scan.number);
  }
}

function decideWorker(f: ScanFacts): Decision {
  const w = f.worker;
  if (!w) return fail('Neznáma karta zamestnanca.');
  if (!w.active) return fail(`${w.name}: karta je deaktivovaná.`);
  // Keep the activity chosen here before; a new sign-in takes the station's default.
  const activity = f.signedInHere ? (f.activity ?? f.station.defaultActivity) : f.station.defaultActivity;
  const effects: Effect[] = [
    { type: 'signIn', workerId: w.id, stationId: f.station.id, activity },
    { type: 'setStationWorker', stationId: f.station.id, workerId: w.id },
  ];
  const next = activity ? `${ACTIVITY_LABEL[activity]} – pípnite dodací list.` : 'Pípnite činnosť (vychystanie / balenie).';
  const running = f.running ? ` Beží DL ${f.running.dlNumber}${f.running.paused ? ' (pauza)' : ''}.` : '';
  return { outcome: 'ok', message: `Prihlásený: ${w.name}. ${next}${running}`, effects };
}

function decideActivity(f: ScanFacts, activity: Activity): Decision {
  const w = f.worker;
  if (!w) return fail('Najprv pípnite kartu zamestnanca.');
  const effects: Effect[] = [{ type: 'setActivity', workerId: w.id, activity }];
  if (f.running && f.running.activity !== activity) {
    effects.unshift(...endRunning(f.running, f.now, 'zmena_cinnosti'));
    return {
      outcome: 'ok',
      message: `${w.name}: DL ${f.running.dlNumber} ukončený. Činnosť: ${ACTIVITY_LABEL[activity]} – pípnite dodací list.`,
      effects,
    };
  }
  return { outcome: 'ok', message: `${w.name}: ${ACTIVITY_LABEL[activity]} – pípnite dodací list.`, effects };
}

function endRunning(running: RunningFact, at: number, reason: EndReason): Effect[] {
  const effects: Effect[] = [];
  if (running.paused) effects.push({ type: 'endPause', recordId: running.id, at });
  effects.push({ type: 'endRecord', recordId: running.id, at, reason });
  return effects;
}

function decideControl(f: ScanFacts, control: 'KONIEC' | 'PAUZA' | 'POKRAC' | 'ODHLAS'): Decision {
  const w = f.worker;
  if (!w) return fail('Najprv pípnite kartu zamestnanca.');
  const r = f.running;
  switch (control) {
    case 'KONIEC':
      if (!r) return { outcome: 'upozornenie', message: `${w.name}: nemáte rozpracovaný dodací list.`, effects: [] };
      return { outcome: 'ok', message: `${w.name}: DL ${r.dlNumber} ukončený.`, effects: endRunning(r, f.now, 'koniec') };
    case 'PAUZA':
      if (!r) return { outcome: 'upozornenie', message: `${w.name}: nemáte rozpracovaný dodací list.`, effects: [] };
      if (r.paused) return { outcome: 'upozornenie', message: `${w.name}: pauza už beží.`, effects: [] };
      return { outcome: 'ok', message: `${w.name}: pauza. Pokračujte kódom POKRAČOVAŤ.`, effects: [{ type: 'startPause', recordId: r.id, at: f.now }] };
    case 'POKRAC':
      if (!r || !r.paused) return { outcome: 'upozornenie', message: `${w.name}: pauza nebeží.`, effects: [] };
      return { outcome: 'ok', message: `${w.name}: pokračujete na DL ${r.dlNumber}.`, effects: [{ type: 'endPause', recordId: r.id, at: f.now }] };
    case 'ODHLAS': {
      const effects: Effect[] = r ? endRunning(r, f.now, 'odhlas') : [];
      effects.push({ type: 'signOut', workerId: w.id }, { type: 'setStationWorker', stationId: f.station.id, workerId: null });
      const ended = r ? ` DL ${r.dlNumber} ukončený.` : '';
      return { outcome: 'ok', message: `${w.name} odhlásený.${ended}`, effects };
    }
  }
}

function decideDeliveryNote(f: ScanFacts, number: string): Decision {
  const w = f.worker;
  if (!w) return fail('Najprv pípnite kartu zamestnanca.');
  const activity = f.activity;
  if (!activity) return fail(`${w.name}: najprv pípnite činnosť (vychystanie / balenie).`);
  const lookup = f.lookup ?? { status: 'unknown' };
  if (lookup.status === 'unknown') return fail(`Neznámy dodací list ${number}.`);

  const r = f.running;
  if (r && r.dlNumber === number && r.activity === activity) {
    if (f.repeatScanEnds) return { outcome: 'ok', message: `${w.name}: DL ${number} ukončený.`, effects: endRunning(r, f.now, 'koniec') };
    return { outcome: 'upozornenie', message: `${w.name}: DL ${number} už beží.`, effects: [] };
  }

  const others = f.doneByOthers ?? [];
  const doneByYou = f.doneByYou ?? false;
  const duplicate = others.length > 0 || doneByYou;
  const effects: Effect[] = r ? endRunning(r, f.now, 'dalsi_dl') : [];
  effects.push({ type: 'startRecord', workerId: w.id, stationId: f.station.id, activity, dlNumber: number, at: f.now, duplicate });

  const ended = r ? `DL ${r.dlNumber} ukončený. ` : '';
  const started = `${w.name}: ${ended}${ACTIVITY_LABEL[activity]} DL ${number} beží.`;
  if (duplicate) {
    const [sg, pl] = activity === 'VYCH' ? ['vychystal', 'vychystali'] : ['zabalil', 'zabalili'];
    const byOthers = others.length > 0 ? ` Pozor: tento DL už ${sg} ${others.join(', ')}.` : '';
    const byYou = doneByYou ? ` Pozor: tento DL ste už ${pl}.` : '';
    return { outcome: 'upozornenie', message: `${started}${byOthers}${byYou}`, effects };
  }
  if (lookup.status === 'unverified') {
    return { outcome: 'upozornenie', message: `${started} ONIX je nedostupný, údaje DL sa doplnia neskôr.`, effects };
  }
  return { outcome: 'ok', message: started, effects };
}
