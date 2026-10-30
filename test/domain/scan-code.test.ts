import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScan, normalizeScan } from '../../src/domain/scan-code.ts';

test('classifies worker, activity, control and delivery-note codes', () => {
  assert.deepEqual(classifyScan('Z0012'), { kind: 'worker', code: 'Z0012' });
  assert.deepEqual(classifyScan('z0012'), { kind: 'worker', code: 'Z0012' });
  assert.deepEqual(classifyScan('C-VYCH'), { kind: 'activity', activity: 'VYCH' });
  assert.deepEqual(classifyScan('c-bal'), { kind: 'activity', activity: 'BAL' });
  assert.deepEqual(classifyScan('C-KONIEC'), { kind: 'control', control: 'KONIEC' });
  assert.deepEqual(classifyScan('C-PAUZA'), { kind: 'control', control: 'PAUZA' });
  assert.deepEqual(classifyScan('C-POKRAC'), { kind: 'control', control: 'POKRAC' });
  assert.deepEqual(classifyScan('C-ODHLAS'), { kind: 'control', control: 'ODHLAS' });
  assert.deepEqual(classifyScan('C-NIECO'), { kind: 'unknownControl', code: 'C-NIECO' });
  assert.deepEqual(classifyScan('DL2026001234'), { kind: 'deliveryNote', number: 'DL2026001234' });
  assert.deepEqual(classifyScan('  '), { kind: 'empty' });
});

test('a Z code needs at least four digits, otherwise it is a delivery note number', () => {
  assert.deepEqual(classifyScan('Z12'), { kind: 'deliveryNote', number: 'Z12' });
  assert.deepEqual(classifyScan('ZA0012'), { kind: 'deliveryNote', number: 'ZA0012' });
});

test('undoes a scanner typing through a Slovak keyboard layout', () => {
  assert.equal(normalizeScan('Yéé+ľ'), 'Z0012');
  assert.equal(normalizeScan('C=KONIEC'), 'C-KONIEC');
  assert.equal(normalizeScan('C=PAUYA'), 'C-PAUZA');
  assert.equal(normalizeScan('ľéľžééš+'), '20260031');
});

test('leaves a correctly typed scan alone apart from trimming', () => {
  assert.equal(normalizeScan(' Z0012 \r'), 'Z0012');
  assert.equal(normalizeScan('C-PAUZA'), 'C-PAUZA');
  assert.equal(normalizeScan('DL-2026/0031'), 'DL-2026/0031');
  assert.equal(normalizeScan('OBY-12'), 'OBY-12');
});
