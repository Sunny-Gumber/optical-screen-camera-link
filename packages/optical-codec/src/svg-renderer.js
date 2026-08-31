import { getC16Color, rgbToCss } from '../../constellation/src/c16.js';

function fillForCell(cell) {
  if (cell.kind === 'finder') return cell.dark ? '#000000' : '#FFFFFF';
  if (cell.kind === 'calibration' || cell.kind === 'data') {
    return rgbToCss(getC16Color(cell.symbol).rgb);
  }
  return '#E8E8E8';
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

  for (const row of frame.cells) {
    for (const cell of row) {
      const x = quietZone + (cell.x * frame.cellSize);
      const y = quietZone + (cell.y * frame.cellSize);
      parts.push(
        `<rect x="${x}" y="${y}" width="${frame.cellSize}" height="${frame.cellSize}" fill="${fillForCell(cell)}"${gridStroke}/>`
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
