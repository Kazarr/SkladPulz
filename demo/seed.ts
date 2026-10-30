/**
 * Fills a fresh SkladPulz database with the demo history (demo/data.ts).
 * `seedDemo(db, today, nowMinutes)` is used by demo/server.ts; it never runs against a customer database.
 */
import { buildConfig } from '../src/config.ts';
import { transaction, type Db } from '../src/db/db.ts';
import { suspicionOf } from '../src/domain/record.ts';
import { upsertNote } from '../src/store/delivery-notes.ts';
import { createStation } from '../src/store/stations.ts';
import { createWorker } from '../src/store/workers.ts';
import { history, items, noteUnits, noteWeight, STATIONS, WORKERS, type DemoHistory } from './data.ts';

export function seedDemo(db: Db, today: string, nowMinutes: number, days = 30): DemoHistory {
  const limits = buildConfig().limits;
  const its = items();
  const h = history(today, days, nowMinutes, its);
  transaction(db, () => {
    for (const s of STATIONS) createStation(db, s.name, s.defaultActivity);
    const ids = new Map<string, number>();
    for (const w of WORKERS) ids.set(w.code, createWorker(db, w.name, w.code).id);
    const byNumber = new Map(h.notes.map((n) => [n.number, n]));
    const opened = new Set(h.openNotes.map((n) => n.number));
    for (const n of h.notes) {
      // Today's untouched notes stay in ONIX only: the demo shows them being fetched on the first scan.
      if (opened.has(n.number)) continue;
      upsertNote(
        db,
        { number: n.number, onixIdMaster: n.idMaster, date: n.date, customer: n.customer, state: n.state, type: 'Dodací list', lines: n.lines.length, units: noteUnits(n), weightKg: noteWeight(n, its) },
        Date.now(),
        n.state !== 'Zabalený',
      );
    }
    const insert = db.prepare(
      `INSERT INTO zaznam (zamestnanec_id, cinnost, cislo_dl, stanica_id, zaciatok, koniec, pauza_s, cisty_cas_s,
         pocet_poloziek, pocet_mj, hmotnost_kg, sposob_ukoncenia, stav, podozrenie, duplicita)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    );
    const pause = db.prepare('INSERT INTO pauza (zaznam_id, od, "do") VALUES (?, ?, ?)');
    const seen = new Set<string>();
    for (const r of h.records) {
      const n = byNumber.get(r.note);
      if (!n) continue;
      const net = Math.max(0, Math.round((r.end - r.start) / 1000) - r.pauseSeconds);
      const key = `${r.note}/${r.activity}`;
      const row = insert.get(
        ids.get(r.worker) ?? 0,
        r.activity,
        r.note,
        r.station,
        r.start,
        r.end,
        r.pauseSeconds,
        net,
        n.lines.length,
        noteUnits(n),
        noteWeight(n, its),
        r.method,
        r.status,
        r.status === 'ok' ? suspicionOf(net, limits) : null,
        seen.has(key) ? 1 : 0,
      ) as { id: number };
      seen.add(key);
      if (r.pauseSeconds > 0) {
        const from = r.start + Math.round((r.end - r.start - r.pauseSeconds * 1000) / 2);
        pause.run(row.id, from, from + r.pauseSeconds * 1000);
      }
    }
  });
  return h;
}
