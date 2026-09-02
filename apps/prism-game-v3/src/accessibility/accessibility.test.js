import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, keyboardIntent } from './accessibility.js';

test('primary text and muted text meet WCAG AA contrast on the game background', () => {
  assert.ok(contrastRatio('#edf7ff', '#040a12') >= 7);
  assert.ok(contrastRatio('#a9c2d3', '#07131f') >= 4.5);
  assert.ok(contrastRatio('#ffe991', '#07131f') >= 4.5);
});

test('keyboard arrows support normal and fine movement', () => {
  assert.deepEqual(keyboardIntent({ key: 'ArrowLeft' }), { type: 'move', dx: -12, dy: 0 });
  assert.deepEqual(keyboardIntent({ key: 'ArrowUp', shiftKey: true }), { type: 'move', dx: 0, dy: -3 });
});

test('keyboard rotation and navigation commands map predictably', () => {
  assert.deepEqual(keyboardIntent({ key: 'q' }), { type: 'rotate', degrees: -15 });
  assert.deepEqual(keyboardIntent({ key: 'E' }), { type: 'rotate', degrees: 15 });
  assert.deepEqual(keyboardIntent({ key: ']' }), { type: 'cycle', delta: 1 });
  assert.deepEqual(keyboardIntent({ key: 'Escape' }), { type: 'levels' });
});
