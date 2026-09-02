import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  bestContinueLevel,
  calculateStars,
  chapterUnlocked,
  createDefaultSave,
  createProgressStore,
  levelUnlocked,
  migrateSave,
  normalizeManifest
} from './progression.js';

const manifest = {
  version: 1,
  chapters: [
    {
      id: 'ch1', name: 'One', synthesisLevel: 'ch1-l03',
      levels: [
        { id: 'ch1-l01', file: 'ch1-l01.json', name: 'A', starThresholds: { one: 95, two: 98, three: 99.5 } },
        { id: 'ch1-l02', file: 'ch1-l02.json', name: 'B', starThresholds: { one: 95, two: 98, three: 99.5 } },
        { id: 'ch1-l03', file: 'ch1-l03.json', name: 'C', starThresholds: { one: 95, two: 98, three: 99.5 } }
      ]
    },
    {
      id: 'ch2', name: 'Two', synthesisLevel: 'ch2-l02',
      levels: [
        { id: 'ch2-l01', file: 'ch2-l01.json', name: 'D', starThresholds: { one: 95, two: 98, three: 99.5 } },
        { id: 'ch2-l02', file: 'ch2-l02.json', name: 'E', starThresholds: { one: 95, two: 98, three: 99.5 } }
      ]
    }
  ]
};

function storage(initial = null) {
  const map = new Map(initial == null ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => map.get(STORAGE_KEY) ?? null
  };
}

test('manifest normalization preserves chapter and threshold metadata', () => {
  const normalized = normalizeManifest(manifest);
  assert.equal(normalized.chapters.length, 2);
  assert.equal(normalized.chapters[0].levels[0].starThresholds.three, 99.5);
});

test('fresh save unlocks only first level', () => {
  const save = createDefaultSave(manifest);
  assert.equal(levelUnlocked('ch1-l01', manifest, save), true);
  assert.equal(levelUnlocked('ch1-l02', manifest, save), false);
  assert.equal(levelUnlocked('ch2-l01', manifest, save), false);
});

test('sequential unlock and chapter synthesis gate work', () => {
  const save = createDefaultSave(manifest);
  save.completedLevels.push('ch1-l01');
  assert.equal(levelUnlocked('ch1-l02', manifest, save), true);
  assert.equal(chapterUnlocked(1, manifest, save), false);
  save.completedLevels.push('ch1-l02', 'ch1-l03');
  assert.equal(chapterUnlocked(1, manifest, save), true);
  assert.equal(levelUnlocked('ch2-l01', manifest, save), true);
});

test('star thresholds distinguish solved efficient and near-perfect results', () => {
  const thresholds = { one: 95, two: 98, three: 99.5 };
  assert.equal(calculateStars(94.99, 0, thresholds), 0);
  assert.equal(calculateStars(95, 0, thresholds), 1);
  assert.equal(calculateStars(98, 0, thresholds), 2);
  assert.equal(calculateStars(99.5, 0, thresholds), 3);
});

test('three-star par move constraint can hold score at two stars', () => {
  const thresholds = { one: 95, two: 98, three: 99.5, parMoves: 4 };
  assert.equal(calculateStars(100, 5, thresholds), 2);
  assert.equal(calculateStars(100, 4, thresholds), 3);
});

test('save/load round trip writes immediately and never downgrades best result', () => {
  const backing = storage();
  const store = createProgressStore({ manifest, storage: backing, now: () => '2026-09-02T10:00:00.000Z' });
  store.saveProgress('ch1-l01', { finalConcentration: 99.8, movesUsed: 2 }, manifest.chapters[0].levels[0].starThresholds);
  const firstRaw = backing.dump();
  assert.ok(firstRaw);
  let save = store.loadSave();
  assert.equal(save.starsPerLevel['ch1-l01'], 3);
  assert.equal(save.bestConcentrationPerLevel['ch1-l01'], 99.8);
  assert.equal(save.currentLevel, 'ch1-l02');
  store.saveProgress('ch1-l01', { finalConcentration: 95.1, movesUsed: 20 }, manifest.chapters[0].levels[0].starThresholds);
  save = store.loadSave();
  assert.equal(save.starsPerLevel['ch1-l01'], 3);
  assert.equal(save.bestConcentrationPerLevel['ch1-l01'], 99.8);
});

test('corrupted storage falls back safely instead of throwing', () => {
  const backing = storage('{definitely-not-json');
  const store = createProgressStore({ manifest, storage: backing });
  const save = store.loadSave();
  assert.deepEqual(save.completedLevels, []);
  assert.equal(save.currentLevel, 'ch1-l01');
  assert.doesNotThrow(() => JSON.parse(backing.dump()));
});

test('legacy versionless save migrates to version 1', () => {
  const migrated = migrateSave({ completedLevels: ['ch1-l01'], starsPerLevel: { 'ch1-l01': 2 } }, manifest);
  assert.equal(migrated.version, 1);
  assert.deepEqual(migrated.completedLevels, ['ch1-l01']);
  assert.equal(migrated.starsPerLevel['ch1-l01'], 2);
});

test('unavailable localStorage falls back to in-memory session state', () => {
  let warnings = 0;
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  const store = createProgressStore({ manifest, storage: broken, onWarning: () => { warnings += 1; } });
  assert.doesNotThrow(() => store.loadSave());
  store.saveProgress('ch1-l01', { finalConcentration: 96 }, { one: 95, two: 98, three: 99.5 });
  const save = store.loadSave();
  assert.equal(save.completedLevels.includes('ch1-l01'), true);
  assert.equal(store.isPersistent(), false);
  assert.equal(warnings, 1);
});

test('bestContinueLevel resolves current or first unlocked incomplete level', () => {
  const save = createDefaultSave(manifest);
  assert.equal(bestContinueLevel(manifest, save), 'ch1-l01');
  save.completedLevels.push('ch1-l01');
  save.currentLevel = 'locked-level';
  assert.equal(bestContinueLevel(manifest, save), 'ch1-l02');
});
