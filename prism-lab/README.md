# Prism Lab V1

A self-contained browser optics puzzle hosted with GitHub Pages.

## V1 features

- 4 playable mirror-reflection levels
- Drag mirrors with mouse, touch, or pen
- Rotate selected mirrors with buttons, slider, keyboard, or double-click
- Multi-bounce 2D ray tracing
- Real-time target hit detection
- Physics view with mirror normals and incidence/reflection angles
- Local progress saving with `localStorage`
- Responsive desktop/mobile layout
- No backend and no external JavaScript dependencies

## Controls

- **Drag mirror:** move it
- **Tap/click mirror:** select it
- **Rotate buttons / slider:** rotate selected mirror
- **Arrow Left / Right:** rotate 5°
- **Shift + Arrow:** rotate 1°
- **R:** reset current level
- **Physics view:** show normals and `θi = θr`

## Deployment

This folder is deployed as part of the repository's existing GitHub Pages workflow. After merge to `main`, open:

`https://sunny-gumber.github.io/optical-screen-camera-link/prism-lab/`

## Next milestones

V2 can add prisms with wavelength-dependent refraction (Snell's law), RGB/white-light dispersion, filters, lenses, obstacles, level scoring, and a sandbox builder.
