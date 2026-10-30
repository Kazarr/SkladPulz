import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashes of the managers in `config.json` (`managers[].passwordHash`).
 *
 * Format: `scrypt$<N>$<r>$<p>$<salt, base64>$<key, base64>`, e.g. `scrypt$16384$8$1$c2FsdA==$...`.
 * The cost parameters travel with the hash, so they can be raised later without invalidating existing hashes.
 * Create one with `npm run hash-password` (src/tools/hash-password.ts).
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

interface Parsed {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const key = Buffer.from(parts[5] ?? '', 'base64');
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || n < 2 || (n & (n - 1)) !== 0 || salt.length === 0 || key.length === 0) return null;
  return { n, r, p, salt, key };
}

function derive(password: string, h: { n: number; r: number; p: number; salt: Buffer }, length: number): Buffer {
  return scryptSync(password, h.salt, length, { N: h.n, r: h.r, p: h.p, maxmem: 256 * h.n * h.r });
}

export function hashPassword(password: string): string {
  const h = { n: N, r: R, p: P, salt: randomBytes(16) };
  return `scrypt$${N}$${R}$${P}$${h.salt.toString('base64')}$${derive(password, h, KEY_LENGTH).toString('base64')}`;
}

export function isPasswordHash(stored: string): boolean {
  return parse(stored) !== null;
}

export function verifyPassword(password: string, stored: string): boolean {
  const h = parse(stored);
  if (!h) return false;
  return timingSafeEqual(derive(password, h, h.key.length), h.key);
}
