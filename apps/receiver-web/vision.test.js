import test from 'node:test';
import assert from 'node:assert/strict';

import { getCenteredGuideRect } from './vision.js';

test('centered guide is square and centered in a landscape frame', () => {
  const guide = getCenteredGuideRect(640, 480, 0.82);
  assert.equal(guide.width, 393);
  assert.equal(guide.height, 393);
  assert.equal(guide.x, 123);
  assert.equal(guide.y, 43);
});

test('centered guide uses the smaller dimension in portrait', () => {
  const guide = getCenteredGuideRect(360, 640, 0.8);
  assert.deepEqual(guide, {
    x: 36,
    y: 176,
    width: 288,
    height: 288,
  });
});

test('invalid guide coverage is rejected', () => {
  assert.throws(() => getCenteredGuideRect(640, 480, 0));
  assert.throws(() => getCenteredGuideRect(640, 480, 1.1));
});
