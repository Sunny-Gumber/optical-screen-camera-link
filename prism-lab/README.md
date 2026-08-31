# Prism Lab V2

A self-contained interactive optics puzzle and sandbox hosted with GitHub Pages.

## V2 highlights

- 7-level campaign plus a free sandbox lab
- Mirrors with specular reflection (`θi = θr`)
- Triangular prisms with Snell-law refraction
- Wavelength-dependent refractive index and RGB dispersion
- Total internal reflection handling
- Convex lenses using a thin-lens focusing model
- Beam splitters with transmitted and reflected branches
- Red, green, and blue optical filters
- Absorbing blockers / obstacles
- Multi-target and multi-ray objectives
- Move count, par score, stars, and local best-score saving
- Physics overlay with normals, focal points, refractive indices, and angles
- Mouse, touch, pen, keyboard, and mobile-friendly controls
- Sandbox component tray for adding/deleting optical elements
- No backend and no external runtime dependencies

## Controls

- **Drag:** move an unlocked optical component
- **Tap/click:** select a component
- **Rotate buttons / slider:** rotate the selected component
- **Double-click:** rotate by 10°
- **Arrow Left / Right:** rotate by 5°
- **Shift + Arrow:** rotate by 1°
- **R:** reset the current level
- **P:** toggle Physics View

## Physics model

The simulator is intentionally lightweight enough to run in a browser, but optical interactions are calculated rather than pre-animated. Reflection uses vector reflection, prisms calculate refraction at each polygon surface with Snell's law and wavelength-dependent refractive indices, beam splitters branch rays, filters selectively transmit wavelengths, and lenses use a thin-lens focal-point approximation.

The Spectrum Sort level uses a deliberately high-dispersion prism so spectral separation is visible at game scale; the normal prism level uses lower dispersion.

## Deployment

The repository's GitHub Pages workflow publishes this folder at:

`https://sunny-gumber.github.io/optical-screen-camera-link/prism-lab/`

## Possible V3 additions

- Concave lenses
- Concave / convex mirrors
- Diffraction gratings
- Polarizers and wave plates
- Fiber-optic total-internal-reflection puzzles
- Adjustable refractive-index materials
- Intensity / power meters
- Timed challenges and daily puzzles
- Level editor and shareable level codes
