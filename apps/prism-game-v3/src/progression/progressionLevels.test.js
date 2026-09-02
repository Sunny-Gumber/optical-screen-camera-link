import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateLevel, traceLevelRuntime } from '../levels/loader.js';
import { validateLevel } from '../levels/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const levelsDir = path.resolve(here, '../../public/levels');
const ids = ['c1-l01', 'c1-l02', 'c1-l03', 'c2-l01', 'c2-l02'];
const readLevel = (id) => JSON.parse(fs.readFileSync(path.join(levelsDir, `${id}.json`), 'utf8'));

function concentration(runtime) {
  const trace = traceLevelRuntime(runtime, { maxRayNodes: 30000 });
  assert.equal(trace.mode, 'concentration');
  return trace.statuses[0]?.concentrationPercent ?? 0;
}

function applyKnownSolution(id, runtime) {
  const reflector = runtime.pieces.find((piece) => piece.id === 'R1');
  const lens = runtime.pieces.find((piece) => piece.id === 'L1');
  if (id === 'c1-l01') reflector.rotation = 0;
  if (id === 'c1-l02') lens.y = 360;
  if (id === 'c1-l03') { reflector.rotation = 0; lens.y = 360; }
  if (id === 'c2-l01') lens.x = 760;
  if (id === 'c2-l02') { reflector.rotation = 0; lens.x = 720; lens.y = 360; lens.rotation = 0; }
}

for (const id of ids) {
  test(`${id} validates, starts unsolved, and has a >=95% known solution`, () => {
    const level = readLevel(id);
    const validation = validateLevel(level);
    assert.equal(validation.valid, true, validation.errors.map((error) => error.text).join('\n'));
    const runtime = instantiateLevel(level);
    const initial = concentration(runtime);
    assert.ok(initial < 95, `${id} should start unsolved, got ${initial}%`);
    applyKnownSolution(id, runtime);
    const solved = concentration(runtime);
    assert.ok(solved >= 95, `${id} known solution only reached ${solved}%`);
  });
}

test('Stage 7 manifest references exactly the five real concentration levels in play order', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(levelsDir, 'index.json'), 'utf8'));
  const manifestIds = manifest.chapters.flatMap((chapter) => chapter.levels.map((level) => level.id));
  assert.deepEqual(manifestIds, ids);
  assert.equal(manifest.chapters[0].synthesisLevel, 'c1-l03');
});
