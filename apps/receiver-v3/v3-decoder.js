import { getV3Color, joinV3Nibble } from '../../packages/constellation/src/v3.js';
import { V3_G64_S4_C4_RS, getV3DataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { recoverV3PacketFromSymbols } from '../../packages/optical-codec/src/v3-frame.js';

function mapPixel(x, y, rotation, size) {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: size - 1 - y, y: x };
    case 180: return { x: size - 1 - x, y: size - 1 - y };
    case 270: return { x: y, y: size - 1 - x };
    default: throw new RangeError(`Unsupported rotation ${rotation}`);
  }
}

function sampleRegion(imageData, x0, y0, x1, y1, rotation = 0) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  const size = imageData.width;
  const sx0 = Math.max(0, Math.floor(x0));
  const sy0 = Math.max(0, Math.floor(y0));
  const sx1 = Math.min(size, Math.ceil(x1));
  const sy1 = Math.min(size, Math.ceil(y1));
  for (let y = sy0; y < sy1; y += 1) {
    for (let x = sx0; x < sx1; x += 1) {
      const mapped = mapPixel(x, y, rotation, size);
      const offset = ((mapped.y * imageData.width) + mapped.x) * 4;
      r += imageData.data[offset];
      g += imageData.data[offset + 1];
      b += imageData.data[offset + 2];
      count += 1;
    }
  }
  if (!count) return [0, 0, 0];
  return [r / count, g / count, b / count];
}

function luma(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function coarseCellLuma(imageData, cellX, cellY, rotation, cellSize = 4, dx = 0, dy = 0) {
  const x = (cellX * cellSize) + dx;
  const y = (cellY * cellSize) + dy;
  const pad = Math.max(0.6, cellSize * 0.24);
  return luma(sampleRegion(imageData, x + pad, y + pad, x + cellSize - pad, y + cellSize - pad, rotation));
}

function scoreCoarseRotation(imageData, rotation, dx, dy, profile = V3_G64_S4_C4_RS) {
  const dark = [];
  const light = [];
  const cellSize = imageData.width / profile.gridSize;
  const last = profile.gridSize - 1;

  for (let x = 0; x < profile.gridSize; x += 2) {
    dark.push(coarseCellLuma(imageData, x, 0, rotation, cellSize, dx, dy));
    dark.push(coarseCellLuma(imageData, x, last, rotation, cellSize, dx, dy));
    if (x + 1 < profile.gridSize) {
      light.push(coarseCellLuma(imageData, x + 1, 0, rotation, cellSize, dx, dy));
      light.push(coarseCellLuma(imageData, x + 1, last, rotation, cellSize, dx, dy));
    }
  }
  for (let y = 2; y < last; y += 2) {
    dark.push(coarseCellLuma(imageData, 0, y, rotation, cellSize, dx, dy));
    dark.push(coarseCellLuma(imageData, last, y, rotation, cellSize, dx, dy));
    if (y + 1 < last) {
      light.push(coarseCellLuma(imageData, 0, y + 1, rotation, cellSize, dx, dy));
      light.push(coarseCellLuma(imageData, last, y + 1, rotation, cellSize, dx, dy));
    }
  }
  const timingSeparation = mean(light) - mean(dark);

  const sigDark = [];
  const sigLight = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const value = coarseCellLuma(
      imageData,
      profile.profileSignatureStartX + index,
      profile.calibrationRow,
      rotation,
      cellSize,
      dx,
      dy,
    );
    (bit ? sigDark : sigLight).push(value);
  });
  const signatureSeparation = mean(sigLight) - mean(sigDark);
  return {
    rotation,
    dx,
    dy,
    timingSeparation,
    signatureSeparation,
    score: timingSeparation + signatureSeparation * 1.5,
  };
}

export function detectV3Coarse(roiCanvas, profile = V3_G64_S4_C4_RS) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('detectV3Coarse expects a canvas');
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const results = [];
  for (const rotation of [0, 90, 180, 270]) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) results.push(scoreCoarseRotation(imageData, rotation, dx, dy, profile));
    }
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  return {
    ...best,
    // Dedicated V3 receiver: the four external locators already identify an
    // optical frame, so the coarse gate should reject obvious bad geometry but
    // should not block the native-resolution decoder merely because a 4px/cell
    // preview has modest contrast.
    isV3: best.timingSeparation > 24 && best.signatureSeparation > 8,
  };
}

function sampleTimingCell(imageData, cellX, cellY, rotation, dx, dy, profile) {
  const baseX = cellX * profile.cellSize + dx;
  const baseY = cellY * profile.cellSize + dy;
  const pad = profile.cellSize * 0.24;
  return luma(sampleRegion(
    imageData,
    baseX + pad,
    baseY + pad,
    baseX + profile.cellSize - pad,
    baseY + profile.cellSize - pad,
    rotation,
  ));
}

function scoreTimingPhase(imageData, rotation, dx, dy, profile) {
  const dark = [];
  const light = [];
  const last = profile.gridSize - 1;
  for (let x = 0; x < profile.gridSize; x += 1) {
    const top = sampleTimingCell(imageData, x, 0, rotation, dx, dy, profile);
    const bottom = sampleTimingCell(imageData, x, last, rotation, dx, dy, profile);
    ((x & 1) === 0 ? dark : light).push(top, bottom);
  }
  for (let y = 1; y < last; y += 1) {
    const left = sampleTimingCell(imageData, 0, y, rotation, dx, dy, profile);
    const right = sampleTimingCell(imageData, last, y, rotation, dx, dy, profile);
    ((y & 1) === 0 ? dark : light).push(left, right);
  }
  return mean(light) - mean(dark);
}

function findBestPhase(imageData, rotation, profile) {
  let best = { dx: 0, dy: 0, separation: -Infinity };
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const separation = scoreTimingPhase(imageData, rotation, dx, dy, profile);
      if (separation > best.separation) best = { dx, dy, separation };
    }
  }
  return best;
}

function colorVector(rgb) {
  const total = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  return [rgb[0] / total, rgb[1] / total, rgb[2] / total];
}

function squaredDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] - b[i]) ** 2;
  return total;
}

function normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm < 1e-8) return values.map(() => 0);
  return values.map((value) => value / norm);
}

function rgbDistance(a, b) {
  return Math.sqrt(((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2));
}

function sampleSolidCell(imageData, cellX, cellY, rotation, phase, profile) {
  const x = cellX * profile.cellSize + phase.dx;
  const y = cellY * profile.cellSize + phase.dy;
  return sampleRegion(imageData, x + 2, y + 2, x + profile.cellSize - 2, y + profile.cellSize - 2, rotation);
}

function sampleChromaticBackground(imageData, cellX, cellY, rotation, phase, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const candidates = [];
  for (let y = 1; y < profile.cellSize - 1; y += 1) {
    for (let x = 1; x < profile.cellSize - 1; x += 1) {
      const rgb = sampleRegion(imageData, baseX + x, baseY + y, baseX + x + 1, baseY + y + 1, rotation);
      const chroma = Math.max(...rgb) - Math.min(...rgb);
      if (chroma > 28) candidates.push({ rgb, chroma });
    }
  }
  candidates.sort((a, b) => b.chroma - a.chroma);
  const selected = candidates.slice(0, 64);
  if (!selected.length) return sampleSolidCell(imageData, cellX, cellY, rotation, phase, profile);
  return [0, 1, 2].map((channel) => mean(selected.map((item) => item.rgb[channel])));
}

function buildColorCalibration(imageData, rotation, phase, profile) {
  return Array.from({ length: profile.colorCount }, (_, colorIndex) => {
    const rgb = sampleSolidCell(
      imageData,
      profile.colorCalibrationStartX + colorIndex,
      profile.calibrationRow,
      rotation,
      phase,
      profile,
    );
    return { colorIndex, rgb, vector: colorVector(rgb) };
  });
}

function classifyColor(rgb, calibration) {
  const vector = colorVector(rgb);
  const ranked = calibration.map((reference) => ({
    colorIndex: reference.colorIndex,
    distance: squaredDistance(vector, reference.vector),
    referenceRgb: reference.rgb,
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  return { ...best, confidence };
}

function sampleBrightBackground(imageData, cellX, cellY, rotation, phase, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const pixels = [];
  for (let y = 0; y < profile.cellSize; y += 1) {
    for (let x = 0; x < profile.cellSize; x += 1) {
      const rgb = sampleRegion(imageData, baseX + x, baseY + y, baseX + x + 1, baseY + y + 1, rotation);
      pixels.push({ rgb, luma: luma(rgb) });
    }
  }
  pixels.sort((a, b) => b.luma - a.luma);
  const selected = pixels.slice(0, Math.max(8, Math.floor(pixels.length * 0.35)));
  return [0, 1, 2].map((channel) => mean(selected.map((item) => item.rgb[channel])));
}

function extractShapeFeature(imageData, cellX, cellY, rotation, phase, backgroundRgb, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const grid = 3;
  const module = profile.cellSize / grid;
  const values = [];
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const rgb = sampleRegion(
        imageData,
        baseX + gx * module,
        baseY + gy * module,
        baseX + (gx + 1) * module,
        baseY + (gy + 1) * module,
        rotation,
      );
      values.push(rgbDistance(rgb, backgroundRgb) / 442);
    }
  }
  return normalize(values);
}

function buildShapeCalibration(imageData, rotation, phase, profile) {
  return Array.from({ length: profile.shapeCount }, (_, shapeId) => {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.calibrationRow;
    const background = sampleBrightBackground(imageData, x, y, rotation, phase, profile);
    return { shapeId, feature: extractShapeFeature(imageData, x, y, rotation, phase, background, profile) };
  });
}

function classifyShape(feature, calibration) {
  const ranked = calibration.map((reference) => ({
    shapeId: reference.shapeId,
    distance: squaredDistance(feature, reference.feature),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  return { ...best, confidence };
}

function scoreHighResSignature(imageData, rotation, phase, profile) {
  const dark = [];
  const light = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const rgb = sampleSolidCell(
      imageData,
      profile.profileSignatureStartX + index,
      profile.calibrationRow,
      rotation,
      phase,
      profile,
    );
    (bit ? dark : light).push(luma(rgb));
  });
  return mean(light) - mean(dark);
}

export function decodeV3Roi(roiCanvas, rotation = 0, profile = V3_G64_S4_C4_RS) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('decodeV3Roi expects a canvas');
  if (roiCanvas.width !== profile.logicalSize || roiCanvas.height !== profile.logicalSize) throw new Error(`V3 ROI must be ${profile.logicalSize}×${profile.logicalSize}`);

  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const phase = findBestPhase(imageData, rotation, profile);
  if (phase.separation < 30) throw new Error(`V3 timing contrast too low (${phase.separation.toFixed(1)})`);
  const signatureSeparation = scoreHighResSignature(imageData, rotation, phase, profile);
  if (signatureSeparation < 10) throw new Error(`V3 signature too weak (${signatureSeparation.toFixed(1)})`);

  const colorCalibration = buildColorCalibration(imageData, rotation, phase, profile);
  const shapeCalibration = buildShapeCalibration(imageData, rotation, phase, profile);
  const coordinates = getV3DataCellCoordinates(profile);
  const symbols = new Uint8Array(profile.encodedSymbolCapacity);
  const confidences = new Float32Array(profile.encodedSymbolCapacity);
  let colorConfidenceSum = 0;
  let shapeConfidenceSum = 0;

  coordinates.forEach(({ x, y }, index) => {
    const color = classifyColor(sampleChromaticBackground(imageData, x, y, rotation, phase, profile), colorCalibration);
    const shapeFeature = extractShapeFeature(imageData, x, y, rotation, phase, color.referenceRgb, profile);
    const shape = classifyShape(shapeFeature, shapeCalibration);
    symbols[index] = joinV3Nibble(shape.shapeId, color.colorIndex);
    confidences[index] = Math.min(shape.confidence, color.confidence);
    colorConfidenceSum += color.confidence;
    shapeConfidenceSum += shape.confidence;
  });

  const averageColorConfidence = colorConfidenceSum / coordinates.length;
  const averageShapeConfidence = shapeConfidenceSum / coordinates.length;
  const averageConfidence = (averageColorConfidence + averageShapeConfidence) / 2;

  let recovered;
  try {
    recovered = recoverV3PacketFromSymbols(symbols, profile, confidences);
  } catch (error) {
    error.v3Diagnostics = {
      timingSeparation: phase.separation,
      signatureSeparation,
      phaseX: phase.dx,
      phaseY: phase.dy,
      rotation,
      averageColorConfidence,
      averageShapeConfidence,
      averageConfidence,
    };
    throw error;
  }

  return {
    profileId: profile.id,
    packetBytes: recovered.packetBytes,
    correctedSymbols: recovered.correctedSymbols,
    erasuresUsed: recovered.erasuresUsed,
    rsBlocksDecoded: recovered.blocksDecoded,
    packetLength: recovered.packetLength,
    timingSeparation: phase.separation,
    signatureSeparation,
    phaseX: phase.dx,
    phaseY: phase.dy,
    rotation,
    averageColorConfidence,
    averageShapeConfidence,
    averageConfidence,
  };
}

export const V3_NOMINAL_COLORS = Object.freeze(Array.from({ length: 4 }, (_, index) => getV3Color(index)));
