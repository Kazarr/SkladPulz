import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../../src/auth.ts';
import { createApp } from '../../src/web/app.ts';
import { createStation } from '../../src/store/stations.ts';
import { createWorker } from '../../src/store/workers.ts';
import { getRecord } from '../../src/store/records.ts';
import { listCorrectionLog } from '../../src/store/corrections.ts';
import { at, testEnv } from '../helpers.ts';
import { counted, logCount, seed } from './seed.ts';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function managerApp() {
  const env = testEnv({ managers: [{ name: 'Jana', passwordHash: hashPassword('heslo') }], sessionSecret: 'x'.repeat(32) }, at('12:00'));
  const app = createApp(env);
  const res = await app.request('/prihlasenie', { method: 'POST', headers: FORM, body: new URLSearchParams({ name: 'Jana', password: 'heslo' }) });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const get = (path: string) => app.request(path, { headers: { cookie } });
  const post = (path: string, fields: Record<string, string>) => app.request(path, { method: 'POST', headers: { ...FORM, cookie }, body: new URLSearchParams(fields) });
  const ján = createWorker(env.db, 'Ján Novák', 'Z0001').id;
  const eva = createWorker(env.db, 'Eva Malá', 'Z0002').id;
  return { env, get, post, ján, eva };
}

test('/kontrola lists the records to review with reason, worker, DL, times and a link to edit; the default range is the last 14 days', async () => {
  const { env, get, ján } = await managerApp();
  const id = seed(env.db, { worker: ján, dl: 'DL-777', start: at('06:00', '2026-10-10'), end: at('14:00', '2026-10-10'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  seed(env.db, { worker: ján, dl: 'DL-SHORT', start: at('08:00'), end: at('08:00') + 5000, suspicion: 'kratky' });
  seed(env.db, { worker: ján, dl: 'DL-LONG', start: at('09:00'), end: at('12:00'), suspicion: 'dlhy' });
  seed(env.db, { worker: ján, dl: 'DL-DUP', start: at('07:00'), duplicate: true });
  seed(env.db, { worker: ján, dl: 'DL-FINE', start: at('07:30') });
  seed(env.db, { worker: ján, dl: 'DL-OLD', start: at('06:00', '2026-09-01'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  const text = await (await get('/kontrola')).text();
  for (const s of ['DL-777', 'Neukončený', 'Ján Novák', 'DL-SHORT', 'Podozrivo krátky', 'DL-LONG', 'Podozrivo dlhý', 'DL-DUP', 'Duplicita', '10. 10. 2026 06:00', '10. 10. 2026 14:00', `href="/zaznam/${id}"`]) {
    assert.ok(text.includes(s), s);
  }
  assert.ok(!text.includes('DL-FINE') && !text.includes('DL-OLD'));
  const old = await (await get('/kontrola?od=2026-09-01&do=2026-09-01')).text();
  assert.ok(old.includes('DL-OLD') && !old.includes('DL-777'));
  // A malformed range falls back to the default.
  assert.ok((await (await get('/kontrola?od=blbost&do=2026-13-45')).text()).includes('DL-777'));
});

test('/kontrola says so when nothing needs review', async () => {
  const { get } = await managerApp();
  assert.match(await (await get('/kontrola')).text(), /Nič na kontrolu/);
});

test('the edit page shows the form, and the history under it', async () => {
  const { env, get, post, ján } = await managerApp();
  const id = seed(env.db, { worker: ján, dl: 'DL-1', start: at('08:00'), end: at('09:00'), status: 'neukoncene', endMethod: 'koniec_zmeny' });
  const page = await (await get(`/zaznam/${id}`)).text();
  assert.match(page, /type="datetime-local"[^>]*name="start"[^>]*value="2026-10-14T08:00:00"/);
  assert.match(page, /name="end"[^>]*value="2026-10-14T09:00:00"/);
  assert.match(page, /Uložiť opravu/);
  assert.match(page, /Vylúčiť z hodnotenia/);
  assert.doesNotMatch(page, /value="potvrdit"/, 'an unfinished record cannot be confirmed');

  const res = await post(`/zaznam/${id}`, { akcia: 'oprava', start: '2026-10-14T08:00:00', end: '2026-10-14T08:30:00', worker: String(ján), activity: 'VYCH', reason: '<b>Skener</b> zlyhal' });
  assert.equal(res.status, 303);
  assert.equal(getRecord(env.db, id)?.end, at('08:30'));
  const after = await (await get(`/zaznam/${id}`)).text();
  assert.match(after, /14\. 10\. 2026 09:00:00/);
  assert.match(after, /14\. 10\. 2026 08:30:00/);
  assert.match(after, /Jana/);
  assert.match(after, /&lt;b&gt;Skener&lt;\/b&gt; zlyhal/);
  assert.doesNotMatch(after, /<b>Skener/);
  assert.match(after, /value="potvrdit"|Potvrdené/);
  // Unchanged fields were not logged: the input value carries no milliseconds, so the same text means unchanged.
  assert.equal(listCorrectionLog(env.db, id).some((l) => l.field === 'zaciatok'), false);
});

test('a refused correction shows the message, keeps the typed values and stores nothing', async () => {
  const { env, get, post, ján } = await managerApp();
  const id = seed(env.db, { worker: ján, dl: 'DL-1', start: at('08:00'), end: at('08:10') });
  seed(env.db, { worker: ján, dl: 'DL-NEXT', start: at('08:30'), end: at('08:40') });
  const bad = (over: Record<string, string>) => post(`/zaznam/${id}`, { akcia: 'oprava', start: '2026-10-14T08:00:00', end: '2026-10-14T08:10:00', worker: String(ján), activity: 'VYCH', reason: 'Dôvod', ...over });

  const overlap = await bad({ end: '2026-10-14T08:35:00', reason: 'Môj dôvod' });
  assert.equal(overlap.status, 400);
  const text = await overlap.text();
  assert.match(text, /DL-NEXT/);
  assert.match(text, /value="2026-10-14T08:35:00"/);
  assert.match(text, /Môj dôvod/);
  const cases: Record<string, string>[] = [{ end: 'zajtra' }, { start: '' }, { worker: 'abc' }, { activity: 'XYZ' }, { reason: '' }, { end: '2026-10-14T13:00:00' }, { akcia: 'zmaz' }];
  for (const over of cases) {
    assert.equal((await bad(over)).status, 400, JSON.stringify(over));
  }
  assert.equal((await post('/zaznam/999', { akcia: 'vylucit', reason: 'x' })).status, 404);
  assert.equal((await get('/zaznam/abc')).status, 404);
  assert.equal(getRecord(env.db, id)?.end, at('08:10'));
  assert.equal(logCount(env.db), 0);
});

test('confirm and exclude over HTTP change what is counted', async () => {
  const { env, post, ján } = await managerApp();
  const id = seed(env.db, { worker: ján, dl: 'DL-1', start: at('08:00'), end: at('08:00') + 5000, suspicion: 'kratky' });
  assert.deepEqual(counted(env.db), []);
  assert.equal((await post(`/zaznam/${id}`, { akcia: 'potvrdit', reason: 'Overené' })).status, 303);
  assert.deepEqual(counted(env.db), [id]);
  assert.equal((await post(`/zaznam/${id}`, { akcia: 'vylucit', reason: 'Skúška' })).status, 303);
  assert.deepEqual(counted(env.db), []);
  assert.equal((await post(`/zaznam/${id}`, { akcia: 'vratit', reason: 'Omyl' })).status, 303);
  assert.deepEqual(counted(env.db), [id]);
  assert.ok(listCorrectionLog(env.db, id).every((l) => l.manager === 'Jana'));
});

test('a running record cannot be edited and its station display keeps working', async () => {
  const { env, get, post, ján } = await managerApp();
  const st = createStation(env.db, 'Stôl', 'VYCH').id;
  const id = seed(env.db, { worker: ján, dl: 'DL-RUN', start: at('11:50'), end: null });
  env.db.prepare('UPDATE stanica SET aktualny_zamestnanec_id = ? WHERE id = ?').run(ján, st);
  const page = await get(`/zaznam/${id}`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /Uložiť opravu/);
  const res = await post(`/zaznam/${id}`, { akcia: 'oprava', start: '2026-10-14T11:50:00', end: '2026-10-14T11:55:00', worker: String(ján), activity: 'VYCH', reason: 'x' });
  assert.equal(res.status, 400);
  assert.equal(getRecord(env.db, id)?.end, null);
  const view = await env.db.prepare('SELECT count(*) AS n FROM zaznam WHERE koniec IS NULL').get() as { n: number };
  assert.equal(view.n, 1);
  assert.equal((await createApp(env).request(`/api/stanica/${st}/stav`)).status, 200);
});

test('without managers the corrections still work and the log names no signed-in manager', async () => {
  const env = testEnv({}, at('12:00'));
  const ján = createWorker(env.db, 'Ján', 'Z0001').id;
  const id = seed(env.db, { worker: ján, dl: 'DL-1', start: at('08:00') });
  const res = await createApp(env).request(`/zaznam/${id}`, { method: 'POST', headers: FORM, body: new URLSearchParams({ akcia: 'vylucit', reason: 'x' }) });
  assert.equal(res.status, 303);
  assert.equal(listCorrectionLog(env.db, id)[0]?.manager, '(bez prihlásenia)');
});
