import test from 'node:test';
import assert from 'node:assert/strict';
import {
  intersectRaySegment,
  mirrorFromCenter,
  reflect,
  traceReflectionRay
} from './rayEngine.js';

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
};

test('ray intersects a vertical mirror at the expected point', () => {
  const mirror = { id: 'm1', a: { x: 5, y: -2 }, b: { x: 5, y: 2 } };
  const hit = intersectRaySegment({ x: 0, y: 0 }, { x: 1, y: 0 }, mirror);
  assert.ok(hit);
  close(hit.point.x, 5);
  close(hit.point.y, 0);
  close(hit.distance, 5);
});

test('reflection from a vertical mirror reverses horizontal direction', () => {
  const reflected = reflect({ x: 1, y: 0 }, { x: -1, y: 0 });
  close(reflected.x, -1);
  close(reflected.y, 0);
});

test('45 degree mirror turns a right-moving ray downward', () => {
  const rootHalf = Math.SQRT1_2;
  const reflected = reflect({ x: 1, y: 0 }, { x: -rootHalf, y: rootHalf });
  close(reflected.x, 0, 1e-5);
  close(reflected.y, 1, 1e-5);
});

test('mirrorFromCenter creates a segment with requested length', () => {
  const mirror = mirrorFromCenter({ id: 'm1', x: 10, y: 10, length: 8, rotation: Math.PI / 4 });
  const segmentLength = Math.hypot(mirror.b.x - mirror.a.x, mirror.b.y - mirror.a.y);
  close(segmentLength, 8);
});

test('traceReflectionRay selects the nearest mirror and records a bounce', () => {
  const mirrors = [
    { id: 'near', a: { x: 4, y: -2 }, b: { x: 4, y: 2 } },
    { id: 'far', a: { x: 8, y: -2 }, b: { x: 8, y: 2 } }
  ];

  const result = traceReflectionRay({
    origin: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    mirrors,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    maxBounces: 5
  });

  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].mirrorId, 'near');
  close(result.hits[0].point.x, 4);
  assert.equal(result.segments.length, 2);
});

test('incidence and reflection angles are equal for every recorded hit', () => {
  const mirror = mirrorFromCenter({ id: 'm1', x: 5, y: 0, length: 10, rotation: Math.PI / 3 });
  const result = traceReflectionRay({
    origin: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    mirrors: [mirror],
    bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
    maxBounces: 2
  });

  assert.equal(result.hits.length, 1);
  close(result.hits[0].incidenceRadians, result.hits[0].reflectionRadians);
});
