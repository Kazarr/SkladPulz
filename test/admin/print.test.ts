import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/web/app.ts';
import { createWorker, updateWorker } from '../../src/store/workers.ts';
import { testEnv } from '../helpers.ts';

function setup() {
  const env = testEnv();
  const jan = createWorker(env.db, 'Ján Novák');
  const eva = createWorker(env.db, 'Eva Malá');
  const peter = createWorker(env.db, 'Peter Starý');
  updateWorker(env.db, peter.id, { active: false });
  return { env, app: createApp(env), jan, eva, peter };
}

const labelOf = (code: string) => `aria-label="${code}"`;

test('the card page prints every active worker and leaves out inactive ones', async () => {
  const { app } = setup();
  const res = await app.request('/zamestnanci/karty');
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const [name, code] of [['Ján Novák', 'Z0001'], ['Eva Malá', 'Z0002']] as const) {
    assert.ok(html.includes(name), name);
    assert.ok(html.includes(labelOf(code)), code);
  }
  assert.ok(!html.includes('Peter Starý'));
  assert.ok(!html.includes(labelOf('Z0003')));
});

test('the card page prints only the selected workers', async () => {
  const { app, eva } = setup();
  const html = await (await app.request(`/zamestnanci/karty?id=${eva.id}`)).text();
  assert.ok(html.includes('Eva Malá') && html.includes(labelOf('Z0002')));
  assert.ok(!html.includes('Ján Novák') && !html.includes(labelOf('Z0001')));
});

test('a selected inactive or unknown worker is not printed', async () => {
  const { app, jan, peter } = setup();
  const html = await (await app.request(`/zamestnanci/karty?id=${jan.id}&id=${peter.id}&id=999&id=abc`)).text();
  assert.ok(html.includes('Ján Novák'));
  assert.ok(!html.includes('Peter Starý') && !html.includes(labelOf('Z0003')));
});

test('the card page is a print page: A4 cards, no topbar, a print button', async () => {
  const { app } = setup();
  const html = await (await app.request('/zamestnanci/karty')).text();
  assert.match(html, /href="\/static\/print\.css"/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /Tlačiť/);
  assert.equal((html.match(/class="card-print"/g) ?? []).length, 2);
});

test('with no worker to print the page says so', async () => {
  const env = testEnv();
  assert.match(await (await createApp(env).request('/zamestnanci/karty')).text(), /Nie je koho tlačiť/);
});

test('card names are HTML-escaped', async () => {
  const env = testEnv();
  createWorker(env.db, '<b>Hacker</b>');
  const html = await (await createApp(env).request('/zamestnanci/karty')).text();
  assert.doesNotMatch(html, /<b>Hacker/);
  assert.match(html, /&lt;b&gt;Hacker/);
});

test('the worker list has a checkbox per worker feeding the card page', async () => {
  const { app, jan } = setup();
  const html = await (await app.request('/zamestnanci')).text();
  assert.match(html, new RegExp(`<input type="checkbox" name="id" value="${jan.id}" form="cards-form"`));
});

test('the control-code page holds all six codes with Slovak labels and a how-to', async () => {
  const html = await (await createApp(testEnv()).request('/tlac/kody')).text();
  for (const code of ['C-VYCH', 'C-BAL', 'C-KONIEC', 'C-PAUZA', 'C-POKRAC', 'C-ODHLAS']) assert.ok(html.includes(labelOf(code)), code);
  for (const label of ['Vychystanie', 'Balenie', 'Koniec DL', 'Pauza', 'Pokračovať', 'Odhlásiť']) assert.ok(html.includes(label), label);
  assert.match(html, /href="\/static\/print\.css"/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
});
