import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkConcentrationSolved,
  evaluateConcentrationGoals,
  lensFromCenter,
  parabolicNormalAtPoint,
  parabolicReflectorFromCenter,
  sampleLightSource,
  thinLensImageDistance,
  thinLensRedirect,
  traceDiffuseLightScene
} from './concentrationEngine.js';
import { directionFromAngle, mirrorFromCenter, normalize, reflect } from './rayEngine.js';

const approx = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected} (±${tolerance})`);
};
const bounds = { minX: 0, minY: 0, maxX: 1200, maxY: 720 };

test('diffuse source distributes exactly its total energy across sampled rays', () => {
  const rays = sampleLightSource({ x: 20, y: 30, centerDirection: 0, coneAngle: Math.PI / 2, rayCount: 150, totalEnergy: 1 });
  assert.equal(rays.length, 150);
  approx(rays.reduce((sum, ray) => sum + ray.energy, 0), 1, 1e-12);
});

test('diffuse source spans the configured cone endpoints', () => {
  const rays = sampleLightSource({ x: 0, y: 0, centerDirection: Math.PI / 2, coneAngle: Math.PI / 2, rayCount: 3, totalEnergy: 1 });
  approx(Math.atan2(rays[0].direction.y, rays[0].direction.x), Math.PI / 4);
  approx(Math.atan2(rays[2].direction.y, rays[2].direction.x), 3 * Math.PI / 4);
});

test('thin-lens equation returns the expected image distance', () => {
  approx(thinLensImageDistance(100, 200), 200, 1e-9);
  assert.equal(thinLensImageDistance(100, 100), Infinity);
});

test('parallel rays through a convex lens converge at its focal plane', () => {
  const lens = lensFromCenter({ id: 'L1', x: 300, y: 200, rotation: 0, length: 260, focalLength: 180 });
  for (const y of [120, 160, 200, 240, 280]) {
    const hit = { x: lens.x, y };
    const direction = thinLensRedirect({ x: 1, y: 0 }, hit, lens);
    const t = lens.focalLength / direction.x;
    const finalY = hit.y + direction.y * t;
    approx(finalY, lens.y, 1e-6);
  }
});

test('parabolic reflector sends focus-origin rays parallel to its optical axis', () => {
  const reflector = parabolicReflectorFromCenter({ id: 'R1', x: 300, y: 300, rotation: 0, focalLength: 120, aperture: 300, segmentCount: 80 });
  for (const point of [reflector.points[10], reflector.points[24], reflector.points[40], reflector.points[56], reflector.points[70]]) {
    const incoming = normalize({ x: point.x - reflector.focus.x, y: point.y - reflector.focus.y });
    const normal = parabolicNormalAtPoint(reflector, point);
    const outgoing = reflect(incoming, normal);
    assert.ok(outgoing.x > 0.999999, `expected collimated +x ray, got ${JSON.stringify(outgoing)}`);
    assert.ok(Math.abs(outgoing.y) < 1e-6);
  }
});

test('lossless mirror bounce preserves the complete emitted-energy budget', () => {
  const mirror = mirrorFromCenter({ id: 'M1', x: 300, y: 200, length: 300, rotation: Math.PI / 2 });
  const trace = traceDiffuseLightScene({
    lightSources: [{ id: 'E1', x: 100, y: 200, centerDirection: 0, coneAngle: 0, rayCount: 25, totalEnergy: 1, wavelength: 589 }],
    mirrors: [{ ...mirror, reflectivity: 1 }],
    bounds,
    goals: []
  });
  approx(trace.energy.emittedEnergy, 1);
  approx(trace.energy.escapedEnergy, 1, 1e-9);
  approx(trace.energy.opticLossEnergy, 0);
  approx(trace.energy.accountingError, 0, 1e-9);
});

test('opaque wall absorbs energy while emitted energy remains the denominator', () => {
  const trace = traceDiffuseLightScene({
    lightSources: [{ id: 'E1', x: 100, y: 200, centerDirection: 0, coneAngle: 0, rayCount: 20, totalEnergy: 1, wavelength: 589 }],
    walls: [{ id: 'W1', vertices: [{ x: 300, y: 40 }, { x: 320, y: 40 }, { x: 320, y: 360 }, { x: 300, y: 360 }] }],
    goals: [{ id: 'G1', shape: 'circle', x: 500, y: 200, radius: 30, requiredConcentration: 95 }],
    bounds
  });
  approx(trace.energy.absorbedEnergy, 1, 1e-9);
  approx(trace.statuses[0].concentrationPercent, 0);
  assert.equal(trace.statuses[0].satisfied, false);
  approx(trace.energy.accountingError, 0, 1e-9);
});

test('concentration percentage uses goal energy divided by total emitted energy', () => {
  const trace = {
    goalHits: [
      { goalId: 'G', energy: 0.4, wavelength: 589 },
      { goalId: 'G', energy: 0.35, wavelength: 589 }
    ],
    energy: { emittedEnergy: 1 }
  };
  const [status] = evaluateConcentrationGoals(trace, [{ id: 'G', requiredConcentration: 75 }]);
  approx(status.concentrationPercent, 75, 1e-9);
  assert.equal(status.satisfied, true);
  assert.equal(checkConcentrationSolved([status]), true);
});

test('reflector plus lens concentrates at least 95% of emitted energy on target', () => {
  const reflector = parabolicReflectorFromCenter({
    id: 'R1', x: 280, y: 360, rotation: 0, focalLength: 120, aperture: 320, segmentCount: 96, reflectivity: 1
  });
  const lens = lensFromCenter({ id: 'L1', x: 700, y: 360, rotation: 0, length: 360, focalLength: 220, transmission: 1 });
  const goal = { id: 'G1', shape: 'circle', x: 920, y: 360, radius: 26, requiredConcentration: 95 };
  const trace = traceDiffuseLightScene({
    lightSources: [{
      id: 'E1', x: reflector.focus.x, y: reflector.focus.y,
      centerDirection: Math.PI, coneAngle: 110 * Math.PI / 180,
      rayCount: 151, totalEnergy: 1, wavelength: 589
    }],
    reflectors: [reflector],
    lenses: [lens],
    goals: [goal],
    bounds
  });
  assert.ok(trace.statuses[0].concentrationPercent >= 95, `concentration=${trace.statuses[0].concentrationPercent}`);
  assert.equal(trace.statuses[0].satisfied, true);
  assert.equal(checkConcentrationSolved(trace.statuses), true);
  assert.ok(Math.abs(trace.energy.accountingError) < 1e-6, `accounting error=${trace.energy.accountingError}`);
});

test('misaligned reflector does not falsely produce a near-perfect concentration solve', () => {
  const reflector = parabolicReflectorFromCenter({
    id: 'R1', x: 280, y: 360, rotation: 18 * Math.PI / 180, focalLength: 120, aperture: 320, segmentCount: 96
  });
  const lens = lensFromCenter({ id: 'L1', x: 700, y: 360, rotation: 0, length: 360, focalLength: 220 });
  const trace = traceDiffuseLightScene({
    lightSources: [{ id: 'E1', x: 373.3333333333, y: 360, centerDirection: Math.PI, coneAngle: 110 * Math.PI / 180, rayCount: 101, totalEnergy: 1, wavelength: 589 }],
    reflectors: [reflector],
    lenses: [lens],
    goals: [{ id: 'G1', shape: 'circle', x: 920, y: 360, radius: 26, requiredConcentration: 95 }],
    bounds
  });
  assert.ok(trace.statuses[0].concentrationPercent < 95, `misaligned concentration=${trace.statuses[0].concentrationPercent}`);
});
