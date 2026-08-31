import { getC16Color, rgbToCss } from '../../constellation/src/c16.js';
import { c32RgbToCss, getC32Color, relativeLuminance } from '../../constellation/src/c32.js';
import { getV1FiducialCenters, V1_FIDUCIAL } from './fiducials.js';
import { getS8Shape } from './shapes.js';

function fillForCell(cell) {
  if (cell.kind === 'finder' || cell.kind === 'profile-signature') {
    return cell.dark ? '#000000' : '#FFFFFF';
  }
  if (cell.kind === 'calibration' || cell.kind === 'data') {
    return rgbToCss(getC16Color(cell.symbol).rgb);
  }
  if (cell.kind === 'color-calibration' || cell.kind === 's8c32-data') {
    return c32RgbToCss(getC32Color(cell.colorIndex).rgb);
  }
  if (cell.kind === 'shape-calibration') return '#A8A8A8';
  return '#E8E8E8';
}

function renderFiducial(center) {
  const outer = V1_FIDUCIAL.outerSize;
  const middle = V1_FIDUCIAL.middleSize;
  const core = V1_FIDUCIAL.coreSize;
  return [
    `<rect x="${center.x - (outer / 2)}" y="${center.y - (outer / 2)}" width="${outer}" height="${outer}" fill="#000000"/>`,
    `<rect x="${center.x - (middle / 2)}" y="${center.y - (middle / 2)}" width="${middle}" height="${middle}" fill="#FFFFFF"/>`,
    `<rect x="${center.x - (core / 2)}" y="${center.y - (core / 2)}" width="${core}" height="${core}" fill="#000000"/>`,
  ].join('');
}

function glyphFill(cell) {
  if (cell.kind === 'shape-calibration') return '#000000';
  const rgb = getC32Color(cell.colorIndex).rgb;
  return relativeLuminance(rgb) >= 145 ? '#050505' : '#FFFFFF';
}

function renderGlyph(cell, x, y, cellSize) {
  if (cell.kind !== 'shape-calibration' && cell.kind !== 's8c32-data') return '';
  const shape = getS8Shape(cell.shapeId);
  const module = cellSize / 8; // 2px when the logical cell is 16px.
  const glyphSize = module * 5;
  const offset = (cellSize - glyphSize) / 2;
  const fill = glyphFill(cell);
  const parts = [];

  shape.mask.forEach((row, gy) => {
    [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      parts.push(
        `<rect x="${x + offset + (gx * module)}" y="${y + offset + (gy * module)}" width="${module}" height="${module}" fill="${fill}"/>`,
      );
    });
  });
  return parts.join('');
}

export function renderOpticalFrameSvg(frame, options = {}) {
  const scale = options.scale ?? 2;
  const quietZone = options.quietZone ?? 24;
  const showGrid = options.showGrid ?? false;
  const borderWidth = options.borderWidth ?? 4;
  const total = frame.logicalSize + (quietZone * 2);
  const displaySize = total * scale;
  const gridStroke = showGrid ? ' stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="0.5"' : '';

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="#FFFFFF"/>`,
    `<rect x="${quietZone}" y="${quietZone}" width="${frame.logicalSize}" height="${frame.logicalSize}" fill="#E8E8E8" stroke="#000000" stroke-width="${borderWidth}"/>`,
  ];

  for (const center of getV1FiducialCenters(total, quietZone)) {
    parts.push(renderFiducial(center));
  }

  for (const row of frame.cells) {
    for (const cell of row) {
      const x = quietZone + (cell.x * frame.cellSize);
      const y = quietZone + (cell.y * frame.cellSize);
      parts.push(
        `<rect x="${x}" y="${y}" width="${frame.cellSize}" height="${frame.cellSize}" fill="${fillForCell(cell)}"${gridStroke}/>`
      );
      parts.push(renderGlyph(cell, x, y, frame.cellSize));
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
