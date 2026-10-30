import { readFileSync, existsSync } from 'node:fs';
import { isPasswordHash } from './auth.ts';

export type Activity = 'VYCH' | 'BAL';
export const ACTIVITIES: readonly Activity[] = ['VYCH', 'BAL'];

export interface Shift {
  /** Display name, e.g. "Ranná". */
  name: string;
  /** Local start time "HH:MM". */
  from: string;
  /** Local end time "HH:MM"; earlier than `from` means the shift ends the next day. */
  to: string;
}

export interface OnixConfig {
  /** PostgreSQL connection string of the read-only ONIX user. Empty: ONIX is not connected. */
  connectionString: string;
  /** How often the active delivery notes are synchronised, in minutes (1–5 in the analysis). */
  syncIntervalMin: number;
  /** Name of the view or table that lists delivery notes (see docs/onix-view.sql). */
  view: string;
  /** States (document_states.name) that make a delivery note active. Empty: every state. Customer question. */
  activeStates: string[];
  /** Document type names to follow. Empty: every type. Customer question. */
  documentTypes: string[];
  /** Only notes dated at most this many days back are synchronised. */
  daysBack: number;
  /** Connect and query timeout in milliseconds, so a dead ONIX never stalls a station. */
  timeoutMs: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface ManagerAccount {
  /** Login name, also written into the correction log. */
  name: string;
  /** scrypt hash created with `node src/tools/hash-password.ts`. */
  passwordHash: string;
}

export interface Config {
  port: number;
  /** Path of the SQLite file of SkladPulz's own measurements. */
  dbPath: string;
  timezone: string;
  shifts: Shift[];
  limits: {
    /** Records with a net time below this many seconds are suspect (default 20). */
    shortSeconds: number;
    /** Records with a net time above this many seconds are suspect. */
    longSeconds: number;
  };
  /** A record running past its shift end is closed this many minutes later (ending at the shift end), so a worker can finish the last note. */
  autoCloseGraceMin: number;
  /** Scanning the running delivery note again ends its record. Open question in #1; off until the customer decides. */
  repeatScanEnds: boolean;
  onix: OnixConfig;
  email: {
    enabled: boolean;
    recipients: string[];
    attachExcel: boolean;
    /** Minutes after the end of the last shift of the day when the summary is sent. */
    delayMin: number;
    smtp: SmtpConfig;
  };
  managers: ManagerAccount[];
  /** Secret that signs the manager's session cookie. */
  sessionSecret: string;
  /** Public base URL used in e-mails, e.g. http://sklad-server:3000 */
  baseUrl: string;
}

export const DEFAULT_CONFIG: Config = {
  port: 3000,
  dbPath: 'data/skladpulz.db',
  timezone: 'Europe/Bratislava',
  shifts: [
    { name: 'Ranná', from: '06:00', to: '14:00' },
    { name: 'Poobedná', from: '14:00', to: '22:00' },
  ],
  limits: { shortSeconds: 20, longSeconds: 2 * 60 * 60 },
  autoCloseGraceMin: 30,
  repeatScanEnds: false,
  onix: {
    connectionString: '',
    syncIntervalMin: 2,
    view: 'skl_aktivne_dl',
    activeStates: [],
    documentTypes: [],
    daysBack: 30,
    timeoutMs: 5000,
  },
  email: {
    enabled: false,
    recipients: [],
    attachExcel: true,
    delayMin: 15,
    smtp: { host: '', port: 587, secure: false, user: '', password: '', from: 'SkladPulz <skladpulz@localhost>' },
  },
  managers: [],
  sessionSecret: '',
  baseUrl: 'http://localhost:3000',
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = k in out ? merge(out[k], v) : v;
  }
  return out as T;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Returns every problem of the configuration in Slovak, empty when it is usable. */
export function validateConfig(c: Config): string[] {
  const errors: string[] = [];
  for (const s of c.shifts) {
    if (!HHMM.test(s.from) || !HHMM.test(s.to)) errors.push(`Zmena „${s.name}“: čas musí byť v tvare HH:MM.`);
    if (s.from === s.to) errors.push(`Zmena „${s.name}“: začiatok a koniec sú rovnaké.`);
  }
  if (!(c.limits.shortSeconds >= 0)) errors.push('limits.shortSeconds musí byť nezáporné číslo.');
  if (!(c.limits.longSeconds > c.limits.shortSeconds)) errors.push('limits.longSeconds musí byť väčšie ako limits.shortSeconds.');
  if (!(c.autoCloseGraceMin >= 0)) errors.push('autoCloseGraceMin musí byť nezáporné číslo.');
  if (!(c.onix.syncIntervalMin >= 1)) errors.push('onix.syncIntervalMin musí byť aspoň 1.');
  for (const m of c.managers) {
    if (!isPasswordHash(m.passwordHash)) errors.push(`Vedúci „${m.name}“: passwordHash nie je platný hash (vytvorte ho príkazom npm run hash-password).`);
  }
  if (c.managers.length > 0 && c.sessionSecret.length < 32) errors.push('sessionSecret musí mať aspoň 32 znakov, kým sú nastavení vedúci.');
  try {
    new Intl.DateTimeFormat('sk-SK', { timeZone: c.timezone });
  } catch {
    errors.push(`Neznáme časové pásmo „${c.timezone}“.`);
  }
  return errors;
}

export function buildConfig(over: DeepPartial<Config> = {}): Config {
  return merge(DEFAULT_CONFIG, over);
}

/** Reads `config.json` (or the file in SKLADPULZ_CONFIG) over the defaults and validates it. */
export function loadConfig(path = process.env['SKLADPULZ_CONFIG'] ?? 'config.json'): Config {
  const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const config = merge(DEFAULT_CONFIG, raw);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(`Chybná konfigurácia (${path}):\n- ${errors.join('\n- ')}`);
  return config;
}
