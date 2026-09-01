const EPSILON = 1e-5;
const REFERENCE_WAVELENGTH_NM = 589;
const AIR_REFRACTIVE_INDEX = 1.0;
const DEFAULT_MIN_INTENSITY = 0.02;
const DEFAULT_MAX_RAY_NODES = 4096;

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function multiply(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(v) {
  return Math.hypot(v.x, v.y);
}

export function normalize(v) {
  const size = length(v);
  if (size < EPSILON) throw new Error('Cannot normalize a zero-length vector.');
  return { x: v.x / size, y: v.y / size };
}

export function directionFromAngle(angleRadians) {
  return { x: Math.cos(angleRadians), y: Math.sin(angleRadians) };
}

function segmentFromCenter({ id, type, x, y, length: segmentLength, rotation, ...extra }) {
  const tangent = directionFromAngle(rotation);
  const half = segmentLength / 2;
  return {
    id,
    type,
    a: { x: x - tangent.x * half, y: y - tangent.y * half },
    b: { x: x + tangent.x * half, y: y + tangent.y * half },
    x,
    y,
    rotation,
    length: segmentLength,
    ...extra
  };
}

export function mirrorFromCenter(options) {
  return segmentFromCenter({ ...options, type: 'mirror' });
}

export function splitterFromCenter({ splitRatio = 0.5, ...options }) {
  return segmentFromCenter({
    ...options,
    type: 'splitter',
    splitRatio: Math.min(1, Math.max(0, splitRatio))
  });
}

export function refractorFromCenter({
  id,
  x,
  y,
  rotation = 0,
  vertices,
  refractiveIndexBase = 1.52,
  dispersionCoefficient = 4200
}) {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    throw new Error('A refractor requires at least three polygon vertices.');
  }
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const worldVertices = vertices.map((vertex) => ({
    x: x + vertex.x * cos - vertex.y * sin,
    y: y + vertex.x * sin + vertex.y * cos
  }));
  return {
    id,
    type: 'refractor',
    x,
    y,
    rotation,
    vertices: worldVertices,
    localVertices: vertices.map((vertex) => ({ ...vertex })),
    refractiveIndexBase,
    dispersionCoefficient
  };
}

export function goalCircle({
  id,
  x,
  y,
  radius = 28,
  requiredColor = 'any',
  requiredIntensity = 0.3
}) {
  return { id, type: 'goal', shape: 'circle', x, y, radius, requiredColor, requiredIntensity };
}

export function goalRect({
  id,
  x,
  y,
  width = 56,
  height = 56,
  requiredColor = 'any',
  requiredIntensity = 0.3
}) {
  return { id, type: 'goal', shape: 'rect', x, y, width, height, requiredColor, requiredIntensity };
}

export function intersectRaySegment(origin, direction, segment) {
  const ray = normalize(direction);
  const segmentVector = subtract(segment.b, segment.a);
  const denominator = cross(ray, segmentVector);
  if (Math.abs(denominator) < EPSILON) return null;

  const fromOriginToSegment = subtract(segment.a, origin);
  const rayDistance = cross(fromOriginToSegment, segmentVector) / denominator;
  const segmentRatio = cross(fromOriginToSegment, ray) / denominator;
  if (rayDistance <= EPSILON || segmentRatio < -EPSILON || segmentRatio > 1 + EPSILON) return null;

  return {
    distance: rayDistance,
    segmentRatio,
    point: add(origin, multiply(ray, rayDistance))
  };
}

export function getMirrorNormal(segment, incomingDirection) {
  const tangent = normalize(subtract(segment.b, segment.a));
  let normal = { x: -tangent.y, y: tangent.x };
  if (dot(incomingDirection, normal) > 0) normal = multiply(normal, -1);
  return normal;
}

export function reflect(direction, normal) {
  const d = normalize(direction);
  const n = normalize(normal);
  return normalize(subtract(d, multiply(n, 2 * dot(d, n))));
}

export function splitRay(ray, surfaceNormal, splitRatio = 0.5) {
  const ratio = Math.min(1, Math.max(0, splitRatio));
  const base = {
    wavelength: ray.wavelength ?? null,
    mediumId: ray.mediumId ?? null,
    hasDispersed: Boolean(ray.hasDispersed),
    spectralWeight: ray.spectralWeight ?? 1,
    interactions: ray.interactions ?? 0
  };
  return {
    reflected: {
      ...base,
      direction: reflect(ray.direction, surfaceNormal),
      intensity: (ray.intensity ?? 1) * ratio
    },
    transmitted: {
      ...base,
      direction: normalize(ray.direction),
      intensity: (ray.intensity ?? 1) * (1 - ratio)
    }
  };
}

export function refract(rayOrDirection, surfaceNormal, n1, n2) {
  const direction = rayOrDirection.direction ?? rayOrDirection;
  const d = normalize(direction);
  let n = normalize(surfaceNormal);
  if (dot(d, n) > 0) n = multiply(n, -1);

  const eta = n1 / n2;
  const cosTheta1 = Math.min(1, Math.max(0, -dot(d, n)));
  const sinTheta2Squared = eta * eta * Math.max(0, 1 - cosTheta1 * cosTheta1);
  const incidenceRadians = Math.acos(cosTheta1);
  const criticalAngleRadians = n1 > n2 ? Math.asin(Math.min(1, n2 / n1)) : null;

  if (sinTheta2Squared > 1 - EPSILON) {
    return {
      direction: reflect(d, n),
      totalInternalReflection: true,
      incidenceRadians,
      refractionRadians: null,
      criticalAngleRadians
    };
  }

  const cosTheta2 = Math.sqrt(Math.max(0, 1 - sinTheta2Squared));
  const transmitted = normalize(add(
    multiply(d, eta),
    multiply(n, eta * cosTheta1 - cosTheta2)
  ));

  return {
    direction: transmitted,
    totalInternalReflection: false,
    incidenceRadians,
    refractionRadians: Math.acos(Math.min(1, Math.max(-1, -dot(transmitted, n)))),
    criticalAngleRadians
  };
}

export function deriveCauchyA(refractiveIndexBase, dispersionCoefficient, referenceWavelength = REFERENCE_WAVELENGTH_NM) {
  return refractiveIndexBase - dispersionCoefficient / (referenceWavelength * referenceWavelength);
}

export function cauchyIndex(wavelength, A, B) {
  if (!Number.isFinite(wavelength) || wavelength <= 0) throw new Error('Wavelength must be a positive finite number.');
  return A + B / (wavelength * wavelength);
}

export function refractiveIndexAt(refractor, wavelength = REFERENCE_WAVELENGTH_NM) {
  const A = deriveCauchyA(refractor.refractiveIndexBase, refractor.dispersionCoefficient);
  return cauchyIndex(wavelength, A, refractor.dispersionCoefficient);
}

// Standard visible-spectrum wavelength approximation (Dan Bruton-style piecewise mapping).
export function wavelengthToRGB(wavelength) {
  const wl = Math.min(780, Math.max(380, wavelength));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (wl >= 380 && wl < 440) {
    red = -(wl - 440) / 60;
    blue = 1;
  } else if (wl < 490) {
    green = (wl - 440) / 50;
    blue = 1;
  } else if (wl < 510) {
    green = 1;
    blue = -(wl - 510) / 20;
  } else if (wl < 580) {
    red = (wl - 510) / 70;
    green = 1;
  } else if (wl < 645) {
    red = 1;
    green = -(wl - 645) / 65;
  } else {
    red = 1;
  }

  let factor = 1;
  if (wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
  else if (wl > 700) factor = 0.3 + 0.7 * (780 - wl) / 80;

  const gamma = 0.8;
  const toChannel = (value) => value <= 0 ? 0 : Math.round(255 * Math.pow(value * factor, gamma));
  return { r: toChannel(red), g: toChannel(green), b: toChannel(blue) };
}

export function rgbToCss({ r, g, b }, alpha = 1) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isInsideMedium(point, polygon) {
  const vertices = Array.isArray(polygon) ? polygon : polygon.vertices;
  if (!vertices || vertices.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonSignedArea(vertices) {
  let area2 = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 / 2;
}

export function polygonEdges(refractor) {
  const ccw = polygonSignedArea(refractor.vertices) > 0;
  return refractor.vertices.map((a, edgeIndex) => {
    const b = refractor.vertices[(edgeIndex + 1) % refractor.vertices.length];
    const tangent = normalize(subtract(b, a));
    const outwardNormal = ccw
      ? { x: tangent.y, y: -tangent.x }
      : { x: -tangent.y, y: tangent.x };
    return { a, b, edgeIndex, tangent, outwardNormal };
  });
}

function findNearestInteraction(origin, direction, mirrors, splitters, refractors) {
  let nearest = null;

  const considerSegment = (object, kind) => {
    const hit = intersectRaySegment(origin, direction, object);
    if (hit && (!nearest || hit.distance < nearest.distance - EPSILON)) {
      nearest = { ...hit, kind, object };
    }
  };

  for (const mirror of mirrors) considerSegment(mirror, 'mirror');
  for (const splitter of splitters) considerSegment(splitter, 'splitter');

  for (const refractor of refractors) {
    for (const edge of polygonEdges(refractor)) {
      const hit = intersectRaySegment(origin, direction, edge);
      if (hit && (!nearest || hit.distance < nearest.distance - EPSILON)) {
        nearest = { ...hit, kind: 'refractor', object: refractor, edge };
      }
    }
  }

  return nearest;
}

export function spectralSamples(sampleCount) {
  const count = Math.max(2, Math.round(sampleCount));
  return Array.from({ length: count }, (_, index) => 400 + (300 * index) / (count - 1));
}

function segmentColor(wavelength) {
  return wavelength == null ? 'rgba(255,255,244,1)' : rgbToCss(wavelengthToRGB(wavelength));
}

function findContainingRefractor(point, refractors) {
  return refractors.find((refractor) => isInsideMedium(point, refractor)) ?? null;
}

function makeNode(ray) {
  return {
    ray: {
      origin: { ...ray.origin },
      direction: { ...ray.direction },
      wavelength: ray.wavelength,
      intensity: ray.intensity,
      spectralWeight: ray.spectralWeight,
      mediumId: ray.mediumId,
      interactions: ray.interactions
    },
    segments: [],
    hits: [],
    children: [],
    terminated: null
  };
}

function pushSegment(node, ray, to, kind, extra = {}) {
  node.segments.push({
    from: { ...ray.origin },
    to: { ...to },
    kind,
    wavelength: ray.wavelength,
    color: segmentColor(ray.wavelength),
    intensity: ray.intensity,
    spectralWeight: ray.spectralWeight,
    mediumId: ray.mediumId,
    ...extra
  });
}

function traceRayNode(initialRay, context, counter) {
  const node = makeNode(initialRay);
  if (counter.count >= context.maxRayNodes) {
    node.terminated = 'node-limit';
    counter.nodeLimitHits += 1;
    return node;
  }
  counter.count += 1;

  if (initialRay.intensity < context.minIntensity) {
    node.terminated = 'intensity-cull';
    counter.culled += 1;
    return node;
  }

  let ray = { ...initialRay, direction: normalize(initialRay.direction) };

  while (true) {
    if (ray.interactions >= context.maxBounces) {
      node.terminated = 'max-bounces';
      counter.maxBounceStops += 1;
      break;
    }

    const nearest = findNearestInteraction(
      ray.origin,
      ray.direction,
      context.mirrors,
      context.splitters,
      context.refractors
    );
    const boundaryHit = intersectRayWithBounds(ray.origin, ray.direction, context.bounds);

    if (!nearest || (boundaryHit && boundaryHit.distance < nearest.distance)) {
      const end = boundaryHit?.point ?? add(ray.origin, multiply(ray.direction, 10000));
      pushSegment(node, ray, end, 'exit');
      node.terminated = 'boundary';
      break;
    }

    if (nearest.kind === 'mirror') {
      const normal = getMirrorNormal(nearest.object, ray.direction);
      const reflectedDirection = reflect(ray.direction, normal);
      const incidenceRadians = Math.acos(Math.min(1, Math.max(-1, -dot(ray.direction, normal))));
      pushSegment(node, ray, nearest.point, 'reflection', { mirrorId: nearest.object.id });
      node.hits.push({
        type: 'reflection',
        point: nearest.point,
        mirrorId: nearest.object.id,
        normal,
        incomingDirection: ray.direction,
        outgoingDirection: reflectedDirection,
        incidenceRadians,
        reflectionRadians: incidenceRadians,
        wavelength: ray.wavelength,
        intensity: ray.intensity,
        spectralWeight: ray.spectralWeight,
        mediumId: ray.mediumId
      });
      ray = {
        ...ray,
        direction: reflectedDirection,
        origin: add(nearest.point, multiply(reflectedDirection, EPSILON * 30)),
        interactions: ray.interactions + 1
      };
      continue;
    }

    if (nearest.kind === 'splitter') {
      const normal = getMirrorNormal(nearest.object, ray.direction);
      const children = splitRay(ray, normal, nearest.object.splitRatio);
      pushSegment(node, ray, nearest.point, 'splitter', { splitterId: nearest.object.id });
      const hit = {
        type: 'splitter',
        point: nearest.point,
        splitterId: nearest.object.id,
        normal,
        incomingDirection: ray.direction,
        splitRatio: nearest.object.splitRatio,
        incomingIntensity: ray.intensity,
        reflectedIntensity: children.reflected.intensity,
        transmittedIntensity: children.transmitted.intensity,
        wavelength: ray.wavelength,
        mediumId: ray.mediumId
      };
      node.hits.push(hit);

      for (const child of [children.reflected, children.transmitted]) {
        if (child.intensity < context.minIntensity) {
          counter.culled += 1;
          continue;
        }
        const childRay = {
          ...child,
          origin: add(nearest.point, multiply(child.direction, EPSILON * 30)),
          interactions: ray.interactions + 1
        };
        node.children.push(traceRayNode(childRay, context, counter));
      }
      node.terminated = 'splitter-branch';
      break;
    }

    const refractor = nearest.object;
    const entering = ray.mediumId !== refractor.id;
    const normal = entering ? nearest.edge.outwardNormal : multiply(nearest.edge.outwardNormal, -1);

    // White light remains a single full-spectrum ray in air, then branches at first air→glass boundary.
    if (entering && ray.wavelength == null && !ray.hasDispersed) {
      pushSegment(node, ray, nearest.point, 'dispersion-entry', { refractorId: refractor.id });
      const samples = spectralSamples(context.spectralSampleCount);
      for (const sampleWavelength of samples) {
        const n2 = refractiveIndexAt(refractor, sampleWavelength);
        const result = refract(ray.direction, normal, AIR_REFRACTIVE_INDEX, n2);
        node.hits.push({
          type: result.totalInternalReflection ? 'tir' : 'refraction',
          point: nearest.point,
          refractorId: refractor.id,
          edgeIndex: nearest.edge.edgeIndex,
          normal,
          incomingDirection: ray.direction,
          outgoingDirection: result.direction,
          incidenceRadians: result.incidenceRadians,
          refractionRadians: result.refractionRadians,
          criticalAngleRadians: result.criticalAngleRadians,
          n1: AIR_REFRACTIVE_INDEX,
          n2,
          wavelength: sampleWavelength,
          intensity: ray.intensity,
          spectralWeight: ray.spectralWeight / samples.length,
          entering: true
        });
        const childRay = {
          origin: add(nearest.point, multiply(result.direction, EPSILON * 30)),
          direction: result.direction,
          wavelength: sampleWavelength,
          intensity: ray.intensity,
          spectralWeight: ray.spectralWeight / samples.length,
          mediumId: result.totalInternalReflection ? null : refractor.id,
          interactions: ray.interactions + 1,
          hasDispersed: true
        };
        node.children.push(traceRayNode(childRay, context, counter));
      }
      node.terminated = 'dispersion-branch';
      break;
    }

    const effectiveWavelength = ray.wavelength ?? REFERENCE_WAVELENGTH_NM;
    const materialIndex = refractiveIndexAt(refractor, effectiveWavelength);
    const n1 = entering ? AIR_REFRACTIVE_INDEX : materialIndex;
    const n2 = entering ? materialIndex : AIR_REFRACTIVE_INDEX;
    const result = refract(ray.direction, normal, n1, n2);
    const nextMediumId = result.totalInternalReflection ? ray.mediumId : (entering ? refractor.id : null);

    pushSegment(node, ray, nearest.point, result.totalInternalReflection ? 'tir' : 'refraction', { refractorId: refractor.id });
    node.hits.push({
      type: result.totalInternalReflection ? 'tir' : 'refraction',
      point: nearest.point,
      refractorId: refractor.id,
      edgeIndex: nearest.edge.edgeIndex,
      normal,
      incomingDirection: ray.direction,
      outgoingDirection: result.direction,
      incidenceRadians: result.incidenceRadians,
      refractionRadians: result.refractionRadians,
      criticalAngleRadians: result.criticalAngleRadians,
      n1,
      n2,
      wavelength: ray.wavelength,
      intensity: ray.intensity,
      spectralWeight: ray.spectralWeight,
      entering
    });

    ray = {
      ...ray,
      origin: add(nearest.point, multiply(result.direction, EPSILON * 30)),
      direction: result.direction,
      mediumId: nextMediumId,
      interactions: ray.interactions + 1
    };
  }

  return node;
}

export function flattenRayTree(rayTree) {
  const segments = [];
  const hits = [];
  const nodes = [];
  const walk = (node) => {
    if (!node) return;
    nodes.push(node);
    segments.push(...(node.segments ?? []));
    hits.push(...(node.hits ?? []));
    for (const child of node.children ?? []) walk(child);
  };
  walk(rayTree);
  return { segments, hits, nodes };
}

export function combineRayTrees(rayTrees) {
  return {
    ray: null,
    segments: [],
    hits: [],
    children: rayTrees.filter(Boolean),
    terminated: 'scene-root'
  };
}

export function traceOpticalRays({
  origin,
  direction,
  mirrors = [],
  splitters = [],
  refractors = [],
  bounds,
  maxBounces = 20,
  wavelength = null,
  spectralSampleCount = 31,
  intensity = 1,
  minIntensity = DEFAULT_MIN_INTENSITY,
  maxRayNodes = DEFAULT_MAX_RAY_NODES
}) {
  const context = {
    mirrors,
    splitters,
    refractors,
    bounds,
    maxBounces,
    spectralSampleCount,
    minIntensity,
    maxRayNodes
  };
  const counter = { count: 0, culled: 0, nodeLimitHits: 0, maxBounceStops: 0 };
  const rayTree = traceRayNode({
    origin: { ...origin },
    direction: normalize(direction),
    wavelength,
    intensity,
    spectralWeight: 1,
    mediumId: findContainingRefractor(origin, refractors)?.id ?? null,
    interactions: 0,
    hasDispersed: wavelength != null
  }, context, counter);
  const flat = flattenRayTree(rayTree);
  return {
    rayTree,
    segments: flat.segments,
    hits: flat.hits,
    stats: {
      rayNodes: flat.nodes.length,
      culledRays: counter.culled,
      nodeLimitHits: counter.nodeLimitHits,
      maxBounceStops: counter.maxBounceStops
    }
  };
}

function closestPointOnSegment(point, a, b) {
  const ab = subtract(b, a);
  const denom = dot(ab, ab);
  if (denom < EPSILON) return { ...a };
  const t = Math.min(1, Math.max(0, dot(subtract(point, a), ab) / denom));
  return add(a, multiply(ab, t));
}

function segmentIntersectsGoal(segment, goal) {
  if (goal.shape === 'rect') {
    const halfW = goal.width / 2;
    const halfH = goal.height / 2;
    const minX = goal.x - halfW;
    const maxX = goal.x + halfW;
    const minY = goal.y - halfH;
    const maxY = goal.y + halfH;
    const inside = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    if (inside(segment.from) || inside(segment.to)) return true;
    const edges = [
      { a: { x: minX, y: minY }, b: { x: maxX, y: minY } },
      { a: { x: maxX, y: minY }, b: { x: maxX, y: maxY } },
      { a: { x: maxX, y: maxY }, b: { x: minX, y: maxY } },
      { a: { x: minX, y: maxY }, b: { x: minX, y: minY } }
    ];
    const dir = subtract(segment.to, segment.from);
    return edges.some((edge) => {
      const hit = intersectRaySegment(segment.from, dir, edge);
      return hit && hit.distance <= length(dir) + EPSILON;
    });
  }

  const radius = goal.radius ?? 28;
  const closest = closestPointOnSegment({ x: goal.x, y: goal.y }, segment.from, segment.to);
  return length(subtract(closest, { x: goal.x, y: goal.y })) <= radius + EPSILON;
}

function colorRange(requiredColor) {
  if (Array.isArray(requiredColor) && requiredColor.length === 2) return requiredColor;
  if (requiredColor && typeof requiredColor === 'object' && Number.isFinite(requiredColor.min) && Number.isFinite(requiredColor.max)) {
    return [requiredColor.min, requiredColor.max];
  }
  const ranges = {
    violet: [400, 450],
    blue: [450, 495],
    cyan: [480, 510],
    green: [495, 570],
    yellow: [570, 590],
    orange: [590, 620],
    red: [620, 700]
  };
  return ranges[String(requiredColor).toLowerCase()] ?? null;
}

function goalContributionEnergy(segment) {
  return Math.max(0, segment.intensity ?? 1) * Math.max(0, segment.spectralWeight ?? 1);
}

export function evaluateGoals(rayTree, goals) {
  const { segments } = flattenRayTree(rayTree);
  return goals.map((goal) => {
    const contributions = segments
      .filter((segment) => segmentIntersectsGoal(segment, goal))
      .map((segment) => ({
        wavelength: segment.wavelength,
        intensity: segment.intensity ?? 1,
        spectralWeight: segment.spectralWeight ?? 1,
        energy: goalContributionEnergy(segment),
        kind: segment.kind
      }));

    const requiredIntensity = goal.requiredIntensity ?? 0.3;
    const totalEnergy = contributions.reduce((sum, c) => sum + c.energy, 0);
    let matchingEnergy = 0;
    let satisfied = false;
    let whiteCoverage = null;
    let whiteBalance = null;
    const required = goal.requiredColor ?? 'any';

    if (String(required).toLowerCase() === 'any') {
      matchingEnergy = totalEnergy;
      satisfied = matchingEnergy + EPSILON >= requiredIntensity;
    } else if (String(required).toLowerCase() === 'white') {
      const directWhiteEnergy = contributions
        .filter((c) => c.wavelength == null)
        .reduce((sum, c) => sum + c.energy, 0);

      const bins = Array.from({ length: 6 }, () => 0);
      for (const contribution of contributions) {
        if (contribution.wavelength == null) continue;
        const index = Math.min(5, Math.max(0, Math.floor((contribution.wavelength - 400) / 50)));
        bins[index] += contribution.energy;
      }
      const spectralEnergy = bins.reduce((sum, value) => sum + value, 0);
      const positive = bins.filter((value) => value > Math.max(EPSILON, spectralEnergy * 0.04));
      whiteCoverage = positive.length / bins.length;
      whiteBalance = positive.length === bins.length
        ? Math.min(...positive) / Math.max(...positive)
        : 0;
      matchingEnergy = Math.max(directWhiteEnergy, spectralEnergy);
      satisfied = directWhiteEnergy + EPSILON >= requiredIntensity || (
        spectralEnergy + EPSILON >= requiredIntensity &&
        whiteCoverage >= 1 &&
        whiteBalance >= 0.35
      );
    } else {
      const range = colorRange(required);
      if (range) {
        matchingEnergy = contributions
          .filter((c) => c.wavelength != null && c.wavelength >= range[0] && c.wavelength <= range[1])
          .reduce((sum, c) => sum + c.energy, 0);
      }
      satisfied = matchingEnergy + EPSILON >= requiredIntensity;
    }

    return {
      id: goal.id,
      status: satisfied ? 'satisfied' : (totalEnergy > EPSILON ? 'partial' : 'unlit'),
      satisfied,
      requiredColor: required,
      requiredIntensity,
      totalIntensity: totalEnergy,
      matchingIntensity: matchingEnergy,
      whiteCoverage,
      whiteBalance,
      contributions
    };
  });
}

export function checkLevelSolved(goalStatuses) {
  return Array.isArray(goalStatuses) && goalStatuses.length > 0 && goalStatuses.every((goal) => goal.satisfied || goal.status === 'satisfied');
}

export function traceReflectionRay({ origin, direction, mirrors, bounds, maxBounces = 20 }) {
  const result = traceOpticalRays({ origin, direction, mirrors, refractors: [], splitters: [], bounds, maxBounces });
  return { segments: result.segments, hits: result.hits, rayTree: result.rayTree, stats: result.stats };
}

export function intersectRayWithBounds(origin, direction, bounds) {
  const d = normalize(direction);
  const candidates = [];

  const addCandidate = (distance, x, y) => {
    if (
      distance > EPSILON &&
      x >= bounds.minX - EPSILON && x <= bounds.maxX + EPSILON &&
      y >= bounds.minY - EPSILON && y <= bounds.maxY + EPSILON
    ) {
      candidates.push({ distance, point: { x, y } });
    }
  };

  if (Math.abs(d.x) > EPSILON) {
    let t = (bounds.minX - origin.x) / d.x;
    addCandidate(t, bounds.minX, origin.y + d.y * t);
    t = (bounds.maxX - origin.x) / d.x;
    addCandidate(t, bounds.maxX, origin.y + d.y * t);
  }

  if (Math.abs(d.y) > EPSILON) {
    let t = (bounds.minY - origin.y) / d.y;
    addCandidate(t, origin.x + d.x * t, bounds.minY);
    t = (bounds.maxY - origin.y) / d.y;
    addCandidate(t, origin.x + d.x * t, bounds.maxY);
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0] ?? null;
}
