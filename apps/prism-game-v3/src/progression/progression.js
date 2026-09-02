export const SAVE_VERSION = 1;
export const STORAGE_KEY = 'prismlab_save_v1';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeManifest(manifest) {
  const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  const normalizedChapters = chapters.map((chapter, chapterIndex) => {
    const levels = (chapter.levels ?? []).map((entry, levelIndex) => {
      if (typeof entry === 'string') {
        const id = entry.replace(/\.json$/i, '');
        return {
          id,
          file: entry,
          name: id,
          difficulty: 1,
          starThresholds: { one: 95, two: 98, three: 99.5 }
        };
      }
      const id = entry.id ?? String(entry.file ?? '').replace(/\.json$/i, '');
      return {
        id,
        file: entry.file ?? `${id}.json`,
        name: entry.name ?? id,
        difficulty: entry.difficulty ?? 1,
        starThresholds: {
          one: entry.starThresholds?.one ?? 95,
          two: entry.starThresholds?.two ?? 98,
          three: entry.starThresholds?.three ?? 99.5,
          ...(finite(entry.starThresholds?.parMoves) ? { parMoves: entry.starThresholds.parMoves } : {})
        },
        chapterId: chapter.id,
        chapterIndex,
        levelIndex
      };
    });
    return {
      id: chapter.id ?? `chapter-${chapterIndex + 1}`,
      name: chapter.name ?? `Chapter ${chapterIndex + 1}`,
      synthesisLevel: chapter.synthesisLevel ?? levels.at(-1)?.id ?? null,
      levels
    };
  });
  return { version: manifest?.version ?? 1, chapters: normalizedChapters };
}

export function flattenManifest(manifest) {
  return normalizeManifest(manifest).chapters.flatMap((chapter, chapterIndex) =>
    chapter.levels.map((level, levelIndex) => ({
      ...level,
      chapterId: chapter.id,
      chapterName: chapter.name,
      chapterIndex,
      levelIndex
    }))
  );
}

export function createDefaultSave(manifest = null) {
  const firstLevel = manifest ? flattenManifest(manifest)[0]?.id ?? null : null;
  return {
    version: SAVE_VERSION,
    completedLevels: [],
    starsPerLevel: {},
    bestConcentrationPerLevel: {},
    currentLevel: firstLevel,
    lastPlayed: null
  };
}

function sanitizeSave(value, manifest = null) {
  const fallback = createDefaultSave(manifest);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

  const completedLevels = Array.isArray(value.completedLevels)
    ? [...new Set(value.completedLevels.filter((id) => typeof id === 'string' && id))]
    : [];

  const starsPerLevel = {};
  for (const [id, stars] of Object.entries(value.starsPerLevel ?? {})) {
    if (typeof id === 'string' && Number.isInteger(stars)) {
      starsPerLevel[id] = Math.max(0, Math.min(3, stars));
    }
  }

  const bestConcentrationPerLevel = {};
  for (const [id, concentration] of Object.entries(value.bestConcentrationPerLevel ?? {})) {
    if (typeof id === 'string' && finite(concentration)) {
      bestConcentrationPerLevel[id] = Math.max(0, Math.min(100, concentration));
    }
  }

  return {
    version: SAVE_VERSION,
    completedLevels,
    starsPerLevel,
    bestConcentrationPerLevel,
    currentLevel: typeof value.currentLevel === 'string' && value.currentLevel
      ? value.currentLevel
      : fallback.currentLevel,
    lastPlayed: typeof value.lastPlayed === 'string' ? value.lastPlayed : null
  };
}

export function migrateSave(input, manifest = null) {
  let value = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { return createDefaultSave(manifest); }
  }
  if (!value || typeof value !== 'object') return createDefaultSave(manifest);
  if (value.version == null || value.version === 0) value = { ...value, version: SAVE_VERSION };
  if (value.version !== SAVE_VERSION) return createDefaultSave(manifest);
  return sanitizeSave(value, manifest);
}

export function calculateStars(finalConcentration, movesUsed = 0, thresholds = {}) {
  const concentration = finite(finalConcentration) ? finalConcentration : 0;
  const one = thresholds.one ?? 95;
  const two = thresholds.two ?? 98;
  const three = thresholds.three ?? 99.5;
  const parMoves = thresholds.parMoves;
  if (concentration + 1e-9 < one) return 0;
  if (concentration + 1e-9 >= three && (!finite(parMoves) || movesUsed <= parMoves)) return 3;
  if (concentration + 1e-9 >= two) return 2;
  return 1;
}

export function chapterUnlocked(chapterIndex, manifest, save) {
  const normalized = normalizeManifest(manifest);
  if (chapterIndex <= 0) return true;
  const previous = normalized.chapters[chapterIndex - 1];
  if (!previous) return false;
  return previous.synthesisLevel ? save.completedLevels.includes(previous.synthesisLevel) : true;
}

export function levelUnlocked(levelId, manifest, save) {
  const normalized = normalizeManifest(manifest);
  const flat = flattenManifest(normalized);
  if (flat[0]?.id === levelId) return true;

  for (let chapterIndex = 0; chapterIndex < normalized.chapters.length; chapterIndex += 1) {
    const chapter = normalized.chapters[chapterIndex];
    const levelIndex = chapter.levels.findIndex((level) => level.id === levelId);
    if (levelIndex < 0) continue;
    if (!chapterUnlocked(chapterIndex, normalized, save)) return false;
    if (levelIndex === 0) return true;
    return save.completedLevels.includes(chapter.levels[levelIndex - 1].id);
  }
  return false;
}

export function nextLevelId(levelId, manifest) {
  const levels = flattenManifest(manifest);
  const index = levels.findIndex((level) => level.id === levelId);
  return index >= 0 ? levels[index + 1]?.id ?? null : null;
}

export function bestContinueLevel(manifest, save) {
  const levels = flattenManifest(manifest);
  if (save.currentLevel && levelUnlocked(save.currentLevel, manifest, save)) return save.currentLevel;
  return levels.find((level) => levelUnlocked(level.id, manifest, save) && !save.completedLevels.includes(level.id))?.id ??
    [...levels].reverse().find((level) => levelUnlocked(level.id, manifest, save))?.id ??
    levels[0]?.id ?? null;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

export function createProgressStore({
  manifest,
  storage,
  now = () => new Date().toISOString(),
  onWarning = () => {}
} = {}) {
  const fallbackStorage = memoryStorage();
  let activeStorage = storage;
  let persistent = true;
  let warningSent = false;

  const warnFallback = () => {
    if (!warningSent) {
      warningSent = true;
      onWarning('Persistent storage is unavailable. Progress will last only for this tab/session.');
    }
    persistent = false;
    activeStorage = fallbackStorage;
  };

  // Accessing window.localStorage itself can throw a SecurityError in restricted
  // browsing contexts. Resolve it inside the guarded function body rather than
  // in a default parameter, so the in-memory fallback can still take over.
  if (activeStorage === undefined) {
    try { activeStorage = globalThis?.localStorage ?? null; }
    catch { activeStorage = null; }
  }
  if (!activeStorage) warnFallback();

  function readRaw() {
    try { return activeStorage.getItem(STORAGE_KEY) ?? null; }
    catch {
      warnFallback();
      return activeStorage.getItem(STORAGE_KEY);
    }
  }

  function write(save) {
    const serialized = JSON.stringify(save);
    try { activeStorage.setItem(STORAGE_KEY, serialized); }
    catch {
      warnFallback();
      activeStorage.setItem(STORAGE_KEY, serialized);
    }
    return save;
  }

  function loadSave() {
    const raw = readRaw();
    const save = migrateSave(raw, manifest);
    if (raw != null) {
      try {
        const parsed = JSON.parse(raw);
        if (JSON.stringify(sanitizeSave(parsed, manifest)) !== JSON.stringify(save)) write(save);
      } catch {
        write(save);
      }
    }
    return save;
  }

  function saveProgress(levelId, result = {}, thresholds = {}) {
    const save = loadSave();
    const concentration = Math.max(0, Math.min(100, Number(result.finalConcentration) || 0));
    const stars = calculateStars(concentration, Number(result.movesUsed) || 0, thresholds);
    if (!save.completedLevels.includes(levelId) && stars > 0) save.completedLevels.push(levelId);
    save.starsPerLevel[levelId] = Math.max(save.starsPerLevel[levelId] ?? 0, stars);
    save.bestConcentrationPerLevel[levelId] = Math.max(
      save.bestConcentrationPerLevel[levelId] ?? 0,
      concentration
    );
    const next = nextLevelId(levelId, manifest);
    save.currentLevel = next && levelUnlocked(next, manifest, save) ? next : levelId;
    save.lastPlayed = now();
    return write(save);
  }

  function setCurrentLevel(levelId) {
    const save = loadSave();
    if (levelId && levelUnlocked(levelId, manifest, save)) save.currentLevel = levelId;
    save.lastPlayed = now();
    return write(save);
  }

  function resetAllProgress() {
    const clean = createDefaultSave(manifest);
    try { activeStorage.removeItem(STORAGE_KEY); }
    catch {
      warnFallback();
      activeStorage.removeItem(STORAGE_KEY);
    }
    return write(clean);
  }

  return {
    loadSave,
    saveProgress,
    setCurrentLevel,
    resetAllProgress,
    isPersistent: () => persistent,
    storageKey: STORAGE_KEY
  };
}
