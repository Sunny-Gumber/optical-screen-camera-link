import { assertValidLevel } from '../levels/schema.js';

const DEG = Math.PI / 180;
const clone = (value) => JSON.parse(JSON.stringify(value));
const degrees = (radians) => radians / DEG;

export function createBlankLevel({
  id = 'draft-level',
  name = 'Untitled Prism Puzzle',
  chapter = 'reflection-basics',
  difficulty = 1,
  width = 1200,
  height = 720
} = {}) {
  return {
    id, name, chapter, difficulty,
    boardBounds: { width, height },
    emitters: [], pieces: [], goals: []
  };
}

export function nextEntityId(level, prefix) {
  const ids = new Set([
    ...level.emitters.map((item) => item.id),
    ...level.pieces.map((item) => item.id),
    ...level.goals.map((item) => item.id)
  ]);
  let index = 1;
  while (ids.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function defaultSchemaEntity(type, x, y, level) {
  if (type === 'emitter') {
    return { collection: 'emitters', value: { id: nextEntityId(level, 'E'), x, y, angle: 0, color: 650 } };
  }
  if (type === 'goal') {
    return {
      collection: 'goals',
      value: { id: nextEntityId(level, 'G'), x, y, shape: 'circle', size: 38, requiredColor: 'any', requiredIntensity: 0.2 }
    };
  }
  if (type === 'mirror') {
    return {
      collection: 'pieces',
      value: {
        id: nextEntityId(level, 'M'), type: 'mirror', movable: true, rotatable: true,
        geometry: { a: { x: -75, y: 0 }, b: { x: 75, y: 0 } },
        initialX: x, initialY: y, initialRotation: 0, props: {}
      }
    };
  }
  if (type === 'splitter') {
    return {
      collection: 'pieces',
      value: {
        id: nextEntityId(level, 'S'), type: 'splitter', movable: true, rotatable: true,
        geometry: { a: { x: -75, y: 0 }, b: { x: 75, y: 0 } },
        initialX: x, initialY: y, initialRotation: 45, props: { splitRatio: 0.5 }
      }
    };
  }
  if (type === 'refractor') {
    return {
      collection: 'pieces',
      value: {
        id: nextEntityId(level, 'P'), type: 'refractor', movable: true, rotatable: true,
        geometry: { vertices: [{ x: -65, y: -95 }, { x: -65, y: 95 }, { x: 90, y: 0 }] },
        initialX: x, initialY: y, initialRotation: 0,
        props: { refractiveIndexBase: 1.52, dispersionCoefficient: 4200 }
      }
    };
  }
  if (type === 'wall') {
    return {
      collection: 'pieces',
      value: {
        id: nextEntityId(level, 'W'), type: 'wall', movable: false, rotatable: false,
        geometry: { vertices: [{ x: -70, y: -18 }, { x: 70, y: -18 }, { x: 70, y: 18 }, { x: -70, y: 18 }] },
        initialX: x, initialY: y, initialRotation: 0, props: {}
      }
    };
  }
  throw new Error(`Unsupported palette type: ${type}`);
}

export function addSchemaEntity(level, type, x, y) {
  const entity = defaultSchemaEntity(type, x, y, level);
  level[entity.collection].push(entity.value);
  return entity.value;
}

export function deleteSchemaEntity(level, id) {
  for (const collection of ['emitters', 'pieces', 'goals']) {
    const index = level[collection].findIndex((item) => item.id === id);
    if (index >= 0) {
      const [removed] = level[collection].splice(index, 1);
      return removed;
    }
  }
  return null;
}

export function serializeRuntimeLevel(runtime, metadata = runtime.metadata) {
  const level = {
    id: metadata.id,
    name: metadata.name,
    chapter: metadata.chapter,
    difficulty: Number(metadata.difficulty),
    boardBounds: clone(runtime.boardBounds),
    emitters: runtime.emitters.map((emitter) => ({
      id: emitter.id,
      x: Number(emitter.x.toFixed(4)),
      y: Number(emitter.y.toFixed(4)),
      angle: Number(degrees(emitter.angle ?? 0).toFixed(4)),
      color: emitter.wavelength == null ? 'white' : emitter.wavelength
    })),
    pieces: runtime.pieces.map((piece) => {
      const rotation = piece.type === 'mirror' || piece.type === 'splitter'
        ? (piece.rotation ?? 0) - (piece.baseGeometryAngle ?? 0)
        : (piece.rotation ?? 0);
      const props = {};
      if (piece.type === 'splitter') props.splitRatio = piece.splitRatio;
      if (piece.type === 'refractor') {
        props.refractiveIndexBase = piece.refractiveIndexBase;
        props.dispersionCoefficient = piece.dispersionCoefficient;
      }
      return {
        id: piece.id,
        type: piece.type,
        movable: piece.schemaMovable ?? piece.movable,
        rotatable: piece.schemaRotatable ?? piece.rotatable,
        geometry: clone(piece.schemaGeometry ?? (piece.vertices ? { vertices: piece.vertices } : {})),
        initialX: Number(piece.x.toFixed(4)),
        initialY: Number(piece.y.toFixed(4)),
        initialRotation: Number(degrees(rotation).toFixed(4)),
        props
      };
    }),
    goals: runtime.goals.map((goal) => ({
      id: goal.id,
      x: Number(goal.x.toFixed(4)),
      y: Number(goal.y.toFixed(4)),
      shape: goal.shape,
      size: goal.shape === 'rect' ? goal.width : goal.radius,
      requiredColor: clone(goal.requiredColor),
      requiredIntensity: goal.requiredIntensity
    }))
  };
  assertValidLevel(level);
  return level;
}

export function levelToPrettyJson(level) {
  assertValidLevel(level);
  return JSON.stringify(level, null, 2);
}

export function applyProperty(level, id, property, value) {
  const emitter = level.emitters.find((item) => item.id === id);
  if (emitter) { emitter[property] = value; return true; }
  const goal = level.goals.find((item) => item.id === id);
  if (goal) { goal[property] = value; return true; }
  const piece = level.pieces.find((item) => item.id === id);
  if (!piece) return false;
  if (property.startsWith('props.')) piece.props[property.slice(6)] = value;
  else piece[property] = value;
  return true;
}
