const EPSILON = 1e-5;

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

export function traceReflectionRay({
  origin,
  direction,
  mirrors,
  bounds,
  maxBounces = 20
}) {
  let currentOrigin = { ...origin };
  let currentDirection = normalize(direction);
  const segments = [];
  const hits = [];

  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    let nearestHit = null;
    let nearestMirror = null;

    for (const mirror of mirrors) {
      const hit = intersectRaySegment(currentOrigin, currentDirection, mirror);
      if (hit && (!nearestHit || hit.distance < nearestHit.distance)) {
        nearestHit = hit;
        nearestMirror = mirror;
      }
    }

    const boundaryHit = intersectRayWithBounds(currentOrigin, currentDirection, bounds);

    if (!nearestHit || (boundaryHit && boundaryHit.distance < nearestHit.distance)) {
      const end = boundaryHit?.point ?? add(currentOrigin, multiply(currentDirection, 10000));
      segments.push({ from: currentOrigin, to: end, kind: 'exit' });
      break;
    }

    const normal = getMirrorNormal(nearestMirror, currentDirection);
    const reflectedDirection = reflect(currentDirection, normal);
    const incidenceRadians = Math.acos(Math.min(1, Math.max(-1, -dot(currentDirection, normal))));

    segments.push({
      from: currentOrigin,
      to: nearestHit.point,
      kind: 'reflection',
      mirrorId: nearestMirror.id
    });

    hits.push({
      point: nearestHit.point,
      mirrorId: nearestMirror.id,
      normal,
      incomingDirection: currentDirection,
      outgoingDirection: reflectedDirection,
      incidenceRadians,
      reflectionRadians: incidenceRadians
    });

    currentDirection = reflectedDirection;
    currentOrigin = add(nearestHit.point, multiply(reflectedDirection, EPSILON * 20));
  }

  return { segments, hits };
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
