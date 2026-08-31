const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  levelLabel: document.getElementById('levelLabel'),
  levelTitle: document.getElementById('levelTitle'),
  objectiveText: document.getElementById('objectiveText'),
  selectedName: document.getElementById('selectedName'),
  selectedDescription: document.getElementById('selectedDescription'),
  angleValue: document.getElementById('angleValue'),
  angleSlider: document.getElementById('angleSlider'),
  rotateLeft: document.getElementById('rotateLeft'),
  rotateRight: document.getElementById('rotateRight'),
  deleteComponent: document.getElementById('deleteComponent'),
  physicsToggle: document.getElementById('physicsToggle'),
  physicsModeLabel: document.getElementById('physicsModeLabel'),
  prevLevel: document.getElementById('prevLevel'),
  resetLevel: document.getElementById('resetLevel'),
  nextLevel: document.getElementById('nextLevel'),
  moveCount: document.getElementById('moveCount'),
  parCount: document.getElementById('parCount'),
  starPreview: document.getElementById('starPreview'),
  rayCount: document.getElementById('rayCount'),
  interactionCount: document.getElementById('interactionCount'),
  targetCount: document.getElementById('targetCount'),
  mediumLabel: document.getElementById('mediumLabel'),
  progressText: document.getElementById('progressText'),
  toast: document.getElementById('toast'),
  componentBadge: document.getElementById('componentBadge'),
  sandboxTray: document.getElementById('sandboxTray'),
  spectrumReadout: document.getElementById('spectrumReadout')
};

const W = canvas.width;
const H = canvas.height;
const EPS = 0.9;
const MAX_INTERACTIONS = 28;
const MAX_RAYS = 80;
const CAMPAIGN_LEVELS = 7;

const LIGHT = {
  red: { hex: '#ff5f67', glow: '#ff303b', wavelength: 650, n: 1.514 },
  green: { hex: '#6cf59b', glow: '#24df69', wavelength: 540, n: 1.519 },
  blue: { hex: '#64a4ff', glow: '#3485ff', wavelength: 460, n: 1.526 }
};

const TYPE_LABEL = {
  mirror: 'Mirror',
  prism: 'Prism',
  lens: 'Convex lens',
  splitter: 'Beam splitter',
  filter: 'Color filter',
  blocker: 'Absorber'
};

const TYPE_DESCRIPTION = {
  mirror: 'Specular reflection: angle of incidence equals angle of reflection.',
  prism: 'Refracts light at each glass surface using Snell’s law. Refractive index changes with wavelength.',
  lens: 'Thin-lens approximation: parallel rays are redirected toward the focal point.',
  splitter: 'Transmits part of the beam and reflects the rest, creating two optical paths.',
  filter: 'Transmits its selected wavelength band and absorbs the other colors.',
  blocker: 'Absorbs incident light. Use other components to route the beam around it.'
};

const levels = [
  {
    title: 'Reflection 101',
    objective: 'Use the mirror to send the green beam into the detector.',
    par: 3,
    source: { x: 105, y: 555, angle: -12, spectrum: ['green'] },
    targets: [{ x: 1050, y: 145, r: 34, color: 'green' }],
    components: [{ type: 'mirror', x: 575, y: 350, angle: 66, length: 190 }]
  },
  {
    title: 'Two-Bounce Relay',
    objective: 'Make the blue beam reflect from two mirrors before it reaches the detector.',
    par: 6,
    source: { x: 100, y: 585, angle: -18, spectrum: ['blue'] },
    targets: [{ x: 1080, y: 115, r: 32, color: 'blue' }],
    components: [
      { type: 'mirror', x: 425, y: 390, angle: 52, length: 165 },
      { type: 'mirror', x: 790, y: 275, angle: 121, length: 165 }
    ]
  },
  {
    title: 'Into Glass',
    objective: 'Rotate and position the prism so the green wavelength reaches the green detector.',
    par: 5,
    source: { x: 100, y: 350, angle: 0, spectrum: ['red', 'green', 'blue'] },
    targets: [{ x: 1050, y: 330, r: 38, color: 'green' }],
    components: [{ type: 'prism', x: 600, y: 350, angle: 12, size: 190, dispersion: 1 }]
  },
  {
    title: 'Spectrum Sort',
    objective: 'Use the high-dispersion prism to separate red, green and blue into their matching detectors.',
    par: 7,
    source: { x: 95, y: 350, angle: 0, spectrum: ['red', 'green', 'blue'] },
    targets: [
      { x: 1018, y: 650, r: 18, color: 'red' },
      { x: 993, y: 650, r: 18, color: 'green' },
      { x: 959, y: 650, r: 18, color: 'blue' }
    ],
    components: [{ type: 'prism', x: 610, y: 350, angle: 2, size: 205, dispersion: 4 }]
  },
  {
    title: 'Focus Point',
    objective: 'Align the convex lens so all five parallel blue rays converge on the detector.',
    par: 4,
    source: { x: 100, y: 350, angle: 0, spectrum: ['blue'], parallelOffsets: [-90, -45, 0, 45, 90] },
    targets: [{ x: 960, y: 350, r: 28, color: 'blue', minHits: 5 }],
    components: [{ type: 'lens', x: 700, y: 350, angle: 8, length: 300, focal: 260 }]
  },
  {
    title: 'Split Decision',
    objective: 'Set the beam splitter so one green beam reaches each detector.',
    par: 3,
    source: { x: 100, y: 350, angle: 0, spectrum: ['green'] },
    targets: [
      { x: 1080, y: 350, r: 30, color: 'green' },
      { x: 600, y: 625, r: 30, color: 'green' }
    ],
    components: [{ type: 'splitter', x: 600, y: 350, angle: 35, length: 190 }]
  },
  {
    title: 'Optical Lock',
    objective: 'Pass only green light, route it around the absorber, and unlock the detector.',
    par: 8,
    source: { x: 90, y: 560, angle: 0, spectrum: ['red', 'green', 'blue'] },
    targets: [{ x: 1050, y: 135, r: 32, color: 'green' }],
    components: [
      { type: 'filter', x: 300, y: 560, angle: 90, length: 150, passColor: 'green' },
      { type: 'mirror', x: 535, y: 515, angle: 48, length: 160 },
      { type: 'blocker', x: 780, y: 355, angle: 90, length: 290, locked: true },
      { type: 'mirror', x: 880, y: 240, angle: 126, length: 160 }
    ]
  },
  {
    title: 'Sandbox Lab',
    objective: 'Experiment freely. Add components and build your own optical path.',
    par: 0,
    sandbox: true,
    source: { x: 90, y: 350, angle: 0, spectrum: ['red', 'green', 'blue'] },
    targets: [{ x: 1100, y: 350, r: 34, color: 'any' }],
    components: [
      { type: 'mirror', x: 420, y: 260, angle: 35, length: 160 },
      { type: 'prism', x: 610, y: 420, angle: 0, size: 170, dispersion: 1 },
      { type: 'lens', x: 820, y: 260, angle: 0, length: 220, focal: 230 }
    ]
  }
];

let levelIndex = 0;
let state = null;
let selectedId = null;
let drag = null;
let physicsView = false;
let moveCount = 0;
let lastTrace = null;
let toastTimer = null;
let componentSerial = 0;

const savedProgress = JSON.parse(localStorage.getItem('prism-lab-v2-progress') || '{}');

function degToRad(v) { return v * Math.PI / 180; }
function radToDeg(v) { return v * 180 / Math.PI; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function mag(a) { return Math.hypot(a.x, a.y); }
function norm(a) { const m = mag(a) || 1; return { x: a.x / m, y: a.y / m }; }
function angleDir(deg) { const a = degToRad(deg); return { x: Math.cos(a), y: Math.sin(a) }; }

function cloneLevel(level) {
  componentSerial = 0;
  return {
    ...level,
    source: { ...level.source, spectrum: [...level.source.spectrum], parallelOffsets: [...(level.source.parallelOffsets || [0])] },
    targets: level.targets.map((t, i) => ({ ...t, id: `t${i}` })),
    components: level.components.map(c => ({ ...c, id: `c${componentSerial++}` }))
  };
}

function loadLevel(index) {
  levelIndex = clamp(index, 0, levels.length - 1);
  state = cloneLevel(levels[levelIndex]);
  selectedId = state.components[0]?.id || null;
  moveCount = 0;
  drag = null;
  ui.sandboxTray.hidden = !state.sandbox;
  updateUI();
  render();
}

function selectedComponent() {
  return state.components.find(c => c.id === selectedId) || null;
}

function lineSegment(c) {
  const drawAngle = c.type === 'lens' ? c.angle + 90 : c.angle;
  const d = angleDir(drawAngle);
  const half = (c.length || 160) / 2;
  return {
    a: { x: c.x - d.x * half, y: c.y - d.y * half },
    b: { x: c.x + d.x * half, y: c.y + d.y * half },
    d
  };
}

function prismVertices(c) {
  const radius = (c.size || 180) * 0.62;
  const base = degToRad(c.angle || 0);
  return [0, 1, 2].map(i => {
    const a = base + i * Math.PI * 2 / 3;
    return { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius };
  });
}

function prismEdges(c) {
  const v = prismVertices(c);
  const center = { x: c.x, y: c.y };
  return v.map((a, i) => {
    const b = v[(i + 1) % v.length];
    const d = norm(sub(b, a));
    const mid = mul(add(a, b), 0.5);
    let n = norm({ x: -d.y, y: d.x });
    if (dot(n, sub(center, mid)) > 0) n = mul(n, -1);
    return { a, b, d, outward: n, edgeIndex: i };
  });
}

function raySegmentIntersection(origin, dir, a, b) {
  const s = sub(b, a);
  const den = cross(dir, s);
  if (Math.abs(den) < 1e-8) return null;
  const ao = sub(a, origin);
  const t = cross(ao, s) / den;
  const u = cross(ao, dir) / den;
  if (t > EPS && u >= 0 && u <= 1) return { t, point: add(origin, mul(dir, t)), u };
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

function rayBoundary(origin, dir) {
  const candidates = [];
  if (dir.x > 1e-8) candidates.push((W - origin.x) / dir.x);
  if (dir.x < -1e-8) candidates.push((0 - origin.x) / dir.x);
  if (dir.y > 1e-8) candidates.push((H - origin.y) / dir.y);
  if (dir.y < -1e-8) candidates.push((0 - origin.y) / dir.y);
  const t = Math.min(...candidates.filter(v => v > EPS));
  return add(origin, mul(dir, Number.isFinite(t) ? t : 1800));
}

function reflect(dir, surfaceDir) {
  const n = norm({ x: -surfaceDir.y, y: surfaceDir.x });
  return norm(sub(dir, mul(n, 2 * dot(dir, n))));
}

function refract(dir, incidentNormal, n1, n2) {
  let n = norm(incidentNormal);
  if (dot(dir, n) > 0) n = mul(n, -1);
  const cosI = clamp(-dot(n, dir), -1, 1);
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) return null;
  return norm(add(mul(dir, eta), mul(n, eta * cosI - Math.sqrt(k))));
}

function glassIndex(color, dispersion = 1) {
  const base = LIGHT[color]?.n ?? 1.519;
  return 1.519 + (base - 1.519) * dispersion;
}

function componentHit(origin, dir, c) {
  if (c.type === 'prism') {
    let nearest = null;
    for (const edge of prismEdges(c)) {
      const hit = raySegmentIntersection(origin, dir, edge.a, edge.b);
      if (hit && (!nearest || hit.t < nearest.t)) nearest = { ...hit, edge };
    }
    return nearest;
  }
  const seg = lineSegment(c);
  const hit = raySegmentIntersection(origin, dir, seg.a, seg.b);
  return hit ? { ...hit, seg } : null;
}

function targetMatches(target, ray) {
  return target.color === 'any' || target.color === ray.color;
}

function makeInitialRays() {
  const source = state.source;
  const dir = angleDir(source.angle);
  const perp = { x: -dir.y, y: dir.x };
  const rays = [];
  let id = 0;
  for (const offset of source.parallelOffsets || [0]) {
    for (const color of source.spectrum) {
      rays.push({
        id: `r${id++}`,
        origin: add({ x: source.x, y: source.y }, mul(perp, offset)),
        dir,
        color,
        intensity: 1,
        medium: null,
        steps: 0
      });
    }
  }
  return rays;
}

function traceScene() {
  const queue = makeInitialRays();
  const segments = [];
  const interactions = [];
  const targetRays = new Map(state.targets.map(t => [t.id, new Set()]));
  let raysStarted = queue.length;
  let processed = 0;

  while (queue.length && processed < MAX_RAYS) {
    const ray = queue.shift();
    processed++;
    let origin = { ...ray.origin };
    let dir = norm(ray.dir);
    let medium = ray.medium;
    let intensity = ray.intensity;
    let steps = ray.steps || 0;

    while (steps < MAX_INTERACTIONS && intensity > 0.025) {
      steps++;
      let nearest = null;

      for (const c of state.components) {
        const hit = componentHit(origin, dir, c);
        if (hit && (!nearest || hit.t < nearest.t)) nearest = { ...hit, component: c };
      }

      let targetHit = null;
      for (const t of state.targets) {
        if (!targetMatches(t, { color: ray.color })) continue;
        const hit = rayCircleIntersection(origin, dir, t);
        if (hit && (!targetHit || hit.t < targetHit.t)) targetHit = { ...hit, target: t };
      }

      if (targetHit && (!nearest || targetHit.t < nearest.t)) {
        segments.push({ a: origin, b: targetHit.point, color: ray.color, intensity, rayId: ray.id });
        targetRays.get(targetHit.target.id).add(ray.id);
        break;
      }

      if (!nearest) {
        segments.push({ a: origin, b: rayBoundary(origin, dir), color: ray.color, intensity, rayId: ray.id });
        break;
      }

      const c = nearest.component;
      const hitPoint = nearest.point;
      segments.push({ a: origin, b: hitPoint, color: ray.color, intensity, rayId: ray.id });

      if (c.type === 'mirror') {
        const out = reflect(dir, nearest.seg.d);
        const normal = norm({ x: -nearest.seg.d.y, y: nearest.seg.d.x });
        const incidence = radToDeg(Math.acos(clamp(Math.abs(dot(dir, normal)), 0, 1)));
        interactions.push({ type: 'mirror', point: hitPoint, normal, incidence, color: ray.color, component: c });
        dir = out;
        origin = add(hitPoint, mul(dir, EPS * 2));
        continue;
      }

      if (c.type === 'blocker') {
        interactions.push({ type: 'blocker', point: hitPoint, color: ray.color, component: c });
        break;
      }

      if (c.type === 'filter') {
        const passed = c.passColor === ray.color;
        interactions.push({ type: 'filter', point: hitPoint, color: ray.color, passed, component: c });
        if (!passed) break;
        intensity *= 0.9;
        origin = add(hitPoint, mul(dir, EPS * 2));
        continue;
      }

      if (c.type === 'lens') {
        const axis = angleDir(c.angle);
        const side = dot(dir, axis) >= 0 ? 1 : -1;
        const focalPoint = add({ x: c.x, y: c.y }, mul(axis, side * (c.focal || 240)));
        const out = norm(sub(focalPoint, hitPoint));
        interactions.push({ type: 'lens', point: hitPoint, axis, focalPoint, color: ray.color, component: c });
        dir = out;
        intensity *= 0.96;
        origin = add(hitPoint, mul(dir, EPS * 2));
        continue;
      }

      if (c.type === 'splitter') {
        const reflected = reflect(dir, nearest.seg.d);
        interactions.push({ type: 'splitter', point: hitPoint, normal: norm({ x: -nearest.seg.d.y, y: nearest.seg.d.x }), color: ray.color, component: c });
        if (processed + queue.length < MAX_RAYS) {
          queue.push({
            id: `${ray.id}s${steps}`,
            origin: add(hitPoint, mul(reflected, EPS * 2)),
            dir: reflected,
            color: ray.color,
            intensity: intensity * 0.46,
            medium,
            steps
          });
          raysStarted++;
        }
        intensity *= 0.54;
        origin = add(hitPoint, mul(dir, EPS * 2));
        continue;
      }

      if (c.type === 'prism') {
        const entering = medium !== c.id;
        const nGlass = glassIndex(ray.color, c.dispersion || 1);
        const n1 = entering ? 1 : nGlass;
        const n2 = entering ? nGlass : 1;
        const incidentNormal = entering ? nearest.edge.outward : mul(nearest.edge.outward, -1);
        const out = refract(dir, incidentNormal, n1, n2);
        const cosI = clamp(Math.abs(dot(dir, incidentNormal)), 0, 1);
        const thetaI = radToDeg(Math.acos(cosI));

        if (!out) {
          const reflected = reflect(dir, nearest.edge.d);
          interactions.push({ type: 'prism-tir', point: hitPoint, normal: incidentNormal, thetaI, n1, n2, color: ray.color, component: c });
          dir = reflected;
          origin = add(hitPoint, mul(dir, EPS * 2));
          continue;
        }

        const cosT = clamp(Math.abs(dot(out, mul(incidentNormal, -1))), 0, 1);
        const thetaT = radToDeg(Math.acos(cosT));
        interactions.push({ type: 'prism', point: hitPoint, normal: incidentNormal, thetaI, thetaT, n1, n2, color: ray.color, component: c });
        dir = out;
        medium = entering ? c.id : null;
        intensity *= 0.97;
        origin = add(hitPoint, mul(dir, EPS * 2));
        continue;
      }

      break;
    }
  }

  const targetStatus = state.targets.map(t => {
    const hits = targetRays.get(t.id)?.size || 0;
    const need = t.minHits || 1;
    return { target: t, hits, need, satisfied: hits >= need };
  });

  return {
    segments,
    interactions,
    targetStatus,
    solved: !state.sandbox && targetStatus.every(s => s.satisfied),
    raysStarted,
    processed
  };
}

function colorHex(color) { return LIGHT[color]?.hex || '#eef6ff'; }
function colorGlow(color) { return LIGHT[color]?.glow || '#ffffff'; }

function drawBackground() {
  ctx.save();
  ctx.fillStyle = '#06101d';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(160, 80, 10, 160, 80, 850);
  glow.addColorStop(0, 'rgba(28,75,119,.22)');
  glow.addColorStop(1, 'rgba(6,16,29,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(100,145,190,.075)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

function drawSource() {
  const s = state.source;
  const dir = angleDir(s.angle);
  const perp = { x: -dir.y, y: dir.x };
  const offsets = s.parallelOffsets || [0];
  ctx.save();
  for (const off of offsets) {
    const p = add({ x: s.x, y: s.y }, mul(perp, off));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(degToRad(s.angle));
    ctx.fillStyle = '#f7fbff';
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#dfeeff';
    ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    s.spectrum.forEach((color, i) => {
      ctx.fillStyle = colorHex(color);
      ctx.globalAlpha = .34;
      ctx.beginPath(); ctx.moveTo(8,-10+i*2); ctx.lineTo(46,0); ctx.lineTo(8,10-i*2); ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  }
  ctx.restore();
}

function drawTargets(trace) {
  for (const status of trace.targetStatus) {
    const t = status.target;
    const base = t.color === 'any' ? '#eaf6ff' : colorHex(t.color);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.shadowBlur = status.satisfied ? 34 : 18;
    ctx.shadowColor = base;
    ctx.strokeStyle = base;
    ctx.fillStyle = status.satisfied ? `${base}3d` : `${base}16`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0,0,t.r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0,0,t.r*.48,0,Math.PI*2); ctx.stroke();
    if ((t.minHits || 1) > 1) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#dcecff';
      ctx.font = '800 13px ui-sans-serif,system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${status.hits}/${status.need}`,0,t.r+20);
    }
    ctx.restore();
  }
}

function drawSelection(c) {
  if (!c || c.id !== selectedId) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(87,231,255,.75)';
  ctx.setLineDash([7,6]);
  ctx.lineWidth = 2;
  const r = c.type === 'prism' ? (c.size || 180) * .72 : Math.max(46,(c.length || 160)*.56);
  ctx.beginPath(); ctx.arc(c.x,c.y,r,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#06101d';
  ctx.strokeStyle = '#57e7ff';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c.x,c.y,10,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawMirror(c) {
  const s = lineSegment(c);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowBlur = 15; ctx.shadowColor = '#7edfff';
  ctx.strokeStyle = '#c6f4ff'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#24495d'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.restore();
}

function drawPrism(c) {
  const v = prismVertices(c);
  ctx.save();
  const g = ctx.createLinearGradient(c.x-90,c.y-80,c.x+90,c.y+80);
  g.addColorStop(0,'rgba(255,110,120,.14)');
  g.addColorStop(.33,'rgba(255,230,100,.11)');
  g.addColorStop(.66,'rgba(90,240,150,.11)');
  g.addColorStop(1,'rgba(90,160,255,.17)');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#bcecff';
  ctx.lineWidth = 4;
  ctx.shadowBlur = 18; ctx.shadowColor = '#6bcfff';
  ctx.beginPath(); ctx.moveTo(v[0].x,v[0].y); v.slice(1).forEach(p=>ctx.lineTo(p.x,p.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawLens(c) {
  ctx.save();
  ctx.translate(c.x,c.y);
  ctx.rotate(degToRad(c.angle));
  const h = (c.length || 240)/2;
  const w = 22;
  ctx.fillStyle = 'rgba(75,194,255,.16)';
  ctx.strokeStyle = '#75d9ff';
  ctx.lineWidth = 4;
  ctx.shadowBlur = 16; ctx.shadowColor = '#55c8ff';
  ctx.beginPath();
  ctx.moveTo(0,-h);
  ctx.bezierCurveTo(w,-h*.62,w,h*.62,0,h);
  ctx.bezierCurveTo(-w,h*.62,-w,-h*.62,0,-h);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawSplitter(c) {
  const s = lineSegment(c);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(190,244,255,.78)';
  ctx.lineWidth = 8;
  ctx.shadowBlur = 13; ctx.shadowColor = '#76ddff';
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#183e52'; ctx.lineWidth = 2; ctx.setLineDash([10,7]);
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.restore();
}

function drawFilter(c) {
  const s = lineSegment(c);
  const col = colorHex(c.passColor);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = col; ctx.globalAlpha = .65; ctx.lineWidth = 13;
  ctx.shadowBlur = 18; ctx.shadowColor = col;
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.strokeStyle = '#d5e4f4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.restore();
}

function drawBlocker(c) {
  const s = lineSegment(c);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3e4d61'; ctx.lineWidth = 18;
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.strokeStyle = '#718198'; ctx.lineWidth = 3; ctx.setLineDash([5,8]);
  ctx.beginPath(); ctx.moveTo(s.a.x,s.a.y); ctx.lineTo(s.b.x,s.b.y); ctx.stroke();
  ctx.restore();
}

function drawComponents() {
  for (const c of state.components) {
    if (c.type === 'mirror') drawMirror(c);
    if (c.type === 'prism') drawPrism(c);
    if (c.type === 'lens') drawLens(c);
    if (c.type === 'splitter') drawSplitter(c);
    if (c.type === 'filter') drawFilter(c);
    if (c.type === 'blocker') drawBlocker(c);
    drawSelection(c);
  }
}

function drawBeams(trace) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const seg of trace.segments) {
    const col = colorHex(seg.color);
    ctx.globalAlpha = clamp(seg.intensity, .12, 1);
    ctx.strokeStyle = col;
    ctx.shadowBlur = 18;
    ctx.shadowColor = colorGlow(seg.color);
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(seg.a.x,seg.a.y); ctx.lineTo(seg.b.x,seg.b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = clamp(seg.intensity*.35, .04, .35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(seg.a.x,seg.a.y); ctx.lineTo(seg.b.x,seg.b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawPhysics(trace) {
  if (!physicsView) return;
  ctx.save();
  ctx.font = '800 12px ui-sans-serif,system-ui';
  ctx.textBaseline = 'middle';

  const chosen = trace.interactions.filter(i => i.component.id === selectedId).slice(0,8);
  for (const item of chosen) {
    const p = item.point;
    if (item.normal) {
      ctx.setLineDash([6,6]);
      ctx.strokeStyle = 'rgba(87,231,255,.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x-item.normal.x*52,p.y-item.normal.y*52);
      ctx.lineTo(p.x+item.normal.x*52,p.y+item.normal.y*52);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#57e7ff';
    ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill();

    let label = item.type;
    if (item.type === 'mirror') label = `θi = θr = ${item.incidence.toFixed(1)}°`;
    if (item.type === 'prism') label = `n ${item.n1.toFixed(3)}→${item.n2.toFixed(3)}  ${item.thetaI.toFixed(1)}°→${item.thetaT.toFixed(1)}°`;
    if (item.type === 'prism-tir') label = `TIR at ${item.thetaI.toFixed(1)}°`;
    if (item.type === 'splitter') label = '54% transmit / 46% reflect';
    if (item.type === 'filter') label = item.passed ? `${item.color} transmitted` : `${item.color} absorbed`;
    if (item.type === 'blocker') label = 'absorbed';
    if (item.type === 'lens') label = `thin lens  f=${item.component.focal || 240}px`;

    const tw = ctx.measureText(label).width;
    const lx = clamp(p.x+14,8,W-tw-18);
    const ly = clamp(p.y-24,16,H-16);
    ctx.fillStyle = 'rgba(4,12,22,.88)';
    ctx.fillRect(lx-6,ly-11,tw+12,22);
    ctx.fillStyle = '#c5f6ff';
    ctx.fillText(label,lx,ly);
  }

  const c = selectedComponent();
  if (c?.type === 'lens') {
    const axis = angleDir(c.angle);
    const f = c.focal || 240;
    ctx.strokeStyle = 'rgba(120,220,255,.45)';
    ctx.setLineDash([8,8]);
    ctx.beginPath();
    ctx.moveTo(c.x-axis.x*360,c.y-axis.y*360);
    ctx.lineTo(c.x+axis.x*360,c.y+axis.y*360);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const sign of [-1,1]) {
      const fp = add({x:c.x,y:c.y},mul(axis,sign*f));
      ctx.fillStyle = '#ffe27b';
      ctx.beginPath();ctx.arc(fp.x,fp.y,6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle = '#ffe9a0';ctx.fillText('F',fp.x+9,fp.y);
    }
  }
  ctx.restore();
}

function starsForMoves(moves, par) {
  if (!par) return 0;
  if (moves <= par) return 3;
  if (moves <= par + 3) return 2;
  return 1;
}

function maybeRecordSolve(trace) {
  if (!trace.solved) return;
  const key = String(levelIndex);
  const stars = starsForMoves(moveCount, state.par);
  const previous = savedProgress[key] || { stars: 0, bestMoves: Infinity };
  if (stars > previous.stars || moveCount < previous.bestMoves) {
    savedProgress[key] = { stars: Math.max(stars, previous.stars), bestMoves: Math.min(moveCount, previous.bestMoves) };
    localStorage.setItem('prism-lab-v2-progress', JSON.stringify(savedProgress));
  }
  if (!state._announced) {
    state._announced = true;
    showToast(`Solved • ${'★'.repeat(stars)}${'☆'.repeat(3-stars)} • ${moveCount} moves`);
  }
}

function render() {
  if (!state) return;
  lastTrace = traceScene();
  drawBackground();
  drawTargets(lastTrace);
  drawComponents();
  drawBeams(lastTrace);
  drawSource();
  drawPhysics(lastTrace);
  maybeRecordSolve(lastTrace);
  updateLiveUI();
}

function updateSpectrumUI() {
  const active = new Set(state.source.spectrum);
  ui.spectrumReadout.querySelectorAll('.spec').forEach(el => {
    const color = el.classList.contains('red') ? 'red' : el.classList.contains('green') ? 'green' : 'blue';
    el.style.opacity = active.has(color) ? '1' : '.24';
  });
}

function updateUI() {
  ui.levelLabel.textContent = state.sandbox ? 'Sandbox' : `Level ${levelIndex + 1} of ${CAMPAIGN_LEVELS}`;
  ui.levelTitle.textContent = state.title;
  ui.objectiveText.textContent = state.objective;
  ui.parCount.textContent = state.sandbox ? '—' : state.par;
  ui.prevLevel.disabled = levelIndex === 0;
  ui.nextLevel.disabled = levelIndex === levels.length - 1;
  updateSelectedUI();
  updateSpectrumUI();
  updateProgressUI();
}

function updateSelectedUI() {
  const c = selectedComponent();
  if (!c) {
    ui.selectedName.textContent = 'None';
    ui.selectedDescription.textContent = 'Select a component on the board.';
    ui.angleValue.textContent = '—';
    ui.componentBadge.textContent = 'No selection';
    ui.rotateLeft.disabled = true;
    ui.rotateRight.disabled = true;
    ui.angleSlider.disabled = true;
    ui.deleteComponent.hidden = true;
    return;
  }
  const sameType = state.components.filter(x => x.type === c.type);
  const typeIndex = sameType.findIndex(x => x.id === c.id) + 1;
  ui.selectedName.textContent = `${TYPE_LABEL[c.type]} ${typeIndex}`;
  ui.selectedDescription.textContent = c.type === 'filter'
    ? `${TYPE_DESCRIPTION.filter} This filter passes ${c.passColor}.`
    : TYPE_DESCRIPTION[c.type];
  const angle = Math.round(((c.angle || 0) % 180 + 180) % 180);
  ui.angleValue.textContent = angle;
  ui.angleSlider.value = angle;
  ui.componentBadge.textContent = c.locked ? `${TYPE_LABEL[c.type]} • fixed` : TYPE_LABEL[c.type];
  ui.rotateLeft.disabled = !!c.locked;
  ui.rotateRight.disabled = !!c.locked;
  ui.angleSlider.disabled = !!c.locked;
  ui.deleteComponent.hidden = !state.sandbox || !!c.locked;
}

function updateLiveUI() {
  ui.moveCount.textContent = moveCount;
  const stars = state.sandbox ? 0 : starsForMoves(moveCount, state.par);
  ui.starPreview.textContent = state.sandbox ? 'LAB' : `${'★'.repeat(stars)}${'☆'.repeat(3-stars)}`;
  ui.rayCount.textContent = lastTrace.raysStarted;
  ui.interactionCount.textContent = lastTrace.interactions.length;
  const satisfied = lastTrace.targetStatus.filter(s => s.satisfied).length;
  ui.targetCount.textContent = `${satisfied}/${state.targets.length}`;
  ui.mediumLabel.textContent = lastTrace.interactions.some(i => i.type.startsWith('prism')) ? 'Air ↔ Glass' : 'Air';
  ui.physicsModeLabel.textContent = physicsView ? 'Analysis' : 'Visual';
}

function updateProgressUI() {
  let solved = 0;
  let stars = 0;
  for (let i = 0; i < CAMPAIGN_LEVELS; i++) {
    if (savedProgress[String(i)]) {
      solved++;
      stars += savedProgress[String(i)].stars || 0;
    }
  }
  ui.progressText.textContent = `${solved} / ${CAMPAIGN_LEVELS} campaign levels solved • ${stars} / ${CAMPAIGN_LEVELS*3} stars`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2100);
}

function countMove() {
  moveCount++;
  state._announced = false;
}

function rotateSelected(delta, count = true) {
  const c = selectedComponent();
  if (!c || c.locked) return;
  c.angle = ((c.angle || 0) + delta + 180) % 180;
  if (count) countMove();
  updateSelectedUI();
  render();
}

function canvasPoint(event) {
  const r = canvas.getBoundingClientRect();
  return { x: (event.clientX-r.left)*W/r.width, y: (event.clientY-r.top)*H/r.height };
}

function distanceToSegment(p,a,b) {
  const ab = sub(b,a);
  const t = clamp(dot(sub(p,a),ab)/(dot(ab,ab)||1),0,1);
  const q = add(a,mul(ab,t));
  return Math.hypot(p.x-q.x,p.y-q.y);
}

function pointInTriangle(p, a, b, c) {
  const s1 = cross(sub(b,a),sub(p,a));
  const s2 = cross(sub(c,b),sub(p,b));
  const s3 = cross(sub(a,c),sub(p,c));
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

function pickComponent(p) {
  let best = null;
  for (const c of state.components) {
    let d = Infinity;
    if (c.type === 'prism') {
      const v = prismVertices(c);
      if (pointInTriangle(p,v[0],v[1],v[2])) d = 0;
      else d = Math.min(...prismEdges(c).map(e=>distanceToSegment(p,e.a,e.b)));
    } else {
      const s = lineSegment(c);
      d = distanceToSegment(p,s.a,s.b);
    }
    if (d < 34 && (!best || d < best.d)) best = { c, d };
  }
  return best?.c || null;
}

canvas.addEventListener('pointerdown', event => {
  const p = canvasPoint(event);
  const c = pickComponent(p);
  if (!c) return;
  selectedId = c.id;
  updateSelectedUI();
  render();
  if (c.locked) return;
  drag = { pointerId: event.pointerId, dx: p.x-c.x, dy: p.y-c.y, moved: false, startX: c.x, startY: c.y };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const c = selectedComponent();
  if (!c) return;
  const p = canvasPoint(event);
  const margin = c.type === 'prism' ? 90 : 55;
  c.x = clamp(p.x-drag.dx, margin, W-margin);
  c.y = clamp(p.y-drag.dy, margin, H-margin);
  if (Math.hypot(c.x-drag.startX,c.y-drag.startY) > 4) drag.moved = true;
  render();
});

function endDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.moved) countMove();
  drag = null;
  try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  render();
}
canvas.addEventListener('pointerup',endDrag);
canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('dblclick',event=>{
  const c = pickComponent(canvasPoint(event));
  if (!c || c.locked) return;
  selectedId = c.id;
  rotateSelected(10);
});

ui.rotateLeft.addEventListener('click',()=>rotateSelected(-5));
ui.rotateRight.addEventListener('click',()=>rotateSelected(5));
ui.angleSlider.addEventListener('input',()=>{
  const c = selectedComponent();
  if (!c || c.locked) return;
  c.angle = Number(ui.angleSlider.value);
  updateSelectedUI();
  render();
});
ui.angleSlider.addEventListener('change',()=>countMove());
ui.physicsToggle.addEventListener('change',()=>{ physicsView = ui.physicsToggle.checked; render(); });
ui.prevLevel.addEventListener('click',()=>loadLevel(levelIndex-1));
ui.nextLevel.addEventListener('click',()=>loadLevel(levelIndex+1));
ui.resetLevel.addEventListener('click',()=>loadLevel(levelIndex));
ui.deleteComponent.addEventListener('click',()=>{
  if (!state.sandbox) return;
  const c = selectedComponent();
  if (!c || c.locked) return;
  state.components = state.components.filter(x=>x.id!==c.id);
  selectedId = state.components[0]?.id || null;
  countMove();
  updateSelectedUI();
  render();
});

function addSandboxComponent(kind) {
  if (!state.sandbox || state.components.length >= 25) return;
  let c = { id: `c${componentSerial++}`, x: 600, y: 350, angle: 45 };
  if (kind === 'mirror') c = { ...c, type: 'mirror', length: 160 };
  if (kind === 'prism') c = { ...c, type: 'prism', size: 170, dispersion: 1 };
  if (kind === 'lens') c = { ...c, type: 'lens', length: 230, focal: 230, angle: 0 };
  if (kind === 'splitter') c = { ...c, type: 'splitter', length: 170 };
  if (kind.startsWith('filter-')) c = { ...c, type: 'filter', length: 160, angle: 90, passColor: kind.split('-')[1] };
  if (kind === 'blocker') c = { ...c, type: 'blocker', length: 180, angle: 90 };
  state.components.push(c);
  selectedId = c.id;
  countMove();
  updateSelectedUI();
  render();
}

ui.sandboxTray.addEventListener('click',event=>{
  const button = event.target.closest('button[data-add]');
  if (button) addSandboxComponent(button.dataset.add);
});

window.addEventListener('keydown',event=>{
  if (event.key === 'ArrowLeft') rotateSelected(event.shiftKey ? -1 : -5);
  if (event.key === 'ArrowRight') rotateSelected(event.shiftKey ? 1 : 5);
  if (event.key.toLowerCase() === 'r') loadLevel(levelIndex);
  if (event.key.toLowerCase() === 'p') {
    physicsView = !physicsView;
    ui.physicsToggle.checked = physicsView;
    render();
  }
});

loadLevel(0);
