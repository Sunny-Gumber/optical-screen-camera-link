export const CAPTURE_MAX_WIDTH = 960;
export const RECTIFIED_SIZE = 304;
export const QUIET_ZONE = 24;
export const LOGICAL_SIZE = 256;

export async function waitForOpenCv(timeoutMs = 20000) {
  const started = performance.now();

  while (performance.now() - started < timeoutMs) {
    if (globalThis.cv instanceof Promise) {
      globalThis.cv = await globalThis.cv;
    }
    if (globalThis.cv?.Mat && globalThis.cv?.findContours) return globalThis.cv;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('OpenCV.js did not become ready');
}

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

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderQuad(points) {
  const sums = points.map((point) => point.x + point.y);
  const diffs = points.map((point) => point.x - point.y);

  const minIndex = (values) => values.indexOf(Math.min(...values));
  const maxIndex = (values) => values.indexOf(Math.max(...values));

  return {
    tl: points[minIndex(sums)],
    br: points[maxIndex(sums)],
    tr: points[maxIndex(diffs)],
    bl: points[minIndex(diffs)],
  };
}

function quadQuality(quad) {
  const sides = [
    pointDistance(quad.tl, quad.tr),
    pointDistance(quad.tr, quad.br),
    pointDistance(quad.br, quad.bl),
    pointDistance(quad.bl, quad.tl),
  ];
  const minimum = Math.max(1, Math.min(...sides));
  const maximum = Math.max(...sides);
  const sideRatio = maximum / minimum;
  const diagonalA = pointDistance(quad.tl, quad.br);
  const diagonalB = pointDistance(quad.tr, quad.bl);
  const diagonalRatio = Math.max(diagonalA, diagonalB) / Math.max(1, Math.min(diagonalA, diagonalB));
  return { sideRatio, diagonalRatio };
}

function contourToPoints(approx) {
  const values = approx.data32S;
  const points = [];
  for (let i = 0; i < values.length; i += 2) {
    points.push({ x: values[i], y: values[i + 1] });
  }
  return points;
}

export function detectAndRectify(cv, sourceCanvas, rectifiedCanvas) {
  const src = cv.imread(sourceCanvas);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best = null;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blur, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = src.cols * src.rows;

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour, false);
      if (area < frameArea * 0.035 || area > frameArea * 0.95) {
        contour.delete();
        continue;
      }

      const perimeter = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, perimeter * 0.025, true);

      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const points = contourToPoints(approx);
        const quad = orderQuad(points);
        const quality = quadQuality(quad);
        const score = area / (quality.sideRatio * quality.diagonalRatio);

        if (quality.sideRatio < 3.8 && quality.diagonalRatio < 2.4 && (!best || score > best.score)) {
          best = { area, score, quad, quality };
        }
      }

      approx.delete();
      contour.delete();
    }

    if (!best) return null;

    const { tl, tr, br, bl } = best.quad;
    const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y,
    ]);
    const targetPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      RECTIFIED_SIZE - 1, 0,
      RECTIFIED_SIZE - 1, RECTIFIED_SIZE - 1,
      0, RECTIFIED_SIZE - 1,
    ]);
    const matrix = cv.getPerspectiveTransform(sourcePoints, targetPoints);
    const warped = new cv.Mat();

    try {
      cv.warpPerspective(
        src,
        warped,
        matrix,
        new cv.Size(RECTIFIED_SIZE, RECTIFIED_SIZE),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(0, 0, 0, 255),
      );
      rectifiedCanvas.width = RECTIFIED_SIZE;
      rectifiedCanvas.height = RECTIFIED_SIZE;
      cv.imshow(rectifiedCanvas, warped);
    } finally {
      sourcePoints.delete();
      targetPoints.delete();
      matrix.delete();
      warped.delete();
    }

    return best;
  } finally {
    src.delete();
    gray.delete();
    blur.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
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

export function drawQuadOverlay(canvas, quad) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#00ff88';
  ctx.fillStyle = '#00ff88';
  ctx.beginPath();
  ctx.moveTo(quad.tl.x, quad.tl.y);
  ctx.lineTo(quad.tr.x, quad.tr.y);
  ctx.lineTo(quad.br.x, quad.br.y);
  ctx.lineTo(quad.bl.x, quad.bl.y);
  ctx.closePath();
  ctx.stroke();
  for (const point of [quad.tl, quad.tr, quad.br, quad.bl]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
