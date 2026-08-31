import './styles.css';
import {
  directionFromAngle,
  isInsideMedium,
  refractorFromCenter,
  traceOpticalRays
} from './physics/rayEngine.js';

const canvas = document.querySelector('#stage');
const ctx = canvas.getContext('2d');

const ui = {
  preset: document.querySelector('#preset'),
  angle: document.querySelector('#angle'),
  angleReadout: document.querySelector('#angleReadout'),
  rotation: document.querySelector('#rotation'),
  rotationReadout: document.querySelector('#rotationReadout'),
  wavelength: document.querySelector('#wavelength'),
  nBase: document.querySelector('#nBase'),
  nBaseReadout: document.querySelector('#nBaseReadout'),
  dispersion: document.querySelector('#dispersion'),
  dispersionReadout: document.querySelector('#dispersionReadout'),
  samples: document.querySelector('#samples'),
  samplesReadout: document.querySelector('#samplesReadout'),
  showNormals: document.querySelector('#showNormals'),
  showHitDots: document.querySelector('#showHitDots'),
  showLabels: document.querySelector('#showLabels'),
  reset: document.querySelector('#reset'),
  segmentCount: document.querySelector('#segmentCount'),
  interactionCount: document.querySelector('#interactionCount'),
  spectralCount: document.querySelector('#spectralCount'),
  frameCost: document.querySelector('#frameCost'),
  boundaryMode: document.querySelector('#boundaryMode'),
  incidenceValue: document.querySelector('#incidenceValue'),
  refractionValue: document.querySelector('#refractionValue'),
  indexValue: document.querySelector('#indexValue')
};

const bounds = { minX: 24, minY: 24, maxX: 1176, maxY: 696 };

const presets = {
  prism: {
    emitter: { x: 110, y: 360, angle: 0, wavelength: null, lockToPiece: false },
    piece: {
      x: 600,
      y: 360,
      rotation: 0,
      vertices: [{ x: -110, y: -165 }, { x: -110, y: 165 }, { x: 155, y: 0 }],
      refractiveIndexBase: 1.52,
      dispersionCoefficient: 4200
    },
    samples: 31
  },
  slab: {
    emitter: { x: 300, y: 360, angle: 0, wavelength: 550, lockToPiece: false },
    piece: {
      x: 620,
      y: 360,
      rotation: 0,
      vertices: [{ x: -90, y: -270 }, { x: 90, y: -270 }, { x: 90, y: 270 }, { x: -90, y: 270 }],
      refractiveIndexBase: 1.5,
      dispersionCoefficient: 0
    },
    samples: 31
  },
  tir: {
    emitter: { x: 620, y: 360, angle: 50, wavelength: 550, lockToPiece: true },
    piece: {
      x: 620,
      y: 360,
      rotation: 0,
      vertices: [{ x: -120, y: -280 }, { x: 120, y: -280 }, { x: 120, y: 280 }, { x: -120, y: 280 }],
      refractiveIndexBase: 1.5,
      dispersionCoefficient: 0
    },
    samples: 31
  }
};

let state;
let dragging = null;

function clonePreset(name) {
  const preset = presets[name];
  return {
    preset: name,
    emitter: { ...preset.emitter },
    piece: { ...preset.piece, vertices: preset.piece.vertices.map((v) => ({ ...v })) },
    samples: preset.samples
  };
}

function loadPreset(name) {
  state = clonePreset(name);
  ui.preset.value = name;
  syncControls();
}

function syncControls() {
  ui.angle.value = String(state.emitter.angle);
  ui.angleReadout.textContent = `${state.emitter.angle.toFixed(1)}°`;
  ui.rotation.value = String(state.piece.rotation);
  ui.rotationReadout.textContent = `${state.piece.rotation.toFixed(1)}°`;
  ui.wavelength.value = state.emitter.wavelength == null ? 'white' : String(state.emitter.wavelength);
  ui.nBase.value = String(state.piece.refractiveIndexBase);
  ui.nBaseReadout.textContent = state.piece.refractiveIndexBase.toFixed(3);
  ui.dispersion.value = String(state.piece.dispersionCoefficient);
  ui.dispersionReadout.textContent = `${Math.round(state.piece.dispersionCoefficient)} nm²`;
  ui.samples.value = String(state.samples);
  ui.samplesReadout.textContent = String(state.samples);
}

function currentEmitter() {
  if (!state.emitter.lockToPiece) return state.emitter;
  return { ...state.emitter, x: state.piece.x, y: state.piece.y };
}

function currentRefractor() {
  return refractorFromCenter({
    id: 'R1',
    x: state.piece.x,
    y: state.piece.y,
    rotation: state.piece.rotation * Math.PI / 180,
    vertices: state.piece.vertices,
    refractiveIndexBase: state.piece.refractiveIndexBase,
    dispersionCoefficient: state.piece.dispersionCoefficient
  });
}

function drawGrid() {
  ctx.fillStyle = '#06101c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(93, 151, 200, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 25; x < canvas.width; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 25; y < canvas.height; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(93, 151, 200, 0.2)';
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function drawRefractor(refractor) {
  const gradient = ctx.createLinearGradient(state.piece.x - 140, state.piece.y - 180, state.piece.x + 150, state.piece.y + 180);
  gradient.addColorStop(0, 'rgba(111, 218, 255, .10)');
  gradient.addColorStop(.45, 'rgba(181, 244, 255, .18)');
  gradient.addColorStop(1, 'rgba(96, 137, 255, .09)');

  ctx.save();
  ctx.beginPath();
  refractor.vertices.forEach((vertex, index) => {
    if (index === 0) ctx.moveTo(vertex.x, vertex.y);
    else ctx.lineTo(vertex.x, vertex.y);
  });
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowBlur = dragging ? 28 : 16;
  ctx.shadowColor = '#66dcff';
  ctx.strokeStyle = dragging ? '#8cecff' : '#6ccde9';
  ctx.lineWidth = dragging ? 4 : 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(213, 250, 255, .20)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(4, 13, 24, .72)';
  ctx.fillRect(state.piece.x - 72, state.piece.y - 16, 144, 32);
  ctx.fillStyle = '#c9f7ff';
  ctx.textAlign = 'center';
  ctx.font = '700 13px system-ui';
  ctx.fillText(`glass n₅₈₉=${state.piece.refractiveIndexBase.toFixed(3)}`, state.piece.x, state.piece.y + 5);
  ctx.restore();
}

function drawEmitter(emitter, direction) {
  ctx.save();
  ctx.translate(emitter.x, emitter.y);
  ctx.rotate(Math.atan2(direction.y, direction.x));
  ctx.shadowBlur = 28;
  ctx.shadowColor = '#fff5ad';
  ctx.fillStyle = '#fff5ad';
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,245,173,.18)';
  ctx.beginPath(); ctx.moveTo(10, -18); ctx.lineTo(68, 0); ctx.lineTo(10, 18); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawRays(trace) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const segment of trace.segments) {
    const spectral = segment.wavelength != null;
    ctx.shadowBlur = spectral ? 9 : 18;
    ctx.shadowColor = segment.color;
    ctx.strokeStyle = segment.color;
    ctx.lineWidth = spectral ? 2.2 : 4.2;
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
    if (!spectral) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.90)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function representativeHits(hits) {
  const groups = new Map();
  for (const hit of hits) {
    if (hit.type !== 'refraction' && hit.type !== 'tir') continue;
    const key = `${hit.refractorId}:${hit.edgeIndex}:${Math.round(hit.point.x)}:${Math.round(hit.point.y)}:${hit.type}`;
    const current = groups.get(key);
    const score = Math.abs((hit.wavelength ?? 589) - 550);
    if (!current || score < current.score) groups.set(key, { hit, score });
  }
  return [...groups.values()].map((entry) => entry.hit);
}

function drawDiagnostics(trace) {
  const reps = representativeHits(trace.hits);
  for (const hit of reps) {
    if (ui.showNormals.checked) {
      ctx.save();
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = hit.type === 'tir' ? 'rgba(255,126,186,.82)' : 'rgba(97,230,255,.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hit.point.x - hit.normal.x * 54, hit.point.y - hit.normal.y * 54);
      ctx.lineTo(hit.point.x + hit.normal.x * 54, hit.point.y + hit.normal.y * 54);
      ctx.stroke();
      ctx.restore();
    }

    if (ui.showHitDots.checked) {
      ctx.save();
      ctx.fillStyle = hit.type === 'tir' ? '#ff7eba' : '#5ce7ff';
      ctx.shadowBlur = 15;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath(); ctx.arc(hit.point.x, hit.point.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (ui.showLabels.checked) {
      const incidence = hit.incidenceRadians * 180 / Math.PI;
      const refraction = hit.refractionRadians == null ? null : hit.refractionRadians * 180 / Math.PI;
      const critical = hit.criticalAngleRadians == null ? null : hit.criticalAngleRadians * 180 / Math.PI;
      const label = hit.type === 'tir'
        ? `TIR  θᵢ ${incidence.toFixed(1)}° > θc ${critical?.toFixed(1)}°`
        : `θᵢ ${incidence.toFixed(1)}° → θt ${refraction.toFixed(1)}°`;
      ctx.save();
      ctx.font = '700 12px system-ui';
      const width = ctx.measureText(label).width + 16;
      const x = Math.max(8, Math.min(canvas.width - width - 8, hit.point.x + 12));
      const y = Math.max(26, Math.min(canvas.height - 8, hit.point.y - 16));
      ctx.fillStyle = 'rgba(5,14,24,.84)';
      ctx.fillRect(x, y - 18, width, 25);
      ctx.fillStyle = hit.type === 'tir' ? '#ffb5d4' : '#bbf6ff';
      ctx.fillText(label, x + 8, y);
      ctx.restore();
    }
  }
}

function updateBoundaryReadout(trace) {
  const opticalHits = trace.hits.filter((hit) => hit.type === 'refraction' || hit.type === 'tir');
  if (!opticalHits.length) {
    ui.boundaryMode.textContent = 'No boundary hit';
    ui.incidenceValue.textContent = '—';
    ui.refractionValue.textContent = '—';
    ui.indexValue.textContent = '—';
    return;
  }
  const tir = opticalHits.find((hit) => hit.type === 'tir');
  const chosen = tir ?? opticalHits.reduce((best, hit) => {
    const score = Math.abs((hit.wavelength ?? 589) - 550);
    return !best || score < best.score ? { hit, score } : best;
  }, null).hit;
  ui.boundaryMode.textContent = chosen.type === 'tir' ? 'Total internal reflection' : (chosen.entering ? 'Air → glass' : 'Glass → air');
  ui.incidenceValue.textContent = `${(chosen.incidenceRadians * 180 / Math.PI).toFixed(2)}°`;
  ui.refractionValue.textContent = chosen.refractionRadians == null
    ? `TIR (θc ${(chosen.criticalAngleRadians * 180 / Math.PI).toFixed(2)}°)`
    : `${(chosen.refractionRadians * 180 / Math.PI).toFixed(2)}°`;
  ui.indexValue.textContent = `${chosen.n1.toFixed(4)} → ${chosen.n2.toFixed(4)}`;
}

function render() {
  const started = performance.now();
  const emitter = currentEmitter();
  const refractor = currentRefractor();
  const direction = directionFromAngle(state.emitter.angle * Math.PI / 180);
  const trace = traceOpticalRays({
    origin: { x: emitter.x, y: emitter.y },
    direction,
    refractors: [refractor],
    mirrors: [],
    bounds,
    maxBounces: 20,
    wavelength: state.emitter.wavelength,
    spectralSampleCount: state.samples
  });

  drawGrid();
  drawRefractor(refractor);
  drawRays(trace);
  drawEmitter(emitter, direction);
  drawDiagnostics(trace);

  ui.segmentCount.textContent = String(trace.segments.length);
  ui.interactionCount.textContent = String(trace.hits.length);
  ui.spectralCount.textContent = String(new Set(trace.segments.filter((s) => s.wavelength != null).map((s) => Math.round(s.wavelength))).size);
  ui.frameCost.textContent = `${(performance.now() - started).toFixed(2)} ms`;
  updateBoundaryReadout(trace);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

canvas.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  const refractor = currentRefractor();
  if (!isInsideMedium(point, refractor)) return;
  dragging = {
    pointerId: event.pointerId,
    dx: point.x - state.piece.x,
    dy: point.y - state.piece.y
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const point = canvasPoint(event);
  state.piece.x = Math.max(170, Math.min(1030, point.x - dragging.dx));
  state.piece.y = Math.max(120, Math.min(600, point.y - dragging.dy));
});

function endDrag(event) {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  dragging = null;
  try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

ui.preset.addEventListener('change', () => loadPreset(ui.preset.value));
ui.angle.addEventListener('input', () => {
  state.emitter.angle = Number(ui.angle.value);
  ui.angleReadout.textContent = `${state.emitter.angle.toFixed(1)}°`;
});
ui.rotation.addEventListener('input', () => {
  state.piece.rotation = Number(ui.rotation.value);
  ui.rotationReadout.textContent = `${state.piece.rotation.toFixed(1)}°`;
});
ui.wavelength.addEventListener('change', () => {
  state.emitter.wavelength = ui.wavelength.value === 'white' ? null : Number(ui.wavelength.value);
});
ui.nBase.addEventListener('input', () => {
  state.piece.refractiveIndexBase = Number(ui.nBase.value);
  ui.nBaseReadout.textContent = state.piece.refractiveIndexBase.toFixed(3);
});
ui.dispersion.addEventListener('input', () => {
  state.piece.dispersionCoefficient = Number(ui.dispersion.value);
  ui.dispersionReadout.textContent = `${Math.round(state.piece.dispersionCoefficient)} nm²`;
});
ui.samples.addEventListener('input', () => {
  state.samples = Number(ui.samples.value);
  ui.samplesReadout.textContent = String(state.samples);
});
ui.reset.addEventListener('click', () => loadPreset(state.preset));

loadPreset('prism');

function loop() {
  render();
  requestAnimationFrame(loop);
}
loop();
