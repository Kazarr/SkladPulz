/**
 * Health check of the ONIX connection (#3): `npm run onix:check`. Reads only.
 * Prints how many delivery notes are active under the configured filters and how many of them have no weight
 * (open question in #1: the share of stock cards without a weight). Exits non-zero when ONIX cannot be read.
 */
import { loadConfig } from '../config.ts';
import { createOnixSource, pgQuery } from '../onix/onix-source.ts';

const config = loadConfig();
if (!config.onix.connectionString) {
  console.error('onix.connectionString je prázdny: ONIX nie je nastavený.');
  process.exit(1);
}

const query = pgQuery(config.onix.connectionString, config.onix.timeoutMs);
const skipped: string[] = [];
let exitCode = 0;
try {
  const notes = await createOnixSource(query, config.onix, { onBadRow: (p) => skipped.push(p) }).fetchActive();
  const withoutWeight = notes.filter((n) => !n.weightKg).length;
  console.log(`ONIX je dostupný. Aktívnych DL: ${notes.length}, z toho bez hmotnosti: ${withoutWeight}.`);
  if (skipped.length > 0) {
    console.error(`Preskočené riadky s chybným tvarom: ${skipped.length}`);
    for (const p of skipped.slice(0, 5)) console.error(`  ${p}`);
    exitCode = 1;
  }
  if (notes.length === 0) {
    console.error('Žiadny aktívny DL: skontrolujte onix.activeStates, onix.documentTypes a onix.daysBack. Synchronizácia by prázdny zoznam ignorovala.');
    exitCode = 1;
  }
} catch (e) {
  console.error(`ONIX sa nepodarilo prečítať: ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 1;
} finally {
  await query.close().catch(() => {});
}
process.exit(exitCode);
