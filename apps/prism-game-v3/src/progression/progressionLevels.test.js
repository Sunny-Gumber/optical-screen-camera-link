import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateLevel, traceLevelRuntime } from '../levels/loader.js';
import { solveLevel } from '../levels/solver.js';
import { validateLevel } from '../levels/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const levelsDir = path.resolve(here, '../../public/levels');
const manifest = JSON.parse(fs.readFileSync(path.join(levelsDir, 'index.json'), 'utf8'));
const ids = manifest.chapters.flatMap((chapter) => chapter.levels.map((level) => level.id));
const readLevel = (id) => JSON.parse(fs.readFileSync(path.join(levelsDir, `${id}.json`), 'utf8'));

function concentration(runtime) {
  const trace = traceLevelRuntime(runtime, { maxRayNodes: 36000 });
  assert.equal(trace.mode, 'concentration');
  return trace.statuses[0]?.concentrationPercent ?? 0;
}

function applyAuthoredSolution(runtime) {
  const goal = runtime.goals[0];
  const reflector = runtime.pieces.find((piece) => piece.id === 'R1');
  const lens = runtime.pieces.find((piece) => piece.id === 'L1');
  if (reflector?.rotatable) reflector.rotation = 0;
  if (lens) {
    if (lens.movable) {
      lens.x = goal.x - lens.focalLength;
      lens.y = goal.y;
    }
    if (lens.rotatable) lens.rotation = 0;
  }
}

for (const id of ids) {
  test(`${id} validates, starts unsolved, authored solution passes, and solver finds a solution`, () => {
    const level = readLevel(id);
    const validation = validateLevel(level);
    assert.equal(validation.valid, true, validation.errors.map((error) => error.text).join('\n'));
    const runtime = instantiateLevel(level);
    const required = runtime.goals[0].requiredConcentration ?? 95;
    const initial = concentration(runtime);
    assert.ok(initial < required, `${id} should start unsolved, got ${initial}% against ${required}%`);
    applyAuthoredSolution(runtime);
    const solved = concentration(runtime);
    assert.ok(solved >= required, `${id} authored solution only reached ${solved}% against ${required}%`);

    const solver = solveLevel(level, { gridStep: 120, maxCombinations: 5000, maxSolutions: 1, stopAfterFirst: true });
    assert.equal(solver.solvable, true, `${id} solver failed after ${solver.checkedCombinations}/${solver.estimatedCombinations} combinations: ${solver.warnings.join('; ')}`);
  });
}

test('Stage 8 manifest contains six chapters and 18 unique playable levels', () => {
  assert.equal(manifest.chapters.length, 6);
  assert.equal(ids.length, 18);
  assert.equal(new Set(ids).size, 18);
  for (const chapter of manifest.chapters) {
    assert.equal(chapter.levels.length, 3);
    assert.ok(chapter.levels.some((level) => level.id === chapter.synthesisLevel));
  }
  assert.equal(ids[0], 'c1-l01');
  assert.equal(ids.at(-1), 'c6-l03');
});

test('published level difficulty grows from beginner to advanced', () => {
  const first = manifest.chapters[0].levels[0].difficulty;
  const last = manifest.chapters.at(-1).levels.at(-1).difficulty;
  assert.equal(first, 1);
  assert.equal(last, 5);
});
