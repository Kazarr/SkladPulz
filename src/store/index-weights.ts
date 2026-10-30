import { ACTIVITIES, type Activity } from '../config.ts';
import type { Db } from '../db/db.ts';
import { DEFAULT_WEIGHTS, type Weights, type WeightsByActivity } from '../domain/index.ts';

export interface StoredWeights {
  weights: Weights;
  /** Null together with `changedAt` while the placeholder defaults apply. */
  changedBy: string | null;
  changedAt: number | null;
}

interface Row {
  cinnost: Activity;
  pevny_cas_s: number;
  cas_na_polozku_s: number;
  cas_na_kg_s: number;
  zmenil: string | null;
  zmenene: number;
}

export function loadIndexWeights(db: Db): Record<Activity, StoredWeights> {
  const rows = db.prepare('SELECT * FROM vahy_indexu').all() as unknown as Row[];
  const out = {} as Record<Activity, StoredWeights>;
  for (const a of ACTIVITIES) {
    const r = rows.find((x) => x.cinnost === a);
    out[a] = r
      ? { weights: { fixedSeconds: r.pevny_cas_s, perLineSeconds: r.cas_na_polozku_s, perKgSeconds: r.cas_na_kg_s }, changedBy: r.zmenil, changedAt: r.zmenene }
      : { weights: DEFAULT_WEIGHTS[a], changedBy: null, changedAt: null };
  }
  return out;
}

export function getIndexWeights(db: Db): WeightsByActivity {
  const all = loadIndexWeights(db);
  return { VYCH: all.VYCH.weights, BAL: all.BAL.weights };
}

export function saveIndexWeights(db: Db, activity: Activity, w: Weights, changedBy: string | null, now: number): void {
  db.prepare(
    `INSERT INTO vahy_indexu (cinnost, pevny_cas_s, cas_na_polozku_s, cas_na_kg_s, zmenil, zmenene) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (cinnost) DO UPDATE SET pevny_cas_s = excluded.pevny_cas_s, cas_na_polozku_s = excluded.cas_na_polozku_s,
       cas_na_kg_s = excluded.cas_na_kg_s, zmenil = excluded.zmenil, zmenene = excluded.zmenene`,
  ).run(activity, w.fixedSeconds, w.perLineSeconds, w.perKgSeconds, changedBy, now);
}
