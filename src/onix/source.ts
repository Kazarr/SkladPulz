import type { DeliveryNote } from '../store/delivery-notes.ts';

/**
 * Where delivery notes come from. Production reads ONIX (src/onix/pg-source.ts, #3); tests and the demo use fakes.
 * Implementations only read; SkladPulz never writes to ONIX.
 */
export interface DeliveryNoteSource {
  /** Every delivery note that is active now. Throws when ONIX cannot be reached. */
  fetchActive(): Promise<DeliveryNote[]>;
  /** One note by its full number regardless of state, or null when ONIX has none. Throws when ONIX cannot be reached. */
  fetchByNumber(number: string): Promise<DeliveryNote | null>;
}

/** Rejects when `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
