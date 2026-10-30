import type { Activity } from '../config.ts';

export type Control = 'KONIEC' | 'PAUZA' | 'POKRAC' | 'ODHLAS';

export type ScannedCode =
  | { kind: 'empty' }
  | { kind: 'worker'; code: string }
  | { kind: 'activity'; activity: Activity }
  | { kind: 'control'; control: Control }
  | { kind: 'unknownControl'; code: string }
  | { kind: 'deliveryNote'; number: string };

/**
 * Keys a US-layout scanner sends, as a Slovak (QWERTZ) keyboard layout types them.
 * A scanner in keyboard-wedge mode on a PC set to the Slovak layout turns "Z0012" into "Yé++ľ"
 * and "C-KONIEC" into "C=KONIEC". The digits row is the tell: it never appears in a real code.
 */
const SK_DIGITS: Record<string, string> = {
  '+': '1', 'ľ': '2', 'š': '3', 'č': '4', 'ť': '5', 'ž': '6', 'ý': '7', 'á': '8', 'í': '9', 'é': '0',
};
const SK_SWAP: Record<string, string> = { y: 'z', z: 'y', Y: 'Z', Z: 'Y', '=': '-', '-': '/' };
/** A garbled digit anywhere, or a control code whose dash came out as "=". */
const SK_TELL = /[+ľščťžýáíé]|^C=/i;

/** Undoes the Slovak-layout garbling of a scan, when the scan shows it. Other input is only trimmed. */
export function normalizeScan(raw: string): string {
  const trimmed = raw.trim();
  if (!SK_TELL.test(trimmed)) return trimmed;
  let out = '';
  for (const ch of trimmed) out += SK_DIGITS[ch] ?? SK_SWAP[ch] ?? ch;
  return out;
}

const WORKER = /^Z\d{4,}$/;

/** Classifies one normalized scan (#1, section 2): `Z…` worker, `C-…` activity or control, anything else a delivery note. */
export function classifyScan(normalized: string): ScannedCode {
  const code = normalized.trim();
  if (code === '') return { kind: 'empty' };
  const upper = code.toUpperCase();
  if (WORKER.test(upper)) return { kind: 'worker', code: upper };
  if (upper.startsWith('C-')) {
    switch (upper) {
      case 'C-VYCH':
        return { kind: 'activity', activity: 'VYCH' };
      case 'C-BAL':
        return { kind: 'activity', activity: 'BAL' };
      case 'C-KONIEC':
        return { kind: 'control', control: 'KONIEC' };
      case 'C-PAUZA':
        return { kind: 'control', control: 'PAUZA' };
      case 'C-POKRAC':
        return { kind: 'control', control: 'POKRAC' };
      case 'C-ODHLAS':
        return { kind: 'control', control: 'ODHLAS' };
      default:
        return { kind: 'unknownControl', code: upper };
    }
  }
  return { kind: 'deliveryNote', number: code };
}
