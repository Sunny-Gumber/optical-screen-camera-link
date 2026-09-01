import './styles.css';
import {
  checkLevelSolved,
  directionFromAngle,
  evaluateGoals,
  goalCircle,
  goalRect,
  refractorFromCenter,
  splitterFromCenter,
  traceOpticalRays
} from './physics/rayEngine.js';

const canvas = document.querySelector('#stage');
const ctx = canvas.getContext('2d');
const bounds = { minX: 24, minY: 24, maxX: 1176, maxY: 696 };
const MIN_INTENSITY = 0.02;

const ui = Object.fromEntries([
  'preset','wavelength','emitterIntensity','emitterIntensityReadout','splitterRotation','splitterRotationReadout',
  'splitRatio','splitRatioReadout','reflectedBar','transmittedBar','goalAColor','goalBColor','goalIntensity',
  'goalIntensityReadout','showIntensity','showLabels','showHitDots','reset','goalReadout','solvedIndicator',
  'segmentCount','rayNodeCount','culledCount','frameCost'
].map((id) => [id, document.querySelector(`#${id}`)]));

const PRESETS = {
  dual: {
    emitter: { x: 120, y: 350, angle: 0, wavelength: 650, intensity: 1 },
    primary: { id: 'S1', x: 560, y: 350, length: 250, rotation: 45, splitRatio: 0.5, draggable: true },
    extraSplitters: [], refractors: [],
    goals: [
      { id: 'A', shape: 'circle', x: 930, y: 350, radius: 38, requiredColor: 'red' },
      { id: 'B', shape: 'circle', x: 560, y: 635, radius: 38, requiredColor: 'red' }
    ]
  },
  chain: {
    emitter: { x: 90, y: 350, angle: 0, wavelength: 650, intensity: 1 },
    primary: { id: 'S1', x: 300, y: 350, length: 230, rotation: 45, splitRatio: 0.5, draggable: true },
    extraSplitters: [420, 540, 660, 780, 900].map((x, i) => ({ id: `S${i + 2}`, x, y: 350, length: 230, rotation: 45, splitRatio: 0.5 })),
    refractors: [],
    goals: [{ id: 'A', shape: 'circle', x: 1080, y: 350, radius: 38, requiredColor: 'red' }]
  },
  attenuation: {
    emitter: { x: 90, y: 350, angle: 0, wavelength: 650, intensity: 1 },
    primary: { id: 'S1', x: 280, y: 350, length: 230, rotation: 45, splitRatio: 0.5, draggable: true },
    extraSplitters: [400, 520, 640, 760, 880].map((x, i) => ({ id: `S${i + 2}`, x, y: 350, length: 230, rotation: 45, splitRatio: 0.5 })),
    refractors: [],
    goals: [{ id: 'A', shape: 'circle', x: 1080, y: 350, radius: 38, requiredColor: 'red' }]
  },
  spectrum: {
    emitter: { x: 110, y: 350, angle: 0, wavelength: null, intensity: 1 },
    primary: { id: 'S1', x: 335, y: 350, length: 250, rotation: 0, splitRatio: 0.08, draggable: true },
    extraSplitters: [],
    refractors: [{
      id: 'P1', x: 590, y: 350, rotation: 0,
      vertices: [{ x: -90, y: -145 }, { x: -90, y: 145 }, { x: 130, y: 0 }],
      refractiveIndexBase: 1.52, dispersionCoefficient: 4200
    }],
    goals: [{ id: 'A', shape: 'rect', x: 940, y: 350, width: 90, height: 330, requiredColor: 'white' }]
  }
};

let state;
let dragging = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadPreset(name) {
  state = clone(PRESETS[name]);
  state.name = name;
  if (name === 'dual') { ui.goalAColor.value = 'red'; ui.goalBColor.value = 'red'; }
  if (name === 'chain' || name === 'attenuation') { ui.goalAColor.value = 'red'; }
  if (name === 'spectrum') { ui.goalAColor.value = 'white'; }
  syncControls();
}

function syncControls() {
  ui.preset.value = state.name;
  ui.wavelength.value = state.emitter.wavelength == null ? 'white' : String(state.emitter.wavelength);
  ui.emitterIntensity.value = String(state.emitter.intensity);
  ui.emitterIntensityReadout.textContent = state.emitter.intensity.toFixed(2);
  ui.splitterRotation.value = String(state.primary.rotation);
  ui.splitterRotationReadout.textContent = `${state.primary.rotation.toFixed(1)}°`;
  ui.splitRatio.value = String(state.primary.splitRatio);
  ui.splitRatioReadout.textContent = `${Math.round(state.primary.splitRatio * 100)}%`;
  ui.goalIntensity.value = state.name === 'attenuation' ? '0.30' : '0.25';
  ui.goalIntensityReadout.textContent = Number(ui.goalIntensity.value).toFixed(2);
  updateRatioBar();
}

function updateRatioBar() {
  const r = state.primary.splitRatio;
  ui.reflectedBar.style.width = `${r * 100}%`;
  ui.transmittedBar.style.width = `${(1 - r) * 100}%`;
}

function splitters() {
  const all = [state.primary, ...state.extraSplitters];
  return all.map((s) => splitterFromCenter({
    id: s.id, x: s.x, y: s.y, length: s.length, rotation: s.rotation * Math.PI / 180, splitRatio: s.splitRatio
  }));
}

function refractors() {
  return state.refractors.map((p) => refractorFromCenter({ ...p, rotation: p.rotation * Math.PI / 180 }));
}

function goals() {
  return state.goals.map((g, index) => {
    const requiredColor = index === 0 ? ui.goalAColor.value : ui.goalBColor.value;
    const requiredIntensity = Number(ui.goalIntensity.value);
    return g.shape === 'rect'
      ? goalRect({ ...g, requiredColor, requiredIntensity })
      : goalCircle({ ...g, requiredColor, requiredIntensity });
  });
}

function drawBackground() {
  ctx.fillStyle = '#06101c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(103,166,216,.07)'; ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 25; y < canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(103,166,216,.22)'; ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function drawEmitter() {
  const d = directionFromAngle(state.emitter.angle * Math.PI / 180);
  ctx.save(); ctx.translate(state.emitter.x, state.emitter.y); ctx.rotate(Math.atan2(d.y, d.x));
  ctx.shadowBlur = 24; ctx.shadowColor = '#fff5a6'; ctx.fillStyle = '#fff5a6';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,245,166,.18)'; ctx.beginPath(); ctx.moveTo(10, -18); ctx.lineTo(65, 0); ctx.lineTo(10, 18); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawSplitter(s, primary = false) {
  const splitter = splitterFromCenter({ id: s.id, x: s.x, y: s.y, length: s.length, rotation: s.rotation * Math.PI / 180, splitRatio: s.splitRatio });
  ctx.save();
  ctx.strokeStyle = primary ? '#a9f2ff' : '#6bd8f1'; ctx.lineWidth = primary ? 7 : 5;
  ctx.shadowBlur = primary ? 22 : 12; ctx.shadowColor = '#54d9ff';
  ctx.beginPath(); ctx.moveTo(splitter.a.x, splitter.a.y); ctx.lineTo(splitter.b.x, splitter.b.y); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  if (ui.showLabels.checked) {
    ctx.fillStyle = '#b9ecf7'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${s.id} ${Math.round(s.splitRatio * 100)}/${Math.round((1 - s.splitRatio) * 100)}`, s.x, s.y - 20);
  }
}

function drawPrism(p) {
  const r = refractorFromCenter({ ...p, rotation: p.rotation * Math.PI / 180 });
  ctx.save(); ctx.beginPath(); r.vertices.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.closePath();
  ctx.fillStyle = 'rgba(99,190,255,.10)'; ctx.fill(); ctx.strokeStyle = '#77d8f5'; ctx.lineWidth = 3; ctx.shadowBlur = 12; ctx.shadowColor = '#5fdfff'; ctx.stroke(); ctx.restore();
}

function drawRays(trace) {
  ctx.save(); ctx.lineCap = 'round';
  for (const s of trace.segments) {
    const alpha = ui.showIntensity.checked ? Math.max(0.08, Math.min(1, s.intensity ?? 1)) : 1;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = s.color; ctx.shadowColor = s.color; ctx.shadowBlur = 5 + 14 * alpha;
    ctx.lineWidth = s.wavelength == null ? 4 : Math.max(1.2, 3 * alpha);
    ctx.beginPath(); ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); ctx.stroke();
  }
  ctx.restore();
  if (ui.showHitDots.checked) {
    for (const h of trace.hits.filter((h) => h.type === 'splitter')) {
      ctx.fillStyle = '#f4fbff'; ctx.beginPath(); ctx.arc(h.point.x, h.point.y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawGoals(goalObjects, statuses) {
  goalObjects.forEach((g, i) => {
    const status = statuses[i];
    const color = status.status === 'satisfied' ? '#79ffae' : status.status === 'partial' ? '#ffd66b' : '#66788c';
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = `${color}18`; ctx.lineWidth = 4; ctx.shadowBlur = status.satisfied ? 24 : 8; ctx.shadowColor = color;
    if (g.shape === 'rect') { ctx.fillRect(g.x - g.width/2, g.y - g.height/2, g.width, g.height); ctx.strokeRect(g.x - g.width/2, g.y - g.height/2, g.width, g.height); }
    else { ctx.beginPath(); ctx.arc(g.x, g.y, g.radius, 0, Math.PI*2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#d7e7f4'; ctx.font = '700 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${g.id}: ${g.requiredColor} · ${status.status}`, g.x, g.shape === 'rect' ? g.y - g.height/2 - 12 : g.y - g.radius - 12);
  });
}

function updateGoalReadout(statuses) {
  ui.goalReadout.innerHTML = statuses.map((s) => `<div class="goal-row ${s.status}"><strong>${s.id}</strong><span>${s.status}</span><small>match ${s.matchingIntensity.toFixed(3)} / ${s.requiredIntensity.toFixed(2)}${s.whiteCoverage == null ? '' : ` · coverage ${(s.whiteCoverage*100).toFixed(0)}%`}</small></div>`).join('');
  const solved = checkLevelSolved(statuses);
  ui.solvedIndicator.textContent = `SOLVED: ${solved ? 'TRUE' : 'FALSE'}`;
  ui.solvedIndicator.classList.toggle('yes', solved);
}

function render() {
  const start = performance.now();
  const splitterObjects = splitters();
  const refractorObjects = refractors();
  const trace = traceOpticalRays({
    origin: { x: state.emitter.x, y: state.emitter.y },
    direction: directionFromAngle(state.emitter.angle * Math.PI / 180),
    splitters: splitterObjects,
    refractors: refractorObjects,
    mirrors: [], bounds, maxBounces: 20,
    wavelength: state.emitter.wavelength,
    intensity: state.emitter.intensity,
    minIntensity: MIN_INTENSITY,
    spectralSampleCount: 31
  });
  const goalObjects = goals();
  const statuses = evaluateGoals(trace.rayTree, goalObjects);
  drawBackground();
  state.refractors.forEach(drawPrism);
  drawGoals(goalObjects, statuses);
  drawRays(trace);
  drawEmitter();
  state.extraSplitters.forEach((s) => drawSplitter(s, false));
  drawSplitter(state.primary, true);
  updateGoalReadout(statuses);
  ui.segmentCount.textContent = String(trace.segments.length);
  ui.rayNodeCount.textContent = String(trace.stats.rayNodes);
  ui.culledCount.textContent = String(trace.stats.culledRays);
  ui.frameCost.textContent = `${(performance.now() - start).toFixed(2)} ms`;
  requestAnimationFrame(render);
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
}
function distanceToSegment(p, a, b) {
  const vx = b.x-a.x, vy=b.y-a.y, wx=p.x-a.x, wy=p.y-a.y;
  const c2=vx*vx+vy*vy; const t=c2 ? Math.max(0,Math.min(1,(wx*vx+wy*vy)/c2)) : 0;
  return Math.hypot(p.x-(a.x+t*vx), p.y-(a.y+t*vy));
}
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e); const s = splitters()[0];
  if (distanceToSegment(p, s.a, s.b) > 26) return;
  dragging = { id: e.pointerId, dx: p.x-state.primary.x, dy: p.y-state.primary.y };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || dragging.id !== e.pointerId) return;
  const p=canvasPoint(e);
  state.primary.x=Math.max(120,Math.min(1080,p.x-dragging.dx));
  state.primary.y=Math.max(100,Math.min(620,p.y-dragging.dy));
});
function endDrag(e){ if (dragging?.id===e.pointerId) dragging=null; }
canvas.addEventListener('pointerup',endDrag); canvas.addEventListener('pointercancel',endDrag);

ui.preset.addEventListener('change', () => loadPreset(ui.preset.value));
ui.wavelength.addEventListener('change', () => state.emitter.wavelength = ui.wavelength.value === 'white' ? null : Number(ui.wavelength.value));
ui.emitterIntensity.addEventListener('input', () => { state.emitter.intensity=Number(ui.emitterIntensity.value); ui.emitterIntensityReadout.textContent=state.emitter.intensity.toFixed(2); });
ui.splitterRotation.addEventListener('input', () => { state.primary.rotation=Number(ui.splitterRotation.value); ui.splitterRotationReadout.textContent=`${state.primary.rotation.toFixed(1)}°`; });
ui.splitRatio.addEventListener('input', () => { state.primary.splitRatio=Number(ui.splitRatio.value); ui.splitRatioReadout.textContent=`${Math.round(state.primary.splitRatio*100)}%`; updateRatioBar(); });
ui.goalIntensity.addEventListener('input', () => ui.goalIntensityReadout.textContent=Number(ui.goalIntensity.value).toFixed(2));
ui.reset.addEventListener('click', () => loadPreset(state.name));

loadPreset('dual');
requestAnimationFrame(render);
