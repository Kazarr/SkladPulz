import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleScan } from '../../src/station/scan-service.ts';
import { createStation } from '../../src/store/stations.ts';
import { createWorker } from '../../src/store/workers.ts';
import { upsertNote } from '../../src/store/delivery-notes.ts';
import { getRecord, getRunningRecord } from '../../src/store/records.ts';
import { at, note, testEnv, type TestEnv } from '../helpers.ts';

function setup(over: Parameters<typeof testEnv>[0] = {}): TestEnv & { pick: number; pack: number; jan: number; eva: number } {
  const env = testEnv(over);
  const pick = createStation(env.db, 'Vychystávanie', null).id;
  const pack = createStation(env.db, 'Baliaci stôl', 'BAL').id;
  const jan = createWorker(env.db, 'Ján Novák', 'Z0001').id;
  const eva = createWorker(env.db, 'Eva Malá', 'Z0002').id;
  for (const n of ['DL1', 'DL2', 'DL3']) upsertNote(env.db, note(n, { lines: 4, weightKg: 10 }), env.clock.t);
  return { ...env, pick, pack, jan, eva };
}

function records(env: TestEnv): Record<string, unknown>[] {
  return env.db.prepare('SELECT * FROM zaznam ORDER BY id').all() as Record<string, unknown>[];
}

test('card, activity and delivery note start a record; the next note ends it and starts another', async () => {
  const env = setup();
  assert.equal((await handleScan(env, env.pick, 'Z0001')).outcome, 'ok');
  assert.equal((await handleScan(env, env.pick, 'C-VYCH')).outcome, 'ok');
  const started = await handleScan(env, env.pick, 'DL1');
  assert.equal(started.outcome, 'ok');
  assert.equal(started.view.current?.running?.dlNumber, 'DL1');
  assert.equal(started.view.current?.running?.customer, 'Odberateľ DL1');
  assert.equal(started.view.current?.running?.lines, 4);
  assert.equal(started.view.current?.running?.weightKg, 10);

  env.clock.advance(120);
  await handleScan(env, env.pick, 'DL2');
  const [first, second] = records(env);
  assert.equal(first?.['sposob_ukoncenia'], 'dalsi_dl');
  assert.equal(first?.['cisty_cas_s'], 120);
  assert.equal(first?.['stav'], 'ok');
  assert.equal(first?.['cinnost'], 'VYCH');
  assert.equal(second?.['koniec'], null);
  assert.equal(second?.['stav'], 'bezi');
});

test('a delivery note before a card or before an activity is refused', async () => {
  const env = setup();
  assert.equal((await handleScan(env, env.pick, 'DL1')).outcome, 'chyba');
  await handleScan(env, env.pick, 'Z0001');
  const noActivity = await handleScan(env, env.pick, 'DL1');
  assert.equal(noActivity.outcome, 'chyba');
  assert.match(noActivity.message, /činnosť/);
  assert.equal(records(env).length, 0);
});

test("the station's default activity applies on sign-in", async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  assert.equal(records(env)[0]?.['cinnost'], 'BAL');
});

test('C-KONIEC and C-ODHLAS end the running record with their method', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  env.clock.advance(60);
  await handleScan(env, env.pack, 'C-KONIEC');
  await handleScan(env, env.pack, 'DL2');
  env.clock.advance(90);
  const out = await handleScan(env, env.pack, 'C-ODHLAS');
  const [a, b] = records(env);
  assert.equal(a?.['sposob_ukoncenia'], 'koniec');
  assert.equal(b?.['sposob_ukoncenia'], 'odhlas');
  assert.equal(b?.['cisty_cas_s'], 90);
  assert.equal(out.view.current, null);
});

test('a pause is left out of the net time, also when the record ends while paused', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  env.clock.advance(100);
  await handleScan(env, env.pack, 'C-PAUZA');
  env.clock.advance(600);
  await handleScan(env, env.pack, 'C-POKRAC');
  env.clock.advance(50);
  await handleScan(env, env.pack, 'C-PAUZA');
  env.clock.advance(300);
  await handleScan(env, env.pack, 'C-KONIEC');
  const [r] = records(env);
  assert.equal(r?.['pauza_s'], 900);
  assert.equal(r?.['cisty_cas_s'], 150);
});

test('pause without a running note, a second pause and resume without pause only warn', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  assert.equal((await handleScan(env, env.pack, 'C-PAUZA')).outcome, 'upozornenie');
  await handleScan(env, env.pack, 'DL1');
  assert.equal((await handleScan(env, env.pack, 'C-POKRAC')).outcome, 'upozornenie');
  await handleScan(env, env.pack, 'C-PAUZA');
  assert.equal((await handleScan(env, env.pack, 'C-PAUZA')).outcome, 'upozornenie');
  assert.equal((env.db.prepare('SELECT count(*) AS n FROM pauza').get() as { n: number }).n, 1);
});

test('workers take turns at one station; each keeps their own running record', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  env.clock.advance(30);
  await handleScan(env, env.pack, 'Z0002');
  const view = (await handleScan(env, env.pack, 'DL2')).view;
  assert.equal(view.current?.name, 'Eva Malá');
  assert.equal(view.others[0]?.name, 'Ján Novák');
  assert.equal(view.others[0]?.running?.dlNumber, 'DL1');
  assert.ok(getRunningRecord(env.db, env.jan));
  assert.ok(getRunningRecord(env.db, env.eva));
  env.clock.advance(30);
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL3');
  assert.equal(getRecord(env.db, 1)?.netSeconds, 60);
  assert.equal(getRunningRecord(env.db, env.eva)?.dlNumber, 'DL2');
});

test('a worker has at most one running record, also across stations', async () => {
  const env = setup();
  await handleScan(env, env.pick, 'Z0001');
  await handleScan(env, env.pick, 'C-VYCH');
  await handleScan(env, env.pick, 'DL1');
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  const running = env.db.prepare('SELECT count(*) AS n FROM zaznam WHERE zamestnanec_id = ? AND koniec IS NULL').get(env.jan) as { n: number };
  assert.equal(running.n, 1);
  assert.equal(getRunningRecord(env.db, env.jan)?.activity, 'BAL');
  assert.throws(() =>
    env.db.prepare("INSERT INTO zaznam (zamestnanec_id, cinnost, cislo_dl, zaciatok) VALUES (?, 'VYCH', 'X', 0)").run(env.jan),
  );
});

test('changing the activity ends the running record of the other activity', async () => {
  const env = setup();
  await handleScan(env, env.pick, 'Z0001');
  await handleScan(env, env.pick, 'C-VYCH');
  await handleScan(env, env.pick, 'DL1');
  env.clock.advance(40);
  await handleScan(env, env.pick, 'C-BAL');
  assert.equal(records(env)[0]?.['sposob_ukoncenia'], 'zmena_cinnosti');
  assert.equal(getRunningRecord(env.db, env.jan), null);
});

test('a note already done by someone else with the same activity starts with a duplicate warning', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  await handleScan(env, env.pack, 'C-KONIEC');
  await handleScan(env, env.pack, 'Z0002');
  const dup = await handleScan(env, env.pack, 'DL1');
  assert.equal(dup.outcome, 'upozornenie');
  assert.match(dup.message, /Ján Novák/);
  assert.equal(records(env)[1]?.['duplicita'], 1);
  // The other activity on the same note is not a duplicate.
  await handleScan(env, env.pick, 'Z0001');
  await handleScan(env, env.pick, 'C-VYCH');
  assert.equal((await handleScan(env, env.pick, 'DL1')).outcome, 'ok');
});

test('when a second worker starts the same note and activity, both records are flagged as duplicates; excluded ones and other activities are not', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  await handleScan(env, env.pack, 'C-KONIEC');
  await handleScan(env, env.pack, 'DL2');
  await handleScan(env, env.pack, 'Z0002');
  await handleScan(env, env.pack, 'DL1');
  const flags = () => records(env).map((r) => [r['cislo_dl'], r['zamestnanec_id'], r['duplicita']]);
  assert.deepEqual(flags(), [['DL1', env.jan, 1], ['DL2', env.jan, 0], ['DL1', env.eva, 1]]);

  // A running earlier record is flagged too.
  await handleScan(env, env.pick, 'Z0001');
  await handleScan(env, env.pick, 'C-VYCH');
  await handleScan(env, env.pick, 'DL3');
  await handleScan(env, env.pick, 'Z0002');
  await handleScan(env, env.pick, 'C-VYCH');
  await handleScan(env, env.pick, 'DL3');
  assert.deepEqual(records(env).filter((r) => r['cislo_dl'] === 'DL3').map((r) => r['duplicita']), [1, 1]);
});

test('an excluded earlier record is not touched when another worker starts the same note', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  await handleScan(env, env.pack, 'C-KONIEC');
  env.db.prepare("UPDATE zaznam SET stav = 'vylucene' WHERE id = 1").run();
  await handleScan(env, env.pack, 'Z0002');
  const res = await handleScan(env, env.pack, 'DL1');
  assert.equal(res.outcome, 'ok');
  assert.deepEqual(records(env).map((r) => r['duplicita']), [0, 0]);
});

test('scanning a note you already finished with the same activity warns, and the new record is a duplicate that does not count', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  env.clock.advance(120);
  await handleScan(env, env.pack, 'C-KONIEC');
  env.clock.advance(60);
  const again = await handleScan(env, env.pack, 'DL1');
  assert.equal(again.outcome, 'upozornenie');
  assert.match(again.message, /tento DL ste už zabalili/);
  assert.equal(again.view.current?.running?.dlNumber, 'DL1');
  assert.deepEqual(records(env).map((r) => r['duplicita']), [0, 1]);
  env.clock.advance(120);
  await handleScan(env, env.pack, 'C-KONIEC');
  const counted = env.db.prepare('SELECT id FROM zaznam_hodnotene').all() as { id: number }[];
  assert.deepEqual(counted.map((r) => r.id), [1]);
});

test('re-scanning the note that is running still only says it runs; a note of another activity or an excluded record of your own is no duplicate', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  const running = await handleScan(env, env.pack, 'DL1');
  assert.match(running.message, /už beží/);
  assert.equal(records(env).length, 1);
  await handleScan(env, env.pack, 'C-KONIEC');
  env.db.prepare("UPDATE zaznam SET stav = 'vylucene' WHERE id = 1").run();
  assert.equal((await handleScan(env, env.pack, 'DL1')).outcome, 'ok');
  await handleScan(env, env.pack, 'C-KONIEC');
  await handleScan(env, env.pack, 'C-VYCH');
  assert.equal((await handleScan(env, env.pack, 'DL1')).outcome, 'ok');
  assert.deepEqual(records(env).map((r) => r['duplicita']), [0, 0, 0]);
});

test('a record that ended while ONIX was down gets its snapshot when a later lookup fetches the note', async () => {
  const env = setup();
  env.source.add(note('DL900', { lines: 40, units: 90, weightKg: 123 }));
  env.source.down = true;
  await handleScan(env, env.pack, 'Z0001');
  assert.equal((await handleScan(env, env.pack, 'DL900')).outcome, 'upozornenie');
  env.clock.advance(60);
  await handleScan(env, env.pack, 'C-KONIEC');
  assert.equal(getRecord(env.db, 1)?.lines, null);
  env.source.down = false;
  await handleScan(env, env.pack, 'Z0002');
  await handleScan(env, env.pack, 'DL900');
  const r = getRecord(env.db, 1);
  assert.deepEqual([r?.lines, r?.units, r?.weightKg], [40, 90, 123]);
});

test('an unknown note is fetched from ONIX on demand; one ONIX does not know is refused in red', async () => {
  const env = setup();
  env.source.add(note('DL900', { customer: 'Nový odberateľ', lines: 40 }));
  await handleScan(env, env.pack, 'Z0001');
  const fetched = await handleScan(env, env.pack, 'DL900');
  assert.equal(fetched.outcome, 'ok');
  assert.equal(fetched.view.current?.running?.customer, 'Nový odberateľ');
  const unknown = await handleScan(env, env.pack, 'DL404');
  assert.equal(unknown.outcome, 'chyba');
  assert.equal(getRunningRecord(env.db, env.jan)?.dlNumber, 'DL900');
  assert.deepEqual(env.source.calls, ['DL900', 'DL404']);
});

test('with ONIX down an uncached note still starts, with a warning, and the outage is logged', async () => {
  const env = setup();
  env.source.down = true;
  await handleScan(env, env.pack, 'Z0001');
  const r = await handleScan(env, env.pack, 'DL777');
  assert.equal(r.outcome, 'upozornenie');
  assert.equal(getRunningRecord(env.db, env.jan)?.dlNumber, 'DL777');
  assert.equal(env.errors.length, 1);
  // A cached note needs no ONIX at all.
  assert.equal((await handleScan(env, env.pack, 'DL1')).outcome, 'ok');
});

test('the snapshot of lines and weight is taken when the record ends', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  upsertNote(env.db, note('DL1', { lines: 9, weightKg: 22.5, units: 30 }), env.clock.t);
  env.clock.advance(60);
  await handleScan(env, env.pack, 'C-KONIEC');
  upsertNote(env.db, note('DL1', { lines: 1, weightKg: 1 }), env.clock.t);
  const r = getRecord(env.db, 1);
  assert.equal(r?.lines, 9);
  assert.equal(r?.weightKg, 22.5);
  assert.equal(r?.units, 30);
});

test('records under the short limit and over the long limit are flagged suspect', async () => {
  const env = setup({ limits: { shortSeconds: 20, longSeconds: 600 } });
  await handleScan(env, env.pack, 'Z0001');
  await handleScan(env, env.pack, 'DL1');
  env.clock.advance(19);
  await handleScan(env, env.pack, 'DL2');
  env.clock.advance(20);
  await handleScan(env, env.pack, 'DL3');
  env.clock.advance(601);
  await handleScan(env, env.pack, 'C-KONIEC');
  assert.deepEqual(
    records(env).map((r) => r['podozrenie']),
    ['kratky', null, 'dlhy'],
  );
  const counted = env.db.prepare('SELECT cislo_dl FROM zaznam_hodnotene').all() as { cislo_dl: string }[];
  assert.deepEqual(counted.map((r) => r.cislo_dl), ['DL2']);
});

test('scanning the running note again only warns, unless repeatScanEnds is on', async () => {
  const off = setup();
  await handleScan(off, off.pack, 'Z0001');
  await handleScan(off, off.pack, 'DL1');
  assert.equal((await handleScan(off, off.pack, 'DL1')).outcome, 'upozornenie');
  assert.ok(getRunningRecord(off.db, off.jan));

  const on = setup({ repeatScanEnds: true });
  await handleScan(on, on.pack, 'Z0001');
  await handleScan(on, on.pack, 'DL1');
  await handleScan(on, on.pack, 'DL1');
  assert.equal(getRunningRecord(on.db, on.jan), null);
  assert.equal(records(on)[0]?.['sposob_ukoncenia'], 'koniec');
});

test('unknown and deactivated cards are refused', async () => {
  const env = setup();
  env.db.prepare('UPDATE zamestnanec SET aktivny = 0 WHERE id = ?').run(env.eva);
  assert.equal((await handleScan(env, env.pack, 'Z9999')).outcome, 'chyba');
  assert.equal((await handleScan(env, env.pack, 'Z0002')).outcome, 'chyba');
  assert.equal((await handleScan(env, env.pack, 'C-NIECO')).outcome, 'chyba');
});

test('every scan lands in scan_log with station, raw code and outcome', async () => {
  const env = setup();
  await handleScan(env, env.pack, 'Yééé+');
  await handleScan(env, env.pack, 'NEZNAMY');
  const log = (env.db.prepare('SELECT stanica_id, surovy_kod, kod, vysledok FROM scan_log ORDER BY id').all() as Record<string, unknown>[]).map((r) => ({ ...r }));
  assert.deepEqual(log, [
    { stanica_id: env.pack, surovy_kod: 'Yééé+', kod: 'Z0001', vysledok: 'ok' },
    { stanica_id: env.pack, surovy_kod: 'NEZNAMY', kod: 'NEZNAMY', vysledok: 'chyba' },
  ]);
});
