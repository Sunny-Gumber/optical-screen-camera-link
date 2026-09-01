import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InteractionModel,
  hitTestPiece,
  isPieceInsideBounds,
  softSnapAngle,
  validatePlacement
} from './interaction.js';

const bounds = { minX: 0, minY: 0, maxX: 500, maxY: 400 };
const deg = (value) => value * Math.PI / 180;

function prism(overrides = {}) {
  return {
    id: 'P1', type: 'refractor', x: 200, y: 180, rotation: 0,
    vertices: [{ x: -50, y: -50 }, { x: -50, y: 50 }, { x: 60, y: 0 }],
    refractiveIndexBase: 1.52, dispersionCoefficient: 4200,
    movable: true, rotatable: true,
    ...overrides
  };
}

function mirror(overrides = {}) {
  return {
    id: 'M1', type: 'mirror', x: 200, y: 180, rotation: 0, length: 120,
    movable: true, rotatable: true,
    ...overrides
  };
}

test('polygon hit test detects a point clearly inside a refractor', () => {
  assert.equal(hitTestPiece({ x: 200, y: 180 }, prism(), 'mouse'), true);
});

test('polygon hit test rejects a point clearly outside a refractor', () => {
  assert.equal(hitTestPiece({ x: 320, y: 300 }, prism(), 'mouse'), false);
});

test('thin mirror is grabbable within mouse tolerance', () => {
  assert.equal(hitTestPiece({ x: 200, y: 187.5 }, mirror(), 'mouse'), true);
});

test('thin mirror is not grabbable just outside mouse tolerance', () => {
  assert.equal(hitTestPiece({ x: 200, y: 189 }, mirror(), 'mouse'), false);
});

test('touch tolerance is more forgiving than mouse tolerance', () => {
  const point = { x: 200, y: 196 };
  assert.equal(hitTestPiece(point, mirror(), 'mouse'), false);
  assert.equal(hitTestPiece(point, mirror(), 'touch'), true);
});

test('soft rotation snap pulls an angle inside threshold toward nearest 15 degrees', () => {
  const raw = deg(18);
  const result = softSnapAngle(raw);
  assert.equal(result.snapActive, true);
  assert.ok(Math.abs(result.angle - deg(15)) < Math.abs(raw - deg(15)));
});

test('rotation outside magnetic threshold remains raw', () => {
  const raw = deg(21);
  const result = softSnapAngle(raw);
  assert.equal(result.snapActive, false);
  assert.ok(Math.abs(result.angle - raw) < 1e-10);
});

test('rotation very close to snap point lands exactly on 15 degree increment', () => {
  const result = softSnapAngle(deg(15.4));
  assert.equal(result.exact, true);
  assert.ok(Math.abs(result.angle - deg(15)) < 1e-10);
});

test('piece completely inside board passes boundary validation', () => {
  assert.equal(isPieceInsideBounds(mirror(), bounds), true);
});

test('attempted out-of-board placement is rejected', () => {
  const piece = mirror({ x: 60, y: 60 });
  const result = validatePlacement(piece, [piece], bounds, { x: -10, y: 60, rotation: 0 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'out-of-bounds');
});

test('attempted overlap with another optical piece is rejected', () => {
  const moving = mirror({ id: 'M1', x: 120, y: 180 });
  const blocker = mirror({ id: 'M2', x: 280, y: 180, rotation: Math.PI / 2 });
  const result = validatePlacement(moving, [moving, blocker], bounds, { x: 280, y: 180, rotation: 0 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'overlap');
  assert.equal(result.otherId, 'M2');
});

test('grab-point-relative drag preserves original pointer offset', () => {
  const piece = mirror({ x: 200, y: 180 });
  const model = new InteractionModel({ pieces: [piece], bounds });
  assert.equal(model.beginDrag('M1', { x: 225, y: 190 }), true);
  assert.equal(model.dragTo({ x: 300, y: 250 }), true);
  assert.equal(piece.x, 275);
  assert.equal(piece.y, 240);
});

test('invalid drag is blocked at last valid position and exposes invalid state', () => {
  const moving = mirror({ id: 'M1', x: 120, y: 180 });
  const blocker = mirror({ id: 'M2', x: 280, y: 180, rotation: Math.PI / 2, movable: false, rotatable: false });
  const model = new InteractionModel({ pieces: [moving, blocker], bounds });
  model.beginDrag('M1', { x: 120, y: 180 });
  assert.equal(model.dragTo({ x: 280, y: 180 }), false);
  assert.equal(moving.x, 120);
  assert.equal(moving.y, 180);
  assert.equal(model.state.invalid, true);
  assert.equal(model.state.invalidReason, 'overlap');
});

test('movable false piece refuses drag and position never changes', () => {
  const fixed = mirror({ id: 'fixed', x: 210, y: 180, movable: false, rotatable: false });
  const model = new InteractionModel({ pieces: [fixed], bounds });
  assert.equal(model.beginDrag('fixed', { x: 210, y: 180 }), false);
  assert.equal(model.dragTo({ x: 350, y: 250 }), false);
  assert.equal(fixed.x, 210);
  assert.equal(fixed.y, 180);
});

test('rotation candidate that would overlap a neighbor is rejected', () => {
  const moving = mirror({ id: 'M1', x: 200, y: 180, length: 120, rotation: Math.PI / 2 });
  const blocker = mirror({ id: 'M2', x: 260, y: 180, length: 90, rotation: Math.PI / 2, movable: false, rotatable: false });
  const model = new InteractionModel({ pieces: [moving, blocker], bounds });
  const oldRotation = moving.rotation;
  model.state.selectedId = 'M1';
  model.state.mode = 'rotate';
  model.state.pointerId = 1;
  const accepted = model.rotateTo({ x: 200, y: 50 });
  assert.equal(accepted, false);
  assert.equal(moving.rotation, oldRotation);
  assert.equal(model.state.invalid, true);
});
