/**
 * Backup of SkladPulz's own database: `npm run backup` writes a consistent copy (VACUUM INTO) to
 * `<db dir>/zaloha/skladpulz-YYYY-MM-DD-HHMM.db` while the app keeps running, and keeps the newest `--keep` copies (default 30).
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/db.ts';
import { localDate, localTime } from '../time.ts';

const keepArg = process.argv.find((a) => a.startsWith('--keep='));
const keep = keepArg ? Number(keepArg.slice('--keep='.length)) : 30;
if (!Number.isInteger(keep) || keep < 1) {
  console.error('--keep musí byť kladné celé číslo.');
  process.exit(2);
}

const config = loadConfig();
const dir = join(dirname(config.dbPath), 'zaloha');
mkdirSync(dir, { recursive: true });
const now = Date.now();
const file = join(dir, `skladpulz-${localDate(now, config.timezone)}-${localTime(now, config.timezone).replace(':', '')}.db`);

const db = openDb(config.dbPath);
rmSync(file, { force: true });
db.prepare('VACUUM INTO ?').run(file);
db.close();
console.log(`Záloha uložená: ${file}`);

const old = readdirSync(dir)
  .filter((f) => /^skladpulz-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) {
  rmSync(join(dir, f));
  console.log(`Zmazaná stará záloha: ${f}`);
}
