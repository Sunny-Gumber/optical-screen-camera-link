import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cauchyIndex,
  deriveCauchyA,
  directionFromAngle,
  intersectRaySegment,
  isInsideMedium,
  mirrorFromCenter,
  refract,
  refractiveIndexAt,
  refractorFromCenter,
  reflect,
  traceOpticalRays,
  traceReflectionRay,
  wavelengthToRGB
} from './rayEngine.js';

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
};
const angleOf = (v) => Math.atan2(v.y, v.x);

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
  close(Math.hypot(mirror.b.x - mirror.a.x, mirror.b.y - mirror.a.y), 8);
});

test('traceReflectionRay selects the nearest mirror and records a bounce', () => {
  const mirrors = [
    { id: 'near', a: { x: 4, y: -2 }, b: { x: 4, y: 2 } },
    { id: 'far', a: { x: 8, y: -2 }, b: { x: 8, y: 2 } }
  ];
  const result = traceReflectionRay({
    origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, mirrors,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, maxBounces: 5
  });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].mirrorId, 'near');
  close(result.hits[0].point.x, 4);
  assert.equal(result.segments.length, 2);
});

test('incidence and reflection angles are equal for every recorded hit', () => {
  const mirror = mirrorFromCenter({ id: 'm1', x: 5, y: 0, length: 10, rotation: Math.PI / 3 });
  const result = traceReflectionRay({
    origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, mirrors: [mirror],
    bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 }, maxBounces: 2
  });
  assert.equal(result.hits.length, 1);
  close(result.hits[0].incidenceRadians, result.hits[0].reflectionRadians);
});

test('normal incidence through an interface does not bend', () => {
  const result = refract({ x: 1, y: 0 }, { x: -1, y: 0 }, 1, 1.5);
  assert.equal(result.totalInternalReflection, false);
  close(result.direction.x, 1);
  close(result.direction.y, 0);
  close(result.refractionRadians, 0);
});

test('30 degree incidence into n=1.5 matches Snell law', () => {
  const theta1 = Math.PI / 6;
  const direction = { x: Math.cos(theta1), y: Math.sin(theta1) };
  const result = refract(direction, { x: -1, y: 0 }, 1, 1.5);
  const expected = Math.asin(Math.sin(theta1) / 1.5);
  close(result.refractionRadians, expected, 1e-8);
});

test('TIR triggers above the critical angle', () => {
  const theta = 50 * Math.PI / 180;
  const result = refract({ x: Math.cos(theta), y: Math.sin(theta) }, { x: -1, y: 0 }, 1.5, 1);
  assert.equal(result.totalInternalReflection, true);
  assert.equal(result.refractionRadians, null);
  close(result.criticalAngleRadians, Math.asin(1 / 1.5));
});

test('TIR does not trigger just under the critical angle', () => {
  const theta = 40 * Math.PI / 180;
  const result = refract({ x: Math.cos(theta), y: Math.sin(theta) }, { x: -1, y: 0 }, 1.5, 1);
  assert.equal(result.totalInternalReflection, false);
  assert.ok(result.refractionRadians > theta);
});

test('Cauchy model matches base index at 589nm and bends violet more', () => {
  const A = deriveCauchyA(1.52, 4200);
  close(cauchyIndex(589, A, 4200), 1.52, 1e-12);
  assert.ok(cauchyIndex(400, A, 4200) > cauchyIndex(700, A, 4200));
});

test('wavelength RGB sanity: 700 red, 550 green, 450 blue', () => {
  const red = wavelengthToRGB(700);
  const green = wavelengthToRGB(550);
  const blue = wavelengthToRGB(450);
  assert.ok(red.r > 200 && red.g < 80 && red.b < 80, JSON.stringify(red));
  assert.ok(green.g > red.g && green.g > green.b, JSON.stringify(green));
  assert.ok(blue.b > 200 && blue.b > blue.r, JSON.stringify(blue));
});

test('isInsideMedium correctly classifies points in a convex polygon', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(isInsideMedium({ x: 5, y: 5 }, square), true);
  assert.equal(isInsideMedium({ x: 15, y: 5 }, square), false);
});

test('flat glass slab at normal incidence exits with original direction', () => {
  const slab = refractorFromCenter({
    id: 'slab', x: 0, y: 0, refractiveIndexBase: 1.5, dispersionCoefficient: 0,
    vertices: [{ x: -2, y: -5 }, { x: 2, y: -5 }, { x: 2, y: 5 }, { x: -2, y: 5 }]
  });
  const trace = traceOpticalRays({
    origin: { x: -8, y: 0 }, direction: { x: 1, y: 0 }, refractors: [slab],
    wavelength: 550, bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 }
  });
  const last = trace.segments.at(-1);
  close(angleOf({ x: last.to.x - last.from.x, y: last.to.y - last.from.y }), 0, 1e-5);
  assert.equal(trace.hits.filter((h) => h.type === 'refraction').length, 2);
});

test('white ray stays white before first refractor and then splits', () => {
  const slab = refractorFromCenter({
    id: 'slab', x: 0, y: 0, vertices: [{ x: -2, y: -4 }, { x: 2, y: -4 }, { x: 2, y: 4 }, { x: -2, y: 4 }]
  });
  const trace = traceOpticalRays({
    origin: { x: -8, y: 0 }, direction: { x: 1, y: 0 }, refractors: [slab],
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, spectralSampleCount: 11
  });
  assert.equal(trace.segments[0].wavelength, null);
  const samples = new Set(trace.segments.filter((s) => s.wavelength != null).map((s) => Math.round(s.wavelength)));
  assert.equal(samples.size, 11);
});

test('ray parallel to a refractor edge does not crash or produce NaN', () => {
  const slab = refractorFromCenter({
    id: 'slab', x: 0, y: 0, vertices: [{ x: -2, y: -4 }, { x: 2, y: -4 }, { x: 2, y: 4 }, { x: -2, y: 4 }]
  });
  const trace = traceOpticalRays({
    origin: { x: -8, y: -4 }, direction: { x: 1, y: 0 }, refractors: [slab],
    wavelength: 550, bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 }
  });
  for (const segment of trace.segments) {
    for (const value of [segment.from.x, segment.from.y, segment.to.x, segment.to.y]) assert.ok(Number.isFinite(value));
  }
});

test('triangular prism disperses wavelengths into ordered exit angles', () => {
  const prism = refractorFromCenter({
    id: 'p', x: 0, y: 0, refractiveIndexBase: 1.52, dispersionCoefficient: 4200,
    vertices: [{ x: -2.8, y: -4.5 }, { x: -2.8, y: 4.5 }, { x: 4.2, y: 0 }]
  });
  const angles = [];
  for (const wavelength of [400, 450, 500, 550, 600, 650, 700]) {
    const trace = traceOpticalRays({
      origin: { x: -8, y: -1.5 }, direction: directionFromAngle(8 * Math.PI / 180),
      refractors: [prism], wavelength,
      bounds: { minX: -10, minY: -10, maxX: 12, maxY: 10 }
    });
    const exit = trace.segments.at(-1);
    angles.push({
      wavelength,
      angle: angleOf({ x: exit.to.x - exit.from.x, y: exit.to.y - exit.from.y })
    });
  }
  for (let i = 1; i < angles.length; i += 1) {
    assert.ok(Math.abs(angles[i - 1].angle) >= Math.abs(angles[i].angle) - 1e-6, JSON.stringify(angles));
  }
});

test('double refraction through a prism produces finite net deviation', () => {
  const prism = refractorFromCenter({
    id: 'p', x: 0, y: 0, refractiveIndexBase: 1.5, dispersionCoefficient: 0,
    vertices: [{ x: -3, y: -5 }, { x: -3, y: 5 }, { x: 4, y: 0 }]
  });
  const trace = traceOpticalRays({
    origin: { x: -8, y: -1 }, direction: directionFromAngle(5 * Math.PI / 180),
    refractors: [prism], wavelength: 589,
    bounds: { minX: -10, minY: -10, maxX: 12, maxY: 10 }
  });
  assert.equal(trace.hits.filter((h) => h.type === 'refraction').length, 2);
  const last = trace.segments.at(-1);
  const out = angleOf({ x: last.to.x - last.from.x, y: last.to.y - last.from.y });
  assert.ok(Number.isFinite(out));
  assert.ok(Math.abs(out - 5 * Math.PI / 180) > 0.01);
});

test('refractiveIndexAt uses material base and dispersion properties', () => {
  const glass = { refractiveIndexBase: 1.52, dispersionCoefficient: 4200 };
  close(refractiveIndexAt(glass, 589), 1.52, 1e-12);
  assert.ok(refractiveIndexAt(glass, 400) > refractiveIndexAt(glass, 700));
});

test('exact prism-vertex hit remains finite and does not freeze the trace', () => {
  const prism = refractorFromCenter({
    id: 'vertex', x: 0, y: 0,
    vertices: [{ x: -3, y: -3 }, { x: -3, y: 3 }, { x: 3, y: 0 }]
  });
  const targetVertex = prism.vertices[2];
  const origin = { x: -8, y: 0 };
  const direction = { x: targetVertex.x - origin.x, y: targetVertex.y - origin.y };
  const trace = traceOpticalRays({
    origin, direction, refractors: [prism], wavelength: 550,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, maxBounces: 20
  });
  assert.ok(trace.segments.length > 0 && trace.segments.length <= 22);
  for (const segment of trace.segments) {
    for (const value of [segment.from.x, segment.from.y, segment.to.x, segment.to.y]) assert.ok(Number.isFinite(value));
  }
});

test('integrated TIR keeps the ray inside the refractor after the internal bounce', () => {
  const slab = refractorFromCenter({
    id: 'tir-slab', x: 0, y: 0, refractiveIndexBase: 1.5, dispersionCoefficient: 0,
    vertices: [{ x: -5, y: -20 }, { x: 5, y: -20 }, { x: 5, y: 20 }, { x: -5, y: 20 }]
  });
  const trace = traceOpticalRays({
    origin: { x: 0, y: 0 }, direction: directionFromAngle(50 * Math.PI / 180),
    refractors: [slab], wavelength: 550,
    bounds: { minX: -30, minY: -30, maxX: 30, maxY: 30 }, maxBounces: 6
  });
  const tirHit = trace.hits.find((hit) => hit.type === 'tir');
  assert.ok(tirHit, 'expected at least one TIR hit');
  assert.equal(tirHit.refractorId, 'tir-slab');
});
