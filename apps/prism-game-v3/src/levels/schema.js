export const LEVEL_SCHEMA_VERSION = 2;
export const PIECE_TYPES = ['mirror', 'refractor', 'splitter', 'wall', 'lens', 'reflector'];
export const GOAL_SHAPES = ['circle', 'rect'];
export const EMITTER_TYPES = ['emitter', 'lightSource'];

export const LEVEL_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://prism-lab.local/schemas/level.schema.json',
  title: 'Prism Lab Level',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'chapter', 'difficulty', 'boardBounds', 'emitters', 'pieces', 'goals'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    chapter: { type: 'string', minLength: 1 },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    boardBounds: {
      type: 'object', additionalProperties: false, required: ['width', 'height'],
      properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }
    },
    emitters: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'x', 'y', 'color'],
        properties: {
          id: { type: 'string', minLength: 1 },
          type: { enum: EMITTER_TYPES },
          x: { type: 'number' }, y: { type: 'number' },
          angle: { type: 'number' }, centerDirection: { type: 'number' }, coneAngle: { type: 'number', minimum: 0, maximum: 360 },
          rayCount: { type: 'integer', minimum: 1, maximum: 1000 }, totalEnergy: { type: 'number', exclusiveMinimum: 0 },
          color: { anyOf: [{ const: 'white' }, { type: 'number', minimum: 400, maximum: 700 }] }
        },
        anyOf: [
          { required: ['angle'] },
          { properties: { type: { const: 'lightSource' } }, required: ['type', 'centerDirection', 'coneAngle', 'rayCount', 'totalEnergy'] }
        ]
      }
    },
    pieces: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'type', 'movable', 'rotatable', 'geometry', 'initialX', 'initialY', 'initialRotation', 'props'],
        properties: {
          id: { type: 'string', minLength: 1 }, type: { enum: PIECE_TYPES }, movable: { type: 'boolean' }, rotatable: { type: 'boolean' },
          geometry: { type: 'object' }, initialX: { type: 'number' }, initialY: { type: 'number' }, initialRotation: { type: 'number' }, props: { type: 'object' }
        }
      }
    },
    goals: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'x', 'y', 'shape', 'size'],
        properties: {
          id: { type: 'string', minLength: 1 }, x: { type: 'number' }, y: { type: 'number' }, shape: { enum: GOAL_SHAPES },
          size: { type: 'number', exclusiveMinimum: 0 }, requiredColor: {}, requiredIntensity: { type: 'number', minimum: 0 },
          requiredConcentration: { type: 'number', minimum: 0, maximum: 100 }
        },
        anyOf: [{ required: ['requiredIntensity'] }, { required: ['requiredConcentration'] }]
      }
    }
  }
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const point = (value) => value && typeof value === 'object' && finite(value.x) && finite(value.y);
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function add(errors, path, message) { errors.push({ path, message, text: `${path}: ${message}` }); }
function requiredString(errors, value, path) {
  if (typeof value !== 'string' || !value.trim()) add(errors, path, 'must be a non-empty string');
}
function requiredNumber(errors, value, path) { if (!finite(value)) add(errors, path, 'must be a finite number'); }
function requiredBoolean(errors, value, path) { if (typeof value !== 'boolean') add(errors, path, 'must be a boolean'); }
function optionalUnitInterval(errors, value, path) {
  if (value != null && (!finite(value) || value < 0 || value > 1)) add(errors, path, 'must be a number from 0 to 1');
}

function validateLineGeometry(errors, geometry, path) {
  if (!plainObject(geometry)) { add(errors, path, 'must be an object'); return; }
  if (!point(geometry.a)) add(errors, `${path}.a`, 'must be a point {x,y}');
  if (!point(geometry.b)) add(errors, `${path}.b`, 'must be a point {x,y}');
  if (point(geometry.a) && point(geometry.b) && Math.hypot(geometry.b.x - geometry.a.x, geometry.b.y - geometry.a.y) < 1e-6) {
    add(errors, path, 'segment endpoints must not be identical');
  }
}

function validatePolygonGeometry(errors, geometry, path) {
  if (!plainObject(geometry)) { add(errors, path, 'must be an object'); return; }
  if (!Array.isArray(geometry.vertices) || geometry.vertices.length < 3) {
    add(errors, `${path}.vertices`, 'must contain at least 3 vertices');
    return;
  }
  geometry.vertices.forEach((vertex, index) => { if (!point(vertex)) add(errors, `${path}.vertices[${index}]`, 'must be a point {x,y}'); });
}

function validateLengthGeometry(errors, geometry, path) {
  if (!plainObject(geometry)) { add(errors, path, 'must be an object'); return; }
  if (!finite(geometry.length) || geometry.length <= 0) add(errors, `${path}.length`, 'must be > 0');
}

function validateReflectorGeometry(errors, geometry, path) {
  if (!plainObject(geometry)) { add(errors, path, 'must be an object'); return; }
  if (!finite(geometry.aperture) || geometry.aperture <= 0) add(errors, `${path}.aperture`, 'must be > 0');
}

function validRequiredColor(value) {
  if (value == null || value === 'any' || value === 'white') return true;
  if (Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1])) {
    return value[0] >= 400 && value[1] <= 700 && value[0] <= value[1];
  }
  if (plainObject(value) && finite(value.min) && finite(value.max)) {
    return value.min >= 400 && value.max <= 700 && value.min <= value.max;
  }
  return false;
}

export function validateLevel(level) {
  const errors = [];
  if (!plainObject(level)) return { valid: false, errors: [{ path: '$', message: 'level must be an object', text: '$: level must be an object' }] };

  requiredString(errors, level.id, '$.id');
  requiredString(errors, level.name, '$.name');
  requiredString(errors, level.chapter, '$.chapter');
  if (!Number.isInteger(level.difficulty) || level.difficulty < 1 || level.difficulty > 5) add(errors, '$.difficulty', 'must be an integer from 1 to 5');

  if (!plainObject(level.boardBounds)) add(errors, '$.boardBounds', 'is required and must be an object');
  else {
    requiredNumber(errors, level.boardBounds.width, '$.boardBounds.width');
    requiredNumber(errors, level.boardBounds.height, '$.boardBounds.height');
    if (finite(level.boardBounds.width) && level.boardBounds.width <= 0) add(errors, '$.boardBounds.width', 'must be > 0');
    if (finite(level.boardBounds.height) && level.boardBounds.height <= 0) add(errors, '$.boardBounds.height', 'must be > 0');
  }

  if (!Array.isArray(level.emitters) || level.emitters.length === 0) add(errors, '$.emitters', 'must contain at least one emitter');
  else level.emitters.forEach((emitter, index) => {
    const path = `$.emitters[${index}]`;
    if (!plainObject(emitter)) { add(errors, path, 'must be an object'); return; }
    requiredString(errors, emitter.id, `${path}.id`);
    requiredNumber(errors, emitter.x, `${path}.x`);
    requiredNumber(errors, emitter.y, `${path}.y`);
    if (emitter.type != null && !EMITTER_TYPES.includes(emitter.type)) add(errors, `${path}.type`, `must be one of: ${EMITTER_TYPES.join(', ')}`);
    const lightSource = emitter.type === 'lightSource';
    if (lightSource) {
      requiredNumber(errors, emitter.centerDirection, `${path}.centerDirection`);
      if (!finite(emitter.coneAngle) || emitter.coneAngle < 0 || emitter.coneAngle > 360) add(errors, `${path}.coneAngle`, 'must be from 0 to 360 degrees');
      if (!Number.isInteger(emitter.rayCount) || emitter.rayCount < 1 || emitter.rayCount > 1000) add(errors, `${path}.rayCount`, 'must be an integer from 1 to 1000');
      if (!finite(emitter.totalEnergy) || emitter.totalEnergy <= 0) add(errors, `${path}.totalEnergy`, 'must be > 0');
    } else {
      requiredNumber(errors, emitter.angle, `${path}.angle`);
    }
    if (!(emitter.color === 'white' || (finite(emitter.color) && emitter.color >= 400 && emitter.color <= 700))) {
      add(errors, `${path}.color`, 'must be "white" or a wavelength from 400 to 700 nm');
    }
  });

  if (!Array.isArray(level.pieces)) add(errors, '$.pieces', 'is required and must be an array');
  else level.pieces.forEach((pieceValue, index) => {
    const path = `$.pieces[${index}]`;
    if (!plainObject(pieceValue)) { add(errors, path, 'must be an object'); return; }
    requiredString(errors, pieceValue.id, `${path}.id`);
    if (!PIECE_TYPES.includes(pieceValue.type)) add(errors, `${path}.type`, `must be one of: ${PIECE_TYPES.join(', ')}`);
    requiredBoolean(errors, pieceValue.movable, `${path}.movable`);
    requiredBoolean(errors, pieceValue.rotatable, `${path}.rotatable`);
    requiredNumber(errors, pieceValue.initialX, `${path}.initialX`);
    requiredNumber(errors, pieceValue.initialY, `${path}.initialY`);
    requiredNumber(errors, pieceValue.initialRotation, `${path}.initialRotation`);
    if (pieceValue.type === 'mirror' || pieceValue.type === 'splitter') validateLineGeometry(errors, pieceValue.geometry, `${path}.geometry`);
    if (pieceValue.type === 'refractor' || pieceValue.type === 'wall') validatePolygonGeometry(errors, pieceValue.geometry, `${path}.geometry`);
    if (pieceValue.type === 'lens') validateLengthGeometry(errors, pieceValue.geometry, `${path}.geometry`);
    if (pieceValue.type === 'reflector') validateReflectorGeometry(errors, pieceValue.geometry, `${path}.geometry`);
    if (!plainObject(pieceValue.props)) add(errors, `${path}.props`, 'must be an object');

    if (pieceValue.type === 'mirror') optionalUnitInterval(errors, pieceValue.props?.reflectivity, `${path}.props.reflectivity`);
    if (pieceValue.type === 'splitter' && (!finite(pieceValue.props?.splitRatio) || pieceValue.props.splitRatio < 0 || pieceValue.props.splitRatio > 1)) {
      add(errors, `${path}.props.splitRatio`, 'must be a number from 0 to 1');
    }
    if (pieceValue.type === 'refractor') {
      if (!finite(pieceValue.props?.refractiveIndexBase) || pieceValue.props.refractiveIndexBase <= 1) add(errors, `${path}.props.refractiveIndexBase`, 'must be > 1');
      if (!finite(pieceValue.props?.dispersionCoefficient) || pieceValue.props.dispersionCoefficient < 0) add(errors, `${path}.props.dispersionCoefficient`, 'must be >= 0');
      optionalUnitInterval(errors, pieceValue.props?.transmission, `${path}.props.transmission`);
    }
    if (pieceValue.type === 'lens') {
      if (!finite(pieceValue.props?.focalLength) || Math.abs(pieceValue.props.focalLength) < 1e-6) add(errors, `${path}.props.focalLength`, 'must be a non-zero number');
      optionalUnitInterval(errors, pieceValue.props?.transmission, `${path}.props.transmission`);
    }
    if (pieceValue.type === 'reflector') {
      if (!finite(pieceValue.props?.focalLength) || pieceValue.props.focalLength <= 0) add(errors, `${path}.props.focalLength`, 'must be > 0');
      if (pieceValue.props?.segmentCount != null && (!Number.isInteger(pieceValue.props.segmentCount) || pieceValue.props.segmentCount < 8 || pieceValue.props.segmentCount > 256)) {
        add(errors, `${path}.props.segmentCount`, 'must be an integer from 8 to 256');
      }
      optionalUnitInterval(errors, pieceValue.props?.reflectivity, `${path}.props.reflectivity`);
    }
  });

  if (!Array.isArray(level.goals) || level.goals.length === 0) add(errors, '$.goals', 'must contain at least one goal');
  else level.goals.forEach((goal, index) => {
    const path = `$.goals[${index}]`;
    if (!plainObject(goal)) { add(errors, path, 'must be an object'); return; }
    requiredString(errors, goal.id, `${path}.id`);
    requiredNumber(errors, goal.x, `${path}.x`);
    requiredNumber(errors, goal.y, `${path}.y`);
    if (!GOAL_SHAPES.includes(goal.shape)) add(errors, `${path}.shape`, `must be one of: ${GOAL_SHAPES.join(', ')}`);
    if (!finite(goal.size) || goal.size <= 0) add(errors, `${path}.size`, 'must be > 0');
    if (!validRequiredColor(goal.requiredColor)) add(errors, `${path}.requiredColor`, 'must be any, white, or a visible wavelength range');
    const hasIntensity = finite(goal.requiredIntensity) && goal.requiredIntensity >= 0;
    const hasConcentration = finite(goal.requiredConcentration) && goal.requiredConcentration >= 0 && goal.requiredConcentration <= 100;
    if (!hasIntensity && !hasConcentration) add(errors, path, 'must define requiredIntensity >= 0 or requiredConcentration from 0 to 100');
    if (goal.requiredIntensity != null && !hasIntensity) add(errors, `${path}.requiredIntensity`, 'must be >= 0');
    if (goal.requiredConcentration != null && !hasConcentration) add(errors, `${path}.requiredConcentration`, 'must be from 0 to 100');
  });

  const ids = [];
  if (Array.isArray(level.emitters)) ids.push(...level.emitters.map((item) => item?.id));
  if (Array.isArray(level.pieces)) ids.push(...level.pieces.map((item) => item?.id));
  if (Array.isArray(level.goals)) ids.push(...level.goals.map((item) => item?.id));
  const seen = new Set();
  ids.filter((id) => typeof id === 'string' && id).forEach((id) => {
    if (seen.has(id)) add(errors, '$.ids', `duplicate id "${id}"`);
    seen.add(id);
  });

  return { valid: errors.length === 0, errors };
}

export function assertValidLevel(level) {
  const result = validateLevel(level);
  if (!result.valid) {
    const error = new Error(`Invalid level JSON:\n${result.errors.map((entry) => `• ${entry.text}`).join('\n')}`);
    error.name = 'LevelValidationError';
    error.validationErrors = result.errors;
    throw error;
  }
  return level;
}
