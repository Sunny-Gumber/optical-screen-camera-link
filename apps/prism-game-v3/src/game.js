import './game.css';
import { InteractionModel, bindPointerInteractions, piecePolygon } from './interaction/interaction.js';
import { LevelSession, traceLevelRuntime, wallWorldVertices } from './levels/loader.js';
import { lensFromCenter, parabolicReflectorFromCenter } from './physics/concentrationEngine.js';
import { mirrorFromCenter, splitterFromCenter } from './physics/rayEngine.js';
import {
  bestContinueLevel,
  calculateStars,
  createProgressStore,
  flattenManifest,
  levelUnlocked,
  nextLevelId,
  normalizeManifest
} from './progression/progression.js';

const $ = (id) => document.querySelector(`#${id}`);
const ui = Object.fromEntries([
  'continueButton','resetProgressButton','storageWarning','levelSelectScreen','progressSummary','chapterList','playScreen',
  'backToLevels','chapterLabel','resetLevel','levelNumber','levelTitle','liveConcentration','gameCanvas','rayCountBadge',
  'solvePulse','meterFill','thresholdMarker','concentrationReadout','requiredReadout','movesReadout','emittedReadout',
  'goalEnergyReadout','absorbedReadout','lostReadout','completionOverlay','completionTitle','completionPercent',
  'completionStars','completionBest','nextLevelButton','replayButton','completionLevelsButton'
].map((id) => [id, $(id)]));

const canvas = ui.gameCanvas;
const ctx = canvas.getContext('2d');
const session = new LevelSession();
let manifest;
let normalizedManifest;
let store;
let save;
let currentEntry = null;
let runtime = null;
let model = null;
let unbind = () => {};
let moves = 0;
let previousPointerMode = null;
let solveHandled = false;
let currentTrace = null;
let currentStatus = null;
let currentLevelDefinition = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pct = (value, digits = 1) => `${(Number(value) || 0).toFixed(digits)}%`;

function showStorageWarning(message) {
  ui.storageWarning.textContent = message;
  ui.storageWarning.classList.remove('hidden');
}

async function loadManifest() {
  const response = await fetch('./levels/index.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  manifest = await response.json();
  normalizedManifest = normalizeManifest(manifest);
  store = createProgressStore({ manifest, onWarning: showStorageWarning });
  save = store.loadSave();
}

function levelEntry(levelId) {
  return flattenManifest(manifest).find((level) => level.id === levelId) ?? null;
}

function renderStars(stars) {
  const count = Math.max(0, Math.min(3, stars ?? 0));
  return `${'★'.repeat(count)}${'☆'.repeat(3 - count)}`;
}

function renderLevelSelect() {
  save = store.loadSave();
  const flat = flattenManifest(manifest);
  const completed = flat.filter((level) => save.completedLevels.includes(level.id)).length;
  ui.progressSummary.textContent = `${completed} / ${flat.length} completed`;
  const continueId = bestContinueLevel(manifest, save);
  ui.continueButton.disabled = !continueId;
  ui.continueButton.dataset.levelId = continueId ?? '';

  ui.chapterList.innerHTML = normalizedManifest.chapters.map((chapter, chapterIndex) => {
    const chapterIsUnlocked = chapterIndex === 0 || save.completedLevels.includes(normalizedManifest.chapters[chapterIndex - 1].synthesisLevel);
    const cards = chapter.levels.map((level, levelIndex) => {
      const unlocked = levelUnlocked(level.id, manifest, save);
      const completedLevel = save.completedLevels.includes(level.id);
      const stars = save.starsPerLevel[level.id] ?? 0;
      const best = save.bestConcentrationPerLevel[level.id];
      const state = !unlocked ? 'locked' : completedLevel ? 'completed unlocked' : 'unlocked';
      const label = chapterIndex * 10 + levelIndex + 1;
      return `<button class="level-card ${state}" data-level-id="${level.id}" ${unlocked ? '' : 'disabled'}>
        <span class="level-number">LEVEL ${label}</span>
        <strong class="level-name">${level.name}</strong>
        <span class="level-meta"><span>Difficulty ${level.difficulty}</span><span class="stars ${stars ? '' : 'empty'}">${renderStars(stars)}</span></span>
        <span class="level-meta"><span>${unlocked ? (completedLevel ? 'Completed' : 'Unlocked') : 'Locked'}</span><span class="best-score">${best == null ? '—' : pct(best, 1)}</span></span>
      </button>`;
    }).join('');
    return `<section class="chapter-card ${chapterIsUnlocked ? '' : 'locked'}">
      <div class="chapter-head"><h3>${chapter.name}</h3><span class="chapter-lock">${chapterIsUnlocked ? `${chapter.levels.length} levels` : '🔒 Complete previous synthesis level'}</span></div>
      <div class="level-grid">${cards}</div>
    </section>`;
  }).join('');

  for (const button of ui.chapterList.querySelectorAll('[data-level-id]')) {
    button.addEventListener('click', () => openLevel(button.dataset.levelId));
  }
}

function showLevelSelect() {
  ui.completionOverlay.classList.add('hidden');
  ui.playScreen.classList.add('hidden');
  ui.levelSelectScreen.classList.remove('hidden');
  unbind();
  renderLevelSelect();
}

function bindInteraction() {
  unbind();
  previousPointerMode = null;
  model = new InteractionModel({
    pieces: runtime.pieces,
    bounds: runtime.bounds,
    onSnap: () => { try { navigator.vibrate?.(12); } catch { /* optional */ } }
  });
  unbind = bindPointerInteractions(canvas, model, {
    boardWidth: canvas.width,
    boardHeight: canvas.height,
    onState: (state) => {
      if (previousPointerMode && !state.mode) moves += 1;
      previousPointerMode = state.mode;
    }
  });
}

async function openLevel(levelId) {
  const entry = levelEntry(levelId);
  if (!entry) throw new Error(`Unknown level: ${levelId}`);
  save = store.loadSave();
  if (!levelUnlocked(levelId, manifest, save)) return;
  const response = await fetch(`./levels/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Level HTTP ${response.status}`);
  currentLevelDefinition = await response.json();
  runtime = session.loadLevel(currentLevelDefinition);
  currentEntry = entry;
  canvas.width = runtime.boardBounds.width;
  canvas.height = runtime.boardBounds.height;
  moves = 0;
  solveHandled = false;
  currentTrace = null;
  currentStatus = null;
  bindInteraction();
  store.setCurrentLevel(levelId);
  ui.levelSelectScreen.classList.add('hidden');
  ui.playScreen.classList.remove('hidden');
  ui.completionOverlay.classList.add('hidden');
  ui.chapterLabel.textContent = entry.chapterName;
  ui.levelNumber.textContent = `LEVEL ${flattenManifest(manifest).findIndex((level) => level.id === entry.id) + 1}`;
  ui.levelTitle.textContent = entry.name;
}

function resetCurrentLevel() {
  if (!currentEntry) return;
  runtime = session.resetLevel();
  moves = 0;
  solveHandled = false;
  ui.completionOverlay.classList.add('hidden');
  bindInteraction();
}

function drawGrid() {
  ctx.fillStyle = '#06101b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(92,151,199,.07)';
  ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 25; y < canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
}

function drawRays(segments) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const segment of segments ?? []) {
    const energy = segment.energy ?? segment.intensity ?? 0.01;
    const alpha = clamp(0.045 + Math.sqrt(Math.max(0, energy)) * 0.5, 0.045, 0.28);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = segment.color ?? 'rgba(255,250,220,1)';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.35;
    ctx.beginPath(); ctx.moveTo(segment.from.x, segment.from.y); ctx.lineTo(segment.to.x, segment.to.y); ctx.stroke();
  }
  ctx.restore();
}

function objectStroke(piece) {
  if (model?.state.selectedId === piece.id && model.state.invalid) return '#ff647d';
  if (model?.state.selectedId === piece.id) return '#fff19a';
  if (model?.state.hoverId === piece.id) return '#8ff1ff';
  if (!piece.movable && !piece.rotatable) return '#647789';
  return '#67dcf5';
}

function drawPiece(piece) {
  const stroke = objectStroke(piece);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = 'rgba(75,180,220,.08)';
  ctx.shadowColor = stroke;
  ctx.shadowBlur = model?.state.selectedId === piece.id ? 20 : 7;
  ctx.lineWidth = 5;

  if (piece.type === 'lens') {
    const lens = lensFromCenter({ id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation, length: piece.length, focalLength: piece.focalLength, transmission: piece.transmission });
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(lens.a.x, lens.a.y); ctx.lineTo(lens.b.x, lens.b.y); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(piece.x, piece.y, 10, piece.length / 2, piece.rotation, 0, Math.PI * 2); ctx.stroke();
  } else if (piece.type === 'reflector') {
    const reflector = parabolicReflectorFromCenter({
      id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation, focalLength: piece.focalLength,
      aperture: piece.aperture, segmentCount: piece.segmentCount, reflectivity: piece.reflectivity
    });
    ctx.beginPath();
    reflector.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.stroke();
  } else if (piece.type === 'mirror' || piece.type === 'splitter') {
    const segment = piece.type === 'mirror'
      ? mirrorFromCenter({ id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation })
      : splitterFromCenter({ id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation, splitRatio: piece.splitRatio });
    ctx.beginPath(); ctx.moveTo(segment.a.x, segment.a.y); ctx.lineTo(segment.b.x, segment.b.y); ctx.stroke();
  } else if (piece.type === 'wall') {
    const vertices = wallWorldVertices(piece);
    ctx.fillStyle = 'rgba(120,129,143,.2)';
    ctx.beginPath(); vertices.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    const vertices = piecePolygon(piece);
    ctx.beginPath(); vertices.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawEmitter(emitter) {
  ctx.save();
  const angle = emitter.centerDirection ?? emitter.angle ?? 0;
  ctx.fillStyle = '#fff0ad';
  ctx.shadowColor = '#ffe87c';
  ctx.shadowBlur = 24;
  ctx.beginPath(); ctx.arc(emitter.x, emitter.y, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff4bd'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(emitter.x, emitter.y); ctx.lineTo(emitter.x + Math.cos(angle) * 42, emitter.y + Math.sin(angle) * 42); ctx.stroke();
  ctx.restore();
}

function drawGoals(statuses) {
  const statusMap = new Map((statuses ?? []).map((status) => [status.id, status]));
  for (const goal of runtime.goals) {
    const status = statusMap.get(goal.id);
    ctx.save();
    ctx.strokeStyle = status?.satisfied ? '#68ff9e' : '#6494ad';
    ctx.fillStyle = status?.satisfied ? 'rgba(104,255,158,.16)' : 'rgba(100,148,173,.07)';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = status?.satisfied ? 24 : 8; ctx.lineWidth = 4;
    if (goal.shape === 'rect') {
      ctx.fillRect(goal.x - goal.width / 2, goal.y - goal.height / 2, goal.width, goal.height);
      ctx.strokeRect(goal.x - goal.width / 2, goal.y - goal.height / 2, goal.width, goal.height);
    } else {
      ctx.beginPath(); ctx.arc(goal.x, goal.y, goal.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#d4e8f2'; ctx.font = '800 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${status?.concentrationPercent?.toFixed(1) ?? '0.0'}%`, goal.x, goal.y - (goal.radius ?? goal.height / 2 ?? 30) - 12);
    ctx.restore();
  }
}

function drawRotationHandle() {
  const piece = model?.selectedPiece();
  const handle = model?.rotationHandle();
  if (!piece?.rotatable || !handle) return;
  ctx.save();
  ctx.strokeStyle = '#82eaff'; ctx.fillStyle = '#82eaff'; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.moveTo(piece.x, piece.y); ctx.lineTo(handle.x, handle.y); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(handle.x, handle.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function updateTelemetry(trace, status) {
  const concentration = status?.concentrationPercent ?? 0;
  const required = status?.requiredConcentration ?? runtime.goals[0]?.requiredConcentration ?? 95;
  ui.liveConcentration.textContent = pct(concentration, 2);
  ui.liveConcentration.classList.toggle('solved', concentration + 1e-9 >= required);
  ui.concentrationReadout.textContent = pct(concentration, 2);
  ui.requiredReadout.textContent = pct(required, 1);
  ui.movesReadout.textContent = String(moves);
  ui.meterFill.style.width = `${clamp(concentration, 0, 100)}%`;
  ui.thresholdMarker.style.left = `${clamp(required, 0, 100)}%`;
  const energy = trace?.energy ?? {};
  ui.emittedReadout.textContent = pct((energy.emittedEnergy ?? 0) * 100, 1);
  ui.goalEnergyReadout.textContent = pct((energy.goalEnergy ?? 0) * 100, 1);
  ui.absorbedReadout.textContent = pct((energy.absorbedEnergy ?? 0) * 100, 1);
  const lost = (energy.escapedEnergy ?? 0) + (energy.opticLossEnergy ?? 0) + (energy.culledEnergy ?? 0) + (energy.terminatedEnergy ?? 0);
  ui.lostReadout.textContent = pct(lost * 100, 1);
  ui.rayCountBadge.textContent = model?.state.mode ? '50 rays while dragging' : `${runtime.emitters[0]?.rayCount ?? 'full'} rays`;
}

function handleSolved(status) {
  if (solveHandled || !currentEntry || !status?.satisfied) return;
  solveHandled = true;
  const concentration = status.concentrationPercent;
  const stars = calculateStars(concentration, moves, currentEntry.starThresholds);
  // Persist synchronously at the exact solve moment, before any animation or navigation.
  save = store.saveProgress(currentEntry.id, { finalConcentration: concentration, movesUsed: moves }, currentEntry.starThresholds);
  ui.solvePulse.classList.remove('active');
  void ui.solvePulse.offsetWidth;
  ui.solvePulse.classList.add('active');
  ui.completionTitle.textContent = currentEntry.name;
  ui.completionPercent.textContent = pct(concentration, 2);
  ui.completionStars.textContent = renderStars(stars);
  ui.completionBest.textContent = `Best: ${pct(save.bestConcentrationPerLevel[currentEntry.id], 2)} · ${renderStars(save.starsPerLevel[currentEntry.id])}`;
  const next = nextLevelId(currentEntry.id, manifest);
  ui.nextLevelButton.textContent = next ? 'Next level' : 'Campaign complete';
  ui.nextLevelButton.dataset.levelId = next ?? '';
  setTimeout(() => ui.completionOverlay.classList.remove('hidden'), 420);
}

function renderFrame() {
  if (runtime) {
    const active = Boolean(model?.state.mode);
    currentTrace = traceLevelRuntime(runtime, { rayCountOverride: active ? 50 : null, maxRayNodes: 30000 });
    currentStatus = currentTrace.statuses?.[0] ?? null;
    drawGrid();
    drawRays(currentTrace.segments);
    drawGoals(currentTrace.statuses);
    for (const emitter of runtime.emitters) drawEmitter(emitter);
    const pieces = [...runtime.pieces].sort((a, b) => (a.id === model?.state.selectedId ? 1 : 0) - (b.id === model?.state.selectedId ? 1 : 0));
    for (const piece of pieces) drawPiece(piece);
    drawRotationHandle();
    updateTelemetry(currentTrace, currentStatus);
    handleSolved(currentStatus);
  }
  requestAnimationFrame(renderFrame);
}

ui.continueButton.addEventListener('click', () => {
  const id = ui.continueButton.dataset.levelId;
  if (id) openLevel(id);
});
ui.backToLevels.addEventListener('click', showLevelSelect);
ui.completionLevelsButton.addEventListener('click', showLevelSelect);
ui.resetLevel.addEventListener('click', resetCurrentLevel);
ui.replayButton.addEventListener('click', resetCurrentLevel);
ui.nextLevelButton.addEventListener('click', () => {
  const id = ui.nextLevelButton.dataset.levelId;
  if (id && levelUnlocked(id, manifest, store.loadSave())) openLevel(id);
  else showLevelSelect();
});
ui.resetProgressButton.addEventListener('click', () => {
  if (!confirm('Reset all Prism Lab progress and best scores?')) return;
  save = store.resetAllProgress();
  showLevelSelect();
});

await loadManifest();
renderLevelSelect();
requestAnimationFrame(renderFrame);

// Read-only QA/debug surface; no progression bypass is exposed in the visible UI.
window.__prismStage7 = {
  get manifest() { return manifest; },
  get save() { return store.loadSave(); },
  get runtime() { return runtime; },
  get currentLevel() { return currentEntry?.id ?? null; },
  get currentConcentration() { return currentStatus?.concentrationPercent ?? 0; },
  openLevel,
  showLevelSelect,
  resetCurrentLevel,
  storageKey: store.storageKey
};
