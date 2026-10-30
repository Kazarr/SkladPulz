import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barcodeSvg, MIN_MODULE_MM } from '../../src/print/barcode.ts';
import { CONTROL_CODES } from '../../src/print/control-codes.ts';
import { classifyScan } from '../../src/domain/scan-code.ts';

function moduleMm(svg: string): number {
  const width = Number(/<svg[^>]* width="([\d.]+)mm"/.exec(svg)?.[1]);
  const modules = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  return width / modules;
}

test('the barcode names the encoded text and draws bars for it', () => {
  const svg = barcodeSvg('Z0012');
  assert.match(svg, /^<svg /);
  assert.match(svg, /aria-label="Z0012"/);
  assert.match(svg, /<path stroke=/);
  assert.notEqual(barcodeSvg('Z0013'), svg);
  assert.equal(barcodeSvg('Z0012'), svg);
});

test('a module is printed at least as wide as a handheld scanner needs', () => {
  assert.ok(MIN_MODULE_MM >= 0.33);
  assert.ok(moduleMm(barcodeSvg('Z0012')) >= 0.33);
  assert.ok(moduleMm(barcodeSvg('C-KONIEC', 0.5)) >= 0.5);
  assert.throws(() => barcodeSvg('Z0012', 0.2), /module/i);
});

test('the text is escaped in the label', () => {
  assert.match(barcodeSvg('A"<b>'), /aria-label="A&quot;&lt;b&gt;"/);
});

test('every control code is one the station understands', () => {
  assert.deepEqual(
    CONTROL_CODES.map((c) => c.code),
    ['C-VYCH', 'C-BAL', 'C-KONIEC', 'C-PAUZA', 'C-POKRAC', 'C-ODHLAS'],
  );
  for (const c of CONTROL_CODES) assert.ok(['activity', 'control'].includes(classifyScan(c.code).kind), c.code);
});
