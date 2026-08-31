export const CAPTURE_MAX_WIDTH = 640;
export const RECTIFIED_SIZE = 304;
export const QUIET_ZONE = 24;
export const LOGICAL_SIZE = 256;
export const DEFAULT_GUIDE_COVERAGE = 0.82;

/**
 * Draw the current camera frame into a modest-size processing canvas.
 * Keeping this small is intentional: V1 prioritizes a responsive phone UI.
 */
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

/**
 * V1.1 uses a centered square alignment guide instead of OpenCV.js.
 * This avoids the large WASM startup cost and lets us validate the optical
 * colour/data channel independently of automatic geometry detection.
 */
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

/**
 * Crop the manual alignment guide and normalize it to the expected 304x304
 * optical frame (24px quiet zone + 256px logical ROI + 24px quiet zone).
 */
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

/**
 * Draw the alignment guide after the processing crop has already been copied.
 * The small corner ticks make it easier to match the sender's outer white square.
 */
export function drawGuideOverlay(canvas, guide, state = 'align') {
  const ctx = canvas.getContext('2d');
  const good = state === 'locked';
  const stroke = good ? '#00ff88' : '#ffd84a';
  const tick = Math.max(14, Math.round(guide.width * 0.07));

  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
  ctx.strokeStyle = stroke;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';

  // Dim only the area outside the guide so the target remains easy to see.
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(guide.x, guide.y, guide.width, guide.height);
  ctx.fill('evenodd');

  ctx.setLineDash([10, 7]);
  ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
  ctx.setLineDash([]);

  const corners = [
    [guide.x, guide.y, 1, 1],
    [guide.x + guide.width, guide.y, -1, 1],
    [guide.x, guide.y + guide.height, 1, -1],
    [guide.x + guide.width, guide.y + guide.height, -1, -1],
  ];

  ctx.lineWidth += 1;
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + (sy * tick));
    ctx.lineTo(x, y);
    ctx.lineTo(x + (sx * tick), y);
    ctx.stroke();
  }

  const label = good ? 'FRAME LOCKED' : 'ALIGN OUTER WHITE SQUARE HERE';
  ctx.font = `600 ${Math.max(12, Math.round(canvas.width / 42))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const labelX = guide.x + (guide.width / 2);
  const labelY = Math.max(18, guide.y - 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 4;
  ctx.strokeText(label, labelX, labelY);
  ctx.fillStyle = stroke;
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}
