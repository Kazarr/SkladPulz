import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { createWorker, getWorker, listWorkers } from '../../src/store/workers.ts';
import { testEnv } from '../helpers.ts';

function post(app: ReturnType<typeof createApp>, path: string, fields: Record<string, string>): Promise<Response> {
  return Promise.resolve(app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));
}

test('adding a worker assigns the next code and redirects to the list', async () => {
  const env = testEnv();
  createWorker(env.db, 'Ján Novák', 'Z0007');
  const app = createApp(env);
  const res = await post(app, '/zamestnanci', { name: '  Eva Malá ' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/zamestnanci');
  const added = listWorkers(env.db).find((w) => w.name === 'Eva Malá');
  assert.equal(added?.code, 'Z0008');
  assert.equal(added?.active, true);
  const list = await (await app.request('/zamestnanci')).text();
  assert.match(list, /Z0008/);
  assert.match(list, /Eva Malá/);
});

test('an empty or blank name is refused with a message and nothing is stored', async () => {
  const env = testEnv();
  const app = createApp(env);
  for (const name of ['', '   ']) {
    const res = await post(app, '/zamestnanci', { name });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Zadajte meno zamestnanca/);
  }
  assert.equal(listWorkers(env.db).length, 0);
});

test('renaming changes the name and refuses an empty one', async () => {
  const env = testEnv();
  const w = createWorker(env.db, 'Ján Novák');
  const app = createApp(env);
  assert.equal((await post(app, `/zamestnanci/${w.id}`, { name: 'Ján Nový' })).status, 303);
  assert.equal(getWorker(env.db, w.id)?.name, 'Ján Nový');
  const res = await post(app, `/zamestnanci/${w.id}`, { name: ' ' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Zadajte meno zamestnanca/);
  assert.equal(getWorker(env.db, w.id)?.name, 'Ján Nový');
  assert.equal((await post(app, '/zamestnanci/999', { name: 'X' })).status, 404);
});

test('a worker can be deactivated and activated again', async () => {
  const env = testEnv();
  const w = createWorker(env.db, 'Ján Novák');
  const app = createApp(env);
  assert.equal((await post(app, `/zamestnanci/${w.id}/aktivny`, { active: '0' })).status, 303);
  assert.equal(getWorker(env.db, w.id)?.active, false);
  assert.match(await (await app.request('/zamestnanci')).text(), /Neaktívny/);
  assert.equal((await post(app, `/zamestnanci/${w.id}/aktivny`, { active: '1' })).status, 303);
  assert.equal(getWorker(env.db, w.id)?.active, true);
});

test('names are HTML-escaped on the list', async () => {
  const env = testEnv();
  createWorker(env.db, '<script>alert(1)</script>');
  const html = await (await createApp(env).request('/zamestnanci')).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('the list links to the card and control-code print pages', async () => {
  const html = await (await createApp(testEnv()).request('/zamestnanci')).text();
  assert.match(html, /href="\/zamestnanci\/karty"/);
  assert.match(html, /href="\/tlac\/kody"/);
});
