# Prism Lab V3 — Stage 1

This branch implements only **Stage 1** of the new master game brief: an isolated reflection-only ray engine plus a visual test scene.

## Included

- Vite + vanilla JavaScript project
- Pure 2D vector ray-tracing module
- Ray/line-segment intersection
- Nearest-hit selection
- Law-of-reflection vector math
- Boundary exit handling
- Max-bounce protection
- Per-hit incidence/reflection diagnostics
- Unit tests for intersections, mirror geometry, bounce selection, and reflection equality
- 60fps Canvas test scene with emitter-angle control
- Static-host-friendly Vite base path

## Run

```bash
npm install
npm test
npm run dev
```

## Scope intentionally deferred

Prisms/refraction, dispersion, splitters, goals, dragging/rotation, JSON levels, editor, progression, solve feedback, and the final mobile performance pass belong to later stages of the agreed roadmap.
