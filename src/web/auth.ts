import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { verifyPassword } from '../auth.ts';
import type { AppDeps, AppEnv } from './app.ts';
import { page } from './layout.ts';

export const OPEN_MODE_WARNING = 'Prihlasovanie vedúcich nie je nastavené';

const COOKIE = 'sp_session';
const SESSION_MS = 12 * 3600 * 1000;
const BAD_LOGIN = 'Nesprávne meno alebo heslo.';
/** Checked against when the name is unknown, so a wrong name costs as much time as a wrong password. */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

/** Paths a station or the browser needs without a manager: stations keep working when nobody is signed in. */
const OPEN_PREFIXES = ['/stanica', '/api/stanica', '/static'];
const OPEN_PATHS = ['/health', '/prihlasenie', '/odhlasit'];

function isOpenPath(path: string): boolean {
  return OPEN_PATHS.includes(path) || OPEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** `next` after sign-in: only a same-site relative path, anything else goes home. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(raw)) return '/';
  return raw;
}

type Ctx = Context<AppEnv>;

async function sessionManager(c: Ctx, deps: AppDeps): Promise<string | null> {
  const value = await getSignedCookie(c, deps.config.sessionSecret, COOKIE);
  if (!value) return null;
  const dot = value.indexOf('.');
  const expires = Number(value.slice(0, dot));
  const name = value.slice(dot + 1);
  if (dot < 1 || !(expires > deps.now())) return null;
  return deps.config.managers.some((m) => m.name === name) ? name : null;
}

/**
 * Sets `manager` from the session cookie and protects every path except the open ones, so a route added later is protected without anyone remembering.
 * With no managers configured nothing is protected (the first install must not lock anyone out) and every HTML page carries a warning.
 */
export function authMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const open = deps.config.managers.length === 0;
    const manager = open ? null : await sessionManager(c, deps);
    c.set('manager', manager);
    if (!open && manager === null && !isOpenPath(c.req.path)) {
      if (c.req.method === 'GET' || c.req.method === 'HEAD') {
        const url = new URL(c.req.url);
        return c.redirect(`/prihlasenie?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }
      return c.text('Prihlásenie je potrebné.', 401);
    }
    await next();
    // ponytail: the warning is spliced into the rendered page so pages of later tickets get it without calling anything.
    if (open && c.res.headers.get('content-type')?.startsWith('text/html')) {
      const body = await c.res.text();
      const banner = `<p class="notice err" role="alert">${OPEN_MODE_WARNING}: všetky stránky sú otvorené každému v sieti. Nastavte <code>managers</code> a <code>sessionSecret</code> v config.json.</p>`;
      const headers = new Headers(c.res.headers);
      headers.delete('content-length');
      c.res = new Response(body.replace('<main>', `<main>${banner}`), { status: c.res.status, headers });
    }
  };
}

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  const form = (c: Ctx, next: string, error?: string, status: 200 | 401 = 200) =>
    c.html(
      page({
        title: 'Prihlásenie vedúceho',
        user: null,
        body: html`
          ${error ? html`<p class="notice err" role="alert">${error}</p>` : ''}
          <form method="post" action="/prihlasenie" class="form">
            <input type="hidden" name="next" value="${next}">
            <label>Meno<input name="name" autocomplete="username" required autofocus></label>
            <label>Heslo<input name="password" type="password" autocomplete="current-password" required></label>
            <button type="submit">Prihlásiť</button>
          </form>`,
      }),
      status,
    );

  r.get('/prihlasenie', (c) => form(c, safeNext(c.req.query('next'))));

  r.post('/prihlasenie', async (c) => {
    const body = await c.req.parseBody();
    const name = typeof body['name'] === 'string' ? body['name'] : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const next = safeNext(body['next']);
    const manager = deps.config.managers.find((m) => m.name === name);
    const valid = verifyPassword(password, manager?.passwordHash ?? DUMMY_HASH);
    if (!manager || !valid) return form(c, next, BAD_LOGIN, 401);
    // The expiry is inside the signed value, so a copied cookie stops working after 12 hours, not only in the browser.
    await setSignedCookie(c, COOKIE, `${deps.now() + SESSION_MS}.${manager.name}`, deps.config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_MS / 1000,
    });
    return c.redirect(next, 303);
  });

  r.get('/odhlasit', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.redirect('/prihlasenie', 302);
  });

  return r;
}
