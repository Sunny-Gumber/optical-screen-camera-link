import {
  combineRayTrees,
  directionFromAngle,
  evaluateGoals,
  goalCircle,
  goalRect,
  intersectRaySegment,
  mirrorFromCenter,
  refractorFromCenter,
  splitterFromCenter,
  traceOpticalRays
} from '../physics/rayEngine.js';
import { assertValidLevel } from './schema.js';

const DEG = Math.PI / 180;
const EPSILON = 1e-6;
const clone = (value) => JSON.parse(JSON.stringify(value));
const rotatePoint = (point, rotation) => ({
  x: point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
  y: point.x * Math.sin(rotation) + point.y * Math.cos(rotation)
});

export function parseLevelInput(input) {
  if (typeof input === 'string') {
    try { return JSON.parse(input); }
    catch (cause) {
      const error = new Error(`Invalid level JSON syntax: ${cause.message}`);
      error.name = 'LevelParseError';
      throw error;
    }
  }
  return clone(input);
}

function lineGeometryInfo(geometry) {
  const dx = geometry.b.x - geometry.a.x;
  const dy = geometry.b.y - geometry.a.y;
  return { length: Math.hypot(dx, dy), baseAngle: Math.atan2(dy, dx) };
}

export function runtimePieceFromSchema(piece) {
  const base = {
    id: piece.id,
    type: piece.type,
    x: piece.initialX,
    y: piece.initialY,
    movable: piece.movable,
    rotatable: piece.rotatable,
    schemaMovable: piece.movable,
    schemaRotatable: piece.rotatable,
    schemaGeometry: clone(piece.geometry),
    schemaProps: clone(piece.props ?? {}),
    schemaInitialRotation: piece.initialRotation,
    collisionThickness: 18,
    clearance: 3
  };

  if (piece.type === 'mirror' || piece.type === 'splitter') {
    const info = lineGeometryInfo(piece.geometry);
    return {
      ...base,
      length: info.length,
      baseGeometryAngle: info.baseAngle,
      rotation: piece.initialRotation * DEG + info.baseAngle,
      ...(piece.type === 'splitter' ? { splitRatio: piece.props.splitRatio } : {})
    };
  }

  return {
    ...base,
    rotation: piece.initialRotation * DEG,
    vertices: clone(piece.geometry.vertices),
    ...(piece.type === 'refractor' ? {
      refractiveIndexBase: piece.props.refractiveIndexBase,
      dispersionCoefficient: piece.props.dispersionCoefficient
    } : {})
  };
}

export function runtimeEmitterFromSchema(emitter) {
  return {
    id: emitter.id,
    type: 'emitter',
    x: emitter.x,
    y: emitter.y,
    angle: emitter.angle * DEG,
    wavelength: emitter.color === 'white' ? null : emitter.color,
    color: emitter.color,
    intensity: 1,
    radius: 20,
    movable: false,
    rotatable: false,
    collidable: false
  };
}

export function runtimeGoalFromSchema(goal) {
  const base = {
    id: goal.id,
    type: 'goal',
    x: goal.x,
    y: goal.y,
    shape: goal.shape,
    size: goal.size,
    requiredColor: clone(goal.requiredColor),
    requiredIntensity: goal.requiredIntensity,
    movable: false,
    rotatable: false,
    collidable: false
  };
  return goal.shape === 'rect'
    ? { ...base, width: goal.size, height: goal.size }
    : { ...base, radius: goal.size };
}

export function instantiateLevel(levelInput) {
  const definition = parseLevelInput(levelInput);
  assertValidLevel(definition);
  const bounds = { minX: 0, minY: 0, maxX: definition.boardBounds.width, maxY: definition.boardBounds.height };
  return {
    definition: clone(definition),
    metadata: {
      id: definition.id,
      name: definition.name,
      chapter: definition.chapter,
      difficulty: definition.difficulty
    },
    boardBounds: clone(definition.boardBounds),
    bounds,
    emitters: definition.emitters.map(runtimeEmitterFromSchema),
    pieces: definition.pieces.map(runtimePieceFromSchema),
    goals: definition.goals.map(runtimeGoalFromSchema)
  };
}

export class LevelSession {
  constructor(levelInput = null) {
    this.sourceDefinition = null;
    this.runtime = null;
    if (levelInput) this.loadLevel(levelInput);
  }

  loadLevel(levelInput) {
    const parsed = parseLevelInput(levelInput);
    assertValidLevel(parsed);
    this.sourceDefinition = clone(parsed);
    this.runtime = instantiateLevel(parsed);
    return this.runtime;
  }

  resetLevel() {
    if (!this.sourceDefinition) throw new Error('No level is loaded');
    this.runtime = instantiateLevel(this.sourceDefinition);
    return this.runtime;
  }

  replaceInitialState(levelInput) { return this.loadLevel(levelInput); }
}

export function wallWorldVertices(piece) {
  return piece.vertices.map((vertex) => {
    const rotated = rotatePoint(vertex, piece.rotation ?? 0);
    return { x: piece.x + rotated.x, y: piece.y + rotated.y };
  });
}

function nearestWallHit(segment, walls) {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const direction = { x: dx / length, y: dy / length };
  let nearest = null;
  for (const wall of walls) {
    const vertices = wallWorldVertices(wall);
    for (let index = 0; index < vertices.length; index += 1) {
      const a = vertices[index];
      const b = vertices[(index + 1) % vertices.length];
      const hit = intersectRaySegment(segment.from, direction, { a, b });
      if (!hit || hit.distance <= EPSILON || hit.distance > length + EPSILON) continue;
      if (!nearest || hit.distance < nearest.distance) nearest = { ...hit, wallId: wall.id };
    }
  }
  return nearest;
}

function trimTreeForWalls(node, walls) {
  if (!node) return node;
  for (let index = 0; index < (node.segments?.length ?? 0); index += 1) {
    const segment = node.segments[index];
    const hit = nearestWallHit(segment, walls);
    if (!hit) continue;
    node.segments = [
      ...node.segments.slice(0, index),
      { ...segment, to: { ...hit.point }, kind: 'wall', wallId: hit.wallId }
    ];
    node.children = [];
    node.terminated = 'wall';
    return node;
  }
  node.children = (node.children ?? []).map((child) => trimTreeForWalls(child, walls));
  return node;
}

function opticalRuntime(runtime) {
  const mirrors = runtime.pieces.filter((piece) => piece.type === 'mirror').map((piece) => mirrorFromCenter({
    id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation
  }));
  const splitters = runtime.pieces.filter((piece) => piece.type === 'splitter').map((piece) => splitterFromCenter({
    id: piece.id, x: piece.x, y: piece.y, length: piece.length, rotation: piece.rotation, splitRatio: piece.splitRatio
  }));
  const refractors = runtime.pieces.filter((piece) => piece.type === 'refractor').map((piece) => refractorFromCenter({
    id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation, vertices: piece.vertices,
    refractiveIndexBase: piece.refractiveIndexBase, dispersionCoefficient: piece.dispersionCoefficient
  }));
  const walls = runtime.pieces.filter((piece) => piece.type === 'wall');
  return { mirrors, splitters, refractors, walls };
}

export function physicsGoals(runtime) {
  return runtime.goals.map((goal) => goal.shape === 'rect'
    ? goalRect({ id: goal.id, x: goal.x, y: goal.y, width: goal.width, height: goal.height, requiredColor: goal.requiredColor, requiredIntensity: goal.requiredIntensity })
    : goalCircle({ id: goal.id, x: goal.x, y: goal.y, radius: goal.radius, requiredColor: goal.requiredColor, requiredIntensity: goal.requiredIntensity }));
}

export function traceLevelRuntime(runtime, options = {}) {
  const { mirrors, splitters, refractors, walls } = opticalRuntime(runtime);
  const trees = runtime.emitters.map((emitter) => {
    const trace = traceOpticalRays({
      origin: { x: emitter.x, y: emitter.y },
      direction: directionFromAngle(emitter.angle),
      mirrors, splitters, refractors,
      bounds: runtime.bounds,
      wavelength: emitter.wavelength,
      intensity: emitter.intensity ?? 1,
      minIntensity: options.minIntensity ?? 0.02,
      maxBounces: options.maxBounces ?? 20,
      maxRayNodes: options.maxRayNodes ?? 1024,
      spectralSampleCount: options.spectralSampleCount ?? 31
    });
    return walls.length ? trimTreeForWalls(trace.rayTree, walls) : trace.rayTree;
  });
  const rayTree = combineRayTrees(trees);
  const statuses = evaluateGoals(rayTree, physicsGoals(runtime));
  return { rayTree, statuses };
}
