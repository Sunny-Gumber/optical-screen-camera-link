import {
  isInsideMedium,
  mirrorFromCenter,
  refractorFromCenter,
  splitterFromCenter
} from '../physics/rayEngine.js';

const TAU = Math.PI * 2;
const DEFAULT_MOUSE_TOLERANCE = 8;
const DEFAULT_TOUCH_TOLERANCE = 20;
const DEFAULT_SNAP_INCREMENT_DEG = 15;
const DEFAULT_SNAP_THRESHOLD_DEG = 5;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const degToRad = (degrees) => degrees * Math.PI / 180;
const radToDeg = (radians) => radians * 180 / Math.PI;

export function normalizeAngle(angle) {
  let value = angle % TAU;
  if (value <= -Math.PI) value += TAU;
  if (value > Math.PI) value -= TAU;
  return value;
}

export function shortestAngleDelta(from, to) {
  return normalizeAngle(to - from);
}

export function distancePointToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

export function pointerTolerance(pointerType = 'mouse') {
  return pointerType === 'touch' || pointerType === 'pen'
    ? DEFAULT_TOUCH_TOLERANCE
    : DEFAULT_MOUSE_TOLERANCE;
}

function transformLocalPoint(piece, point, x = piece.x, y = piece.y, rotation = piece.rotation ?? 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: x + point.x * cos - point.y * sin,
    y: y + point.x * sin + point.y * cos
  };
}

function linePieceSegment(piece, x = piece.x, y = piece.y, rotation = piece.rotation ?? 0) {
  const params = { id: piece.id, x, y, length: piece.length, rotation };
  return piece.type === 'splitter'
    ? splitterFromCenter({ ...params, splitRatio: piece.splitRatio ?? 0.5 })
    : mirrorFromCenter(params);
}

export function piecePolygon(piece, override = {}) {
  const x = override.x ?? piece.x;
  const y = override.y ?? piece.y;
  const rotation = override.rotation ?? piece.rotation ?? 0;
  const padding = override.padding ?? 0;

  if (piece.type === 'refractor') {
    const refractor = refractorFromCenter({
      id: piece.id,
      x,
      y,
      rotation,
      vertices: piece.vertices,
      refractiveIndexBase: piece.refractiveIndexBase,
      dispersionCoefficient: piece.dispersionCoefficient
    });
    if (padding <= 0) return refractor.vertices;
    const center = { x, y };
    return refractor.vertices.map((vertex) => {
      const dx = vertex.x - center.x;
      const dy = vertex.y - center.y;
      const size = Math.hypot(dx, dy) || 1;
      return { x: vertex.x + dx / size * padding, y: vertex.y + dy / size * padding };
    });
  }

  if (piece.type === 'mirror' || piece.type === 'splitter') {
    const segment = linePieceSegment(piece, x, y, rotation);
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const size = Math.hypot(dx, dy) || 1;
    const nx = -dy / size;
    const ny = dx / size;
    const halfThickness = (piece.collisionThickness ?? 18) / 2 + padding;
    return [
      { x: segment.a.x + nx * halfThickness, y: segment.a.y + ny * halfThickness },
      { x: segment.b.x + nx * halfThickness, y: segment.b.y + ny * halfThickness },
      { x: segment.b.x - nx * halfThickness, y: segment.b.y - ny * halfThickness },
      { x: segment.a.x - nx * halfThickness, y: segment.a.y - ny * halfThickness }
    ];
  }

  if (piece.type === 'emitter') {
    const radius = (piece.radius ?? 22) + padding;
    return Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * TAU;
      return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    });
  }

  const width = (piece.width ?? 60) + padding * 2;
  const height = (piece.height ?? 60) + padding * 2;
  return [
    transformLocalPoint({ ...piece, x, y, rotation }, { x: -width / 2, y: -height / 2 }),
    transformLocalPoint({ ...piece, x, y, rotation }, { x: width / 2, y: -height / 2 }),
    transformLocalPoint({ ...piece, x, y, rotation }, { x: width / 2, y: height / 2 }),
    transformLocalPoint({ ...piece, x, y, rotation }, { x: -width / 2, y: height / 2 })
  ];
}

function polygonAxes(polygon) {
  const axes = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const size = Math.hypot(dx, dy);
    if (size > 1e-8) axes.push({ x: -dy / size, y: dx / size });
  }
  return axes;
}

function projectPolygon(polygon, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

export function polygonsOverlap(a, b, clearance = 0) {
  const axes = [...polygonAxes(a), ...polygonAxes(b)];
  return axes.every((axis) => {
    const pa = projectPolygon(a, axis);
    const pb = projectPolygon(b, axis);
    return pa.max + clearance >= pb.min && pb.max + clearance >= pa.min;
  });
}

export function isPieceInsideBounds(piece, bounds, override = {}) {
  return piecePolygon(piece, override).every((point) => (
    point.x >= bounds.minX && point.x <= bounds.maxX &&
    point.y >= bounds.minY && point.y <= bounds.maxY
  ));
}

export function validatePlacement(piece, pieces, bounds, override = {}) {
  if (!isPieceInsideBounds(piece, bounds, override)) {
    return { valid: false, reason: 'out-of-bounds' };
  }
  const candidate = piecePolygon(piece, override);
  for (const other of pieces) {
    if (other.id === piece.id || other.collidable === false) continue;
    if (polygonsOverlap(candidate, piecePolygon(other), piece.clearance ?? 3)) {
      return { valid: false, reason: 'overlap', otherId: other.id };
    }
  }
  return { valid: true, reason: null };
}

export function hitTestPiece(point, piece, pointerType = 'mouse') {
  const tolerance = pointerTolerance(pointerType);
  if (piece.type === 'mirror' || piece.type === 'splitter') {
    const segment = linePieceSegment(piece);
    return distancePointToSegment(point, segment.a, segment.b) <= tolerance;
  }
  if (piece.type === 'refractor') {
    const refractor = refractorFromCenter({
      id: piece.id,
      x: piece.x,
      y: piece.y,
      rotation: piece.rotation ?? 0,
      vertices: piece.vertices,
      refractiveIndexBase: piece.refractiveIndexBase,
      dispersionCoefficient: piece.dispersionCoefficient
    });
    if (isInsideMedium(point, refractor)) return true;
    return refractor.vertices.some((a, index) => (
      distancePointToSegment(point, a, refractor.vertices[(index + 1) % refractor.vertices.length]) <= tolerance
    ));
  }
  if (piece.type === 'emitter') {
    return Math.hypot(point.x - piece.x, point.y - piece.y) <= (piece.radius ?? 22) + tolerance;
  }
  return isInsideMedium(point, piecePolygon(piece, { padding: tolerance }));
}

export function softSnapAngle(rawAngle, {
  incrementDegrees = DEFAULT_SNAP_INCREMENT_DEG,
  thresholdDegrees = DEFAULT_SNAP_THRESHOLD_DEG,
  exactDegrees = 0.75
} = {}) {
  const increment = degToRad(incrementDegrees);
  const threshold = degToRad(thresholdDegrees);
  const exact = degToRad(exactDegrees);
  const nearest = Math.round(rawAngle / increment) * increment;
  const delta = shortestAngleDelta(rawAngle, nearest);
  const distance = Math.abs(delta);
  if (distance >= threshold) {
    return { angle: normalizeAngle(rawAngle), snapActive: false, exact: false, target: normalizeAngle(nearest) };
  }
  if (distance <= exact) {
    return { angle: normalizeAngle(nearest), snapActive: true, exact: true, target: normalizeAngle(nearest) };
  }
  const proximity = 1 - distance / threshold;
  const pull = proximity * proximity;
  return {
    angle: normalizeAngle(rawAngle + delta * pull),
    snapActive: true,
    exact: false,
    target: normalizeAngle(nearest)
  };
}

export function rotationHandlePoint(piece) {
  const polygon = piecePolygon(piece);
  const radius = Math.max(36, ...polygon.map((point) => Math.hypot(point.x - piece.x, point.y - piece.y))) + 34;
  const handleAngle = (piece.rotation ?? 0) - Math.PI / 2;
  return {
    x: piece.x + Math.cos(handleAngle) * radius,
    y: piece.y + Math.sin(handleAngle) * radius,
    radius
  };
}

export class InteractionModel {
  constructor({ pieces, bounds, onChange = () => {}, onSnap = () => {} }) {
    this.pieces = pieces;
    this.bounds = bounds;
    this.onChange = onChange;
    this.onSnap = onSnap;
    this.state = {
      selectedId: null,
      hoverId: null,
      mode: null,
      pointerId: null,
      pointerType: 'mouse',
      grabOffset: { x: 0, y: 0 },
      invalid: false,
      invalidReason: null,
      invalidCandidate: null,
      snapActive: false,
      snapPulseUntil: 0
    };
  }

  getPiece(id) { return this.pieces.find((piece) => piece.id === id) ?? null; }
  selectedPiece() { return this.getPiece(this.state.selectedId); }

  hitTest(point, pointerType = 'mouse', { includeFixed = false } = {}) {
    const ordered = [...this.pieces];
    if (this.state.selectedId) {
      const selectedIndex = ordered.findIndex((piece) => piece.id === this.state.selectedId);
      if (selectedIndex >= 0) ordered.push(...ordered.splice(selectedIndex, 1));
    }
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const piece = ordered[index];
      if (!includeFixed && !piece.movable && !piece.rotatable) continue;
      if (hitTestPiece(point, piece, pointerType)) return piece;
    }
    return null;
  }

  setHover(point, pointerType = 'mouse') {
    if (this.state.mode) return this.state.hoverId;
    const hit = this.hitTest(point, pointerType);
    this.state.hoverId = hit?.id ?? null;
    return this.state.hoverId;
  }

  select(id) {
    const piece = this.getPiece(id);
    if (!piece || (!piece.movable && !piece.rotatable)) return false;
    this.state.selectedId = id;
    return true;
  }

  beginDrag(id, point, { pointerId = 1, pointerType = 'mouse' } = {}) {
    const piece = this.getPiece(id);
    if (!piece?.movable) return false;
    this.state.selectedId = id;
    this.state.hoverId = id;
    this.state.mode = 'drag';
    this.state.pointerId = pointerId;
    this.state.pointerType = pointerType;
    this.state.grabOffset = { x: point.x - piece.x, y: point.y - piece.y };
    this.clearInvalid();
    return true;
  }

  dragTo(point) {
    if (this.state.mode !== 'drag') return false;
    const piece = this.selectedPiece();
    if (!piece?.movable) return false;
    const candidate = {
      x: point.x - this.state.grabOffset.x,
      y: point.y - this.state.grabOffset.y,
      rotation: piece.rotation ?? 0
    };
    return this.applyCandidate(piece, candidate);
  }

  beginRotate(id, point, { pointerId = 1, pointerType = 'mouse' } = {}) {
    const piece = this.getPiece(id);
    if (!piece?.rotatable) return false;
    this.state.selectedId = id;
    this.state.hoverId = id;
    this.state.mode = 'rotate';
    this.state.pointerId = pointerId;
    this.state.pointerType = pointerType;
    this.state.snapActive = false;
    this.clearInvalid();
    return this.rotateTo(point);
  }

  rotateTo(point) {
    if (this.state.mode !== 'rotate') return false;
    const piece = this.selectedPiece();
    if (!piece?.rotatable) return false;
    const raw = Math.atan2(point.y - piece.y, point.x - piece.x) + Math.PI / 2;
    const snap = softSnapAngle(raw);
    const candidate = { x: piece.x, y: piece.y, rotation: snap.angle };
    const accepted = this.applyCandidate(piece, candidate);
    if (accepted && snap.snapActive && !this.state.snapActive) {
      this.state.snapPulseUntil = performanceNow() + 190;
      this.onSnap({ piece, exact: snap.exact, angle: snap.angle, target: snap.target });
    }
    this.state.snapActive = snap.snapActive;
    return accepted;
  }

  applyCandidate(piece, candidate) {
    const validation = validatePlacement(piece, this.pieces, this.bounds, candidate);
    if (!validation.valid) {
      this.state.invalid = true;
      this.state.invalidReason = validation.reason;
      this.state.invalidCandidate = { ...candidate, id: piece.id };
      return false;
    }
    piece.x = candidate.x;
    piece.y = candidate.y;
    piece.rotation = candidate.rotation;
    this.clearInvalid();
    this.onChange({ piece, mode: this.state.mode });
    return true;
  }

  end(pointerId = this.state.pointerId) {
    if (this.state.pointerId != null && pointerId !== this.state.pointerId) return false;
    this.state.mode = null;
    this.state.pointerId = null;
    this.state.snapActive = false;
    this.clearInvalid();
    return true;
  }

  clearInvalid() {
    this.state.invalid = false;
    this.state.invalidReason = null;
    this.state.invalidCandidate = null;
  }

  rotationHandle() {
    const piece = this.selectedPiece();
    return piece?.rotatable ? rotationHandlePoint(piece) : null;
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function bindPointerInteractions(canvas, model, {
  boardWidth = canvas.width,
  boardHeight = canvas.height,
  onState = () => {}
} = {}) {
  canvas.style.touchAction = 'none';

  const toBoard = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * boardWidth / rect.width,
      y: (event.clientY - rect.top) * boardHeight / rect.height
    };
  };

  const notify = () => onState(model.state);

  const pointerDown = (event) => {
    const point = toBoard(event);
    const selected = model.selectedPiece();
    if (selected?.rotatable) {
      const handle = model.rotationHandle();
      const tolerance = pointerTolerance(event.pointerType) + 7;
      if (handle && Math.hypot(point.x - handle.x, point.y - handle.y) <= tolerance) {
        if (model.beginRotate(selected.id, point, { pointerId: event.pointerId, pointerType: event.pointerType })) {
          canvas.setPointerCapture?.(event.pointerId);
          event.preventDefault();
          notify();
          return;
        }
      }
    }

    const hit = model.hitTest(point, event.pointerType, { includeFixed: true });
    if (!hit || (!hit.movable && !hit.rotatable)) {
      model.state.hoverId = null;
      notify();
      return;
    }
    model.select(hit.id);
    if (hit.movable) {
      model.beginDrag(hit.id, point, { pointerId: event.pointerId, pointerType: event.pointerType });
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
    notify();
  };

  const pointerMove = (event) => {
    const point = toBoard(event);
    if (model.state.mode === 'drag' && model.state.pointerId === event.pointerId) {
      model.dragTo(point);
      event.preventDefault();
    } else if (model.state.mode === 'rotate' && model.state.pointerId === event.pointerId) {
      model.rotateTo(point);
      event.preventDefault();
    } else {
      model.setHover(point, event.pointerType);
    }
    notify();
  };

  const pointerEnd = (event) => {
    if (model.state.pointerId === event.pointerId) {
      model.end(event.pointerId);
      event.preventDefault();
      notify();
    }
  };

  const pointerLeave = () => {
    if (!model.state.mode) {
      model.state.hoverId = null;
      notify();
    }
  };

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', pointerLeave);

  return () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerEnd);
    canvas.removeEventListener('pointercancel', pointerEnd);
    canvas.removeEventListener('pointerleave', pointerLeave);
  };
}

export const interactionConstants = {
  mouseTolerance: DEFAULT_MOUSE_TOLERANCE,
  touchTolerance: DEFAULT_TOUCH_TOLERANCE,
  snapIncrementDegrees: DEFAULT_SNAP_INCREMENT_DEG,
  snapThresholdDegrees: DEFAULT_SNAP_THRESHOLD_DEG,
  radToDeg
};
