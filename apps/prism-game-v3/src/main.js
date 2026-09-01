import './styles.css';
import {
  checkLevelSolved,
  directionFromAngle,
  evaluateGoals,
  goalCircle,
  mirrorFromCenter,
  refractorFromCenter,
  splitterFromCenter,
  traceOpticalRays
} from './physics/rayEngine.js';
import {
  InteractionModel,
  bindPointerInteractions,
  interactionConstants,
  piecePolygon
} from './interaction/interaction.js';
import { RaySmoother } from './render/raySmoothing.js';

const canvas = document.querySelector('#stage');
const ctx = canvas.getContext('2d');
const bounds = { minX: 28, minY: 28, maxX: 1172, maxY: 692 };
const deg = (value) => value * Math.PI / 180;

const ui = Object.fromEntries([
  'solvedIndicator','physicsCost','frameCost','rayNodeCount','segmentCount','selectedPiece','interactionMode',
  'pointerType','placementState','snapNotice','pieceType','pieceRotation','pieceMovable','pieceRotatable',
  'enableSmoothing','showExact','showGoals','reset','goalReadout'
].map((id) => [id, document.querySelector(`#${id}`)]));

const GOALS = [
  goalCircle({ id: 'A', x: 1090, y: 225, radius: 42, requiredColor: 'red', requiredIntensity: 0.12 }),
  goalCircle({ id: 'B', x: 1080, y: 560, radius: 42, requiredColor: 'any', requiredIntensity: 0.08 })
];

function initialPieces() {
  return [
    {
      id: 'E1', type: 'emitter', x: 90, y: 360, angle: 0, wavelength: 650, intensity: 1,
      radius: 21, movable: false, rotatable: false, collidable: true
    },
    {
      id: 'S1', type: 'splitter', x: 300, y: 360, length: 180, rotation: deg(45), splitRatio: 0.5,
      movable: true, rotatable: true, collisionThickness: 18
    },
    {
      id: 'S2', type: 'splitter', x: 300, y: 545, length: 150, rotation: deg(45), splitRatio: 0.5,
      movable: true, rotatable: true, collisionThickness: 18
    },
    {
      id: 'P1', type: 'refractor', x: 590, y: 360, rotation: 0,
      vertices: [{ x: -75, y: -112 }, { x: -75, y: 112 }, { x: 105, y: 0 }],
      refractiveIndexBase: 1.52, dispersionCoefficient: 4200,
      movable: true, rotatable: true, clearance: 4
    },
    {
      id: 'M1', type: 'mirror', x: 830, y: 205, length: 170, rotation: deg(35),
      movable: true, rotatable: true, collisionThickness: 18
    },
    {
      id: 'M2', type: 'mirror', x: 870, y: 555, length: 180, rotation: deg(135),
      movable: false, rotatable: false, collisionThickness: 18
    }
  ];
}

let pieces = initialPieces();
let model;
let unbind = () => {};
let lastSnapTextUntil = 0;
const smoother = new RaySmoother({ durationMs: 130 });

function createModel() {
  model = new InteractionModel({
    pieces,
    bounds,
    onChange: () => {},
    onSnap: ({ target }) => {
      lastSnapTextUntil = performance.now() + 500;
      ui.snapNotice.textContent = `Snap ${(target * 180 / Math.PI).toFixed(0)}°`;
      ui.snapNotice.classList.add('active');
      try { navigator.vibrate?.(12); } catch { /* haptics are optional */ }
    }
  });
  unbind = bindPointerInteractions(canvas, model, {
    boardWidth: canvas.width,
    boardHeight: canvas.height,
    onState: () => {
      canvas.dataset.mode = model.state.mode ?? 'idle';
      canvas.dataset.hover = model.state.hoverId ? 'true' : 'false';
    }
  });
}

function emitterPiece() { return pieces.find((piece) => piece.type === 'emitter'); }
function opticalPieces(type) { return pieces.filter((piece) => piece.type === type); }

function exactSceneTrace() {
  const emitter = emitterPiece();
  const mirrors = opticalPieces('mirror').map((piece) => mirrorFromCenter({
    id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation
  }));
  const splitters = opticalPieces('splitter').map((piece) => splitterFromCenter({
    id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation, splitRatio: piece.splitRatio
  }));
  const refractors = opticalPieces('refractor').map((piece) => refractorFromCenter({
    id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation, vertices: piece.vertices,
    refractiveIndexBase: piece.refractiveIndexBase, dispersionCoefficient: piece.dispersionCoefficient
  }));
  return traceOpticalRays({
    origin: { x: emitter.x, y: emitter.y },
    direction: directionFromAngle(emitter.angle),
    mirrors, splitters, refractors, bounds,
    wavelength: emitter.wavelength,
    intensity: emitter.intensity,
    minIntensity: 0.02,
    maxBounces: 20,
    maxRayNodes: 1024,
    spectralSampleCount: 31
  });
}

function drawGrid() {
  ctx.fillStyle = '#06101b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(91,150,197,.075)';
  ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 25; y < canvas.height; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(105,183,232,.25)';
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function drawGoals(statuses) {
  if (!ui.showGoals.checked) return;
  GOALS.forEach((goal, index) => {
    const status = statuses[index];
    const color = status.satisfied ? '#6dff9d' : status.status === 'partial' ? '#ffd369' : '#5f7082';
    ctx.save();
    ctx.fillStyle = status.satisfied ? 'rgba(109,255,157,.10)' : 'rgba(129,151,171,.07)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.shadowBlur = status.satisfied ? 26 : 9;
    ctx.shadowColor = color;
    ctx.beginPath(); ctx.arc(goal.x, goal.y, goal.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d8e9f5';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${goal.id}: ${goal.requiredColor} · ${status.status}`, goal.x, goal.y - goal.radius - 13);
    ctx.restore();
  });
}

function drawRaySegments(segments, { exactOverlay = false } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  if (exactOverlay) ctx.setLineDash([5, 7]);
  for (const segment of segments) {
    const intensity = segment.displayIntensity ?? segment.intensity ?? 1;
    const alpha = exactOverlay ? 0.24 : Math.max(0.06, Math.min(1, intensity));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = exactOverlay ? '#f7fbff' : segment.color;
    ctx.shadowColor = exactOverlay ? '#ffffff' : segment.color;
    ctx.shadowBlur = exactOverlay ? 0 : 5 + 12 * alpha;
    ctx.lineWidth = exactOverlay ? 1.2 : (segment.wavelength == null ? 4 : Math.max(1.2, 3 * alpha));
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLock(x, y) {
  ctx.save();
  ctx.strokeStyle = '#8293a4';
  ctx.fillStyle = 'rgba(18,30,43,.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 7, 7, Math.PI, 0);
  ctx.stroke();
  ctx.fillRect(x - 9, y - 7, 18, 14);
  ctx.strokeRect(x - 9, y - 7, 18, 14);
  ctx.restore();
}

function visualState(piece) {
  if (!piece.movable && !piece.rotatable) return 'fixed';
  if (model.state.selectedId === piece.id && model.state.invalid) return 'invalid';
  if (model.state.selectedId === piece.id) return 'selected';
  if (model.state.hoverId === piece.id) return 'hover';
  return 'idle';
}

function stateStroke(state) {
  if (state === 'invalid' || state === 'invalid-ghost') return '#ff667f';
  if (state === 'selected') return '#fff08a';
  if (state === 'hover') return '#8cf1ff';
  if (state === 'fixed') return '#65788b';
  return '#63d1eb';
}

function drawPiece(piece, { override = null, forcedState = null } = {}) {
  const p = override ? { ...piece, ...override } : piece;
  const state = forcedState ?? visualState(piece);
  const stroke = stateStroke(state);
  const selectedLike = state === 'selected' || state === 'invalid' || state === 'invalid-ghost';
  const fixed = state === 'fixed';

  ctx.save();
  if (state === 'invalid-ghost') ctx.setLineDash([8, 7]);
  ctx.strokeStyle = stroke;
  ctx.shadowColor = stroke;
  ctx.shadowBlur = fixed ? 0 : selectedLike ? 24 : state === 'hover' ? 18 : 10;
  ctx.globalAlpha = state === 'invalid-ghost' ? 0.62 : 1;

  if (p.type === 'mirror' || p.type === 'splitter') {
    const segment = p.type === 'splitter'
      ? splitterFromCenter({ id: p.id, x: p.x, y: p.y, length: p.length, rotation: p.rotation, splitRatio: p.splitRatio })
      : mirrorFromCenter({ id: p.id, x: p.x, y: p.y, length: p.length, rotation: p.rotation });
    ctx.lineWidth = p.type === 'splitter' ? 7 : 6;
    ctx.beginPath(); ctx.moveTo(segment.a.x, segment.a.y); ctx.lineTo(segment.b.x, segment.b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = fixed ? '#91a0ad' : 'rgba(255,255,255,.82)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (p.type === 'refractor') {
    const polygon = piecePolygon(p);
    ctx.beginPath();
    polygon.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = state.startsWith('invalid') ? 'rgba(255,70,95,.12)' : 'rgba(93,190,255,.11)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (p.type === 'emitter') {
    ctx.fillStyle = '#fff1a0';
    ctx.shadowColor = '#fff1a0';
    ctx.shadowBlur = 25;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius ?? 21, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,241,160,.14)';
    ctx.beginPath(); ctx.moveTo(p.x + 15, p.y - 20); ctx.lineTo(p.x + 78, p.y); ctx.lineTo(p.x + 15, p.y + 20); ctx.closePath(); ctx.fill();
  }

  ctx.restore();

  if (state !== 'invalid-ghost') {
    ctx.save();
    ctx.fillStyle = fixed ? '#7f91a2' : '#b9d7e6';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'center';
    const suffix = p.type === 'splitter' ? ` ${Math.round((p.splitRatio ?? .5) * 100)}/${Math.round((1 - (p.splitRatio ?? .5)) * 100)}` : '';
    ctx.fillText(`${p.id}${suffix}`, p.x, p.y - 18);
    ctx.restore();
    if (fixed) drawLock(p.x + 28, p.y + 24);
  }
}

function drawRotationHandle(now) {
  const selected = model.selectedPiece();
  const handle = model.rotationHandle();
  if (!selected?.rotatable || !handle) return;
  const pulse = now < model.state.snapPulseUntil;
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = pulse ? '#fff49b' : 'rgba(137,225,255,.65)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(selected.x, selected.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = pulse ? '#fff49b' : '#86e6ff';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = pulse ? 28 : 14;
  ctx.beginPath(); ctx.arc(handle.x, handle.y, pulse ? 13 : 11, 0, Math.PI * 2); ctx.fill();
  if (pulse) {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(handle.x, handle.y, 21, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function updateUi(statuses, trace, physicsMs, frameMs, now) {
  const selected = model.selectedPiece();
  ui.selectedPiece.textContent = selected?.id ?? 'None';
  ui.interactionMode.textContent = model.state.mode ? model.state.mode[0].toUpperCase() + model.state.mode.slice(1) : 'Idle';
  ui.pointerType.textContent = model.state.pointerId == null ? (model.state.pointerType || '—') : model.state.pointerType;
  ui.placementState.textContent = model.state.invalid ? `Blocked: ${model.state.invalidReason}` : 'Valid';
  ui.placementState.classList.toggle('bad', model.state.invalid);
  ui.pieceType.textContent = selected?.type ?? '—';
  ui.pieceRotation.textContent = selected ? `${(selected.rotation * 180 / Math.PI).toFixed(1)}°` : '—';
  ui.pieceMovable.textContent = selected ? (selected.movable ? 'Yes' : 'No') : '—';
  ui.pieceRotatable.textContent = selected ? (selected.rotatable ? 'Yes' : 'No') : '—';
  if (now > lastSnapTextUntil) {
    ui.snapNotice.textContent = `${interactionConstants.snapIncrementDegrees}° snap ready`;
    ui.snapNotice.classList.remove('active');
  }
  const solved = checkLevelSolved(statuses);
  ui.solvedIndicator.textContent = `SOLVED: ${solved ? 'TRUE' : 'FALSE'}`;
  ui.solvedIndicator.classList.toggle('yes', solved);
  ui.physicsCost.textContent = `${physicsMs.toFixed(2)} ms`;
  ui.frameCost.textContent = `${frameMs.toFixed(2)} ms`;
  ui.rayNodeCount.textContent = String(trace.stats.rayNodes);
  ui.segmentCount.textContent = String(trace.segments.length);
  ui.goalReadout.innerHTML = statuses.map((status) => (
    `<div class="goal-row ${status.status}"><strong>${status.id}</strong><span>${status.status}</span><small>match ${status.matchingIntensity.toFixed(3)} / ${status.requiredIntensity.toFixed(2)}</small></div>`
  )).join('');
  canvas.style.cursor = model.state.mode ? 'grabbing' : model.state.hoverId ? 'grab' : 'default';
}

function render(now) {
  const frameStart = performance.now();
  const physicsStart = performance.now();
  const trace = exactSceneTrace();
  const physicsMs = performance.now() - physicsStart;
  const statuses = evaluateGoals(trace.rayTree, GOALS);
  const displayed = ui.enableSmoothing.checked ? smoother.update(trace.segments, now) : trace.segments;

  drawGrid();
  drawGoals(statuses);
  if (ui.showExact.checked) drawRaySegments(trace.segments, { exactOverlay: true });
  drawRaySegments(displayed);

  const normalPieces = pieces.filter((piece) => piece.id !== model.state.selectedId);
  normalPieces.forEach((piece) => drawPiece(piece));
  const selected = model.selectedPiece();
  if (selected) drawPiece(selected);
  if (selected && model.state.invalidCandidate) {
    drawPiece(selected, { override: model.state.invalidCandidate, forcedState: 'invalid-ghost' });
  }
  drawRotationHandle(now);

  updateUi(statuses, trace, physicsMs, performance.now() - frameStart, now);
  requestAnimationFrame(render);
}

function resetScene() {
  unbind();
  pieces = initialPieces();
  smoother.reset([]);
  createModel();
  lastSnapTextUntil = 0;
}

ui.reset.addEventListener('click', resetScene);
ui.enableSmoothing.addEventListener('change', () => smoother.reset([]));

createModel();
requestAnimationFrame(render);
