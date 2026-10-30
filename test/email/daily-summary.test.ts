import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySummary } from '../../src/email/daily-summary.ts';
import { at, testEnv } from '../helpers.ts';
import { addRecord, addWorker } from '../reports/seed.ts';

const D = '2026-10-14';
const over = (attachExcel: boolean) => ({ baseUrl: 'http://sklad:3000', email: { enabled: true, recipients: ['vedenie@firma.sk', 'druhy@firma.sk'], attachExcel } });

test('the message holds a worker\'s numbers, the review count and both links; a worker without records is left out', async () => {
  const env = testEnv(over(false));
  const anna = addWorker(env.db, 'Anna Nováková', 'Z0001');
  addWorker(env.db, 'Nepracoval Peter', 'Z0002');
  addRecord(env.db, { worker: anna, start: at('08:00'), net: 1800, lines: 20, kg: 12.5, dl: 'DL1' });
  addRecord(env.db, { worker: anna, start: at('09:00'), net: 1800, lines: 10, kg: 7.5, dl: 'DL2' });
  addRecord(env.db, { worker: anna, start: at('10:00'), stav: 'neukoncene', method: 'koniec_zmeny', dl: 'DL3' });
  addRecord(env.db, { worker: anna, start: at('11:00'), net: 5, podozrenie: 'kratky', dl: 'DL4' });

  const m = await buildDailySummary(env.db, env.config, D);
  assert.equal(m.subject, 'SkladPulz – súhrn dňa 14. 10. 2026');
  assert.deepEqual(m.to, ['vedenie@firma.sk', 'druhy@firma.sk']);
  assert.equal(m.from, env.config.email.smtp.from);
  for (const body of [m.html, m.text]) {
    assert.match(body, /Anna Nováková/);
    assert.match(body, /Vychystanie/);
    assert.match(body, /20,0/); // kg
    assert.match(body, /http:\/\/sklad:3000\/kontrola/);
    assert.match(body, /http:\/\/sklad:3000\/prehlad\?datum=2026-10-14/);
    assert.ok(!body.includes('Nepracoval Peter'));
  }
  assert.match(m.text, /Na kontrolu: 2/);
  assert.match(m.html, /Na kontrolu: <strong>2<\/strong>/);
  assert.match(m.html, /Tím spolu/);
  assert.ok(m.html.includes('style="'));
  assert.ok(!m.html.includes('<style'));
});

test('the Excel attachment is there only when attachExcel is on', async () => {
  for (const attach of [true, false]) {
    const env = testEnv(over(attach));
    addRecord(env.db, { worker: addWorker(env.db, 'Anna', 'Z0001'), start: at('08:00') });
    const m = await buildDailySummary(env.db, env.config, D);
    assert.equal(m.attachments.length, attach ? 1 : 0);
    if (attach) {
      assert.equal(m.attachments[0]?.filename, 'skladpulz-prehlad-2026-10-14.xlsx');
      assert.ok((m.attachments[0]?.content.length ?? 0) > 100);
    }
  }
});

test('a day without records still produces a short message with the links', async () => {
  const env = testEnv(over(true));
  const m = await buildDailySummary(env.db, env.config, D);
  assert.match(m.text, /žiadne záznamy/);
  assert.match(m.html, /žiadne záznamy/);
  assert.match(m.text, /Na kontrolu: 0/);
  assert.match(m.html, /prehlad\?datum=2026-10-14/);
  assert.equal(m.attachments.length, 0);
});

test('worker names are escaped in the HTML body', async () => {
  const env = testEnv(over(false));
  addRecord(env.db, { worker: addWorker(env.db, '<script>alert(1)</script> & "Co"', 'Z0001'), start: at('08:00') });
  const m = await buildDailySummary(env.db, env.config, D);
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;'));
});
