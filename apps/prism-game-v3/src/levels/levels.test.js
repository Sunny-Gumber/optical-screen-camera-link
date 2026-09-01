import test from 'node:test';
import assert from 'node:assert/strict';
import { LevelSession, instantiateLevel } from './loader.js';
import { solveLevel } from './solver.js';
import { validateLevel } from './schema.js';

function baseLevel() {
  return {
    id: 'test-level',
    name: 'Test Level',
    chapter: 'reflection-basics',
    difficulty: 1,
    boardBounds: { width: 600, height: 600 },
    emitters: [{ id: 'E1', x: 100, y: 300, angle: 0, color: 650 }],
    pieces: [{
      id: 'M1', type: 'mirror', movable: false, rotatable: true,
      geometry: { a: { x: -100, y: 0 }, b: { x: 100, y: 0 } },
      initialX: 300, initialY: 300, initialRotation: 45, props: {}
    }],
    goals: [{ id: 'G1', x: 300, y: 500, shape: 'circle', size: 32, requiredColor: 'any', requiredIntensity: 0.2 }]
  };
}

test('schema accepts a valid level', () => {
  const result = validateLevel(baseLevel());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('schema reports a clear missing required field', () => {
  const level = baseLevel();
  delete level.boardBounds;
  const result = validateLevel(level);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === '$.boardBounds'));
});

test('schema rejects an invalid piece type', () => {
  const level = baseLevel();
  level.pieces[0].type = 'teleporter';
  const result = validateLevel(level);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path.endsWith('.type')));
});

test('loader instantiates pieces emitters and goals at authored positions', () => {
  const runtime = instantiateLevel(baseLevel());
  assert.equal(runtime.pieces.length, 1);
  assert.equal(runtime.emitters.length, 1);
  assert.equal(runtime.goals.length, 1);
  assert.equal(runtime.pieces[0].x, 300);
  assert.equal(runtime.emitters[0].y, 300);
  assert.equal(runtime.goals[0].x, 300);
});

test('resetLevel restores exact initial state after movement', () => {
  const session = new LevelSession(baseLevel());
  session.runtime.pieces[0].x = 444;
  session.runtime.pieces[0].rotation = 0;
  session.resetLevel();
  assert.equal(session.runtime.pieces[0].x, 300);
  assert.ok(Math.abs(session.runtime.pieces[0].rotation - Math.PI / 4) < 1e-9);
});

test('solver finds the known 45 degree reflection solution', () => {
  const result = solveLevel(baseLevel(), { maxCombinations: 1000, stopAfterFirst: true });
  assert.equal(result.solvable, true);
  assert.ok(result.exampleSolution?.some((piece) => piece.id === 'M1'));
});

test('solver reports false for a fixed unreachable goal', () => {
  const level = baseLevel();
  level.pieces = [];
  level.goals[0].x = 500;
  level.goals[0].y = 500;
  const result = solveLevel(level, { maxCombinations: 100 });
  assert.equal(result.solvable, false);
  assert.equal(result.complete, true);
});

test('solver caps a deliberately excessive search space instead of hanging', () => {
  const level = baseLevel();
  level.goals[0].x = 590;
  level.goals[0].y = 590;
  level.pieces = Array.from({ length: 5 }, (_, index) => ({
    id: `M${index + 1}`, type: 'mirror', movable: true, rotatable: true,
    geometry: { a: { x: -35, y: 0 }, b: { x: 35, y: 0 } },
    initialX: 100 + index * 90, initialY: 120 + (index % 2) * 140, initialRotation: 0, props: {}
  }));
  const result = solveLevel(level, { gridStep: 200, maxCombinations: 20, maxSolutions: 5 });
  assert.equal(result.capped, true);
  assert.ok(result.estimatedCombinations > 20);
  assert.ok(result.warnings.length > 0);
});
