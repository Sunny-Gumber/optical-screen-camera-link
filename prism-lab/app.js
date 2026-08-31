const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  levelLabel: document.getElementById('levelLabel'),
  levelTitle: document.getElementById('levelTitle'),
  selectedName: document.getElementById('selectedName'),
  angleValue: document.getElementById('angleValue'),
  angleSlider: document.getElementById('angleSlider'),
  rotateLeft: document.getElementById('rotateLeft'),
  rotateRight: document.getElementById('rotateRight'),
  physicsToggle: document.getElementById('physicsToggle'),
  prevLevel: document.getElementById('prevLevel'),
  resetLevel: document.getElementById('resetLevel'),
  nextLevel: document.getElementById('nextLevel'),
  progressText: document.getElementById('progressText'),
  toast: document.getElementById('toast')
};

const W = canvas.width;
const H = canvas.height;
const EPS = 0.75;
const MAX_BOUNCES = 12;

const levels = [
  {
    title: 'First Reflection',
    hint: 'Use one mirror to bend the beam into the target.',
    source: { x: 105, y: 530, angle: -18 },
    target: { x: 1030, y: 155, r: 34 },
    mirrors: [{ x: 610, y: 360, length: 190, angle: 62 }]
  },
  {
    title: 'Corner Shot',
    hint: 'One mirror is enough, but position matters.',
    source: { x: 110, y: 150, angle: 16 },
    target: { x: 1015, y: 560, r: 34 },
    mirrors: [{ x: 565, y: 335, length: 205, angle: 116 }]
  },
  {
    title: 'Double Bounce',
    hint: 'Make the beam reflect from both mirrors.',
    source: { x: 105, y: 590, angle: -26 },
    target: { x: 1050, y: 120, r: 34 },
    mirrors: [
      { x: 430, y: 380, length: 175, angle: 48 },
      { x: 790, y: 280, length: 175, angle: 126 }
    ]
  },
  {
    title: 'Precision Path',
    hint: 'Three mirrors. Build a clean optical path.',
    source: { x: 95, y: 350, angle: 0 },
    target: { x: 1090, y: 350, r: 32 },
    mirrors: [
      { x: 365, y: 350, length: 150, angle: 45 },
      { x: 610, y: 160, length: 155, angle: 135 },
      { x: 845, y: 350, length: 150, angle: 45 }
    ]
  }
];

let levelIndex = 0;
let state = null;
let selectedMirror = 0;
let drag = null;
let physicsView = false;
let lastTrace = null;
let toastTimer = null;

const solvedLevels = new Set(JSON.parse(localStorage.getItem('prism-lab-v1-solved') || '[]'));

function degToRad(deg) { return deg * Math.PI / 180; }
function radToDeg(rad) { return rad * 180 / Math.PI; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
function len(a) { return Math.hypot(a.x, a.y); }
function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }

function cloneLevel(level) {
  return {
    title: level.title,
    hint: level.hint,
    source: { ...level.source },
    target: { ...level.target },
    mirrors: level.mirrors.map((m, i) => ({ ...m, id: i }))
  };
}

function loadLevel(index) {
  levelIndex = (index + levels.length) % levels.length;
  state = cloneLevel(levels[levelIndex]);
  selectedMirror = 0;
  drag = null;
  updateUI();
  render();
}

function mirrorEnds(m) {
  const a = degToRad(m.angle);
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const half = m.length / 2;
  return {
    a: { x: m.x - d.x * half, y: m.y - d.y * half },
    b: { x: m.x + d.x * half, y: m.y + d.y * half },
    d
  };
}

function raySegmentIntersection(origin, dir, a, b) {
  const s = sub(b, a);
  const denom = cross(dir, s);
  if (Math.abs(denom) < 1e-8) return null;
  const ao = sub(a, origin);
  const t = cross(ao, s) / denom;
  const u = cross(ao, dir) / denom;
  if (t > EPS && u >= 0 && u <= 1) return { t, u, point: add(origin, mul(dir, t)) };
  return null;
}

function rayCircleIntersection(origin, dir, circle) {
  const oc = { x: origin.x - circle.x, y: origin.y - circle.y };
  const b = 2 * dot(oc, dir);
  const c = dot(oc, oc) - circle.r * circle.r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / 2;
  const t2 = (-b + root) / 2;
  const t = t1 > EPS ? t1 : (t2 > EPS ? t2 : null);
  return t == null ? null : { t, point: add(origin, mul(dir, t)) };
}

function rayToBoundary(origin, dir) {
  const candidates = [];
  if (dir.x > 1e-8) candidates.push((W - origin.x) / dir.x);
  if (dir.x < -1e-8) candidates.push((0 - origin.x) / dir.x);
  if (dir.y > 1e-8) candidates.push((H - origin.y) / dir.y);
  if (dir.y < -1e-8) candidates.push((0 - origin.y) / dir.y);
  const t = Math.min(...candidates.filter(v => v > EPS));
  return add(origin, mul(dir, Number.isFinite(t) ? t : 2000));
}

function reflect(dir, mirrorDir) {
  const n = norm({ x: -mirrorDir.y, y: mirrorDir.x });
  const k = 2 * dot(dir, n);
  return norm({ x: dir.x - k * n.x, y: dir.y - k * n.y });
}

function traceRay() {
  const sourceAngle = degToRad(state.source.angle);
  let origin = { x: state.source.x, y: state.source.y };
  let dir = norm({ x: Math.cos(sourceAngle), y: Math.sin(sourceAngle) });
  const segments = [];
  const hits = [];
  let targetHit = false;

  for (let bounce = 0; bounce <= MAX_BOUNCES; bounce++) {
    let nearest = null;

    for (const mirror of state.mirrors) {
      const ends = mirrorEnds(mirror);
      const hit = raySegmentIntersection(origin, dir, ends.a, ends.b);
      if (hit && (!nearest || hit.t < nearest.t)) {
        nearest = { ...hit, mirror, mirrorDir: ends.d };
      }
    }

    const target = rayCircleIntersection(origin, dir, state.target);
    if (target && (!nearest || target.t < nearest.t)) {
      segments.push({ a: origin, b: target.point, final: true });
      targetHit = true;
      break;
    }

    if (!nearest) {
      segments.push({ a: origin, b: rayToBoundary(origin, dir), final: true });
      break;
    }

    segments.push({ a: origin, b: nearest.point, mirrorId: nearest.mirror.id });
    const reflected = reflect(dir, nearest.mirrorDir);
    const normal = norm({ x: -nearest.mirrorDir.y, y: nearest.mirrorDir.x });
    const incidence = radToDeg(Math.acos(clamp(Math.abs(dot(dir, normal)), 0, 1)));
    hits.push({ point: nearest.point, incoming: dir, outgoing: reflected, normal, incidence, mirrorId: nearest.mirror.id });
    origin = add(nearest.point, mul(reflected, EPS * 2));
    dir = reflected;
  }

  return { segments, hits, targetHit };
}

function drawGrid() {
  ctx.save();
  ctx.fillStyle = '#06101d';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createRadialGradient(W * .15, H * .1, 10, W * .15, H * .1, W * .9);
  grad.addColorStop(0, 'rgba(28,72,112,.22)');
  grad.addColorStop(1, 'rgba(6,16,29,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(90,135,180,.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

function drawTarget(hit) {
  const t = state.target;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.shadowBlur = hit ? 38 : 20;
  ctx.shadowColor = '#72f5a6';
  ctx.strokeStyle = '#72f5a6';
  ctx.fillStyle = hit ? 'rgba(114,245,166,.34)' : 'rgba(114,245,166,.12)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, t.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, t.r * .48, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawSource() {
  const s = state.source;
  const a = degToRad(s.angle);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(a);
  ctx.shadowBlur = 25;
  ctx.shadowColor = '#ffe27a';
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,226,122,.24)';
  ctx.beginPath(); ctx.moveTo(10, -16); ctx.lineTo(48, 0); ctx.lineTo(10, 16); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawMirrors() {
  state.mirrors.forEach((m, i) => {
    const ends = mirrorEnds(m);
    const selected = i === selectedMirror;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = selected ? 22 : 11;
    ctx.shadowColor = selected ? '#57e7ff' : '#87c6de';
    ctx.strokeStyle = selected ? '#57e7ff' : '#b9dbe8';
    ctx.lineWidth = selected ? 9 : 7;
    ctx.beginPath(); ctx.moveTo(ends.a.x, ends.a.y); ctx.lineTo(ends.b.x, ends.b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#17384a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ends.a.x, ends.a.y); ctx.lineTo(ends.b.x, ends.b.y); ctx.stroke();

    if (selected) {
      ctx.fillStyle = '#07101d';
      ctx.strokeStyle = '#57e7ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  });
}

function drawBeam(trace) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const seg of trace.segments) {
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ffe27a';
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,240,.95)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawPhysics(trace) {
  if (!physicsView) return;
  ctx.save();
  ctx.font = '700 14px ui-sans-serif, system-ui';
  ctx.textBaseline = 'middle';
  for (const hit of trace.hits) {
    const p = hit.point;
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = 'rgba(87,231,255,.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - hit.normal.x * 58, p.y - hit.normal.y * 58);
    ctx.lineTo(p.x + hit.normal.x * 58, p.y + hit.normal.y * 58);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#57e7ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();

    const label = `θi = θr = ${hit.incidence.toFixed(1)}°`;
    const tw = ctx.measureText(label).width;
    const lx = clamp(p.x + 16, 8, W - tw - 22);
    const ly = clamp(p.y - 28, 18, H - 18);
    ctx.fillStyle = 'rgba(5,14,25,.86)';
    ctx.fillRect(lx - 7, ly - 12, tw + 14, 24);
    ctx.fillStyle = '#bff6ff';
    ctx.fillText(label, lx, ly);
  }
  ctx.restore();
}

function render() {
  if (!state) return;
  lastTrace = traceRay();
  drawGrid();
  drawTarget(lastTrace.targetHit);
  drawMirrors();
  drawBeam(lastTrace);
  drawSource();
  drawPhysics(lastTrace);

  if (lastTrace.targetHit && !solvedLevels.has(levelIndex)) {
    solvedLevels.add(levelIndex);
    localStorage.setItem('prism-lab-v1-solved', JSON.stringify([...solvedLevels]));
    showToast(`Level ${levelIndex + 1} solved!`);
    updateProgress();
  }
}

function updateUI() {
  const m = state.mirrors[selectedMirror];
  ui.levelLabel.textContent = `Level ${levelIndex + 1} of ${levels.length}`;
  ui.levelTitle.textContent = state.title;
  ui.selectedName.textContent = `Mirror ${selectedMirror + 1}`;
  ui.angleValue.textContent = Math.round((m.angle % 180 + 180) % 180);
  ui.angleSlider.value = Math.round((m.angle % 180 + 180) % 180);
  ui.prevLevel.disabled = levelIndex === 0;
  ui.nextLevel.disabled = levelIndex === levels.length - 1;
  updateProgress();
}

function updateSelectedUI() {
  const m = state.mirrors[selectedMirror];
  const angle = Math.round((m.angle % 180 + 180) % 180);
  ui.selectedName.textContent = `Mirror ${selectedMirror + 1}`;
  ui.angleValue.textContent = angle;
  ui.angleSlider.value = angle;
}

function updateProgress() {
  ui.progressText.textContent = `${solvedLevels.size} / ${levels.length} levels solved`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

function rotateSelected(delta) {
  const m = state.mirrors[selectedMirror];
  m.angle = (m.angle + delta + 180) % 180;
  updateSelectedUI();
  render();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * W / rect.width,
    y: (event.clientY - rect.top) * H / rect.height
  };
}

function distanceToSegment(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const denom = dot(ab, ab) || 1;
  const t = clamp(dot(ap, ab) / denom, 0, 1);
  const q = add(a, mul(ab, t));
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function pickMirror(p) {
  let best = null;
  state.mirrors.forEach((m, i) => {
    const ends = mirrorEnds(m);
    const d = distanceToSegment(p, ends.a, ends.b);
    if (d < 34 && (!best || d < best.d)) best = { i, d };
  });
  return best ? best.i : null;
}

canvas.addEventListener('pointerdown', (event) => {
  const p = canvasPoint(event);
  const picked = pickMirror(p);
  if (picked == null) return;
  selectedMirror = picked;
  const m = state.mirrors[selectedMirror];
  drag = { dx: p.x - m.x, dy: p.y - m.y, pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
  updateSelectedUI();
  render();
});

canvas.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const p = canvasPoint(event);
  const m = state.mirrors[selectedMirror];
  const margin = Math.max(55, m.length * .15);
  m.x = clamp(p.x - drag.dx, margin, W - margin);
  m.y = clamp(p.y - drag.dy, margin, H - margin);
  render();
});

function endDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = null;
  try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('dblclick', (event) => {
  const picked = pickMirror(canvasPoint(event));
  if (picked == null) return;
  selectedMirror = picked;
  rotateSelected(15);
});

ui.rotateLeft.addEventListener('click', () => rotateSelected(-5));
ui.rotateRight.addEventListener('click', () => rotateSelected(5));
ui.angleSlider.addEventListener('input', () => {
  state.mirrors[selectedMirror].angle = Number(ui.angleSlider.value);
  updateSelectedUI();
  render();
});
ui.physicsToggle.addEventListener('change', () => {
  physicsView = ui.physicsToggle.checked;
  render();
});
ui.resetLevel.addEventListener('click', () => loadLevel(levelIndex));
ui.prevLevel.addEventListener('click', () => loadLevel(levelIndex - 1));
ui.nextLevel.addEventListener('click', () => loadLevel(levelIndex + 1));

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') rotateSelected(event.shiftKey ? -1 : -5);
  if (event.key === 'ArrowRight') rotateSelected(event.shiftKey ? 1 : 5);
  if (event.key.toLowerCase() === 'r') loadLevel(levelIndex);
});

loadLevel(0);
