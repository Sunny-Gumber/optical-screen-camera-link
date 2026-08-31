# Prism Lab V3 — Stage 2

Stage 2 extends the Stage 1 reflection engine in the **same physics module** with refraction, total internal reflection, and wavelength-based dispersion. The live Prism Lab V2 remains separate.

## Physics included

- Stage 1 mirror reflection remains supported and regression-tested
- Convex polygon `refractor` pieces with per-edge surface normals
- Air ↔ glass medium tracking across polygon boundaries
- Vector-form Snell refraction
- Total internal reflection using the Stage 1 reflection function
- Shared max-20 optical interaction safety limit
- Cauchy material model `n(λ) = A + B / λ²`
- `refractiveIndexBase` anchored at 589 nm
- `dispersionCoefficient` stored in nm²
- White light stays white in air and splits only at its first air→glass boundary
- Configurable 400–700 nm spectral sampling
- Visible wavelength → RGB conversion
- Precomputed segment colors; Canvas contains no Snell/Cauchy calculations

## Public physics APIs added

- `refract(ray, surfaceNormal, n1, n2)`
- `cauchyIndex(wavelength, A, B)`
- `deriveCauchyA(refractiveIndexBase, dispersionCoefficient)`
- `refractiveIndexAt(refractor, wavelength)`
- `wavelengthToRGB(wavelength)`
- `isInsideMedium(point, polygon)`
- `refractorFromCenter(...)`
- `traceOpticalRays(...)`

`traceReflectionRay(...)` now delegates to the unified optical tracer, preserving Stage 1 behavior rather than maintaining a parallel engine.

## Automated verification

The Stage 2 suite contains **21 tests** covering:

- all six Stage 1 reflection regressions
- normal incidence
- known 30° Snell-law refraction
- TIR above the critical angle
- non-TIR just below the critical angle
- Cauchy base-index and wavelength ordering
- wavelength/RGB sanity
- point-in-polygon medium detection
- flat slab enter/exit behavior
- delayed white-light spectral split
- parallel-edge safety
- prism dispersion ordering (400 nm deviates more than 700 nm)
- double refraction through a prism
- exact prism-vertex hit safety
- integrated TIR inside a refractor

## Diagnostic UI / manual QA presets

The Stage 2 scene intentionally includes only QA-specific refractor manipulation, not the general Stage 4 piece-interaction system.

### Prism dispersion

White emitter + triangular glass prism. Drag the prism and use the rotation slider to inspect live 400–700 nm spread and rotation continuity.

### Flat slab / known angle

Monochromatic 550 nm source into a flat glass slab. At 0° the ray should pass straight through. Set the emitter to 45° with `n = 1.500`; the displayed transmitted angle should be about 28.1°.

### Total internal reflection

The source begins inside a tall glass block at 50°. With `n = 1.500`, the ray hits a glass→air boundary above the ~41.8° critical angle and internally reflects.

The panel also exposes material index, dispersion coefficient, spectral sample count, normals, hit points, angle labels, segment count, interaction count, spectral ray count, and per-frame trace/render cost.

## Run

```bash
npm install
npm test
npm run dev
```

## Scope intentionally deferred

Do **not** add beam splitters, goal-zone detection, the general draggable/rotatable puzzle-piece system, JSON levels, level editor, progression, solve feedback, or final mobile optimization in Stage 2. Those remain Stage 3+ per the master roadmap.
