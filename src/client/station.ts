/** Scan station screen (#4). The scanner types the code and Enter into the always-focused input. */
export {};

type Activity = 'VYCH' | 'BAL';
type Outcome = 'ok' | 'upozornenie' | 'chyba';

interface RunningView {
  dlNumber: string;
  activity: Activity;
  customer: string | null;
  lines: number | null;
  weightKg: number | null;
  start: number;
  pausedSeconds: number;
  pausedSince: number | null;
}

interface WorkerView {
  name: string;
  activity: Activity | null;
  running: RunningView | null;
}

interface StationView {
  asOf: number;
  current: WorkerView | null;
  others: WorkerView[];
}

interface ScanResult {
  outcome: Outcome;
  message: string;
  view: StationView;
}

const LABEL: Record<Activity, string> = { VYCH: 'Vychystanie', BAL: 'Balenie' };
const POLL_MS = 5000;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

const stationId = document.body.dataset['station'] ?? '';
const input = el<HTMLInputElement>('scan');
const form = el<HTMLFormElement>('scan-form');
const status = el<HTMLElement>('status');
const message = el<HTMLElement>('message');

let view: StationView | null = null;
/** Server clock minus browser clock, so timers follow the server. */
let clockSkew = 0;
let busy = false;
const queue: string[] = [];

// --- sound -----------------------------------------------------------------
let audio: AudioContext | null = null;

function beep(outcome: Outcome): void {
  try {
    audio ??= new AudioContext();
    const tones: Record<Outcome, [number, number][]> = {
      ok: [[1320, 0.09]],
      upozornenie: [[880, 0.12], [880, 0.12]],
      chyba: [[220, 0.45]],
    };
    let t = audio.currentTime;
    for (const [freq, dur] of tones[outcome]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = outcome === 'chyba' ? 'square' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.06;
    }
  } catch {
    // No audio device: the colour still tells the result.
  }
}

// --- rendering -------------------------------------------------------------
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function netSeconds(r: RunningView, serverNow: number, asOf: number): number {
  const openPause = r.pausedSince === null ? 0 : (serverNow - asOf) / 1000;
  return (serverNow - r.start) / 1000 - r.pausedSeconds - openPause;
}

function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString('sk-SK', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function render(): void {
  const cur = view?.current ?? null;
  el('worker').textContent = cur ? cur.name : '—';
  const act = el('activity');
  act.textContent = cur?.activity ? LABEL[cur.activity] : cur ? 'Pípnite činnosť' : '';
  act.className = `activity ${cur?.activity ?? ''}`;
  const r = cur?.running ?? null;
  el('note').classList.toggle('hidden', !r);
  el('timer').classList.toggle('hidden', !r);
  if (r) {
    el('dl').textContent = r.dlNumber;
    el('customer').textContent = r.customer ?? 'Údaje DL sa načítavajú z ONIXu…';
    el('lines').textContent = r.lines === null ? '' : `${fmtNumber(r.lines)} položiek`;
    el('weight').textContent = r.weightKg === null ? '' : `${fmtNumber(r.weightKg, 1)} kg`;
  }
  const others = el('others');
  others.replaceChildren(
    ...(view?.others ?? []).map((w) => {
      const div = document.createElement('div');
      div.className = 'other';
      div.dataset['start'] = String(w.running?.start ?? '');
      const name = document.createElement('strong');
      name.textContent = w.name;
      const what = document.createElement('span');
      what.textContent = w.running ? ` ${LABEL[w.running.activity]} DL ${w.running.dlNumber}${w.running.pausedSince ? ' · pauza' : ''}` : ' bez rozpracovaného DL';
      div.append(name, what);
      return div;
    }),
  );
  tick();
}

function tick(): void {
  const serverNow = Date.now() + clockSkew;
  const d = new Date(serverNow);
  el('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const r = view?.current?.running ?? null;
  const timer = el('timer');
  if (r && view) {
    timer.textContent = duration(netSeconds(r, serverNow, view.asOf));
    timer.classList.toggle('paused', r.pausedSince !== null);
  }
}

function setView(v: StationView): void {
  view = v;
  clockSkew = v.asOf - Date.now();
  render();
}

function show(outcome: Outcome | 'idle', text: string): void {
  status.className = `status ${outcome}`;
  message.textContent = text;
  // Restart the flash animation on every scan, even with the same outcome.
  void status.offsetWidth;
  status.classList.add('flash');
}

// --- server ----------------------------------------------------------------
async function send(code: string): Promise<void> {
  try {
    const res = await fetch(`/api/stanica/${stationId}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kod: code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      show('chyba', body.error ?? `Chyba servera (${res.status}).`);
      beep('chyba');
      return;
    }
    const result = (await res.json()) as ScanResult;
    setView(result.view);
    show(result.outcome, result.message);
    beep(result.outcome);
  } catch {
    show('chyba', 'Server neodpovedá. Skontrolujte sieť a pípnite znova.');
    beep('chyba');
  }
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let code = queue.shift(); code !== undefined; code = queue.shift()) await send(code);
  } finally {
    busy = false;
  }
}

async function poll(): Promise<void> {
  if (busy) return;
  try {
    const res = await fetch(`/api/stanica/${stationId}/stav`);
    if (res.ok) setView((await res.json()) as StationView);
  } catch {
    // Next poll tries again; a scan reports the outage.
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = input.value;
  input.value = '';
  if (code.trim() === '') return;
  queue.push(code);
  void drain();
});

// The scanner types into whatever has focus: keep it on the input.
function refocus(): void {
  if (document.activeElement !== input) input.focus();
}
input.addEventListener('blur', () => setTimeout(refocus, 0));
document.addEventListener('click', refocus);
document.addEventListener('visibilitychange', refocus);

setInterval(tick, 1000);
setInterval(() => void poll(), POLL_MS);
void poll();
refocus();
