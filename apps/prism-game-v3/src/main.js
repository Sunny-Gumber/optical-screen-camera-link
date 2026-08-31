import './styles.css';
import {
  directionFromAngle,
  mirrorFromCenter,
  traceReflectionRay
} from './physics/rayEngine.js';

const canvas = document.querySelector('#stage');
const ctx = canvas.getContext('2d');
const angleInput = document.querySelector('#angle');
const angleReadout = document.querySelector('#angleReadout');
const showNormals = document.querySelector('#showNormals');
const showHitDots = document.querySelector('#showHitDots');
const resetButton = document.querySelector('#reset');
const segmentCount = document.querySelector('#segmentCount');
const bounceCount = document.querySelector('#bounceCount');
const frameCost = document.querySelector('#frameCost');

const bounds = { minX: 24, minY: 24, maxX: 1176, maxY: 696 };
const emitter = { x: 100, y: 380, angle: -8 };

const mirrorDefinitions = [
  { id: 'M1', x: 410, y: 330, length: 220, rotation: 59 },
  { id: 'M2', x: 690, y: 165, length: 210, rotation: 129 },
  { id: 'M3', x: 900, y: 430, length: 230, rotation: 52 },
  { id: 'M4', x: 570, y: 590, length: 180, rotation: 8 }
];

const mirrors = mirrorDefinitions.map((m) => mirrorFromCenter({
  ...m,
  rotation: m.rotation * Math.PI / 180
}));

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

function drawEmitter(direction) {
  ctx.save();
  ctx.translate(emitter.x, emitter.y);
  ctx.rotate(Math.atan2(direction.y, direction.x));
  ctx.shadowBlur = 28;
  ctx.shadowColor = '#fff29a';
  ctx.fillStyle = '#fff29a';
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,242,154,.18)';
  ctx.beginPath();
  ctx.moveTo(10, -18); ctx.lineTo(70, 0); ctx.lineTo(10, 18); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMirrors() {
  for (const mirror of mirrors) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#64dcff';
    ctx.strokeStyle = '#b8eafa';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(mirror.a.x, mirror.a.y);
    ctx.lineTo(mirror.b.x, mirror.b.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#163d51';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#7ddfff';
    ctx.font = '700 14px system-ui';
    ctx.fillText(mirror.id, (mirror.a.x + mirror.b.x) / 2 + 10, (mirror.a.y + mirror.b.y) / 2 - 10);
    ctx.restore();
  }
}

function drawRay(trace) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const segment of trace.segments) {
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#fff4a8';
    ctx.strokeStyle = '#ffe783';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fffdf0';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawDiagnostics(trace) {
  for (const hit of trace.hits) {
    if (showNormals.checked) {
      ctx.save();
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(97,230,255,.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hit.point.x - hit.normal.x * 55, hit.point.y - hit.normal.y * 55);
      ctx.lineTo(hit.point.x + hit.normal.x * 55, hit.point.y + hit.normal.y * 55);
      ctx.stroke();
      ctx.restore();
    }

    if (showHitDots.checked) {
      ctx.save();
      ctx.fillStyle = '#5ce7ff';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#5ce7ff';
      ctx.beginPath(); ctx.arc(hit.point.x, hit.point.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    const degrees = hit.incidenceRadians * 180 / Math.PI;
    ctx.fillStyle = 'rgba(5,14,24,.82)';
    ctx.fillRect(hit.point.x + 12, hit.point.y - 37, 116, 26);
    ctx.fillStyle = '#bbf6ff';
    ctx.font = '700 13px system-ui';
    ctx.fillText(`θᵢ = θᵣ = ${degrees.toFixed(1)}°`, hit.point.x + 18, hit.point.y - 19);
  }
}

function render() {
  const start = performance.now();
  const angleRadians = emitter.angle * Math.PI / 180;
  const direction = directionFromAngle(angleRadians);
  const trace = traceReflectionRay({
    origin: { x: emitter.x, y: emitter.y },
    direction,
    mirrors,
    bounds,
    maxBounces: 20
  });

  drawGrid();
  drawMirrors();
  drawRay(trace);
  drawEmitter(direction);
  drawDiagnostics(trace);

  segmentCount.textContent = trace.segments.length;
  bounceCount.textContent = trace.hits.length;
  frameCost.textContent = `${(performance.now() - start).toFixed(2)} ms`;
}

angleInput.addEventListener('input', () => {
  emitter.angle = Number(angleInput.value);
  angleReadout.textContent = `${emitter.angle}°`;
});
showNormals.addEventListener('change', render);
showHitDots.addEventListener('change', render);
resetButton.addEventListener('click', () => {
  emitter.angle = -8;
  angleInput.value = '-8';
  angleReadout.textContent = '-8°';
});

function loop() {
  render();
  requestAnimationFrame(loop);
}

loop();
