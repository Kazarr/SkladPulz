import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBands, type Band } from '../../src/domain/bands.ts';

function bands(indices: (number | null)[]): (Band | null)[] {
  const m = splitBands(indices.map((index, id) => ({ id, index })));
  return indices.map((_, id) => m.get(id) ?? null);
}
const count = (b: (Band | null)[], band: Band): number => b.filter((x) => x === band).length;

test('10 workers split 3 top / 4 middle / 3 bottom by index', () => {
  const b = bands([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(b, ['top', 'top', 'top', 'middle', 'middle', 'middle', 'middle', 'bottom', 'bottom', 'bottom']);
});

test('order of the input does not matter', () => {
  const b = bands([10, 100, 50]);
  assert.deepEqual(b, ['bottom', 'top', 'middle']);
});

test('3 workers: one top, one middle, one bottom', () => {
  assert.deepEqual(bands([120, 100, 80]), ['top', 'middle', 'bottom']);
});

test('2 workers: one top, one bottom; 1 worker: middle (nobody is best or worst alone)', () => {
  assert.deepEqual(bands([120, 80]), ['top', 'bottom']);
  assert.deepEqual(bands([100]), ['middle']);
});

test('band sizes round half down so fewer workers are labelled top or bottom (5 -> 1/3/1, 15 -> 4/7/4)', () => {
  const five = bands([5, 4, 3, 2, 1]);
  assert.deepEqual([count(five, 'top'), count(five, 'middle'), count(five, 'bottom')], [1, 3, 1]);
  const fifteen = bands(Array.from({ length: 15 }, (_, i) => i));
  assert.deepEqual([count(fifteen, 'top'), count(fifteen, 'middle'), count(fifteen, 'bottom')], [4, 7, 4]);
});

test('a tie is never split: a tie group touching two bands goes to the middle', () => {
  // positions 2 and 3 tie; top has 3 places
  const b = bands([100, 90, 80, 80, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(b.slice(0, 5), ['top', 'top', 'middle', 'middle', 'middle']);
  assert.deepEqual(b.slice(7), ['bottom', 'bottom', 'bottom']);
  // tie on the bottom border
  const c = bands([100, 90, 80, 70, 60, 50, 40, 40, 30, 10]);
  assert.deepEqual(c.slice(6), ['middle', 'middle', 'bottom', 'bottom']);
});

test('everyone tied: everyone is middle', () => {
  assert.deepEqual(bands([100, 100, 100]), ['middle', 'middle', 'middle']);
});

test('a tie wholly inside a band stays in it', () => {
  const b = bands([100, 100, 100, 70, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(b.slice(0, 4), ['top', 'top', 'top', 'middle']);
});

test('workers without an index get no band and do not count towards the sizes', () => {
  const b = bands([null, 120, 100, 80, null]);
  assert.deepEqual(b, [null, 'top', 'middle', 'bottom', null]);
});
