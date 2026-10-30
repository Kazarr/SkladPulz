import { ACTIVITY_LABEL } from '../domain/station.ts';
import { BAND_LABEL, orderRows, rankOf, type Comparison, type ComparisonRow, type ComparisonView } from './comparison.ts';
import { addSheet, newWorkbook, workbookBytes, type Column } from './excel.ts';
import { periodLabel } from './period.ts';

interface Line {
  row: ComparisonRow;
  rank: number | null;
}

/** The comparison table of the page as a workbook: one sheet "Porovnanie", team row last. */
export function comparisonWorkbookBytes(c: Comparison, view: ComparisonView, tz: string): Promise<Uint8Array> {
  const ordered = orderRows(c.rows, view);
  const lines: Line[] = [...ordered, c.team].map((row) => ({ row, rank: row === c.team ? null : rankOf(c.rows, row) }));
  const first: Column<Line> =
    view === 'pasma'
      ? { header: 'Pásmo', kind: 'text', width: 14, value: (l) => (l.row.band ? BAND_LABEL[l.row.band] : null) }
      : { header: 'Poradie', kind: 'integer', width: 9, value: (l) => l.rank };
  const columns: Column<Line>[] = [
    { header: 'Obdobie', kind: 'text', width: 26, value: () => periodLabel(c.period) },
    { header: 'Činnosť', kind: 'text', value: () => ACTIVITY_LABEL[c.activity] },
    first,
    { header: 'Zamestnanec', kind: 'text', width: 24, value: (l) => l.row.workerName },
    { header: 'DL', kind: 'integer', value: (l) => l.row.notes },
    { header: 'Položky', kind: 'integer', value: (l) => l.row.lines },
    { header: 'Hmotnosť (kg)', kind: 'decimal', value: (l) => l.row.weightKg },
    { header: 'Čistý čas (h:mm:ss)', kind: 'duration', value: (l) => l.row.netSeconds },
    { header: 'DL / hod', kind: 'decimal', value: (l) => l.row.notesPerHour },
    { header: 'Položky / hod', kind: 'decimal', value: (l) => l.row.linesPerHour },
    { header: 'kg / hod', kind: 'decimal', value: (l) => l.row.kgPerHour },
    { header: 'Priemerný čas na DL (h:mm:ss)', kind: 'duration', value: (l) => l.row.avgSecondsPerNote },
    { header: 'Priemerný čas na položku (h:mm:ss)', kind: 'duration', value: (l) => l.row.avgSecondsPerLine },
    { header: 'Index (%)', kind: 'decimal', value: (l) => l.row.index },
    { header: 'Odchýlka položiek / hod (%)', kind: 'decimal', value: (l) => l.row.linesPerHourDeviation },
    { header: 'Odchýlka indexu (%)', kind: 'decimal', value: (l) => l.row.indexDeviation },
    { header: 'Trend položiek / hod (%)', kind: 'decimal', value: (l) => l.row.linesPerHourTrend },
    { header: 'Trend indexu (%)', kind: 'decimal', value: (l) => l.row.indexTrend },
    { header: 'Neukončené (mimo výpočtu)', kind: 'integer', value: (l) => l.row.unfinished },
    { header: 'Podozrivé na kontrolu (mimo výpočtu)', kind: 'integer', value: (l) => l.row.suspect },
    { header: 'Vylúčené (mimo výpočtu)', kind: 'integer', value: (l) => l.row.excluded },
  ];
  const wb = newWorkbook();
  addSheet(wb, 'Porovnanie', tz, columns, lines);
  return workbookBytes(wb);
}
