import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { ACTIVITY_LABEL } from '../domain/station.ts';
import { buildDailyReport, needsReview, type DailySection, type ReportFilter, type SummaryRow } from '../reports/daily.ts';
import { dailyWorkbookBytes } from '../reports/daily-export.ts';
import { formatNumber, formatSeconds } from '../reports/format.ts';
import { parseDate } from '../time.ts';
import type { MailMessage } from './transport.ts';

const ALL: ReportFilter = { workerId: null, activity: null, status: null };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HEAD = ['Zamestnanec', 'DL', 'Položky', 'kg', 'Čistý čas', 'DL / hod', 'Položky / hod', 'kg / hod'];

function cells(r: SummaryRow): string[] {
  return [r.workerName, String(r.notes), String(r.lines), formatNumber(r.weightKg), formatSeconds(r.netSeconds), formatNumber(r.notesPerHour), formatNumber(r.linesPerHour), formatNumber(r.kgPerHour)];
}

const TD = 'padding:4px 8px;border-bottom:1px solid #ddd;';

function htmlSection(s: DailySection): string {
  const row = (r: SummaryRow, bold: boolean): string =>
    `<tr>${cells(r).map((c, i) => `<td style="${TD}${i > 0 ? 'text-align:right;' : ''}${bold ? 'font-weight:bold;' : ''}">${esc(c)}</td>`).join('')}</tr>`;
  const head = HEAD.map((h, i) => `<th style="${TD}background:#f0f0f0;${i > 0 ? 'text-align:right;' : 'text-align:left;'}">${h}</th>`).join('');
  return `<h2 style="font-size:16px;margin:20px 0 6px;">${ACTIVITY_LABEL[s.activity]}</h2>
<table style="border-collapse:collapse;font-size:13px;"><thead><tr>${head}</tr></thead><tbody>${s.rows.map((r) => row(r, false)).join('')}${row(s.total, true)}</tbody></table>`;
}

function textSection(s: DailySection): string {
  const line = (r: SummaryRow): string => {
    const [name, ...rest] = cells(r);
    return `${name}: ${rest.map((c, i) => `${c} ${HEAD[i + 1]}`).join(', ')}`;
  };
  return [`${ACTIVITY_LABEL[s.activity]}`, ...s.rows.map(line), line(s.total)].join('\n');
}

/** The summary e-mail of local day `date` (Slovak): HTML with inline styles, a plain-text alternative and, when configured, the day's Excel. */
export async function buildDailySummary(db: Db, config: Config, date: string): Promise<MailMessage> {
  const report = buildDailyReport(db, config.timezone, date, ALL);
  const { year, month, day } = parseDate(date);
  const label = `${day}. ${month}. ${year}`;
  const review = report.records.filter(needsReview).length;
  const base = config.baseUrl.replace(/\/+$/, '');
  const reviewUrl = `${base}/kontrola`;
  const dayUrl = `${base}/prehlad?datum=${date}`;
  const empty = report.sections.length === 0;

  const html = `<!doctype html>
<html lang="sk"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;">
<h1 style="font-size:20px;">Súhrn dňa ${label}</h1>
${empty ? '<p>Za tento deň nie sú žiadne záznamy.</p>' : report.sections.map(htmlSection).join('\n')}
<p style="margin-top:20px;">Na kontrolu: <strong>${review}</strong> záznamov (neukončené a podozrivé). <a href="${esc(reviewUrl)}">Otvoriť kontrolu</a></p>
<p><a href="${esc(dayUrl)}">Denný prehľad ${label}</a></p>
</body></html>`;

  const text = [
    `Súhrn dňa ${label}`,
    '',
    empty ? 'Za tento deň nie sú žiadne záznamy.' : report.sections.map(textSection).join('\n\n'),
    '',
    `Na kontrolu: ${review} záznamov (neukončené a podozrivé): ${reviewUrl}`,
    `Denný prehľad: ${dayUrl}`,
  ].join('\n');

  const attachments: MailMessage['attachments'] = [];
  if (config.email.attachExcel && !empty) {
    attachments.push({ filename: `skladpulz-prehlad-${date}.xlsx`, content: await dailyWorkbookBytes(report, config.timezone), contentType: XLSX });
  }
  return { from: config.email.smtp.from, to: config.email.recipients, subject: `SkladPulz – súhrn dňa ${label}`, html, text, attachments };
}
