import { ACTIVITIES, type Activity } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { EndMethod, RecordStatus } from '../store/records.ts';
import { listCountedDayRecords, listDayRecords, type ReportRecord } from './queries.ts';
import { performanceIndex, type WeightsByActivity } from '../domain/index.ts';
import { totalsByWorkerAndActivity, totalsOf, type Totals } from './metrics.ts';

export type StatusFilter = RecordStatus | 'kontrola';

export interface ReportFilter {
  workerId: number | null;
  activity: Activity | null;
  /** `kontrola` = records waiting for a manager: unfinished or suspect and not confirmed. */
  status: StatusFilter | null;
}

export interface SummaryRow extends Totals {
  workerName: string;
  /** Performance index in percent against the whole team of that day and activity; null without net time. */
  index: number | null;
  /** Records excluded from the figures: closed automatically at shift end. */
  unfinished: number;
  /** Records excluded from the figures: suspect, not yet confirmed. */
  suspect: number;
}

export interface DailySection {
  activity: Activity;
  rows: SummaryRow[];
  total: SummaryRow;
}

export interface DailyReport {
  date: string;
  filter: ReportFilter;
  sections: DailySection[];
  records: ReportRecord[];
}

export const STATUS_LABEL: Record<RecordStatus, string> = {
  bezi: 'beží',
  ok: 'ok',
  neukoncene: 'neukončený',
  opravene: 'opravený',
  vylucene: 'vylúčený',
};

export const END_METHOD_LABEL: Record<EndMethod, string> = {
  dalsi_dl: 'ďalší DL',
  koniec: 'koniec',
  odhlas: 'odhlásenie',
  zmena_cinnosti: 'zmena činnosti',
  koniec_zmeny: 'koniec zmeny',
  oprava: 'oprava vedúcim',
};

export const SUSPICION_LABEL = { kratky: 'krátky', dlhy: 'dlhý' } as const;

/** A suspect record that no manager has confirmed or excluded yet. */
export function isSuspectUnconfirmed(r: ReportRecord): boolean {
  return r.suspicion !== null && !r.confirmed && (r.status === 'ok' || r.status === 'opravene');
}

export function needsReview(r: ReportRecord): boolean {
  return r.status === 'neukoncene' || isSuspectUnconfirmed(r);
}

export interface RecordTag {
  label: string;
  kind: 'err' | 'warn' | 'ok';
}

/** Why a record is flagged. */
export function recordTags(r: ReportRecord): RecordTag[] {
  const tags: RecordTag[] = [];
  if (r.status === 'neukoncene') tags.push({ label: 'neukončený', kind: 'err' });
  if (r.suspicion) tags.push({ label: SUSPICION_LABEL[r.suspicion], kind: r.confirmed ? 'ok' : 'warn' });
  if (r.duplicate) tags.push({ label: 'duplicita', kind: 'warn' });
  return tags;
}

/** CSS class of a record's table row. */
export function recordRowClass(r: ReportRecord): 'err' | 'warn' | '' {
  if (r.status === 'neukoncene') return 'err';
  return isSuspectUnconfirmed(r) || r.duplicate ? 'warn' : '';
}

function matchesStatus(r: ReportRecord, status: StatusFilter | null): boolean {
  if (status === null) return true;
  return status === 'kontrola' ? needsReview(r) : r.status === status;
}

export function buildDailyReport(db: Db, tz: string, date: string, filter: ReportFilter, weights: WeightsByActivity): DailyReport {
  const all = listDayRecords(db, tz, date, filter);
  // The index is relative to the whole team, also when the list is filtered to one worker.
  const team = listCountedDayRecords(db, tz, date, { workerId: null, activity: filter.activity });
  const counted = filter.workerId === null ? team : team.filter((r) => r.workerId === filter.workerId);
  const teamAll = filter.workerId === null ? all : listDayRecords(db, tz, date, { workerId: null, activity: filter.activity });
  const names = new Map(all.map((r) => [r.workerId, r.workerName]));
  const sections: DailySection[] = [];
  for (const activity of ACTIVITIES) {
    const mine = all.filter((r) => r.activity === activity);
    if (mine.length === 0) continue;
    const countedHere = counted.filter((r) => r.activity === activity);
    const teamHere = team.filter((r) => r.activity === activity);
    const w = weights[activity];
    const workerIds = [...new Set(mine.map((r) => r.workerId))];
    const rows = workerIds.map((workerId): SummaryRow => {
      const ownCounted = countedHere.filter((r) => r.workerId === workerId);
      const totals = totalsByWorkerAndActivity(ownCounted)[0] ?? totalsOf([]);
      const theirs = mine.filter((r) => r.workerId === workerId);
      return {
        ...totals,
        index: performanceIndex(w, ownCounted, teamHere),
        workerName: names.get(workerId) ?? '',
        unfinished: theirs.filter((r) => r.status === 'neukoncene').length,
        suspect: theirs.filter(isSuspectUnconfirmed).length,
      };
    });
    rows.sort((a, b) => a.workerName.localeCompare(b.workerName, 'sk'));
    const total: SummaryRow = {
      // The whole team, also when the list is filtered to one worker.
      ...totalsOf(teamHere),
      index: performanceIndex(w, teamHere, teamHere),
      workerName: 'Tím spolu',
      unfinished: teamAll.filter((r) => r.activity === activity && r.status === 'neukoncene').length,
      suspect: teamAll.filter((r) => r.activity === activity && isSuspectUnconfirmed(r)).length,
    };
    sections.push({ activity, rows, total });
  }
  return { date, filter, sections, records: all.filter((r) => matchesStatus(r, filter.status)) };
}
