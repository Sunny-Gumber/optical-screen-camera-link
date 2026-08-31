const EPSILON = 1e-5;
const REFERENCE_WAVELENGTH_NM = 589;
const AIR_REFRACTIVE_INDEX = 1.0;

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

export function mirrorFromCenter({ id, x, y, length: mirrorLength, rotation }) {
  const tangent = directionFromAngle(rotation);
  const half = mirrorLength / 2;
  return {
    id,
    type: 'mirror',
    a: { x: x - tangent.x * half, y: y - tangent.y * half },
    b: { x: x + tangent.x * half, y: y + tangent.y * half }
  };
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

export function intersectRaySegment(origin, direction, segment) {
  const ray = normalize(direction);
  const segmentVector = subtract(segment.b, segment.a);
  const denominator = cross(ray, segmentVector);

  if (Math.abs(denominator) < EPSILON) return null;

  const fromOriginToSegment = subtract(segment.a, origin);
  const rayDistance = cross(fromOriginToSegment, segmentVector) / denominator;
  const segmentRatio = cross(fromOriginToSegment, ray) / denominator;

  if (rayDistance <= EPSILON || segmentRatio < -EPSILON || segmentRatio > 1 + EPSILON) {
    return null;
  }

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

export function refract(rayOrDirection, surfaceNormal, n1, n2) {
  const direction = rayOrDirection.direction ?? rayOrDirection;
  const d = normalize(direction);
  let n = normalize(surfaceNormal);

  // N must point into medium 1, opposite the incident ray.
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

function findNearestInteraction(origin, direction, mirrors, refractors) {
  let nearest = null;

  for (const mirror of mirrors) {
    const hit = intersectRaySegment(origin, direction, mirror);
    if (hit && (!nearest || hit.distance < nearest.distance)) {
      nearest = { ...hit, kind: 'mirror', object: mirror };
    }
  }

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

function spectralSamples(sampleCount) {
  const count = Math.max(2, Math.round(sampleCount));
  return Array.from({ length: count }, (_, index) => 400 + (300 * index) / (count - 1));
}

function segmentColor(wavelength) {
  return wavelength == null ? 'rgba(255,255,244,1)' : rgbToCss(wavelengthToRGB(wavelength));
}

export function traceOpticalRays({
  origin,
  direction,
  mirrors = [],
  refractors = [],
  bounds,
  maxBounces = 20,
  wavelength = null,
  spectralSampleCount = 31
}) {
  const segments = [];
  const hits = [];
  const queue = [{
    origin: { ...origin },
    direction: normalize(direction),
    wavelength,
    mediumId: findContainingRefractor(origin, refractors)?.id ?? null,
    interactions: 0,
    hasDispersed: wavelength != null
  }];

  while (queue.length) {
    let ray = queue.shift();

    while (ray.interactions <= maxBounces) {
      const nearest = findNearestInteraction(ray.origin, ray.direction, mirrors, refractors);
      const boundaryHit = intersectRayWithBounds(ray.origin, ray.direction, bounds);

      if (!nearest || (boundaryHit && boundaryHit.distance < nearest.distance)) {
        const end = boundaryHit?.point ?? add(ray.origin, multiply(ray.direction, 10000));
        segments.push({
          from: ray.origin,
          to: end,
          kind: 'exit',
          wavelength: ray.wavelength,
          color: segmentColor(ray.wavelength),
          mediumId: ray.mediumId
        });
        break;
      }

      if (nearest.kind === 'mirror') {
        const normal = getMirrorNormal(nearest.object, ray.direction);
        const reflectedDirection = reflect(ray.direction, normal);
        const incidenceRadians = Math.acos(Math.min(1, Math.max(-1, -dot(ray.direction, normal))));
        segments.push({
          from: ray.origin,
          to: nearest.point,
          kind: 'reflection',
          mirrorId: nearest.object.id,
          wavelength: ray.wavelength,
          color: segmentColor(ray.wavelength),
          mediumId: ray.mediumId
        });
        hits.push({
          type: 'reflection',
          point: nearest.point,
          mirrorId: nearest.object.id,
          normal,
          incomingDirection: ray.direction,
          outgoingDirection: reflectedDirection,
          incidenceRadians,
          reflectionRadians: incidenceRadians,
          wavelength: ray.wavelength,
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

      const refractor = nearest.object;
      const entering = ray.mediumId !== refractor.id;
      const normal = entering ? nearest.edge.outwardNormal : multiply(nearest.edge.outwardNormal, -1);

      // White light remains white in air, then branches only at first air->glass boundary.
      if (entering && ray.wavelength == null && !ray.hasDispersed) {
        segments.push({
          from: ray.origin,
          to: nearest.point,
          kind: 'dispersion-entry',
          refractorId: refractor.id,
          wavelength: null,
          color: segmentColor(null),
          mediumId: ray.mediumId
        });

        for (const sampleWavelength of spectralSamples(spectralSampleCount)) {
          const n2 = refractiveIndexAt(refractor, sampleWavelength);
          const result = refract(ray.direction, normal, AIR_REFRACTIVE_INDEX, n2);
          hits.push({
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
            entering: true
          });
          queue.push({
            origin: add(nearest.point, multiply(result.direction, EPSILON * 30)),
            direction: result.direction,
            wavelength: sampleWavelength,
            mediumId: result.totalInternalReflection ? null : refractor.id,
            interactions: ray.interactions + 1,
            hasDispersed: true
          });
        }
        break;
      }

      const effectiveWavelength = ray.wavelength ?? REFERENCE_WAVELENGTH_NM;
      const materialIndex = refractiveIndexAt(refractor, effectiveWavelength);
      const n1 = entering ? AIR_REFRACTIVE_INDEX : materialIndex;
      const n2 = entering ? materialIndex : AIR_REFRACTIVE_INDEX;
      const result = refract(ray.direction, normal, n1, n2);
      const nextMediumId = result.totalInternalReflection
        ? ray.mediumId
        : (entering ? refractor.id : null);

      segments.push({
        from: ray.origin,
        to: nearest.point,
        kind: result.totalInternalReflection ? 'tir' : 'refraction',
        refractorId: refractor.id,
        wavelength: ray.wavelength,
        color: segmentColor(ray.wavelength),
        mediumId: ray.mediumId
      });
      hits.push({
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
  }

  return { segments, hits };
}

function findContainingRefractor(point, refractors) {
  return refractors.find((refractor) => isInsideMedium(point, refractor)) ?? null;
}

export function traceReflectionRay({ origin, direction, mirrors, bounds, maxBounces = 20 }) {
  const result = traceOpticalRays({ origin, direction, mirrors, refractors: [], bounds, maxBounces });
  return { segments: result.segments, hits: result.hits };
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
