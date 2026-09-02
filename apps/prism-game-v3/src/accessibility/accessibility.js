const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function hexToRgb(hex) {
  const value = String(hex).replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid 6-digit hex color: ${hex}`);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function channel(value) {
  const normalized = clamp(value, 0, 255) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color) {
  const rgb = typeof color === 'string' ? hexToRgb(color) : color;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function keyboardIntent(eventLike) {
  const key = String(eventLike?.key ?? '');
  const fine = Boolean(eventLike?.shiftKey);
  const moveStep = fine ? 3 : 12;
  if (key === 'ArrowLeft') return { type: 'move', dx: -moveStep, dy: 0 };
  if (key === 'ArrowRight') return { type: 'move', dx: moveStep, dy: 0 };
  if (key === 'ArrowUp') return { type: 'move', dx: 0, dy: -moveStep };
  if (key === 'ArrowDown') return { type: 'move', dx: 0, dy: moveStep };
  if (key.toLowerCase() === 'q') return { type: 'rotate', degrees: -15 };
  if (key.toLowerCase() === 'e') return { type: 'rotate', degrees: 15 };
  if (key === '[') return { type: 'cycle', delta: -1 };
  if (key === ']') return { type: 'cycle', delta: 1 };
  if (key.toLowerCase() === 'r') return { type: 'reset' };
  if (key === 'Escape') return { type: 'levels' };
  return null;
}
