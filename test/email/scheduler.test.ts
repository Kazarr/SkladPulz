import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSendLog, sendDueSummaries } from '../../src/email/scheduler.ts';
import { at, testEnv, type TestEnv } from '../helpers.ts';
import { addRecord, addWorker } from '../reports/seed.ts';
import { FakeTransport } from './fake-transport.ts';

const D = '2026-10-14';
const ON = { email: { enabled: true, recipients: ['vedenie@firma.sk'], attachExcel: false, delayMin: 15 } };

function withDay(over: Parameters<typeof testEnv>[0] = ON, date = D, hhmm = '08:00'): TestEnv {
  const env = testEnv(over);
  addRecord(env.db, { worker: addWorker(env.db, 'Anna', 'Z0001'), start: at(hhmm, date) });
  return env;
}

test('nothing is sent before the last shift end plus the delay, then it is sent right after', async () => {
  const env = withDay(); // shifts 06-14 and 14-22, delay 15 min: due at 22:15
  const t = new FakeTransport();
  await sendDueSummaries(env.db, env.config, at('22:14'), t);
  assert.equal(t.sent.length, 0);
  await sendDueSummaries(env.db, env.config, at('22:15'), t);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0]?.subject ?? '', /14\. 10\. 2026/);
});

test('a day is sent once only across repeated runs, and the send is logged', async () => {
  const env = withDay();
  const t = new FakeTransport();
  for (const hhmm of ['22:15', '22:20', '23:00']) await sendDueSummaries(env.db, env.config, at(hhmm), t);
  assert.equal(t.sent.length, 1);
  const log = listSendLog(env.db, 10);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0]?.date, log[0]?.ok, log[0]?.recipients, log[0]?.test], [D, true, ['vedenie@firma.sk'], false]);
});

test('a failure is recorded and retried on the next run; success stops the retries', async () => {
  const env = withDay();
  const t = new FakeTransport();
  t.failures = 1;
  await sendDueSummaries(env.db, env.config, at('22:15'), t);
  assert.equal(t.sent.length, 0);
  const [failed] = listSendLog(env.db, 10);
  assert.equal(failed?.ok, false);
  assert.match(failed?.error ?? '', /SMTP down/);
  await sendDueSummaries(env.db, env.config, at('22:20'), t);
  assert.equal(t.sent.length, 1);
  await sendDueSummaries(env.db, env.config, at('22:25'), t);
  assert.equal(t.sent.length, 1);
  assert.equal(t.attempts, 2);
  assert.deepEqual(listSendLog(env.db, 10).map((l) => l.ok), [true, false]);
});

test('retries stop after 5 failures that day and the error stays in the log', async () => {
  const env = withDay();
  const t = new FakeTransport();
  t.failures = 100;
  for (let i = 0; i < 8; i++) await sendDueSummaries(env.db, env.config, at('22:15') + i * 300_000, t);
  assert.equal(t.attempts, 5);
  assert.equal(listSendLog(env.db, 10).filter((l) => !l.ok).length, 5);
  // the next day's summary is independent
  addRecord(env.db, { worker: 1, start: at('08:00', '2026-10-15') });
  t.failures = 0;
  await sendDueSummaries(env.db, env.config, at('22:15', '2026-10-15'), t);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0]?.subject ?? '', /15\. 10\. 2026/);
});

test('after downtime only yesterday and today are sent, never a backlog', async () => {
  const env = withDay();
  const t = new FakeTransport();
  await sendDueSummaries(env.db, env.config, at('23:00', '2026-10-20'), t); // 20th is today, 19th yesterday; 14th is long past
  assert.deepEqual(t.sent.map((m) => m.subject), ['SkladPulz – súhrn dňa 19. 10. 2026', 'SkladPulz – súhrn dňa 20. 10. 2026']);
});

test('disabled config or no recipients sends nothing', async () => {
  for (const email of [{ enabled: false, recipients: ['a@b.sk'] }, { enabled: true, recipients: [] }]) {
    const env = withDay({ email });
    const t = new FakeTransport();
    await sendDueSummaries(env.db, env.config, at('23:00'), t);
    assert.equal(t.attempts, 0);
    assert.equal(listSendLog(env.db, 10).length, 0);
  }
});

test('a night shift ending after midnight counts for the day it started', async () => {
  const env = withDay({ ...ON, shifts: [{ name: 'Nočná', from: '22:00', to: '06:00' }] }, D, '23:00');
  const t = new FakeTransport();
  await sendDueSummaries(env.db, env.config, at('06:14', '2026-10-15'), t);
  assert.equal(t.sent.length, 0);
  await sendDueSummaries(env.db, env.config, at('06:15', '2026-10-15'), t);
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0]?.subject ?? '', /14\. 10\. 2026/);
  assert.match(t.sent[0]?.text ?? '', /Anna/);
});
