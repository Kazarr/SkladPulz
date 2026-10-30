import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, validateConfig } from '../../src/config.ts';
import { hashPassword, verifyPassword } from '../../src/auth.ts';
import { createApp } from '../../src/web/app.ts';
import { createStation } from '../../src/store/stations.ts';
import { testEnv } from '../helpers.ts';

const SECRET = 'x'.repeat(32);
const PASSWORD = 'tajne-heslo';
const BANNER = 'Prihlasovanie vedúcich nie je nastavené';

function secured() {
  const env = testEnv({ managers: [{ name: 'Jana', passwordHash: hashPassword(PASSWORD) }], sessionSecret: SECRET });
  return { env, app: createApp(env) };
}

type App = ReturnType<typeof createApp>;

async function login(app: App, name: string, password: string, next?: string): Promise<Response> {
  const body = new URLSearchParams({ name, password });
  if (next !== undefined) body.set('next', next);
  return await app.request('/prihlasenie', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
}

function cookieOf(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

async function signIn(app: App): Promise<string> {
  const res = await login(app, 'Jana', PASSWORD);
  assert.equal(res.status, 303);
  return cookieOf(res);
}

test('password hashes verify, differ per salt and reject garbage', () => {
  const h = hashPassword('abc');
  assert.ok(verifyPassword('abc', h));
  assert.ok(!verifyPassword('abd', h));
  assert.notEqual(h, hashPassword('abc'));
  assert.ok(!verifyPassword('abc', 'not-a-hash'));
  assert.ok(!verifyPassword('abc', ''));
});

test('wrong password and unknown name are refused with the same message and no cookie', async () => {
  const { app } = secured();
  const wrong = await login(app, 'Jana', 'zle');
  const unknown = await login(app, 'Niekto', PASSWORD);
  for (const res of [wrong, unknown]) {
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  }
  const msg = /Nesprávne meno alebo heslo\./;
  assert.match(await wrong.text(), msg);
  assert.match(await unknown.text(), msg);
});

test('a correct sign-in sets a signed, httpOnly, SameSite=Lax cookie for 12 hours and shows the manager', async () => {
  const { app } = secured();
  const res = await login(app, 'Jana', PASSWORD);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const set = res.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=Lax/i);
  assert.match(set, /Max-Age=43200/i);
  const home = await app.request('/', { headers: { cookie: cookieOf(res) } });
  assert.equal(home.status, 200);
  const text = await home.text();
  assert.match(text, /Jana/);
  assert.match(text, /Odhlásiť/);
});

test('sign-out clears the cookie', async () => {
  const { app } = secured();
  const res = await app.request('/odhlasit', { headers: { cookie: await signIn(app) } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/prihlasenie');
  assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});

test('a tampered, forged or foreign-signed session cookie is rejected', async () => {
  const { env, app } = secured();
  const good = await signIn(app);
  const value = good.slice(good.indexOf('=') + 1);
  const flipped = decodeURIComponent(value).replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A'));
  const other = testEnv({ managers: env.config.managers, sessionSecret: 'y'.repeat(32) });
  const foreign = cookieOf(await login(createApp(other), 'Jana', PASSWORD));
  for (const cookie of [`sp_session=${encodeURIComponent(flipped)}`, 'sp_session=Jana', 'sp_session=', foreign]) {
    const res = await app.request('/zamestnanci', { headers: { cookie } });
    assert.equal(res.status, 302, cookie);
    assert.match(res.headers.get('location') ?? '', /^\/prihlasenie/);
  }
});

test('a session older than 12 hours is rejected even with a valid signature', async () => {
  const { env, app } = secured();
  const cookie = await signIn(app);
  assert.equal((await app.request('/zamestnanci', { headers: { cookie } })).status, 200);
  env.clock.advance(12 * 3600 + 1);
  assert.equal((await app.request('/zamestnanci', { headers: { cookie } })).status, 302);
});

test('a session for a manager removed from the configuration is rejected', async () => {
  const { env, app } = secured();
  const cookie = await signIn(app);
  env.config.managers.length = 0;
  env.config.managers.push({ name: 'Iná', passwordHash: hashPassword('x') });
  assert.equal((await app.request('/zamestnanci', { headers: { cookie } })).status, 302);
});

test('signed out: a protected GET redirects to the sign-in with next, any other method gets 401', async () => {
  const { env, app } = secured();
  const get = await app.request('/kontrola?od=2026-10-01');
  assert.equal(get.status, 302);
  assert.equal(get.headers.get('location'), '/prihlasenie?next=%2Fkontrola%3Fod%3D2026-10-01');
  // Protection is by exclusion: a path no route handles is still behind the sign-in.
  assert.equal((await app.request('/nejaka-buduca-stranka')).status, 302);
  const post = await app.request('/zamestnanci', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Hacker' });
  assert.equal(post.status, 401);
  assert.equal((await app.request('/zaznam/1', { method: 'POST', body: 'akcia=vylucit' })).status, 401);
  const n = env.db.prepare('SELECT count(*) AS n FROM zamestnanec').get() as { n: number };
  assert.equal(n.n, 0);
});

test('stations, the health check, static files and the sign-in page work signed out', async () => {
  const { env, app } = secured();
  const st = createStation(env.db, 'Stôl', null).id;
  for (const path of [`/stanica/${st}`, `/api/stanica/${st}/stav`, '/health', '/static/app.css', '/prihlasenie']) {
    assert.equal((await app.request(path)).status, 200, path);
  }
  const scan = await app.request(`/api/stanica/${st}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kod: 'Z9999' }) });
  assert.equal(scan.status, 200);
});

test('after sign-in the next page is honoured only when it is a same-site relative path', async () => {
  const { app } = secured();
  const cases: [string | undefined, string][] = [
    ['/kontrola?od=2026-10-01', '/kontrola?od=2026-10-01'],
    ['/zaznam/5', '/zaznam/5'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['http://evil.com/x', '/'],
    ['javascript:alert(1)', '/'],
    ['evil.com', '/'],
    ['', '/'],
    [undefined, '/'],
  ];
  for (const [next, expected] of cases) {
    const res = await login(app, 'Jana', PASSWORD, next);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), expected, String(next));
  }
});

test('the sign-in form keeps a safe next and drops an unsafe one', async () => {
  const { app } = secured();
  assert.match(await (await app.request('/prihlasenie?next=%2Fkontrola')).text(), /name="next" value="\/kontrola"/);
  assert.doesNotMatch(await (await app.request('/prihlasenie?next=%2F%2Fevil.com')).text(), /evil\.com/);
});

test('without managers in the configuration pages stay open and every page warns', async () => {
  const env = testEnv();
  const app = createApp(env);
  for (const path of ['/', '/zamestnanci', '/kontrola', '/prihlasenie']) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(BANNER), path);
  }
  const post = await app.request('/zamestnanci', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Ján' });
  assert.equal(post.status, 303);
});

test('with managers configured no page shows the warning', async () => {
  const { app } = secured();
  const cookie = await signIn(app);
  for (const path of ['/', '/zamestnanci', '/kontrola']) {
    assert.doesNotMatch(await (await app.request(path, { headers: { cookie } })).text(), new RegExp(BANNER), path);
  }
});

test('validateConfig reports a session secret shorter than 32 characters when managers exist', () => {
  const managers = [{ name: 'Jana', passwordHash: hashPassword('x') }];
  assert.ok(validateConfig(buildConfig({ managers, sessionSecret: 'krátke' })).some((e) => e.includes('sessionSecret')));
  assert.ok(!validateConfig(buildConfig({ managers, sessionSecret: SECRET })).some((e) => e.includes('sessionSecret')));
  assert.deepEqual(validateConfig(buildConfig()), []);
  assert.ok(validateConfig(buildConfig({ managers: [{ name: 'Jana', passwordHash: 'plain' }], sessionSecret: SECRET })).some((e) => e.includes('Jana')));
});
