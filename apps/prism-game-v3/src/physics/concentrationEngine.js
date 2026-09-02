import {
  add,
  directionFromAngle,
  dot,
  intersectRaySegment,
  intersectRayWithBounds,
  multiply,
  normalize,
  polygonEdges,
  reflect,
  refract,
  refractiveIndexAt,
  rgbToCss,
  spectralSamples,
  subtract,
  wavelengthToRGB
} from './rayEngine.js';

const EPSILON = 1e-5;
const AIR_REFRACTIVE_INDEX = 1;
const DEFAULT_MIN_ENERGY = 1e-7;
const DEFAULT_MAX_NODES = 24000;
const DEFAULT_MAX_INTERACTIONS = 20;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (value) => Math.hypot(value.x, value.y);
const rotate = (point, angle) => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
});
const inverseRotate = (point, angle) => rotate(point, -angle);
const cssForWavelength = (wavelength, alpha = 1) => wavelength == null
  ? `rgba(255,255,242,${alpha})`
  : rgbToCss(wavelengthToRGB(wavelength), alpha);

export function sampleLightSource({
  id = 'light',
  x,
  y,
  centerDirection = 0,
  coneAngle = Math.PI / 3,
  rayCount = 150,
  totalEnergy = 1,
  wavelength = 589
}) {
  const count = Math.max(1, Math.round(rayCount));
  if (!Number.isFinite(totalEnergy) || totalEnergy <= 0) throw new Error('totalEnergy must be > 0');
  const energyPerRay = totalEnergy / count;
  const halfCone = Math.max(0, coneAngle) / 2;
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = centerDirection - halfCone + t * halfCone * 2;
    return {
      sourceId: id,
      origin: { x, y },
      direction: directionFromAngle(angle),
      wavelength,
      energy: energyPerRay,
      mediumId: null,
      hasDispersed: wavelength != null,
      interactions: 0
    };
  });
}

export function thinLensImageDistance(focalLength, objectDistance) {
  if (!Number.isFinite(focalLength) || Math.abs(focalLength) < EPSILON) throw new Error('focalLength must be non-zero');
  if (!Number.isFinite(objectDistance) || Math.abs(objectDistance) < EPSILON) throw new Error('objectDistance must be non-zero');
  const denominator = (1 / focalLength) - (1 / objectDistance);
  if (Math.abs(denominator) < EPSILON) return Infinity;
  return 1 / denominator;
}

export function lensFromCenter({
  id,
  x,
  y,
  rotation = 0,
  length: lensLength = 280,
  focalLength = 180,
  transmission = 1
}) {
  if (!Number.isFinite(focalLength) || Math.abs(focalLength) < EPSILON) throw new Error('Lens focalLength must be non-zero');
  const axis = directionFromAngle(rotation);
  const tangent = { x: -axis.y, y: axis.x };
  const half = lensLength / 2;
  return {
    id,
    type: 'lens',
    x,
    y,
    rotation,
    length: lensLength,
    focalLength,
    transmission: clamp(transmission, 0, 1),
    axis,
    tangent,
    a: { x: x - tangent.x * half, y: y - tangent.y * half },
    b: { x: x + tangent.x * half, y: y + tangent.y * half }
  };
}

// Paraxial thin-lens transform. The angular kick tan(Δθ)=-height/f is
// equivalent to the thin-lens ray-transfer matrix and focuses a parallel
// bundle at the configured focal plane.
export function thinLensRedirect(direction, hitPoint, lens) {
  const incoming = normalize(direction);
  let axis = lens.axis;
  let tangent = lens.tangent;
  if (dot(incoming, axis) < 0) {
    axis = multiply(axis, -1);
    tangent = multiply(tangent, -1);
  }
  const relative = subtract(hitPoint, { x: lens.x, y: lens.y });
  const height = dot(relative, tangent);
  const forward = Math.max(EPSILON, dot(incoming, axis));
  const thetaIn = Math.atan2(dot(incoming, tangent), forward);
  const lensKick = Math.atan(-height / lens.focalLength);
  const thetaOut = thetaIn + lensKick;
  return normalize(add(
    multiply(axis, Math.cos(thetaOut)),
    multiply(tangent, Math.sin(thetaOut))
  ));
}

export function parabolicReflectorFromCenter({
  id,
  x,
  y,
  rotation = 0,
  focalLength = 120,
  aperture = 320,
  segmentCount = 72,
  reflectivity = 1
}) {
  if (!Number.isFinite(focalLength) || focalLength <= 0) throw new Error('Reflector focalLength must be > 0');
  if (!Number.isFinite(aperture) || aperture <= 0) throw new Error('Reflector aperture must be > 0');
  const count = Math.max(8, Math.round(segmentCount));
  const halfAperture = aperture / 2;
  const depth = halfAperture * halfAperture / (4 * focalLength);
  const vertexX = -depth / 2;
  const localPoints = Array.from({ length: count + 1 }, (_, index) => {
    const yy = -halfAperture + aperture * index / count;
    const xx = vertexX + yy * yy / (4 * focalLength);
    return { x: xx, y: yy };
  });
  const world = (point) => {
    const transformed = rotate(point, rotation);
    return { x: x + transformed.x, y: y + transformed.y };
  };
  const points = localPoints.map(world);
  const segments = points.slice(0, -1).map((a, index) => ({
    id: `${id}:seg:${index}`,
    reflectorId: id,
    a,
    b: points[index + 1],
    localA: localPoints[index],
    localB: localPoints[index + 1]
  }));
  const axis = directionFromAngle(rotation);
  const localFocus = { x: vertexX + focalLength, y: 0 };
  const focusOffset = rotate(localFocus, rotation);
  return {
    id,
    type: 'reflector',
    x,
    y,
    rotation,
    focalLength,
    aperture,
    segmentCount: count,
    reflectivity: clamp(reflectivity, 0, 1),
    depth,
    vertexX,
    localPoints,
    points,
    segments,
    axis,
    focus: { x: x + focusOffset.x, y: y + focusOffset.y }
  };
}

export function parabolicNormalAtPoint(reflector, worldPoint) {
  const local = inverseRotate({ x: worldPoint.x - reflector.x, y: worldPoint.y - reflector.y }, reflector.rotation);
  const localNormal = normalize({ x: -1, y: local.y / (2 * reflector.focalLength) });
  return normalize(rotate(localNormal, reflector.rotation));
}

function intersectRayCircle(origin, direction, goal) {
  const d = normalize(direction);
  const centerOffset = subtract(origin, { x: goal.x, y: goal.y });
  const radius = goal.radius ?? goal.size ?? 30;
  const b = 2 * dot(centerOffset, d);
  const c = dot(centerOffset, centerOffset) - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / 2, (-b + root) / 2].filter((value) => value > EPSILON).sort((a, b2) => a - b2);
  const distance = candidates[0];
  return distance == null ? null : { distance, point: add(origin, multiply(d, distance)) };
}

function intersectRayRect(origin, direction, goal) {
  const d = normalize(direction);
  const halfW = (goal.width ?? goal.size ?? 60) / 2;
  const halfH = (goal.height ?? goal.size ?? 60) / 2;
  const minX = goal.x - halfW;
  const maxX = goal.x + halfW;
  const minY = goal.y - halfH;
  const maxY = goal.y + halfH;
  let tMin = -Infinity;
  let tMax = Infinity;
  for (const [o, delta, min, max] of [[origin.x, d.x, minX, maxX], [origin.y, d.y, minY, maxY]]) {
    if (Math.abs(delta) < EPSILON) {
      if (o < min || o > max) return null;
      continue;
    }
    let t1 = (min - o) / delta;
    let t2 = (max - o) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMax < tMin) return null;
  }
  const distance = tMin > EPSILON ? tMin : (tMax > EPSILON ? tMax : null);
  return distance == null ? null : { distance, point: add(origin, multiply(d, distance)) };
}

function intersectRayGoal(origin, direction, goal) {
  return goal.shape === 'rect'
    ? intersectRayRect(origin, direction, goal)
    : intersectRayCircle(origin, direction, goal);
}

function wallEdges(wall) {
  return polygonEdges({ vertices: wall.vertices });
}

function containingRefractor(point, refractors) {
  for (const refractor of refractors) {
    let inside = false;
    const vertices = refractor.vertices;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
      const a = vertices[i];
      const b = vertices[j];
      const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
        point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
      if (crosses) inside = !inside;
    }
    if (inside) return refractor;
  }
  return null;
}

function nearestInteraction(origin, direction, context) {
  let nearest = null;
  const consider = (hit, kind, object, extra = {}) => {
    if (hit && (!nearest || hit.distance < nearest.distance - EPSILON)) nearest = { ...hit, kind, object, ...extra };
  };

  for (const goal of context.goals) consider(intersectRayGoal(origin, direction, goal), 'goal', goal);
  for (const mirror of context.mirrors) consider(intersectRaySegment(origin, direction, mirror), 'mirror', mirror);
  for (const splitter of context.splitters) consider(intersectRaySegment(origin, direction, splitter), 'splitter', splitter);
  for (const lens of context.lenses) consider(intersectRaySegment(origin, direction, lens), 'lens', lens);
  for (const reflector of context.reflectors) {
    for (const segment of reflector.segments) consider(intersectRaySegment(origin, direction, segment), 'reflector', reflector, { reflectorSegment: segment });
  }
  for (const refractor of context.refractors) {
    for (const edge of polygonEdges(refractor)) consider(intersectRaySegment(origin, direction, edge), 'refractor', refractor, { edge });
  }
  for (const wall of context.walls) {
    for (const edge of wallEdges(wall)) consider(intersectRaySegment(origin, direction, edge), 'wall', wall, { wallEdge: edge });
  }
  return nearest;
}

function raySegment(ray, to, kind, extra = {}) {
  return {
    from: { ...ray.origin },
    to: { ...to },
    kind,
    wavelength: ray.wavelength,
    color: cssForWavelength(ray.wavelength),
    energy: ray.energy,
    intensity: ray.energy,
    ...extra
  };
}

function pushLoss(accounting, field, value) {
  if (value > 0) accounting[field] += value;
}

function traceEnergyRay(initialRay, context, accounting, output, counter) {
  if (counter.nodes >= context.maxRayNodes) {
    accounting.terminatedEnergy += initialRay.energy;
    counter.nodeLimitHits += 1;
    return;
  }
  counter.nodes += 1;
  if (initialRay.energy < context.minEnergy) {
    accounting.culledEnergy += initialRay.energy;
    counter.culled += 1;
    return;
  }

  let ray = { ...initialRay, direction: normalize(initialRay.direction) };
  while (true) {
    if (ray.interactions >= context.maxInteractions) {
      accounting.terminatedEnergy += ray.energy;
      counter.maxInteractionStops += 1;
      return;
    }

    const nearest = nearestInteraction(ray.origin, ray.direction, context);
    const boundary = intersectRayWithBounds(ray.origin, ray.direction, context.bounds);
    if (!nearest || (boundary && boundary.distance < nearest.distance)) {
      const end = boundary?.point ?? add(ray.origin, multiply(ray.direction, 10000));
      output.segments.push(raySegment(ray, end, 'escape'));
      accounting.escapedEnergy += ray.energy;
      return;
    }

    output.segments.push(raySegment(ray, nearest.point, nearest.kind, { objectId: nearest.object.id }));

    if (nearest.kind === 'goal') {
      output.goalHits.push({
        goalId: nearest.object.id,
        sourceId: ray.sourceId,
        point: { ...nearest.point },
        energy: ray.energy,
        wavelength: ray.wavelength
      });
      accounting.goalEnergy += ray.energy;
      return;
    }

    if (nearest.kind === 'wall') {
      accounting.absorbedEnergy += ray.energy;
      output.absorptions.push({ wallId: nearest.object.id, point: { ...nearest.point }, energy: ray.energy });
      return;
    }

    if (nearest.kind === 'mirror') {
      const tangent = normalize(subtract(nearest.object.b, nearest.object.a));
      const normal = { x: -tangent.y, y: tangent.x };
      const nextDirection = reflect(ray.direction, normal);
      const reflectivity = clamp(nearest.object.reflectivity ?? 1, 0, 1);
      const nextEnergy = ray.energy * reflectivity;
      pushLoss(accounting, 'opticLossEnergy', ray.energy - nextEnergy);
      ray = {
        ...ray,
        origin: add(nearest.point, multiply(nextDirection, EPSILON * 30)),
        direction: nextDirection,
        energy: nextEnergy,
        interactions: ray.interactions + 1
      };
      continue;
    }

    if (nearest.kind === 'reflector') {
      const normal = parabolicNormalAtPoint(nearest.object, nearest.point);
      const nextDirection = reflect(ray.direction, normal);
      const nextEnergy = ray.energy * nearest.object.reflectivity;
      pushLoss(accounting, 'opticLossEnergy', ray.energy - nextEnergy);
      output.reflectorHits.push({ reflectorId: nearest.object.id, point: { ...nearest.point }, normal, outgoingDirection: nextDirection, energy: nextEnergy });
      ray = {
        ...ray,
        origin: add(nearest.point, multiply(nextDirection, EPSILON * 30)),
        direction: nextDirection,
        energy: nextEnergy,
        interactions: ray.interactions + 1
      };
      continue;
    }

    if (nearest.kind === 'lens') {
      const nextDirection = thinLensRedirect(ray.direction, nearest.point, nearest.object);
      const nextEnergy = ray.energy * nearest.object.transmission;
      pushLoss(accounting, 'opticLossEnergy', ray.energy - nextEnergy);
      output.lensHits.push({ lensId: nearest.object.id, point: { ...nearest.point }, outgoingDirection: nextDirection, energy: nextEnergy });
      ray = {
        ...ray,
        origin: add(nearest.point, multiply(nextDirection, EPSILON * 30)),
        direction: nextDirection,
        energy: nextEnergy,
        interactions: ray.interactions + 1
      };
      continue;
    }

    if (nearest.kind === 'splitter') {
      const tangent = normalize(subtract(nearest.object.b, nearest.object.a));
      const normal = { x: -tangent.y, y: tangent.x };
      const ratio = clamp(nearest.object.splitRatio ?? 0.5, 0, 1);
      const reflectedEnergy = ray.energy * ratio;
      const transmittedEnergy = ray.energy * (1 - ratio);
      const reflectedDirection = reflect(ray.direction, normal);
      const children = [
        { ...ray, origin: add(nearest.point, multiply(reflectedDirection, EPSILON * 30)), direction: reflectedDirection, energy: reflectedEnergy, interactions: ray.interactions + 1 },
        { ...ray, origin: add(nearest.point, multiply(ray.direction, EPSILON * 30)), direction: ray.direction, energy: transmittedEnergy, interactions: ray.interactions + 1 }
      ];
      for (const child of children) traceEnergyRay(child, context, accounting, output, counter);
      return;
    }

    const refractor = nearest.object;
    const entering = ray.mediumId !== refractor.id;
    const outward = nearest.edge.outwardNormal;
    const normal = entering ? outward : multiply(outward, -1);

    if (entering && ray.wavelength == null && !ray.hasDispersed) {
      const wavelengths = spectralSamples(context.spectralSampleCount);
      const energyPerSample = ray.energy / wavelengths.length;
      for (const wavelength of wavelengths) {
        const materialN = refractiveIndexAt(refractor, wavelength);
        const result = refract(ray.direction, normal, AIR_REFRACTIVE_INDEX, materialN);
        const child = {
          ...ray,
          origin: add(nearest.point, multiply(result.direction, EPSILON * 30)),
          direction: result.direction,
          wavelength,
          energy: energyPerSample,
          mediumId: result.totalInternalReflection ? ray.mediumId : refractor.id,
          hasDispersed: true,
          interactions: ray.interactions + 1
        };
        traceEnergyRay(child, context, accounting, output, counter);
      }
      return;
    }

    const wavelength = ray.wavelength ?? 589;
    const materialN = refractiveIndexAt(refractor, wavelength);
    const n1 = entering ? AIR_REFRACTIVE_INDEX : materialN;
    const n2 = entering ? materialN : AIR_REFRACTIVE_INDEX;
    const result = refract(ray.direction, normal, n1, n2);
    const transmission = clamp(refractor.transmission ?? 1, 0, 1);
    const nextEnergy = result.totalInternalReflection ? ray.energy : ray.energy * transmission;
    if (!result.totalInternalReflection) pushLoss(accounting, 'opticLossEnergy', ray.energy - nextEnergy);
    ray = {
      ...ray,
      origin: add(nearest.point, multiply(result.direction, EPSILON * 30)),
      direction: result.direction,
      energy: nextEnergy,
      mediumId: result.totalInternalReflection ? ray.mediumId : (entering ? refractor.id : null),
      interactions: ray.interactions + 1
    };
  }
}

export function evaluateConcentrationGoals(trace, goals, totalEmittedEnergy = trace.energy.emittedEnergy) {
  return goals.map((goal) => {
    const contributions = trace.goalHits.filter((hit) => hit.goalId === goal.id);
    const landedEnergy = contributions.reduce((sum, hit) => sum + hit.energy, 0);
    const concentrationPercent = totalEmittedEnergy > 0 ? landedEnergy / totalEmittedEnergy * 100 : 0;
    const requiredConcentration = goal.requiredConcentration ?? 95;
    const satisfied = concentrationPercent + 1e-9 >= requiredConcentration;
    return {
      id: goal.id,
      status: satisfied ? 'satisfied' : (landedEnergy > EPSILON ? 'partial' : 'unlit'),
      satisfied,
      concentrationPercent,
      requiredConcentration,
      landedEnergy,
      totalEmittedEnergy,
      contributions
    };
  });
}

export function checkConcentrationSolved(statuses) {
  return Array.isArray(statuses) && statuses.length > 0 && statuses.every((status) => status.satisfied);
}

export function traceDiffuseLightScene({
  lightSources,
  mirrors = [],
  splitters = [],
  refractors = [],
  lenses = [],
  reflectors = [],
  walls = [],
  goals = [],
  bounds,
  rayCountOverride = null,
  spectralSampleCount = 21,
  minEnergy = DEFAULT_MIN_ENERGY,
  maxRayNodes = DEFAULT_MAX_NODES,
  maxInteractions = DEFAULT_MAX_INTERACTIONS
}) {
  const context = {
    mirrors,
    splitters,
    refractors,
    lenses,
    reflectors,
    walls,
    goals,
    bounds,
    spectralSampleCount,
    minEnergy,
    maxRayNodes,
    maxInteractions
  };
  const output = { segments: [], goalHits: [], absorptions: [], reflectorHits: [], lensHits: [] };
  const accounting = {
    emittedEnergy: 0,
    goalEnergy: 0,
    absorbedEnergy: 0,
    escapedEnergy: 0,
    opticLossEnergy: 0,
    culledEnergy: 0,
    terminatedEnergy: 0
  };
  const counter = { nodes: 0, culled: 0, nodeLimitHits: 0, maxInteractionStops: 0, emittedRays: 0 };

  for (const source of lightSources) {
    const sourceEnergy = source.totalEnergy ?? 1;
    accounting.emittedEnergy += sourceEnergy;
    const rays = sampleLightSource({
      ...source,
      rayCount: rayCountOverride ?? source.rayCount ?? 150,
      totalEnergy: sourceEnergy
    });
    counter.emittedRays += rays.length;
    for (const baseRay of rays) {
      const containing = containingRefractor(baseRay.origin, refractors);
      traceEnergyRay({ ...baseRay, mediumId: containing?.id ?? null }, context, accounting, output, counter);
    }
  }

  const accountedEnergy = accounting.goalEnergy + accounting.absorbedEnergy + accounting.escapedEnergy +
    accounting.opticLossEnergy + accounting.culledEnergy + accounting.terminatedEnergy;
  accounting.accountedEnergy = accountedEnergy;
  accounting.accountingError = accounting.emittedEnergy - accountedEnergy;
  accounting.accountedPercent = accounting.emittedEnergy > 0 ? accountedEnergy / accounting.emittedEnergy * 100 : 0;

  const statuses = evaluateConcentrationGoals({ ...output, energy: accounting }, goals, accounting.emittedEnergy);
  return {
    ...output,
    statuses,
    energy: accounting,
    stats: counter
  };
}
