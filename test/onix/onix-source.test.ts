import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildConfig, type OnixConfig } from '../../src/config.ts';
import { createOnixSource, type QueryFn } from '../../src/onix/onix-source.ts';
import { addDl, onixDb, SCHEMA_SQL, type OnixDb } from './helpers.ts';

function sourceOver(db: OnixDb, onix: Partial<OnixConfig> = {}) {
  const bad: string[] = [];
  const source = createOnixSource(db.query, buildConfig({ onix }).onix, { onBadRow: (p) => bad.push(p) });
  return { source, bad };
}

const numbers = (ns: { number: string }[]): string[] => ns.map((n) => n.number).sort();

test('fetchActive maps a delivery note: numeric columns arrive as numbers, the date as YYYY-MM-DD', async () => {
  const db = await onixDb();
  const master = await addDl(db, { number: 'DL-1', daysAgo: 2, partner: 'Firma s.r.o.', state: 'Na vychystanie', type: 'Predajný DL', weight: 12.5, lines: [{ amount: -3 }, { amount: 2 }] });
  const { source, bad } = sourceOver(db);
  const [n, ...rest] = await source.fetchActive();
  assert.equal(rest.length, 0);
  assert.equal(typeof n?.date, 'string');
  assert.match(n?.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({ ...n, date: null }, { number: 'DL-1', onixIdMaster: master, date: null, customer: 'Firma s.r.o.', state: 'Na vychystanie', type: 'Predajný DL', lines: 2, units: 5, weightKg: 12.5 });
  assert.deepEqual(bad, []);
});

test('the state filter leaves out other states; an empty list follows every state', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'A', state: 'Na vychystanie' });
  await addDl(db, { number: 'B', state: 'Vyfakturovaný' });
  assert.deepEqual(numbers(await sourceOver(db, { activeStates: ['Na vychystanie'] }).source.fetchActive()), ['A']);
  assert.deepEqual(numbers(await sourceOver(db, { activeStates: ['Na vychystanie', 'Vyfakturovaný'] }).source.fetchActive()), ['A', 'B']);
  assert.deepEqual(numbers(await sourceOver(db, { activeStates: [] }).source.fetchActive()), ['A', 'B']);
});

test('the type filter leaves out other document types', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'A', type: 'Predajný DL' });
  await addDl(db, { number: 'B', type: 'Výdajka' });
  assert.deepEqual(numbers(await sourceOver(db, { documentTypes: ['Predajný DL'] }).source.fetchActive()), ['A']);
  assert.deepEqual(numbers(await sourceOver(db, { documentTypes: [] }).source.fetchActive()), ['A', 'B']);
});

test('daysBack leaves out older notes and keeps the one exactly daysBack old', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'EDGE', daysAgo: 30 });
  await addDl(db, { number: 'OLD', daysAgo: 31 });
  assert.deepEqual(numbers(await sourceOver(db, { daysBack: 30 }).source.fetchActive()), ['EDGE']);
  assert.deepEqual(numbers(await sourceOver(db, { daysBack: 365 }).source.fetchActive()), ['EDGE', 'OLD']);
});

test('lines without a stock item (transport, services) are not counted', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'A', lines: [{ amount: 4 }, { amount: -1 }, { amount: 1, stock: false }, { amount: 25, stock: false }] });
  await addDl(db, { number: 'NOSTOCK', lines: [{ amount: 1, stock: false }] });
  const notes = await sourceOver(db).source.fetchActive();
  assert.deepEqual(notes.filter((n) => n.number === 'A').map((n) => [n.lines, n.units]), [[2, 5]]);
  assert.deepEqual(notes.filter((n) => n.number === 'NOSTOCK').map((n) => [n.lines, n.units]), [[0, 0]]);
});

test('drafts, old history versions and other document types are not delivery notes', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'OK' });
  await addDl(db, { number: 'DRAFT', draft: 1 });
  await addDl(db, { number: 'ORDER', baseType: 1000 });
  const master = await addDl(db, { number: 'EDITED', version: 1 });
  await addDl(db, { number: 'EDITED', version: 2, idMaster: master });
  assert.deepEqual(numbers(await sourceOver(db).source.fetchActive()), ['EDITED', 'OK']);
});

test('fetchByNumber ignores the state, type and date filters; an unknown number gives null', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'DONE', state: 'Vyfakturovaný', type: 'Výdajka', daysAgo: 400 });
  const { source } = sourceOver(db, { activeStates: ['Na vychystanie'], documentTypes: ['Predajný DL'], daysBack: 30 });
  assert.deepEqual(await source.fetchActive(), []);
  assert.equal((await source.fetchByNumber('DONE'))?.state, 'Vyfakturovaný');
  assert.equal(await source.fetchByNumber('NOPE'), null);
});

test('the number is a query parameter, never part of the SQL', async () => {
  const db = await onixDb();
  await addDl(db, { number: 'DL-1' });
  assert.equal(await sourceOver(db).source.fetchByNumber(`x' OR '1'='1`), null);
});

const good = { id_master: 7, ns_number: 'DL-7', date_document: '2026-10-14', partner_name: 'Firma', stav: 'Nový', druh: null, hmotnost_kg: '12.500', pocet_poloziek: '3', pocet_mj: '10.0000' };

function fakeQuery(...rows: Record<string, unknown>[]): QueryFn {
  return async () => rows;
}

test('pg strings for bigint and numeric are converted; garbage is skipped and reported, never returned', async () => {
  const garbage: Record<string, unknown>[] = [
    { ...good, ns_number: 'G1', hmotnost_kg: 'abc' },
    { ...good, ns_number: 'G2', pocet_poloziek: '2.5' },
    { ...good, ns_number: 'G3', pocet_mj: '1e3' },
    { ...good, ns_number: 'G4', hmotnost_kg: -1 },
    { ...good, ns_number: 'G5', date_document: '14.10.2026' },
    { ...good, ns_number: 'G6', id_master: 'x' },
    { ...good, ns_number: 'G7', stav: 5 },
    { ...good, ns_number: '' },
    { ...good, ns_number: null },
    { ...good, ns_number: 'G10', pocet_poloziek: Number.NaN },
  ];
  const bad: string[] = [];
  const source = createOnixSource(fakeQuery(good, ...garbage), buildConfig().onix, { onBadRow: (p) => bad.push(p) });
  const notes = await source.fetchActive();
  assert.deepEqual(notes, [{ number: 'DL-7', onixIdMaster: 7, date: '2026-10-14', customer: 'Firma', state: 'Nový', type: null, lines: 3, units: 10, weightKg: 12.5 }]);
  assert.equal(bad.length, garbage.length);
  assert.ok(bad.every((p) => p.length > 0));
});

test('a missing weight stays null (cards without a weight are an open question, not an error)', async () => {
  const source = createOnixSource(fakeQuery({ ...good, hmotnost_kg: null }), buildConfig().onix);
  assert.equal((await source.fetchActive())[0]?.weightKg, null);
});

test('fetchByNumber reports a malformed row and answers null', async () => {
  const bad: string[] = [];
  const source = createOnixSource(fakeQuery({ ...good, hmotnost_kg: 'abc' }), buildConfig().onix, { onBadRow: (p) => bad.push(p) });
  assert.equal(await source.fetchByNumber('DL-7'), null);
  assert.equal(bad.length, 1);
});

test('a query error reaches the caller', async () => {
  const source = createOnixSource(async () => Promise.reject(new Error('connection refused')), buildConfig().onix);
  await assert.rejects(source.fetchActive(), /connection refused/);
  await assert.rejects(source.fetchByNumber('X'), /connection refused/);
});

test('the view name is an identifier, never SQL', () => {
  assert.throws(() => createOnixSource(fakeQuery(), buildConfig({ onix: { view: 'skl_aktivne_dl; DROP TABLE documents' } }).onix), /view/);
  assert.doesNotThrow(() => createOnixSource(fakeQuery(), buildConfig({ onix: { view: 'public.skl_aktivne_dl' } }).onix));
});

test('the fixture holds a verbatim copy of the view in docs/onix-view.sql, and that file installs and grants on the fixture', async () => {
  const docs = readFileSync(new URL('../../docs/onix-view.sql', import.meta.url), 'utf8');
  const copy = /-- BEGIN VIEW\n([\s\S]*?)-- END VIEW/.exec(SCHEMA_SQL)?.[1];
  assert.ok(copy && docs.includes(copy), 'the view in test/fixtures/onix-schema.sql differs from docs/onix-view.sql');
  const db = await onixDb();
  await db.pg.exec('CREATE ROLE skladpulz_ro');
  await db.pg.exec(docs);
});
