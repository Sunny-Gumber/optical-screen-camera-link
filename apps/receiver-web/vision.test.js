import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSquareToQuadHomography,
  getCenteredGuideRect,
  mapPerspectivePoint,
  validateCornerQuad,
} from './vision.js';

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

test('square-to-quad homography maps all four output corners correctly', () => {
  const corners = [
    { x: 100, y: 50 },
    { x: 500, y: 70 },
    { x: 470, y: 390 },
    { x: 120, y: 420 },
  ];
  const size = 304;
  const h = computeSquareToQuadHomography(corners, size);
  const expected = corners;
  const samples = [
    [0, 0],
    [size - 1, 0],
    [size - 1, size - 1],
    [0, size - 1],
  ];

  samples.forEach(([u, v], index) => {
    const mapped = mapPerspectivePoint(h, u, v);
    assert.ok(Math.abs(mapped.x - expected[index].x) < 1e-6);
    assert.ok(Math.abs(mapped.y - expected[index].y) < 1e-6);
  });
});

test('perspective mapping handles an axis-aligned square', () => {
  const corners = [
    { x: 20, y: 30 },
    { x: 323, y: 30 },
    { x: 323, y: 333 },
    { x: 20, y: 333 },
  ];
  const h = computeSquareToQuadHomography(corners, 304);
  const center = mapPerspectivePoint(h, 151.5, 151.5);
  assert.ok(Math.abs(center.x - 171.5) < 1e-6);
  assert.ok(Math.abs(center.y - 181.5) < 1e-6);
});

test('corner quad validation rejects degenerate selections', () => {
  assert.equal(validateCornerQuad([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]), true);

  assert.equal(validateCornerQuad([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]), false);
});
