import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLevelSolved } from '../physics/rayEngine.js';
import { instantiateLevel, isConcentrationRuntime, traceLevelRuntime } from './loader.js';
import { solveLevel } from './solver.js';
import { validateLevel } from './schema.js';

function concentrationLevel({ movable = false } = {}) {
  return {
    id: 's6-focus',
    name: 'Focus the Torch',
    chapter: 'concentration-basics',
    difficulty: 2,
    boardBounds: { width: 1200, height: 720 },
    emitters: [{
      id: 'SRC1', type: 'lightSource', x: 373.3333333333, y: 360,
      centerDirection: 180, coneAngle: 110, rayCount: 121, totalEnergy: 1, color: 589
    }],
    pieces: [
      {
        id: 'R1', type: 'reflector', movable, rotatable: movable,
        geometry: { aperture: 320 }, initialX: 280, initialY: 360, initialRotation: 0,
        props: { focalLength: 120, segmentCount: 96, reflectivity: 1 }
      },
      {
        id: 'L1', type: 'lens', movable, rotatable: movable,
        geometry: { length: 360 }, initialX: 700, initialY: 360, initialRotation: 0,
        props: { focalLength: 220, transmission: 1 }
      }
    ],
    goals: [{ id: 'G1', x: 920, y: 360, shape: 'circle', size: 26, requiredColor: 'any', requiredConcentration: 95 }]
  };
}

test('Stage 6 concentration level validates through the formal schema', () => {
  const result = validateLevel(concentrationLevel());
  assert.equal(result.valid, true, result.errors.map((error) => error.text).join('\n'));
});

test('Stage 6 loader instantiates diffuse source lens reflector and concentration goal', () => {
  const runtime = instantiateLevel(concentrationLevel());
  assert.equal(runtime.emitters[0].type, 'lightSource');
  assert.equal(runtime.emitters[0].rayCount, 121);
  assert.equal(runtime.pieces.find((piece) => piece.id === 'R1').type, 'reflector');
  assert.equal(runtime.pieces.find((piece) => piece.id === 'L1').focalLength, 220);
  assert.equal(runtime.goals[0].requiredConcentration, 95);
  assert.equal(isConcentrationRuntime(runtime), true);
});

test('Stage 6 traceLevelRuntime uses concentration engine and solves the aligned level', () => {
  const runtime = instantiateLevel(concentrationLevel());
  const trace = traceLevelRuntime(runtime);
  assert.equal(trace.mode, 'concentration');
  assert.ok(trace.segments.length > 100);
  assert.ok(trace.statuses[0].concentrationPercent >= 95, `concentration=${trace.statuses[0].concentrationPercent}`);
  assert.equal(checkLevelSolved(trace.statuses), true);
  assert.ok(Math.abs(trace.energy.accountingError) < 1e-6);
});

test('Stage 5 solver evaluates concentration status through the shared runtime path', () => {
  const result = solveLevel(concentrationLevel(), { maxCombinations: 10, stopAfterFirst: true });
  assert.equal(result.solvable, true);
  assert.equal(result.solutionCount, 1);
});

test('malformed Stage 6 fields fail loudly', () => {
  const broken = concentrationLevel();
  broken.emitters[0].rayCount = 0;
  broken.pieces[1].props.focalLength = 0;
  broken.goals[0].requiredConcentration = 101;
  const result = validateLevel(broken);
  assert.equal(result.valid, false);
  const text = result.errors.map((error) => error.text).join('\n');
  assert.match(text, /rayCount/);
  assert.match(text, /focalLength/);
  assert.match(text, /requiredConcentration/);
});
