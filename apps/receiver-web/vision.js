export const CAPTURE_MAX_WIDTH = 640;
export const RECTIFIED_SIZE = 304;
export const QUIET_ZONE = 24;
export const LOGICAL_SIZE = 256;
export const DEFAULT_GUIDE_COVERAGE = 0.82;

/** Draw the current camera frame into a modest-size processing canvas. */
export function drawVideoFrame(video, canvas, maxWidth = CAPTURE_MAX_WIDTH) {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  return { width, height, scale };
}

// Kept as a fallback/debug helper. V1.3 primarily uses four tapped corners.
export function getCenteredGuideRect(width, height, coverage = DEFAULT_GUIDE_COVERAGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Guide dimensions must be positive numbers');
  }
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) {
    throw new RangeError('Guide coverage must be > 0 and <= 1');
  }

  const side = Math.max(1, Math.floor(Math.min(width, height) * coverage));
  const x = Math.floor((width - side) / 2);
  const y = Math.floor((height - side) / 2);
  return { x, y, width: side, height: side };
}

export function rectifyGuide(sourceCanvas, rectifiedCanvas, guide = null) {
  const rect = guide ?? getCenteredGuideRect(sourceCanvas.width, sourceCanvas.height);
  rectifiedCanvas.width = RECTIFIED_SIZE;
  rectifiedCanvas.height = RECTIFIED_SIZE;
  const ctx = rectifiedCanvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
  ctx.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    RECTIFIED_SIZE,
    RECTIFIED_SIZE,
  );
  return rect;
}

function solveLinearSystem(rows) {
  const matrix = rows.map((row) => row.slice());
  const size = matrix.length;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-10) {
      throw new Error('Selected corners cannot form a stable perspective transform');
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

    const divisor = matrix[column][column];
    for (let c = column; c <= size; c += 1) matrix[column][c] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) < 1e-14) continue;
      for (let c = column; c <= size; c += 1) {
        matrix[row][c] -= factor * matrix[column][c];
      }
    }
  }

  return matrix.map((row, index) => row[size]);
}

/**
 * Compute a projective mapping from a normalized output square to a source quad.
 * Corners must be supplied in TL, TR, BR, BL order.
 */
export function computeSquareToQuadHomography(corners, size = RECTIFIED_SIZE) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    throw new RangeError('Exactly four corners are required');
  }
  const max = size - 1;
  const destination = [
    { u: 0, v: 0 },
    { u: max, v: 0 },
    { u: max, v: max },
    { u: 0, v: max },
  ];

  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    const { u, v } = destination[i];
    const { x, y } = corners[i];
    if (![x, y].every(Number.isFinite)) throw new TypeError('Corner coordinates must be finite');
    rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
    rows.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
  }

  return solveLinearSystem(rows);
}

export function mapPerspectivePoint(h, u, v) {
  const denominator = (h[6] * u) + (h[7] * v) + 1;
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: ((h[0] * u) + (h[1] * v) + h[2]) / denominator,
    y: ((h[3] * u) + (h[4] * v) + h[5]) / denominator,
  };
}

export function validateCornerQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  let twiceArea = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return false;
    twiceArea += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(twiceArea) > 1500;
}

/**
 * Pure Canvas/JS perspective warp. This avoids OpenCV/WASM completely.
 * Nearest-neighbour sampling is intentional for speed; each optical cell is
 * averaged later by the colour decoder.
 */
export function rectifyQuad(sourceCanvas, rectifiedCanvas, corners) {
  if (!validateCornerQuad(corners)) {
    throw new Error('The four selected corners are too small or invalid');
  }

  const h = computeSquareToQuadHomography(corners, RECTIFIED_SIZE);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const outputCtx = rectifiedCanvas.getContext('2d', { willReadFrequently: true });
  rectifiedCanvas.width = RECTIFIED_SIZE;
  rectifiedCanvas.height = RECTIFIED_SIZE;
  const output = outputCtx.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);

  for (let v = 0; v < RECTIFIED_SIZE; v += 1) {
    for (let u = 0; u < RECTIFIED_SIZE; u += 1) {
      const point = mapPerspectivePoint(h, u, v);
      if (!point) continue;
      const sx = Math.round(point.x);
      const sy = Math.round(point.y);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;

      const sourceOffset = ((sy * source.width) + sx) * 4;
      const targetOffset = ((v * RECTIFIED_SIZE) + u) * 4;
      output.data[targetOffset] = source.data[sourceOffset];
      output.data[targetOffset + 1] = source.data[sourceOffset + 1];
      output.data[targetOffset + 2] = source.data[sourceOffset + 2];
      output.data[targetOffset + 3] = 255;
    }
  }

  outputCtx.putImageData(output, 0, 0);
  return h;
}

export function eventToCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

export function extractLogicalRoi(rectifiedCanvas, roiCanvas) {
  roiCanvas.width = LOGICAL_SIZE;
  roiCanvas.height = LOGICAL_SIZE;
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
  ctx.drawImage(
    rectifiedCanvas,
    QUIET_ZONE,
    QUIET_ZONE,
    LOGICAL_SIZE,
    LOGICAL_SIZE,
    0,
    0,
    LOGICAL_SIZE,
    LOGICAL_SIZE,
  );
}

export function drawCornerOverlay(canvas, corners, state = 'selecting') {
  const ctx = canvas.getContext('2d');
  const labels = ['TL', 'TR', 'BR', 'BL'];
  const locked = corners.length === 4;
  const stroke = state === 'decoded' ? '#00ff88' : locked ? '#56b4ff' : '#ffd84a';

  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.font = `700 ${Math.max(13, Math.round(canvas.width / 40))}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  if (corners.length > 1) {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    if (locked) ctx.closePath();
    ctx.stroke();
  }

  corners.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(7, canvas.width / 90), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#05070a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = stroke;
    ctx.fillText(labels[index], point.x + 12, point.y - 12);
  });

  const nextLabel = corners.length < 4 ? labels[corners.length] : null;
  const text = nextLabel
    ? `TAP ${nextLabel} CORNER (${corners.length + 1}/4)`
    : state === 'decoded' ? 'PERSPECTIVE LOCKED · DATA OK' : '4 CORNERS SET · KEEP CAMERA STILL';
  ctx.font = `700 ${Math.max(13, Math.round(canvas.width / 43))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, canvas.width / 2, 10);
  ctx.fillStyle = stroke;
  ctx.fillText(text, canvas.width / 2, 10);
  ctx.restore();
}

// Legacy visual helper retained for regression/debug use.
export function drawGuideOverlay(canvas, guide, state = 'align') {
  const ctx = canvas.getContext('2d');
  const good = state === 'locked';
  const stroke = good ? '#00ff88' : '#ffd84a';
  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
  ctx.strokeStyle = stroke;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
  ctx.restore();
}
