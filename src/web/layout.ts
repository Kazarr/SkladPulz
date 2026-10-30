import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface NavItem {
  href: string;
  label: string;
}

/** Top navigation of the manager's pages. Feature modules add their entries here. */
export const NAV: NavItem[] = [
  { href: '/', label: 'Stanice' },
  { href: '/prehlad', label: 'Denný prehľad' },
  { href: '/porovnanie', label: 'Porovnanie' },
  { href: '/kontrola', label: 'Na kontrolu' },
  { href: '/zamestnanci', label: 'Zamestnanci' },
  { href: '/nastavenia/stanice', label: 'Nastavenia' },
];

export function page(opts: { title: string; active?: string; body: Html; user?: string | null; head?: Html }): Html {
  return html`<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · SkladPulz</title>
<link rel="stylesheet" href="/static/app.css">
${opts.head ?? ''}
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Sklad<span>Pulz</span></a>
  <nav>${NAV.map((n) => html`<a href="${n.href}" class="${opts.active === n.href ? 'active' : ''}">${n.label}</a>`)}</nav>
  <div class="who">${opts.user ? html`${opts.user} · <a href="/odhlasit">Odhlásiť</a>` : ''}</div>
</header>
<main>
<h1>${opts.title}</h1>
${opts.body}
</main>
</body>
</html>`;
}
