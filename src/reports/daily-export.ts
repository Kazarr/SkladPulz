import { ACTIVITY_LABEL } from '../domain/station.ts';
import { END_METHOD_LABEL, STATUS_LABEL, SUSPICION_LABEL, type DailyReport, type SummaryRow } from './daily.ts';
import { addSheet, newWorkbook, workbookBytes, type Column } from './excel.ts';
import type { ReportRecord } from './queries.ts';

interface SummaryLine {
  activity: string;
  row: SummaryRow;
}

const SUMMARY_COLUMNS: Column<SummaryLine>[] = [
  { header: 'Činnosť', kind: 'text', value: (l) => l.activity },
  { header: 'Zamestnanec', kind: 'text', width: 24, value: (l) => l.row.workerName },
  { header: 'DL', kind: 'integer', value: (l) => l.row.notes },
  { header: 'Položky', kind: 'integer', value: (l) => l.row.lines },
  { header: 'Kusy', kind: 'decimal', value: (l) => l.row.units },
  { header: 'Hmotnosť (kg)', kind: 'decimal', value: (l) => l.row.weightKg },
  { header: 'Čistý čas (h:mm:ss)', kind: 'duration', value: (l) => l.row.netSeconds },
  { header: 'DL / hod', kind: 'decimal', value: (l) => l.row.notesPerHour },
  { header: 'Položky / hod', kind: 'decimal', value: (l) => l.row.linesPerHour },
  { header: 'kg / hod', kind: 'decimal', value: (l) => l.row.kgPerHour },
  { header: 'Výkonový index (%)', kind: 'decimal', value: (l) => l.row.index },
  { header: 'Priemerný čas na DL (h:mm:ss)', kind: 'duration', value: (l) => l.row.avgSecondsPerNote },
  { header: 'Priemerný čas na položku (h:mm:ss)', kind: 'duration', value: (l) => l.row.avgSecondsPerLine },
  { header: 'Neukončené (mimo výpočtu)', kind: 'integer', value: (l) => l.row.unfinished },
  { header: 'Podozrivé na kontrolu (mimo výpočtu)', kind: 'integer', value: (l) => l.row.suspect },
];

function flags(r: ReportRecord): string {
  const out: string[] = [];
  if (r.suspicion) out.push(`${SUSPICION_LABEL[r.suspicion]}${r.confirmed ? ' (potvrdený)' : ''}`);
  if (r.duplicate) out.push('duplicita');
  return out.join(', ');
}

const RECORD_COLUMNS: Column<ReportRecord>[] = [
  { header: 'Začiatok', kind: 'datetime', width: 17, value: (r) => r.start },
  { header: 'Koniec', kind: 'datetime', width: 17, value: (r) => r.end },
  { header: 'Zamestnanec', kind: 'text', width: 24, value: (r) => r.workerName },
  { header: 'Činnosť', kind: 'text', value: (r) => ACTIVITY_LABEL[r.activity] },
  { header: 'DL', kind: 'text', width: 18, value: (r) => r.dlNumber },
  { header: 'Položky', kind: 'integer', value: (r) => r.lines },
  { header: 'Kusy', kind: 'decimal', value: (r) => r.units },
  { header: 'Hmotnosť (kg)', kind: 'decimal', value: (r) => r.weightKg },
  { header: 'Čistý čas (h:mm:ss)', kind: 'duration', value: (r) => r.netSeconds },
  { header: 'Pauza (h:mm:ss)', kind: 'duration', value: (r) => r.pauseSeconds },
  { header: 'Ukončenie', kind: 'text', value: (r) => (r.endMethod ? END_METHOD_LABEL[r.endMethod] : null) },
  { header: 'Stav', kind: 'text', value: (r) => STATUS_LABEL[r.status] },
  { header: 'Označenie', kind: 'text', value: flags },
];

/** The day report as a workbook: sheet "Súhrn" (counted records, team total per activity) and sheet "Záznamy" (the filtered list). */
export function dailyWorkbookBytes(report: DailyReport, tz: string): Promise<Uint8Array> {
  const wb = newWorkbook();
  const lines: SummaryLine[] = report.sections.flatMap((s) => [...s.rows, s.total].map((row) => ({ activity: ACTIVITY_LABEL[s.activity], row })));
  addSheet(wb, 'Súhrn', tz, SUMMARY_COLUMNS, lines);
  addSheet(wb, 'Záznamy', tz, RECORD_COLUMNS, report.records);
  return workbookBytes(wb);
}
