import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { createStation, getStation, listStations } from '../../src/store/stations.ts';
import { testEnv } from '../helpers.ts';

function post(app: ReturnType<typeof createApp>, path: string, fields: Record<string, string>): Promise<Response> {
  return Promise.resolve(app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));
}

test('the list links to every station page', async () => {
  const env = testEnv();
  const a = createStation(env.db, 'Baliaci stôl 1', 'BAL');
  const b = createStation(env.db, 'Regál A', null);
  const html = await (await createApp(env).request('/nastavenia/stanice')).text();
  assert.match(html, new RegExp(`href="/stanica/${a.id}"`));
  assert.match(html, new RegExp(`href="/stanica/${b.id}"`));
  assert.match(html, /Baliaci stôl 1/);
});

test('a station is added with its default activity', async () => {
  const env = testEnv();
  const app = createApp(env);
  for (const [name, activity, expected] of [['Stôl 1', 'BAL', 'BAL'], ['Regál A', 'VYCH', 'VYCH'], ['Voľná', '', null]] as const) {
    assert.equal((await post(app, '/nastavenia/stanice', { name, activity })).status, 303);
    assert.equal(listStations(env.db).find((s) => s.name === name)?.defaultActivity, expected);
  }
});

test('a station is edited: name and default activity', async () => {
  const env = testEnv();
  const s = createStation(env.db, 'Stôl 1', 'BAL');
  const app = createApp(env);
  assert.equal((await post(app, `/nastavenia/stanice/${s.id}`, { name: 'Stôl 2', activity: '' })).status, 303);
  assert.deepEqual([getStation(env.db, s.id)?.name, getStation(env.db, s.id)?.defaultActivity], ['Stôl 2', null]);
  assert.equal((await post(app, `/nastavenia/stanice/${s.id}`, { name: 'Stôl 2', activity: 'VYCH' })).status, 303);
  assert.equal(getStation(env.db, s.id)?.defaultActivity, 'VYCH');
  assert.equal((await post(app, '/nastavenia/stanice/999', { name: 'X', activity: '' })).status, 404);
});

test('an invalid activity or an empty name is refused and nothing changes', async () => {
  const env = testEnv();
  const s = createStation(env.db, 'Stôl 1', 'BAL');
  const app = createApp(env);
  const badActivity = await post(app, `/nastavenia/stanice/${s.id}`, { name: 'Stôl 1', activity: 'LETAT' });
  assert.equal(badActivity.status, 400);
  assert.match(await badActivity.text(), /Neplatná činnosť/);
  assert.equal(getStation(env.db, s.id)?.defaultActivity, 'BAL');
  const emptyName = await post(app, '/nastavenia/stanice', { name: ' ', activity: '' });
  assert.equal(emptyName.status, 400);
  assert.match(await emptyName.text(), /Zadajte názov stanice/);
  assert.equal((await post(app, '/nastavenia/stanice', { name: 'Nová', activity: 'LETAT' })).status, 400);
  assert.equal(listStations(env.db).length, 1);
});

test('station names are HTML-escaped', async () => {
  const env = testEnv();
  createStation(env.db, '<img src=x onerror=1>', null);
  const html = await (await createApp(env).request('/nastavenia/stanice')).text();
  assert.doesNotMatch(html, /<img src=x/);
});
