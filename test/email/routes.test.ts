import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { at, testEnv } from '../helpers.ts';
import { addRecord, addWorker } from '../reports/seed.ts';
import { FakeTransport, markSent } from './fake-transport.ts';

const ON = { email: { enabled: true, recipients: ['vedenie@firma.sk'], attachExcel: false } };

test('the preview shows the body, the recipients and the last sends', async () => {
  const env = testEnv(ON);
  addRecord(env.db, { worker: addWorker(env.db, 'Anna', 'Z0001'), start: at('08:00') });
  const app = createApp({ ...env, mail: new FakeTransport() });
  const res = await app.request('/email/nahlad?datum=2026-10-14');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /vedenie@firma\.sk/);
  assert.match(body, /<iframe/);
  assert.match(body, /Anna/);
  assert.equal((await app.request('/email/nahlad?datum=zle')).status, 400);
});

test('the test send mails the chosen day at once without marking it as sent', async () => {
  const env = testEnv(ON);
  addRecord(env.db, { worker: addWorker(env.db, 'Anna', 'Z0001'), start: at('08:00') });
  const t = new FakeTransport();
  markSent(env.db, '2026-10-13');
  const app = createApp({ ...env, mail: t });
  const res = await app.request('/email/nahlad/odoslat', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'datum=2026-10-14' });
  assert.equal(res.status, 303);
  assert.equal(t.sent.length, 1);
  assert.match(await (await app.request('/email/nahlad?datum=2026-10-14')).text(), /skúšobný/);
  // the scheduler still sends the real one
  const { sendDueSummaries } = await import('../../src/email/scheduler.ts');
  await sendDueSummaries(env.db, env.config, at('22:15'), t);
  assert.equal(t.sent.length, 2);
});

test('a failed test send shows the error; no recipients refuses the send', async () => {
  const env = testEnv(ON);
  const t = new FakeTransport();
  t.failures = 1;
  const app = createApp({ ...env, mail: t });
  const post = (a: typeof app) => a.request('/email/nahlad/odoslat', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'datum=2026-10-14' });
  await post(app);
  assert.match(await (await app.request('/email/nahlad?datum=2026-10-14')).text(), /SMTP down/);
  const none = testEnv({ email: { recipients: [] } });
  const res = await post(createApp({ ...none, mail: new FakeTransport() }));
  assert.equal(res.status, 400);
});
