import ExcelJS from 'exceljs';
import { localParts } from '../time.ts';

/** Small helper for report workbooks: a sheet from column definitions and rows. Used by the day report (#7), the comparison (#9) and the e-mail (#12). */

export type CellKind = 'text' | 'integer' | 'decimal' | 'duration' | 'datetime' | 'date';

export interface Column<T> {
  header: string;
  kind: CellKind;
  width?: number;
  /** text: string; integer/decimal: number; duration: seconds; datetime/date: epoch ms. null leaves the cell empty. */
  value: (row: T) => string | number | null;
}

const NUMBER_FORMAT: Record<CellKind, string | undefined> = {
  text: undefined,
  integer: '0',
  decimal: '0.00',
  duration: '[h]:mm:ss',
  datetime: 'd.m.yyyy hh:mm',
  date: 'd.m.yyyy',
};

/** Excel has no time zones: a date is stored as the wall-clock time shown in `tz`, written as if it were UTC. */
export function localWallClock(ms: number, tz: string): Date {
  const p = localParts(ms, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

function cellValue(kind: CellKind, v: string | number | null, tz: string): ExcelJS.CellValue {
  if (v === null) return null;
  if (kind === 'duration') return Number(v) / 86400;
  if (kind === 'datetime' || kind === 'date') return localWallClock(Number(v), tz);
  return v;
}

export function addSheet<T>(wb: ExcelJS.Workbook, name: string, tz: string, columns: readonly Column<T>[], rows: readonly T[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => {
    const format = NUMBER_FORMAT[c.kind];
    return { header: c.header, width: c.width ?? Math.max(12, c.header.length + 3), ...(format ? { style: { numFmt: format } } : {}) };
  });
  for (const row of rows) ws.addRow(columns.map((c) => cellValue(c.kind, c.value(row), tz)));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function workbookBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SkladPulz';
  return wb;
}
