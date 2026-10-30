import type { Activity, Config } from '../config.ts';
import { transaction, type Db } from '../db/db.ts';
import { classifyScan, normalizeScan, type ScannedCode } from '../domain/scan-code.ts';
import { decideScan, type DeliveryNoteLookup, type Effect, type Outcome } from '../domain/station.ts';
import { withTimeout, type DeliveryNoteSource } from '../onix/source.ts';
import { getNote, upsertNote } from '../store/delivery-notes.ts';
import { endPause, endRecord, getRunningRecord, listPauses, priorWorkOnNote, startPause, startRecord } from '../store/records.ts';
import { logScan } from '../store/scan-log.ts';
import { getSignIn, getStation, listSignInsAt, setActivity, setStationWorker, signIn, signOut } from '../store/stations.ts';
import { findWorkerByCode, getWorker } from '../store/workers.ts';
import { pausedSeconds } from '../domain/record.ts';

export interface ScanDeps {
  db: Db;
  config: Config;
  source: DeliveryNoteSource | null;
  now: () => number;
  logError: (message: string, error: unknown) => void;
}

export interface RunningView {
  recordId: number;
  dlNumber: string;
  activity: Activity;
  customer: string | null;
  lines: number | null;
  weightKg: number | null;
  start: number;
  /** Seconds paused so far, open pause included up to `asOf`. */
  pausedSeconds: number;
  pausedSince: number | null;
}

export interface WorkerView {
  workerId: number;
  name: string;
  activity: Activity | null;
  running: RunningView | null;
}

export interface StationView {
  stationId: number;
  stationName: string;
  defaultActivity: Activity | null;
  asOf: number;
  current: WorkerView | null;
  /** Other workers signed in at this station, whose records keep running. */
  others: WorkerView[];
}

export interface ScanResult {
  outcome: Outcome;
  message: string;
  view: StationView;
}

export class UnknownStationError extends Error {}

async function lookupNote(deps: ScanDeps, number: string): Promise<DeliveryNoteLookup> {
  const cached = getNote(deps.db, number);
  if (cached) return { status: 'found', note: { number, customer: cached.customer, lines: cached.lines, weightKg: cached.weightKg } };
  if (!deps.source) return { status: 'unknown' };
  try {
    const fetched = await withTimeout(deps.source.fetchByNumber(number), deps.config.onix.timeoutMs, `ONIX lookup of ${number}`);
    if (!fetched) return { status: 'unknown' };
    upsertNote(deps.db, fetched, deps.now(), false);
    return { status: 'found', note: { number, customer: fetched.customer, lines: fetched.lines, weightKg: fetched.weightKg } };
  } catch (e) {
    deps.logError(`ONIX lookup of delivery note ${number} failed; the record starts unverified`, e);
    return { status: 'unverified' };
  }
}

function applyEffect(deps: ScanDeps, e: Effect): void {
  const { db, config } = deps;
  switch (e.type) {
    case 'signIn':
      signIn(db, e.workerId, e.stationId, e.activity, deps.now());
      return;
    case 'setActivity':
      setActivity(db, e.workerId, e.activity);
      return;
    case 'signOut':
      signOut(db, e.workerId);
      return;
    case 'setStationWorker':
      setStationWorker(db, e.stationId, e.workerId);
      return;
    case 'endRecord':
      endRecord(db, e.recordId, { at: e.at, method: e.reason, status: 'ok', limits: config.limits });
      return;
    case 'startRecord':
      startRecord(db, { workerId: e.workerId, stationId: e.stationId, activity: e.activity, dlNumber: e.dlNumber, at: e.at, duplicate: e.duplicate });
      return;
    case 'startPause':
      startPause(db, e.recordId, e.at);
      return;
    case 'endPause':
      endPause(db, e.recordId, e.at);
      return;
  }
}

/** Handles one scan at a station: decides, applies the effects in one transaction, logs it, and returns the new station view. */
export async function handleScan(deps: ScanDeps, stationId: number, raw: string): Promise<ScanResult> {
  const { db } = deps;
  if (!getStation(db, stationId)) throw new UnknownStationError(`Stanica ${stationId} neexistuje.`);
  const normalized = normalizeScan(raw);
  const scan: ScannedCode = classifyScan(normalized);

  // The only async step comes first, so the facts read below cannot go stale before the effects are applied.
  let lookup: DeliveryNoteLookup | undefined;
  if (scan.kind === 'deliveryNote') {
    const station = getStation(db, stationId);
    const current = station?.currentWorkerId ?? null;
    const activity = current === null ? null : (getSignIn(db, current)?.activity ?? null);
    if (current !== null && activity !== null) lookup = await lookupNote(deps, scan.number);
  }

  return transaction(db, () => {
    const now = deps.now();
    const station = getStation(db, stationId);
    if (!station) throw new UnknownStationError(`Stanica ${stationId} neexistuje.`);
    const worker = scan.kind === 'worker' ? findWorkerByCode(db, scan.code) : station.currentWorkerId === null ? null : getWorker(db, station.currentWorkerId);
    const signIn = worker ? getSignIn(db, worker.id) : null;
    const running = worker ? getRunningRecord(db, worker.id) : null;
    const activity = signIn?.activity ?? null;
    const decision = decideScan({
      now,
      station: { id: station.id, defaultActivity: station.defaultActivity },
      scan,
      worker: worker ? { id: worker.id, name: worker.name, active: worker.active } : null,
      activity,
      signedInHere: signIn?.stationId === station.id,
      running: running ? { id: running.id, activity: running.activity, dlNumber: running.dlNumber, paused: running.paused } : null,
      ...(scan.kind === 'deliveryNote' && worker && activity
        ? (({ others, own }) => ({ lookup, doneByOthers: others, doneByYou: own }))(priorWorkOnNote(db, scan.number, activity, worker.id))
        : {}),
      repeatScanEnds: deps.config.repeatScanEnds,
    });
    for (const e of decision.effects) applyEffect(deps, e);
    logScan(db, {
      at: now,
      stationId: station.id,
      raw,
      code: normalized,
      outcome: decision.outcome,
      message: decision.message,
      workerId: worker?.id ?? null,
    });
    return { outcome: decision.outcome, message: decision.message, view: stationView(db, station.id, now) };
  });
}

function workerView(db: Db, workerId: number, activity: Activity | null, asOf: number): WorkerView | null {
  const w = getWorker(db, workerId);
  if (!w) return null;
  const r = getRunningRecord(db, workerId);
  let running: RunningView | null = null;
  if (r) {
    const pauses = listPauses(db, r.id);
    const open = pauses.find((p) => p.to === null);
    const note = getNote(db, r.dlNumber);
    running = {
      recordId: r.id,
      dlNumber: r.dlNumber,
      activity: r.activity,
      customer: note?.customer ?? null,
      lines: note?.lines ?? null,
      weightKg: note?.weightKg ?? null,
      start: r.start,
      pausedSeconds: pausedSeconds(pauses, r.start, asOf),
      pausedSince: open ? open.from : null,
    };
  }
  return { workerId, name: w.name, activity, running };
}

/** What a station screen shows: its current worker, and the others signed in there. */
export function stationView(db: Db, stationId: number, asOf: number): StationView {
  const station = getStation(db, stationId);
  if (!station) throw new UnknownStationError(`Stanica ${stationId} neexistuje.`);
  const signIns = listSignInsAt(db, stationId);
  const currentSignIn = signIns.find((s) => s.workerId === station.currentWorkerId);
  const current = station.currentWorkerId === null ? null : workerView(db, station.currentWorkerId, currentSignIn?.activity ?? null, asOf);
  const others = signIns
    .filter((s) => s.workerId !== station.currentWorkerId)
    .map((s) => workerView(db, s.workerId, s.activity, asOf))
    .filter((v): v is WorkerView => v !== null);
  return { stationId, stationName: station.name, defaultActivity: station.defaultActivity, asOf, current, others };
}
