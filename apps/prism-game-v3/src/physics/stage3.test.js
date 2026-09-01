import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLevelSolved,
  combineRayTrees,
  directionFromAngle,
  evaluateGoals,
  flattenRayTree,
  goalCircle,
  goalRect,
  refractorFromCenter,
  splitRay,
  splitterFromCenter,
  traceOpticalRays
} from './rayEngine.js';

const BOUNDS = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
};

function simpleTreeSegment({ from = { x: 0, y: 0 }, to = { x: 10, y: 0 }, wavelength = 650, intensity = 1, spectralWeight = 1 } = {}) {
  return {
    ray: null,
    segments: [{ from, to, wavelength, intensity, spectralWeight, kind: 'exit', color: 'white', mediumId: null }],
    hits: [],
    children: [],
    terminated: 'test'
  };
}

test('50/50 splitter creates reflected and transmitted child rays with equal intensity', () => {
  const input = { direction: { x: 1, y: 0 }, wavelength: 650, intensity: 1, mediumId: null, interactions: 0 };
  const { reflected, transmitted } = splitRay(input, { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, 0.5);
  close(reflected.intensity, 0.5);
  close(transmitted.intensity, 0.5);
  close(transmitted.direction.x, 1);
  close(transmitted.direction.y, 0);
  assert.ok(Math.abs(reflected.direction.y) > 0.99);
});

test('splitter ratio clamps and conserves intensity', () => {
  const input = { direction: { x: 1, y: 0 }, intensity: 0.8 };
  const { reflected, transmitted } = splitRay(input, { x: -1, y: 0 }, 0.25);
  close(reflected.intensity, 0.2);
  close(transmitted.intensity, 0.6);
  close(reflected.intensity + transmitted.intensity, 0.8);
});

test('traced splitter produces a branching ray tree', () => {
  const splitter = splitterFromCenter({ id: 's1', x: 0, y: 0, length: 12, rotation: Math.PI / 4, splitRatio: 0.5 });
  const trace = traceOpticalRays({ origin: { x: -10, y: 0 }, direction: { x: 1, y: 0 }, splitters: [splitter], bounds: BOUNDS, wavelength: 650 });
  assert.equal(trace.rayTree.children.length, 2);
  assert.equal(trace.hits.filter((h) => h.type === 'splitter').length, 1);
  assert.ok(trace.segments.length >= 3);
});

test('intensity culling prevents a long splitter chain from runaway branching', () => {
  const splitters = Array.from({ length: 8 }, (_, i) => splitterFromCenter({
    id: `s${i}`,
    x: -7 + i * 2,
    y: 0,
    length: 8,
    rotation: Math.PI / 4,
    splitRatio: 0.5
  }));
  const trace = traceOpticalRays({
    origin: { x: -10, y: 0 }, direction: { x: 1, y: 0 }, splitters, bounds: BOUNDS,
    wavelength: 650, minIntensity: 0.02, maxRayNodes: 256
  });
  assert.ok(trace.stats.culledRays > 0);
  assert.ok(trace.stats.rayNodes < 64, JSON.stringify(trace.stats));
  assert.equal(trace.stats.nodeLimitHits, 0);
});

test('red ray satisfies a red goal', () => {
  const goal = goalCircle({ id: 'g', x: 5, y: 0, radius: 1, requiredColor: 'red', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(simpleTreeSegment({ wavelength: 650, intensity: 0.7 }), [goal]);
  assert.equal(status.status, 'satisfied');
  assert.ok(status.matchingIntensity >= 0.7 - 1e-9);
});

test('red ray does not satisfy a blue goal', () => {
  const goal = goalCircle({ id: 'g', x: 5, y: 0, radius: 1, requiredColor: 'blue', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(simpleTreeSegment({ wavelength: 650, intensity: 1 }), [goal]);
  assert.equal(status.status, 'partial');
  assert.equal(status.satisfied, false);
  close(status.matchingIntensity, 0);
});

test('goal required intensity rejects a correctly colored but attenuated ray', () => {
  const goal = goalCircle({ id: 'g', x: 5, y: 0, radius: 1, requiredColor: 'red', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(simpleTreeSegment({ wavelength: 650, intensity: 0.125 }), [goal]);
  assert.equal(status.satisfied, false);
  assert.equal(status.status, 'partial');
});

test('any-color goal accepts sufficient light regardless of wavelength', () => {
  const goal = goalRect({ id: 'g', x: 5, y: 0, width: 2, height: 2, requiredColor: 'any', requiredIntensity: 0.2 });
  const [status] = evaluateGoals(simpleTreeSegment({ wavelength: 450, intensity: 0.4 }), [goal]);
  assert.equal(status.satisfied, true);
});

test('full spectral contributions satisfy a white goal', () => {
  const children = Array.from({ length: 31 }, (_, i) => simpleTreeSegment({
    wavelength: 400 + (300 * i) / 30,
    intensity: 1,
    spectralWeight: 1 / 31
  }));
  const tree = combineRayTrees(children);
  const goal = goalRect({ id: 'white', x: 5, y: 0, width: 2, height: 4, requiredColor: 'white', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(tree, [goal]);
  assert.equal(status.satisfied, true, JSON.stringify(status));
  assert.equal(status.whiteCoverage, 1);
});

test('five of 31 spectral samples are only partial for a white goal', () => {
  const wavelengths = [400, 410, 420, 430, 440];
  const tree = combineRayTrees(wavelengths.map((wavelength) => simpleTreeSegment({ wavelength, intensity: 1, spectralWeight: 1 / 5 })));
  const goal = goalCircle({ id: 'white', x: 5, y: 0, radius: 2, requiredColor: 'white', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(tree, [goal]);
  assert.equal(status.satisfied, false);
  assert.equal(status.status, 'partial');
  assert.ok(status.whiteCoverage < 1);
});

test('coincident branches combine their intensity at a goal without mutating the ray tree', () => {
  const a = simpleTreeSegment({ wavelength: 650, intensity: 0.2 });
  const b = simpleTreeSegment({ wavelength: 650, intensity: 0.2 });
  const tree = combineRayTrees([a, b]);
  const goal = goalCircle({ id: 'g', x: 5, y: 0, radius: 1, requiredColor: 'red', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(tree, [goal]);
  assert.equal(status.satisfied, true);
  close(status.matchingIntensity, 0.4);
  assert.equal(tree.children.length, 2);
});

test('checkLevelSolved requires all goals simultaneously satisfied', () => {
  assert.equal(checkLevelSolved([{ status: 'satisfied', satisfied: true }, { status: 'partial', satisfied: false }]), false);
  assert.equal(checkLevelSolved([{ status: 'satisfied', satisfied: true }, { status: 'satisfied', satisfied: true }]), true);
});

test('splitter then prism keeps each wavelength independent', () => {
  const splitter = splitterFromCenter({ id: 's', x: -5, y: 0, length: 10, rotation: Math.PI / 4, splitRatio: 0.5 });
  const prism = refractorFromCenter({
    id: 'p', x: 3, y: 0, refractiveIndexBase: 1.52, dispersionCoefficient: 4200,
    vertices: [{ x: -2.5, y: -4 }, { x: -2.5, y: 4 }, { x: 3.5, y: 0 }]
  });
  const trace = traceOpticalRays({
    origin: { x: -12, y: 0 }, direction: { x: 1, y: 0 }, splitters: [splitter], refractors: [prism],
    bounds: BOUNDS, wavelength: null, spectralSampleCount: 11
  });
  const wavelengths = new Set(trace.segments.filter((s) => s.wavelength != null).map((s) => Math.round(s.wavelength)));
  assert.equal(wavelengths.size, 11);
  assert.ok(trace.hits.some((h) => h.type === 'splitter'));
  assert.ok(trace.hits.some((h) => h.type === 'refraction'));
});

test('max-bounce termination on one branch does not crash sibling branches', () => {
  const splitter = splitterFromCenter({ id: 's', x: 0, y: 0, length: 12, rotation: Math.PI / 4, splitRatio: 0.5 });
  const trace = traceOpticalRays({
    origin: { x: -10, y: 0 }, direction: directionFromAngle(0), splitters: [splitter], bounds: BOUNDS,
    wavelength: 650, maxBounces: 1
  });
  const flat = flattenRayTree(trace.rayTree);
  assert.ok(flat.nodes.length >= 3);
  assert.ok(trace.stats.maxBounceStops >= 2);
  assert.equal(trace.stats.nodeLimitHits, 0);
});

test('goal rectangle detects a ray crossing its boundary even when endpoints are outside', () => {
  const tree = simpleTreeSegment({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, wavelength: 550, intensity: 0.5 });
  const goal = goalRect({ id: 'g', x: 5, y: 0, width: 1, height: 4, requiredColor: 'green', requiredIntensity: 0.3 });
  const [status] = evaluateGoals(tree, [goal]);
  assert.equal(status.satisfied, true);
});

test('node cap cleanly terminates pathological splitter scenes', () => {
  const splitters = Array.from({ length: 20 }, (_, i) => splitterFromCenter({
    id: `s${i}`, x: -9 + i * 0.9, y: 0, length: 30, rotation: Math.PI / 4, splitRatio: 0.5
  }));
  const trace = traceOpticalRays({
    origin: { x: -12, y: 0 }, direction: { x: 1, y: 0 }, splitters, bounds: BOUNDS,
    wavelength: 650, minIntensity: 0, maxRayNodes: 20, maxBounces: 20
  });
  assert.ok(trace.stats.nodeLimitHits > 0, JSON.stringify(trace.stats));
  assert.ok(trace.stats.rayNodes <= 40, JSON.stringify(trace.stats));
});
