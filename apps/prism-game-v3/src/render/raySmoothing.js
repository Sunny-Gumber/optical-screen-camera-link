const clonePoint = (point) => ({ x: point.x, y: point.y });
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

function cloneSegment(segment) {
  return {
    ...segment,
    from: clonePoint(segment.from),
    to: clonePoint(segment.to),
    displayIntensity: segment.intensity ?? 1
  };
}

export class RaySmoother {
  constructor({ durationMs = 130 } = {}) {
    this.durationMs = durationMs;
    this.current = [];
    this.lastTime = null;
  }

  reset(segments = []) {
    this.current = segments.map(cloneSegment);
    this.lastTime = null;
    return this.current;
  }

  update(targetSegments, now = performanceNow()) {
    if (!this.current.length) {
      this.current = targetSegments.map(cloneSegment);
      this.lastTime = now;
      return this.current;
    }

    const dt = this.lastTime == null ? 16 : Math.max(0, Math.min(80, now - this.lastTime));
    this.lastTime = now;
    const factor = 1 - Math.pow(0.01, dt / this.durationMs);
    const next = [];
    const count = Math.max(this.current.length, targetSegments.length);

    for (let index = 0; index < count; index += 1) {
      const current = this.current[index];
      const target = targetSegments[index];

      if (target && current) {
        next.push({
          ...target,
          from: lerpPoint(current.from, target.from, factor),
          to: lerpPoint(current.to, target.to, factor),
          displayIntensity: lerp(current.displayIntensity ?? current.intensity ?? 1, target.intensity ?? 1, factor)
        });
        continue;
      }

      if (target && !current) {
        next.push({
          ...target,
          from: clonePoint(target.from),
          to: lerpPoint(target.from, target.to, factor),
          displayIntensity: lerp(0, target.intensity ?? 1, factor)
        });
        continue;
      }

      if (current && !target) {
        const faded = {
          ...current,
          to: lerpPoint(current.to, current.from, factor),
          displayIntensity: lerp(current.displayIntensity ?? current.intensity ?? 1, 0, factor)
        };
        if (faded.displayIntensity > 0.015 || Math.hypot(faded.to.x - faded.from.x, faded.to.y - faded.from.y) > 0.7) {
          next.push(faded);
        }
      }
    }

    this.current = next;
    return this.current;
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
