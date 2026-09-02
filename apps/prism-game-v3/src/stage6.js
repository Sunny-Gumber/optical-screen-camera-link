import './stage6.css';
import { InteractionModel, bindPointerInteractions } from './interaction/interaction.js';
import { RaySmoother } from './render/raySmoothing.js';
import {
  checkConcentrationSolved,
  lensFromCenter,
  parabolicReflectorFromCenter,
  traceDiffuseLightScene
} from './physics/concentrationEngine.js';

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const canvas = document.querySelector('#stage6Canvas');
const ctx = canvas.getContext('2d');
const bounds = { minX: 24, minY: 24, maxX: 1176, maxY: 696 };
const smoother = new RaySmoother({ durationMs: 110 });

const ui = Object.fromEntries([
  'solvedIndicator','concentrationValue','concentrationBar','physicsCost','frameCost','rayCountReadout','segmentCount',
  'fullRayCount','fullRayCountLabel','coneAngle','coneAngleLabel','smoothRays','showPhysics','selectedPiece','interactionMode',
  'samplingMode','placementState','emittedEnergy','landedEnergy','absorbedEnergy','escapedEnergy','opticLossEnergy','accountingError','logEnergy'
].map((id) => [id, document.querySelector(`#${id}`)]));

function reflectorDimensions(aperture, focalLength) {
  const depth = (aperture / 2) ** 2 / (4 * focalLength);
  return { depth, width: depth + 24, height: aperture };
}

const reflector = {
  id: 'R1', type: 'reflector', x: 280, y: 360, rotation: 0,
  focalLength: 120, aperture: 320, segmentCount: 96, reflectivity: 1,
  movable: true, rotatable: true, clearance: 5,
  ...reflectorDimensions(320, 120)
};
const lens = {
  id: 'L1', type: 'lens', x: 700, y: 360, rotation: 0,
  length: 360, focalLength: 220, transmission: 1,
  width: 20, height: 360, movable: true, rotatable: true, clearance: 5
};
const perfectReflector = parabolicReflectorFromCenter(reflector);
const source = {
  id: 'SRC1', x: perfectReflector.focus.x, y: perfectReflector.focus.y,
  centerDirection: Math.PI, totalEnergy: 1, wavelength: 589
};
const goal = { id: 'G1', shape: 'circle', x: 920, y: 360, radius: 26, requiredConcentration: 95 };
const absorptionWall = {
  id: 'W1',
  vertices: [{ x: 530, y: 150 }, { x: 550, y: 150 }, { x: 550, y: 570 }, { x: 530, y: 570 }]
};

let preset = 'perfect';
let reflectorActive = true;
let lensActive = true;
let wallActive = false;
let model = null;
let unbind = () => {};
let lastTrace = null;

function resetPieceStates({ reflectorRotation = 0, reflectorX = 280, reflectorY = 360, lensX = 700, lensY = 360, lensRotation = 0 } = {}) {
  reflector.x = reflectorX;
  reflector.y = reflectorY;
  reflector.rotation = reflectorRotation;
  Object.assign(reflector, reflectorDimensions(reflector.aperture, reflector.focalLength));
  lens.x = lensX;
  lens.y = lensY;
  lens.rotation = lensRotation;
}

function activePieces() {
  return [reflectorActive ? reflector : null, lensActive ? lens : null].filter(Boolean);
}

function bindModel() {
  unbind();
  model = new InteractionModel({
    pieces: activePieces(),
    bounds,
    onChange: ({ piece }) => {
      if (piece.type === 'reflector') Object.assign(piece, reflectorDimensions(piece.aperture, piece.focalLength));
    },
    onSnap: () => {
      try { navigator.vibrate?.(12); } catch { /* optional haptic */ }
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

function applyPreset(name) {
  preset = name;
  reflectorActive = name !== 'bare';
  lensActive = name === 'perfect' || name === 'misaligned' || name === 'wall';
  wallActive = name === 'wall';
  if (name === 'misaligned') resetPieceStates({ reflectorRotation: 18 * DEG });
  else resetPieceStates();
  smoother.reset();
  bindModel();
  document.querySelectorAll('[data-preset]').forEach((button) => button.classList.toggle('active', button.dataset.preset === name));
}

document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
ui.fullRayCount.addEventListener('input', () => { ui.fullRayCountLabel.textContent = ui.fullRayCount.value; });
ui.coneAngle.addEventListener('input', () => { ui.coneAngleLabel.textContent = `${ui.coneAngle.value}°`; });
ui.smoothRays.addEventListener('change', () => smoother.reset());
ui.logEnergy.addEventListener('click', () => {
  if (!lastTrace) return;
  console.group('Prism Lab Stage 6 energy snapshot');
  console.table({
    emitted: lastTrace.energy.emittedEnergy,
    goal: lastTrace.energy.goalEnergy,
    absorbed: lastTrace.energy.absorbedEnergy,
    escaped: lastTrace.energy.escapedEnergy,
    opticLoss: lastTrace.energy.opticLossEnergy,
    culled: lastTrace.energy.culledEnergy,
    terminated: lastTrace.energy.terminatedEnergy,
    accountingError: lastTrace.energy.accountingError
  });
  console.table(lastTrace.statuses.map((status) => ({ id: status.id, concentration: status.concentrationPercent, threshold: status.requiredConcentration, satisfied: status.satisfied })));
  console.groupEnd();
});

function makeReflector() {
  return parabolicReflectorFromCenter({
    id: reflector.id, x: reflector.x, y: reflector.y, rotation: reflector.rotation,
    focalLength: reflector.focalLength, aperture: reflector.aperture,
    segmentCount: reflector.segmentCount, reflectivity: reflector.reflectivity
  });
}
function makeLens() {
  return lensFromCenter({
    id: lens.id, x: lens.x, y: lens.y, rotation: lens.rotation,
    length: lens.length, focalLength: lens.focalLength, transmission: lens.transmission
  });
}

function drawGrid() {
  ctx.fillStyle = '#06101b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(85,148,194,.075)';
  ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 25; y < canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(105,183,232,.22)';
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function drawRays(segments, activeRayCount) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const segment of segments) {
    const energy = Math.max(0, segment.displayIntensity ?? segment.energy ?? segment.intensity ?? 0);
    const alpha = clamp(energy * activeRayCount * 0.055, 0.018, 0.11);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = segment.color ?? 'rgba(255,244,190,1)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
  }
  ctx.restore();
}

function pieceState(piece) {
  if (model?.state.selectedId === piece.id && model.state.invalid) return 'invalid';
  if (model?.state.selectedId === piece.id) return 'selected';
  if (model?.state.hoverId === piece.id) return 'hover';
  return 'idle';
}
function stateColor(piece) {
  const state = pieceState(piece);
  if (state === 'invalid') return '#ff667f';
  if (state === 'selected') return '#fff08d';
  if (state === 'hover') return '#8ef0ff';
  return '#67ddf5';
}

function drawReflector() {
  if (!reflectorActive) return;
  const geometry = makeReflector();
  const color = stateColor(reflector);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = pieceState(reflector) === 'selected' ? 22 : 10;
  ctx.lineWidth = 6;
  ctx.beginPath();
  geometry.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.stroke();
  ctx.restore();

  if (ui.showPhysics.checked) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,239,139,.55)';
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    ctx.moveTo(geometry.focus.x - 14, geometry.focus.y);
    ctx.lineTo(geometry.focus.x + 14, geometry.focus.y);
    ctx.moveTo(geometry.focus.x, geometry.focus.y - 14);
    ctx.lineTo(geometry.focus.x, geometry.focus.y + 14);
    ctx.stroke();
    ctx.fillStyle = '#fff09a';
    ctx.font = '700 11px system-ui';
    ctx.fillText('reflector focus', geometry.focus.x + 18, geometry.focus.y - 10);
    ctx.restore();
  }
}

function drawLens() {
  if (!lensActive) return;
  const geometry = makeLens();
  const color = stateColor(lens);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = pieceState(lens) === 'selected' ? 22 : 12;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(geometry.a.x, geometry.a.y); ctx.lineTo(geometry.b.x, geometry.b.y); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(220,248,255,.8)';
  ctx.beginPath(); ctx.moveTo(geometry.a.x, geometry.a.y); ctx.lineTo(geometry.b.x, geometry.b.y); ctx.stroke();
  ctx.restore();

  if (ui.showPhysics.checked) {
    const focus = { x: lens.x + geometry.axis.x * lens.focalLength, y: lens.y + geometry.axis.y * lens.focalLength };
    ctx.save();
    ctx.strokeStyle = 'rgba(255,239,139,.52)';
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.moveTo(lens.x, lens.y); ctx.lineTo(focus.x, focus.y); ctx.stroke();
    ctx.fillStyle = '#fff09a';
    ctx.beginPath(); ctx.arc(focus.x, focus.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 11px system-ui'; ctx.fillText(`f=${lens.focalLength}`, focus.x + 9, focus.y - 7);
    ctx.restore();
  }
}

function drawSource() {
  const cone = Number(ui.coneAngle.value) * DEG;
  ctx.save();
  ctx.fillStyle = '#fff3a0';
  ctx.shadowColor = '#fff3a0';
  ctx.shadowBlur = 26;
  ctx.beginPath(); ctx.arc(source.x, source.y, 18, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,240,150,.38)';
  ctx.setLineDash([4, 7]);
  for (const angle of [source.centerDirection - cone / 2, source.centerDirection + cone / 2]) {
    ctx.beginPath(); ctx.moveTo(source.x, source.y); ctx.lineTo(source.x + Math.cos(angle) * 150, source.y + Math.sin(angle) * 150); ctx.stroke();
  }
  ctx.fillStyle = '#ffe997';
  ctx.font = '700 11px system-ui';
  ctx.fillText('diffuse source', source.x + 24, source.y - 22);
  ctx.restore();
}

function drawWall() {
  if (!wallActive) return;
  const vertices = absorptionWall.vertices;
  ctx.save();
  ctx.fillStyle = 'rgba(170,179,190,.28)';
  ctx.strokeStyle = '#8996a5';
  ctx.lineWidth = 3;
  ctx.beginPath(); vertices.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#adb8c4'; ctx.font = '700 11px system-ui'; ctx.fillText('absorbing wall', 558, 170);
  ctx.restore();
}

function drawGoal(status) {
  const percent = status?.concentrationPercent ?? 0;
  const solved = status?.satisfied;
  const color = solved ? '#72ffa7' : percent > 0 ? '#ffd36f' : '#708396';
  ctx.save();
  ctx.fillStyle = solved ? 'rgba(114,255,167,.14)' : 'rgba(120,148,170,.08)';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = solved ? 28 : 10;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(goal.x, goal.y, goal.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#e8f6ff'; ctx.font = '800 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${percent.toFixed(1)}%`, goal.x, goal.y + 4);
  ctx.font = '700 10px system-ui'; ctx.fillText('95% target', goal.x, goal.y - goal.radius - 10);
  ctx.restore();
}

function drawRotationHandle(now) {
  const piece = model?.selectedPiece();
  const handle = model?.rotationHandle();
  if (!piece?.rotatable || !handle) return;
  const pulse = now < model.state.snapPulseUntil;
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = pulse ? '#fff39a' : '#7fe8ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(piece.x, piece.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = pulse ? '#fff39a' : '#7fe8ff';
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = pulse ? 25 : 12;
  ctx.beginPath(); ctx.arc(handle.x, handle.y, pulse ? 13 : 10, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function percent(value, total) {
  return total > 0 ? value / total * 100 : 0;
}

function updateUi(trace, activeRayCount, physicsMs, frameMs) {
  const status = trace.statuses[0];
  const concentration = status?.concentrationPercent ?? 0;
  const solved = checkConcentrationSolved(trace.statuses);
  ui.concentrationValue.textContent = `${concentration.toFixed(2)}%`;
  ui.concentrationBar.style.width = `${clamp(concentration, 0, 100)}%`;
  ui.solvedIndicator.textContent = solved ? 'SOLVED ≥ 95%' : 'NOT SOLVED';
  ui.solvedIndicator.classList.toggle('yes', solved);
  ui.physicsCost.textContent = `${physicsMs.toFixed(2)} ms`;
  ui.frameCost.textContent = `${frameMs.toFixed(2)} ms`;
  ui.rayCountReadout.textContent = String(activeRayCount);
  ui.segmentCount.textContent = String(trace.segments.length);
  ui.selectedPiece.textContent = model?.state.selectedId ?? 'None';
  ui.interactionMode.textContent = model?.state.mode ? model.state.mode[0].toUpperCase() + model.state.mode.slice(1) : 'Idle';
  ui.samplingMode.textContent = model?.state.mode ? 'Drag 50' : 'Full';
  ui.placementState.textContent = model?.state.invalid ? `Blocked: ${model.state.invalidReason}` : 'Valid';
  const total = trace.energy.emittedEnergy;
  ui.emittedEnergy.textContent = `${percent(total, total).toFixed(2)}%`;
  ui.landedEnergy.textContent = `${percent(trace.energy.goalEnergy, total).toFixed(2)}%`;
  ui.absorbedEnergy.textContent = `${percent(trace.energy.absorbedEnergy, total).toFixed(2)}%`;
  ui.escapedEnergy.textContent = `${percent(trace.energy.escapedEnergy, total).toFixed(2)}%`;
  ui.opticLossEnergy.textContent = `${percent(trace.energy.opticLossEnergy, total).toFixed(2)}%`;
  ui.accountingError.textContent = `${percent(trace.energy.accountingError, total).toFixed(6)}%`;
}

function render(now) {
  const frameStart = performance.now();
  const fullRayCount = Number(ui.fullRayCount.value);
  const activeRayCount = model?.state.mode ? Math.min(50, fullRayCount) : fullRayCount;
  const physicsStart = performance.now();
  const trace = traceDiffuseLightScene({
    lightSources: [{
      ...source,
      coneAngle: Number(ui.coneAngle.value) * DEG,
      rayCount: fullRayCount
    }],
    reflectors: reflectorActive ? [makeReflector()] : [],
    lenses: lensActive ? [makeLens()] : [],
    walls: wallActive ? [absorptionWall] : [],
    goals: [goal],
    bounds,
    rayCountOverride: activeRayCount,
    maxRayNodes: 24000,
    maxInteractions: 20
  });
  const physicsMs = performance.now() - physicsStart;
  lastTrace = trace;
  const segments = ui.smoothRays.checked ? smoother.update(trace.segments, now) : trace.segments;
  if (!ui.smoothRays.checked) smoother.reset(trace.segments);

  drawGrid();
  drawRays(segments, activeRayCount);
  drawSource();
  drawWall();
  drawReflector();
  drawLens();
  drawGoal(trace.statuses[0]);
  drawRotationHandle(now);
  const frameMs = performance.now() - frameStart;
  updateUi(trace, activeRayCount, physicsMs, frameMs);
  requestAnimationFrame(render);
}

applyPreset('perfect');
ui.fullRayCountLabel.textContent = ui.fullRayCount.value;
ui.coneAngleLabel.textContent = `${ui.coneAngle.value}°`;
requestAnimationFrame(render);
