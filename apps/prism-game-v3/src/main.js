import './styles.css';
import {
  checkLevelSolved,
  flattenRayTree,
  mirrorFromCenter,
  splitterFromCenter
} from './physics/rayEngine.js';
import {
  InteractionModel,
  bindPointerInteractions,
  piecePolygon
} from './interaction/interaction.js';
import { RaySmoother } from './render/raySmoothing.js';
import {
  LevelSession,
  runtimeEmitterFromSchema,
  runtimeGoalFromSchema,
  runtimePieceFromSchema,
  traceLevelRuntime,
  wallWorldVertices
} from './levels/loader.js';
import { estimateSearchSpace } from './levels/solver.js';
import { validateLevel } from './levels/schema.js';
import {
  addSchemaEntity,
  createBlankLevel,
  deleteSchemaEntity,
  levelToPrettyJson
} from './editor/editorState.js';

const DEG = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const canvas = document.querySelector('#stage');
const ctx = canvas.getContext('2d');
const smoother = new RaySmoother({ durationMs: 130 });
const session = new LevelSession();

const ui = Object.fromEntries([
  'modeBadge','schemaBadge','objectCount','segmentCount','physicsCost','solvedState','palette','paletteHint','modeToggle','resetLevel',
  'canvasModeBadge','canvasHint','errorBox','levelId','difficulty','levelName','chapter','deleteSelected','selectionEmpty','propertyFields',
  'solverState','gridStep','maxCombinations','runSolver','solverResult','jsonState','jsonEditor','importJson','exportJson','copyJson','downloadJson','clearLevel'
].map((id) => [id, document.querySelector(`#${id}`)]));

let draft = createBlankLevel();
let runtime = null;
let mode = 'edit';
let paletteType = 'select';
let model = null;
let unbind = () => {};
let lastPropertyKey = '';
let propertyRevision = 0;
let solverWorker = null;
let solverRequestId = 0;

function degrees(value) { return value * RAD_TO_DEG; }
function radians(value) { return value * DEG; }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

function runtimeFromDraft(level) {
  const width = level.boardBounds?.width ?? 1200;
  const height = level.boardBounds?.height ?? 720;
  return {
    metadata: { id: level.id, name: level.name, chapter: level.chapter, difficulty: level.difficulty },
    boardBounds: { width, height },
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    emitters: (level.emitters ?? []).map(runtimeEmitterFromSchema),
    pieces: (level.pieces ?? []).map(runtimePieceFromSchema),
    goals: (level.goals ?? []).map(runtimeGoalFromSchema)
  };
}

function wallBox(piece) {
  if (!piece.vertices?.length) return { width: 80, height: 40 };
  const xs = piece.vertices.map((vertex) => vertex.x);
  const ys = piece.vertices.map((vertex) => vertex.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function editorInteractionItems() {
  const items = [];
  for (const piece of runtime.pieces) {
    piece.schemaMovable ??= piece.movable;
    piece.schemaRotatable ??= piece.rotatable;
    piece.movable = true;
    piece.rotatable = true;
    piece.collidable = false;
    if (piece.type === 'wall') Object.assign(piece, wallBox(piece));
    items.push(piece);
  }
  for (const emitter of runtime.emitters) {
    emitter.rotation = emitter.angle ?? 0;
    emitter.movable = true;
    emitter.rotatable = true;
    emitter.collidable = false;
    items.push(emitter);
  }
  for (const goal of runtime.goals) {
    goal.rotation = 0;
    goal.movable = true;
    goal.rotatable = false;
    goal.collidable = false;
    const diameter = (goal.radius ?? goal.size ?? 35) * 2;
    goal.width = goal.shape === 'rect' ? goal.width : diameter;
    goal.height = goal.shape === 'rect' ? goal.height : diameter;
    items.push(goal);
  }
  return items;
}

function playInteractionItems() {
  for (const piece of runtime.pieces) {
    if (piece.type === 'wall') Object.assign(piece, wallBox(piece));
  }
  return runtime.pieces;
}

function syncRuntimeObjectToDraft(object) {
  if (mode !== 'edit' || !object) return;
  const emitter = draft.emitters.find((item) => item.id === object.id);
  if (emitter) {
    emitter.x = object.x;
    emitter.y = object.y;
    emitter.angle = degrees(object.rotation ?? object.angle ?? 0);
    object.angle = object.rotation ?? object.angle ?? 0;
    propertyRevision += 1;
    return;
  }
  const goal = draft.goals.find((item) => item.id === object.id);
  if (goal) {
    goal.x = object.x;
    goal.y = object.y;
    propertyRevision += 1;
    return;
  }
  const piece = draft.pieces.find((item) => item.id === object.id);
  if (!piece) return;
  piece.initialX = object.x;
  piece.initialY = object.y;
  const baseAngle = object.type === 'mirror' || object.type === 'splitter' ? (object.baseGeometryAngle ?? 0) : 0;
  piece.initialRotation = degrees((object.rotation ?? 0) - baseAngle);
  propertyRevision += 1;
}

function bindModel(selectedId = null) {
  unbind();
  const items = mode === 'edit' ? editorInteractionItems() : playInteractionItems();
  model = new InteractionModel({
    pieces: items,
    bounds: runtime.bounds,
    onChange: ({ piece }) => syncRuntimeObjectToDraft(piece),
    onSnap: () => {
      try { navigator.vibrate?.(12); } catch { /* optional */ }
    }
  });
  if (selectedId) model.select(selectedId);
  unbind = bindPointerInteractions(canvas, model, {
    boardWidth: canvas.width,
    boardHeight: canvas.height,
    onState: () => { propertyRevision += 1; }
  });
  lastPropertyKey = '';
}

function rebuildEditRuntime(selectedId = null) {
  runtime = runtimeFromDraft(draft);
  canvas.width = runtime.boardBounds.width;
  canvas.height = runtime.boardBounds.height;
  smoother.reset();
  bindModel(selectedId);
  syncMetadataInputs();
  refreshValidationBadge();
}

function setDraft(level, selectedId = null) {
  draft = clone(level);
  mode = 'edit';
  rebuildEditRuntime(selectedId);
  updateModeUi();
}

function syncMetadataInputs() {
  ui.levelId.value = draft.id ?? '';
  ui.levelName.value = draft.name ?? '';
  ui.chapter.value = draft.chapter ?? '';
  ui.difficulty.value = String(draft.difficulty ?? 1);
}

function refreshValidationBadge() {
  const validation = validateLevel(draft);
  ui.schemaBadge.textContent = validation.valid ? 'SCHEMA VALID' : `SCHEMA ${validation.errors.length} ISSUE${validation.errors.length === 1 ? '' : 'S'}`;
  ui.schemaBadge.classList.toggle('good', validation.valid);
  ui.schemaBadge.classList.toggle('bad', !validation.valid);
  ui.jsonState.textContent = validation.valid ? 'valid' : 'draft';
  return validation;
}

function showError(message) {
  ui.errorBox.classList.remove('hidden');
  ui.errorBox.textContent = message;
}
function clearError() {
  ui.errorBox.classList.add('hidden');
  ui.errorBox.textContent = '';
}
function showValidationErrors(validation, prefix = 'Level is not valid yet.') {
  showError(`${prefix}\n${validation.errors.slice(0, 8).map((entry) => `• ${entry.text}`).join('\n')}`);
}

function updateModeUi() {
  const editing = mode === 'edit';
  ui.modeBadge.textContent = editing ? 'EDIT MODE' : 'PLAY PREVIEW';
  ui.modeBadge.classList.toggle('edit', editing);
  ui.modeBadge.classList.toggle('play', !editing);
  ui.modeToggle.textContent = editing ? '▶ Play preview' : '✎ Back to edit';
  ui.resetLevel.disabled = editing;
  ui.canvasModeBadge.textContent = editing ? 'authoring' : 'real physics preview';
  ui.canvasHint.textContent = editing
    ? 'Select a palette item to place it. Drag objects to reposition; use the round handle to rotate.'
    : 'Play preview uses the exact Stage 1–4 engine. Reset returns every piece to the authored initial state.';
  ui.palette.classList.toggle('disabled', !editing);
  for (const input of [ui.levelId, ui.levelName, ui.chapter, ui.difficulty]) input.disabled = !editing;
  propertyRevision += 1;
}

function setPalette(type) {
  paletteType = type;
  [...ui.palette.querySelectorAll('[data-palette]')].forEach((button) => button.classList.toggle('active', button.dataset.palette === type));
  ui.paletteHint.textContent = type === 'select' ? 'Select, drag, rotate, or edit an existing object.' : `Place ${type}: tap/click the board.`;
}

function handlePalettePlacement(event) {
  if (mode !== 'edit' || paletteType === 'select') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const point = canvasPoint(event);
  const x = clamp(point.x, 90, Math.max(90, runtime.boardBounds.width - 90));
  const y = clamp(point.y, 90, Math.max(90, runtime.boardBounds.height - 90));
  const entity = addSchemaEntity(draft, paletteType, x, y);
  rebuildEditRuntime(entity.id);
  clearError();
}
canvas.addEventListener('pointerdown', handlePalettePlacement, true);

function selectedObject() { return model?.selectedPiece() ?? null; }
function formatRequiredColor(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value[0]}-${value[1]}`;
  if (value && typeof value === 'object') return `${value.min}-${value.max}`;
  return 'any';
}
function inputField(label, prop, value, { type = 'number', step = '1', min = null, max = null, disabled = false } = {}) {
  const attrs = [min != null ? `min="${min}"` : '', max != null ? `max="${max}"` : '', type === 'number' ? `step="${step}"` : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ');
  return `<label>${escapeHtml(label)}<input data-prop="${escapeHtml(prop)}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
}

function renderPropertyPanel() {
  const object = selectedObject();
  const key = `${mode}:${object?.id ?? 'none'}:${propertyRevision}`;
  if (key === lastPropertyKey) return;
  lastPropertyKey = key;
  const editing = mode === 'edit';
  ui.deleteSelected.disabled = !editing || !object;
  ui.selectionEmpty.classList.toggle('hidden', Boolean(object));
  ui.propertyFields.classList.toggle('hidden', !object);
  if (!object) { ui.propertyFields.innerHTML = ''; return; }

  const rotation = degrees(object.rotation ?? object.angle ?? 0).toFixed(2);
  let html = `<div class="object-chip"><strong>${escapeHtml(object.id)}</strong><span>${escapeHtml(object.type)}</span></div>`;
  html += `<div class="form-grid two compact">`;
  html += inputField('X', 'x', object.x.toFixed(2), { step: '1', disabled: !editing });
  html += inputField('Y', 'y', object.y.toFixed(2), { step: '1', disabled: !editing });
  if (object.type !== 'goal') html += inputField(object.type === 'emitter' ? 'Angle °' : 'Rotation °', 'rotation', rotation, { step: '0.1', disabled: !editing });

  if (object.type === 'emitter') {
    const color = object.wavelength == null ? 'white' : object.wavelength;
    html += inputField('Color (white / nm)', 'emitterColor', color, { type: 'text', disabled: !editing });
  } else if (object.type === 'goal') {
    html += `<label>Shape<select data-prop="goalShape" ${editing ? '' : 'disabled'}><option value="circle" ${object.shape === 'circle' ? 'selected' : ''}>circle</option><option value="rect" ${object.shape === 'rect' ? 'selected' : ''}>rect</option></select></label>`;
    html += inputField('Size', 'goalSize', object.shape === 'rect' ? object.width : object.radius, { step: '1', min: 4, disabled: !editing });
    html += inputField('Required color', 'goalColor', formatRequiredColor(object.requiredColor), { type: 'text', disabled: !editing });
    html += inputField('Required intensity', 'goalIntensity', object.requiredIntensity, { step: '0.01', min: 0, disabled: !editing });
  } else {
    html += `<label class="check-field"><input data-prop="movable" type="checkbox" ${object.schemaMovable ? 'checked' : ''} ${editing ? '' : 'disabled'}> Movable in play</label>`;
    html += `<label class="check-field"><input data-prop="rotatable" type="checkbox" ${object.schemaRotatable ? 'checked' : ''} ${editing ? '' : 'disabled'}> Rotatable in play</label>`;
    if (object.type === 'mirror' || object.type === 'splitter') html += inputField('Length', 'length', object.length.toFixed(1), { step: '1', min: 20, disabled: !editing });
    if (object.type === 'splitter') html += inputField('Split ratio', 'splitRatio', object.splitRatio, { step: '0.01', min: 0, max: 1, disabled: !editing });
    if (object.type === 'refractor') {
      html += inputField('n @ 589 nm', 'refractiveIndexBase', object.refractiveIndexBase, { step: '0.001', min: 1.001, disabled: !editing });
      html += inputField('Cauchy B (nm²)', 'dispersionCoefficient', object.dispersionCoefficient, { step: '10', min: 0, disabled: !editing });
    }
  }
  html += `</div>`;
  ui.propertyFields.innerHTML = html;
}

function parseRequiredColor(text) {
  const value = String(text).trim().toLowerCase();
  if (value === 'any' || value === 'white') return value;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('Required color must be any, white, or a wavelength range like 620-700.');
  return [Number(match[1]), Number(match[2])];
}

function rebuildPreservingSelection(id) {
  rebuildEditRuntime(id);
  refreshValidationBadge();
}

function applyPropertyChange(target) {
  if (mode !== 'edit') return;
  const object = selectedObject();
  if (!object) return;
  const prop = target.dataset.prop;
  if (!prop) return;
  clearError();
  try {
    if (prop === 'x' || prop === 'y' || prop === 'rotation') {
      const candidate = { x: object.x, y: object.y, rotation: object.rotation ?? 0 };
      if (prop === 'x') candidate.x = Number(target.value);
      if (prop === 'y') candidate.y = Number(target.value);
      if (prop === 'rotation') candidate.rotation = radians(Number(target.value));
      if (!model.applyCandidate(object, candidate)) throw new Error(`Placement blocked: ${model.state.invalidReason}`);
      syncRuntimeObjectToDraft(object);
    } else if (prop === 'movable' || prop === 'rotatable') {
      const schemaPiece = draft.pieces.find((piece) => piece.id === object.id);
      schemaPiece[prop] = target.checked;
      object[`schema${prop[0].toUpperCase()}${prop.slice(1)}`] = target.checked;
    } else if (prop === 'length') {
      const length = Math.max(20, Number(target.value));
      const schemaPiece = draft.pieces.find((piece) => piece.id === object.id);
      schemaPiece.geometry = { a: { x: -length / 2, y: 0 }, b: { x: length / 2, y: 0 } };
      schemaPiece.initialX = object.x; schemaPiece.initialY = object.y; schemaPiece.initialRotation = degrees(object.rotation ?? 0);
      rebuildPreservingSelection(object.id);
      return;
    } else if (prop === 'splitRatio') {
      const value = clamp(Number(target.value), 0, 1);
      object.splitRatio = value;
      draft.pieces.find((piece) => piece.id === object.id).props.splitRatio = value;
    } else if (prop === 'refractiveIndexBase' || prop === 'dispersionCoefficient') {
      const value = Number(target.value);
      object[prop] = value;
      draft.pieces.find((piece) => piece.id === object.id).props[prop] = value;
    } else if (prop === 'emitterColor') {
      const text = String(target.value).trim().toLowerCase();
      const color = text === 'white' ? 'white' : Number(text);
      if (!(color === 'white' || (Number.isFinite(color) && color >= 400 && color <= 700))) throw new Error('Emitter color must be white or 400–700 nm.');
      const emitter = draft.emitters.find((item) => item.id === object.id);
      emitter.color = color;
      object.wavelength = color === 'white' ? null : color;
    } else if (prop === 'goalShape') {
      draft.goals.find((goal) => goal.id === object.id).shape = target.value;
      rebuildPreservingSelection(object.id);
      return;
    } else if (prop === 'goalSize') {
      const value = Math.max(4, Number(target.value));
      draft.goals.find((goal) => goal.id === object.id).size = value;
      rebuildPreservingSelection(object.id);
      return;
    } else if (prop === 'goalColor') {
      const value = parseRequiredColor(target.value);
      draft.goals.find((goal) => goal.id === object.id).requiredColor = value;
      object.requiredColor = clone(value);
    } else if (prop === 'goalIntensity') {
      const value = Math.max(0, Number(target.value));
      draft.goals.find((goal) => goal.id === object.id).requiredIntensity = value;
      object.requiredIntensity = value;
    }
    refreshValidationBadge();
    propertyRevision += 1;
  } catch (error) {
    showError(error.message);
  }
}
ui.propertyFields.addEventListener('change', (event) => applyPropertyChange(event.target));

function deleteCurrentSelection() {
  if (mode !== 'edit') return;
  const object = selectedObject();
  if (!object) return;
  deleteSchemaEntity(draft, object.id);
  rebuildEditRuntime();
}
ui.deleteSelected.addEventListener('click', deleteCurrentSelection);
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (selectedObject()) { event.preventDefault(); deleteCurrentSelection(); }
});

function toggleMode() {
  clearError();
  if (mode === 'edit') {
    const validation = refreshValidationBadge();
    if (!validation.valid) { showValidationErrors(validation, 'Cannot enter play preview.'); return; }
    session.loadLevel(draft);
    runtime = session.runtime;
    mode = 'play';
    canvas.width = runtime.boardBounds.width;
    canvas.height = runtime.boardBounds.height;
    smoother.reset();
    bindModel();
  } else {
    mode = 'edit';
    rebuildEditRuntime();
  }
  updateModeUi();
}
ui.modeToggle.addEventListener('click', toggleMode);
ui.resetLevel.addEventListener('click', () => {
  if (mode !== 'play') return;
  runtime = session.resetLevel();
  smoother.reset();
  bindModel();
});

for (const button of ui.palette.querySelectorAll('[data-palette]')) button.addEventListener('click', () => { if (mode === 'edit') setPalette(button.dataset.palette); });

for (const [element, key, transform] of [
  [ui.levelId, 'id', (value) => value.trim()],
  [ui.levelName, 'name', (value) => value.trim()],
  [ui.chapter, 'chapter', (value) => value.trim()],
  [ui.difficulty, 'difficulty', (value) => Number(value)]
]) {
  element.addEventListener('change', () => {
    if (mode !== 'edit') return;
    draft[key] = transform(element.value);
    runtime.metadata[key] = draft[key];
    refreshValidationBadge();
  });
}

function exportLevel() {
  const validation = refreshValidationBadge();
  if (!validation.valid) { showValidationErrors(validation, 'Export blocked because the level is malformed.'); return null; }
  const text = levelToPrettyJson(draft);
  ui.jsonEditor.value = text;
  ui.jsonState.textContent = 'exported';
  clearError();
  return text;
}
ui.exportJson.addEventListener('click', exportLevel);
ui.importJson.addEventListener('click', () => {
  clearError();
  try {
    const parsed = JSON.parse(ui.jsonEditor.value);
    const validation = validateLevel(parsed);
    if (!validation.valid) { showValidationErrors(validation, 'Import rejected.'); return; }
    setDraft(parsed);
    ui.jsonState.textContent = 'imported';
  } catch (error) {
    showError(`Import rejected: ${error.message}`);
  }
});
ui.copyJson.addEventListener('click', async () => {
  const text = exportLevel();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); ui.jsonState.textContent = 'copied'; }
  catch { showError('Clipboard access was not available; the JSON is still in the text area.'); }
});
ui.downloadJson.addEventListener('click', () => {
  const text = exportLevel();
  if (!text) return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${draft.id || 'prism-level'}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
ui.clearLevel.addEventListener('click', () => {
  setDraft(createBlankLevel({ id: 'draft-level', name: 'Untitled Prism Puzzle' }));
  ui.jsonEditor.value = '';
  ui.solverResult.textContent = 'No solver run yet.';
  setPalette('select');
});

function createSolverWorker() {
  solverWorker?.terminate();
  solverWorker = new Worker(new URL('./levels/solverWorker.js', import.meta.url), { type: 'module' });
  return solverWorker;
}
function formatSolverResult(result) {
  const lines = [
    `solvable: ${result.solvable}`,
    `solutions: ${result.solutionCountLabel}`,
    `quality: ${result.constraintQuality}`,
    `checked: ${result.checkedCombinations.toLocaleString()} / estimated ${result.estimatedCombinations.toLocaleString()}`,
    `complete: ${result.complete}`
  ];
  if (result.exampleSolution) lines.push(`example: ${JSON.stringify(result.exampleSolution)}`);
  if (result.warnings.length) lines.push(...result.warnings.map((warning) => `warning: ${warning}`));
  return lines.join('\n');
}
ui.runSolver.addEventListener('click', () => {
  const validation = refreshValidationBadge();
  if (!validation.valid) { showValidationErrors(validation, 'Solver cannot run on malformed JSON.'); return; }
  clearError();
  const gridStep = clamp(Number(ui.gridStep.value) || 120, 40, 300);
  const maxCombinations = clamp(Number(ui.maxCombinations.value) || 100000, 100, 100000);
  const estimate = estimateSearchSpace(draft, { gridStep });
  ui.solverState.textContent = 'running';
  ui.solverState.classList.add('running');
  ui.runSolver.disabled = true;
  ui.solverResult.textContent = estimate.estimatedCombinations > maxCombinations
    ? `Search-space warning: ${estimate.estimatedCombinations.toLocaleString()} combinations. Worker will stop at ${maxCombinations.toLocaleString()}.`
    : `Searching ${estimate.estimatedCombinations.toLocaleString()} combinations in worker…`;
  const requestId = ++solverRequestId;
  const worker = createSolverWorker();
  worker.onmessage = (event) => {
    if (event.data.requestId !== requestId) return;
    ui.runSolver.disabled = false;
    ui.solverState.classList.remove('running');
    if (!event.data.ok) {
      ui.solverState.textContent = 'error';
      ui.solverResult.textContent = event.data.error.message;
      return;
    }
    const result = event.data.result;
    ui.solverState.textContent = result.solvable ? 'solvable' : result.capped ? 'capped' : 'unsolvable';
    ui.solverResult.textContent = formatSolverResult(result);
  };
  worker.onerror = (event) => {
    ui.runSolver.disabled = false;
    ui.solverState.classList.remove('running');
    ui.solverState.textContent = 'error';
    ui.solverResult.textContent = event.message;
  };
  worker.postMessage({ requestId, level: clone(draft), options: { gridStep, maxCombinations, maxSolutions: 50 } });
});

function visualState(object) {
  if (model?.state.selectedId === object.id && model.state.invalid) return 'invalid';
  if (model?.state.selectedId === object.id) return 'selected';
  if (model?.state.hoverId === object.id) return 'hover';
  if (mode === 'play' && !object.movable && !object.rotatable) return 'fixed';
  return 'idle';
}
function strokeForState(state, type) {
  if (state === 'invalid') return '#ff667f';
  if (state === 'selected') return '#fff18c';
  if (state === 'hover') return '#91f2ff';
  if (state === 'fixed') return '#657789';
  if (type === 'goal') return '#6dff9d';
  if (type === 'wall') return '#8c93a1';
  return '#64d9f4';
}

function drawGrid() {
  ctx.fillStyle = '#06101b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(91,150,197,.075)';
  ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 25; y < canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(105,183,232,.25)';
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
}

function drawRays(segments) {
  ctx.save(); ctx.lineCap = 'round';
  for (const segment of segments) {
    const intensity = segment.displayIntensity ?? segment.intensity ?? 1;
    const alpha = Math.max(0.07, Math.min(1, intensity));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = segment.color;
    ctx.shadowColor = segment.color;
    ctx.shadowBlur = 5 + 12 * alpha;
    ctx.lineWidth = segment.wavelength == null ? 4 : Math.max(1.2, 3 * alpha);
    ctx.beginPath(); ctx.moveTo(segment.from.x, segment.from.y); ctx.lineTo(segment.to.x, segment.to.y); ctx.stroke();
  }
  ctx.restore();
}

function drawObject(object, status = null) {
  const state = visualState(object);
  const stroke = strokeForState(state, object.type);
  ctx.save();
  ctx.strokeStyle = status?.satisfied ? '#72ffa6' : stroke;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = state === 'selected' ? 24 : state === 'hover' ? 16 : 8;
  ctx.lineWidth = 4;

  if (object.type === 'mirror' || object.type === 'splitter') {
    const segment = object.type === 'mirror'
      ? mirrorFromCenter({ id: object.id, x: object.x, y: object.y, length: object.length, rotation: object.rotation })
      : splitterFromCenter({ id: object.id, x: object.x, y: object.y, length: object.length, rotation: object.rotation, splitRatio: object.splitRatio });
    ctx.lineWidth = object.type === 'splitter' ? 7 : 6;
    ctx.beginPath(); ctx.moveTo(segment.a.x, segment.a.y); ctx.lineTo(segment.b.x, segment.b.y); ctx.stroke();
  } else if (object.type === 'refractor' || object.type === 'wall') {
    const vertices = object.type === 'wall' ? wallWorldVertices(object) : piecePolygon(object);
    ctx.beginPath(); vertices.forEach((vertex, index) => index ? ctx.lineTo(vertex.x, vertex.y) : ctx.moveTo(vertex.x, vertex.y)); ctx.closePath();
    ctx.fillStyle = object.type === 'wall' ? 'rgba(116,125,139,.18)' : 'rgba(81,190,255,.12)';
    ctx.fill(); ctx.stroke();
  } else if (object.type === 'emitter') {
    const angle = object.rotation ?? object.angle ?? 0;
    ctx.fillStyle = object.wavelength == null ? '#fff7dc' : '#fff1a0';
    ctx.beginPath(); ctx.arc(object.x, object.y, object.radius ?? 20, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(object.x, object.y); ctx.lineTo(object.x + Math.cos(angle) * 58, object.y + Math.sin(angle) * 58); ctx.stroke();
  } else if (object.type === 'goal') {
    ctx.fillStyle = status?.satisfied ? 'rgba(114,255,166,.16)' : 'rgba(108,145,169,.09)';
    if (object.shape === 'rect') {
      ctx.fillRect(object.x - object.width / 2, object.y - object.height / 2, object.width, object.height);
      ctx.strokeRect(object.x - object.width / 2, object.y - object.height / 2, object.width, object.height);
    } else {
      ctx.beginPath(); ctx.arc(object.x, object.y, object.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#c4dbe8'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
  const suffix = object.type === 'goal' && status ? ` · ${status.status}` : '';
  ctx.fillText(`${object.id}${suffix}`, object.x, object.y - ((object.radius ?? 20) + 16));
  ctx.restore();
}

function drawRotationHandle(now) {
  const object = selectedObject();
  const handle = model?.rotationHandle();
  if (!object?.rotatable || !handle) return;
  const pulse = now < model.state.snapPulseUntil;
  ctx.save();
  ctx.setLineDash([5, 6]); ctx.strokeStyle = pulse ? '#fff494' : '#7fe8ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(object.x, object.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = pulse ? '#fff494' : '#7fe8ff'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = pulse ? 24 : 12;
  ctx.beginPath(); ctx.arc(handle.x, handle.y, pulse ? 13 : 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function render(now) {
  const frameStart = performance.now();
  const validation = refreshValidationBadge();
  let statuses = runtime.goals.map((goal) => ({ id: goal.id, status: 'unlit', satisfied: false }));
  let exactSegments = [];
  let physicsMs = null;
  if (validation.valid) {
    const physicsStart = performance.now();
    const trace = traceLevelRuntime(runtime);
    physicsMs = performance.now() - physicsStart;
    statuses = trace.statuses;
    exactSegments = flattenRayTree(trace.rayTree).segments;
  }
  const displaySegments = smoother.update(exactSegments, now);
  drawGrid();
  drawRays(displaySegments);

  const goalStatusById = new Map(statuses.map((status) => [status.id, status]));
  const objects = [...runtime.goals, ...runtime.emitters, ...runtime.pieces];
  const selectedId = model?.state.selectedId;
  objects.sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0));
  for (const object of objects) drawObject(object, object.type === 'goal' ? goalStatusById.get(object.id) : null);
  drawRotationHandle(now);

  const solved = validation.valid && checkLevelSolved(statuses);
  ui.objectCount.textContent = String(objects.length);
  ui.segmentCount.textContent = String(exactSegments.length);
  ui.physicsCost.textContent = physicsMs == null ? '—' : `${physicsMs.toFixed(2)} ms`;
  ui.solvedState.textContent = solved ? 'TRUE' : 'FALSE';
  ui.solvedState.classList.toggle('yes', solved);
  renderPropertyPanel();
  requestAnimationFrame(render);
  void frameStart;
}

async function loadStarter() {
  try {
    const response = await fetch('./levels/ch1-l01.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setDraft(await response.json());
    ui.jsonEditor.value = levelToPrettyJson(draft);
  } catch (error) {
    setDraft(createBlankLevel());
    showError(`Starter level could not be loaded: ${error.message}`);
  }
}

setPalette('select');
updateModeUi();
await loadStarter();
requestAnimationFrame(render);
