import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { createStation } from '../../src/store/stations.ts';
import { createWorker } from '../../src/store/workers.ts';
import { testEnv } from '../helpers.ts';

function scan(app: ReturnType<typeof createApp>, station: number, kod: unknown): Promise<Response> {
  return Promise.resolve(app.request(`/api/stanica/${station}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kod }) }));
}

test('the station page and its scan API work end to end over HTTP', async () => {
  const env = testEnv();
  const st = createStation(env.db, 'Baliaci stôl 1', 'BAL').id;
  createWorker(env.db, 'Ján Novák', 'Z0001');
  const app = createApp(env);

  const pageRes = await app.request(`/stanica/${st}`);
  assert.equal(pageRes.status, 200);
  assert.match(await pageRes.text(), /Baliaci stôl 1/);

  const res = await scan(app, st, 'Z0001');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome: string; view: { current: { name: string } } };
  assert.equal(body.outcome, 'ok');
  assert.equal(body.view.current.name, 'Ján Novák');

  const stav = (await (await app.request(`/api/stanica/${st}/stav`)).json()) as { current: { name: string } };
  assert.equal(stav.current.name, 'Ján Novák');

  const home = await (await app.request('/')).text();
  assert.match(home, /Ján Novák/);
});

test('bad scan requests are refused without touching the database', async () => {
  const env = testEnv();
  const st = createStation(env.db, 'S', null).id;
  const app = createApp(env);
  assert.equal((await scan(app, 999, 'Z0001')).status, 404);
  assert.equal((await scan(app, st, 12)).status, 400);
  assert.equal((await scan(app, st, 'x'.repeat(101))).status, 400);
  const notJson = await app.request(`/api/stanica/${st}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'kod=Z0001' });
  assert.equal(notJson.status, 400);
  assert.equal((await app.request('/stanica/abc')).status, 404);
  const n = env.db.prepare('SELECT count(*) AS n FROM scan_log').get() as { n: number };
  assert.equal(n.n, 0);
});

test('escapes worker names in pages', async () => {
  const env = testEnv();
  const st = createStation(env.db, '<b>S</b>', null).id;
  createWorker(env.db, '<script>x</script>', 'Z0001');
  const app = createApp(env);
  await scan(app, st, 'Z0001');
  const home = await (await app.request('/')).text();
  assert.ok(!home.includes('<script>x</script>'));
  assert.ok(home.includes('&lt;script&gt;'));
});

test('the scan API accepts only application/json, so a plain cross-origin form or text/plain post cannot reach it', async () => {
  const env = testEnv();
  const st = createStation(env.db, 'S', null).id;
  createWorker(env.db, 'Ján', 'Z0001');
  const app = createApp(env);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'text/plain;charset=UTF-8']) {
    const res = await app.request(`/api/stanica/${st}/scan`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify({ kod: 'Z0001' }) });
    assert.equal(res.status, 415, type);
  }
  assert.equal((await app.request(`/api/stanica/${st}/scan`, { method: 'POST', body: JSON.stringify({ kod: 'Z0001' }) })).status, 415);
  const ok = await app.request(`/api/stanica/${st}/scan`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ kod: 'Z0001' }) });
  assert.equal(ok.status, 200);
  const n = env.db.prepare('SELECT count(*) AS n FROM scan_log').get() as { n: number };
  assert.equal(n.n, 1);
});

test('a state-changing request from another origin or marked cross-site is refused; same-origin and header-less requests pass', async () => {
  const env = testEnv();
  const st = createStation(env.db, 'S', null).id;
  createWorker(env.db, 'Ján', 'Z0001');
  const app = createApp(env);
  const post = (headers: Record<string, string>) =>
    app.request(`http://sklad:3000/api/stanica/${st}/scan`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ kod: 'Z0001' }) });
  assert.equal((await post({ origin: 'http://evil.example' })).status, 403);
  assert.equal((await post({ origin: 'null' })).status, 403);
  assert.equal((await post({ origin: 'http://sklad:3001' })).status, 403);
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ origin: 'http://sklad:3000', 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await post({})).status, 200);
  // the check covers every route, e.g. a manager form, and every non-GET method
  const form = await app.request('http://sklad:3000/prihlasenie', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'meno=a&heslo=b' });
  assert.equal(form.status, 403);
  assert.equal((await app.request('http://sklad:3000/', { method: 'GET', headers: { origin: 'http://evil.example' } })).status, 200);
});
