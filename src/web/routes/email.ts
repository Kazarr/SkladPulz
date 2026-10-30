import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppDeps, AppEnv } from '../app.ts';
import { page } from '../layout.ts';
import { buildDailySummary } from '../../email/daily-summary.ts';
import { listSendLog, sendSummary } from '../../email/scheduler.ts';
import { createSmtpTransport } from '../../email/transport.ts';
import { isDate, localDate, localDateTime } from '../../time.ts';

export function emailRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const tz = deps.config.timezone;
  const dayOf = (raw: string | undefined): string | null => (raw === undefined || raw === '' ? localDate(deps.now(), tz) : isDate(raw) ? raw : null);

  r.get('/email/nahlad', async (c) => {
    const date = dayOf(c.req.query('datum'));
    if (date === null) return c.text('Neplatný dátum, použite tvar RRRR-MM-DD.', 400);
    const { recipients, enabled } = deps.config.email;
    const message = await buildDailySummary(deps.db, deps.config, date);
    const log = listSendLog(deps.db, 10);
    const body = html`
      <form class="filters" method="get" action="/email/nahlad">
        <label>Dátum<input type="date" name="datum" value="${date}"></label>
        <button type="submit">Zobraziť</button>
      </form>
      <p>Denný súhrn je <strong>${enabled ? 'zapnutý' : 'vypnutý'}</strong>. Príjemcovia: ${recipients.length > 0 ? recipients.join(', ') : html`<em>nie sú nastavení</em>`}.</p>
      <form method="post" action="/email/nahlad/odoslat">
        <input type="hidden" name="datum" value="${date}">
        <button type="submit">Poslať skúšobný e-mail</button>
        <span class="muted">Pošle súhrn tohto dňa hneď; deň sa tým nepovažuje za odoslaný.</span>
      </form>
      <h2>${message.subject}</h2>
      <iframe sandbox="" srcdoc="${message.html}" style="width:100%;height:480px;border:1px solid #ccc;background:#fff;"></iframe>
      <h2>Posledné odoslania</h2>
      ${log.length === 0
        ? html`<p class="empty">Zatiaľ nič nebolo odoslané.</p>`
        : html`<table><thead><tr><th>Odoslané</th><th>Deň</th><th>Príjemcovia</th><th>Výsledok</th></tr></thead><tbody>${log.map(
            (l) => html`<tr><td>${localDateTime(l.at, tz)}</td><td>${l.date}${l.test ? ' (skúšobný)' : ''}</td><td>${l.recipients.join(', ')}</td>
              <td>${l.ok ? 'odoslané' : html`chyba: ${l.error ?? ''}`}</td></tr>`,
          )}</tbody></table>`}`;
    return c.html(page({ title: 'Denný súhrn e-mailom', body, user: c.get('manager') }));
  });

  r.post('/email/nahlad/odoslat', async (c) => {
    const form = await c.req.parseBody();
    const date = dayOf(typeof form['datum'] === 'string' ? form['datum'] : undefined);
    if (date === null) return c.text('Neplatný dátum, použite tvar RRRR-MM-DD.', 400);
    if (deps.config.email.recipients.length === 0) return c.text('Nie sú nastavení príjemcovia (email.recipients v konfigurácii).', 400);
    await sendSummary(deps.db, deps.config, date, deps.now(), deps.mail ?? createSmtpTransport(deps.config.email.smtp), true);
    return c.redirect(`/email/nahlad?datum=${date}`, 303);
  });

  return r;
}
