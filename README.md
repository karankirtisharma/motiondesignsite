# Motion Design Site

A continuous, scroll-driven journey through the actual Motion Design headquarters.

## Open the website

Double-click **Launch Site.cmd**, then open **http://127.0.0.1:5173**.

Or, from this folder:

```sh
npm install
npm run dev
```

Node.js 22.12 or newer is required. The installed dependencies and lockfile are included in this working folder.

## Explore

- Scroll forward or backward to move along the same continuous route.
- **The spaces** selects a destination. The camera travels through the intervening spaces.
- **Look around** pauses the journey. Drag, or use the arrow keys, to look around.
- **Return to path** restores the saved viewpoint and scroll position.
- Reception has four additional viewpoints while you are in its clear walking area.
- **View without 3D** opens source-rendered stills. Reduced-motion preferences select this mode initially.
- Settings control image quality and reduced camera motion.

The route includes the approach, reception, spine, meeting room, founder’s studio, lounge, lab, motion floor, stairs, upper gallery and render hall.

## Build and verify

```sh
npm run build
npm run validate
npm run preview
```

The production website is written to `dist/`. Preview serves it at http://127.0.0.1:4173.

## Source and implementation

- Babylon.js, TypeScript and Vite. WebGPU with a WebGL2 fallback.
- Geometry derives from `MOTION_HQ_ARCH_v09_FINAL.blend`; the original file remains unchanged.
- Source SHA-256: `8ae6ccdeb28674be7692aecc1f8fcc6d4f57c04247e406d107233f9c8487b9c7`.
- Room packages preserve physical coordinates, materials and doorways. One continuous rail rounds the path corners, removes stationary camera shots, and smoothly interpolates camera direction. Critically damped scroll response replaces the old fixed-speed backlog. The scroll track is 32 viewport heights.
- The user-selected reference at `D:\Claude\Motion Design Site\web` supplies the dusk-sky design and fixed light-pool technique. Materials now come from the actual Blender master, and interior reflection captures come from its rooms.
- A fixed pool of nearby lights fades between assignments and prioritizes the current room. Source 2K direct/indirect diffuse maps preserve room shading. A single linear HDR → bloom → AgX → antialiasing chain prevents the previous double color conversion. Mirrors also stay in linear color space.
- All **43 original image textures** are extracted under `textures/original/`, with hashes and full material graph records in `textures/manifest.json`. No original image is downscaled in this archive.
- The browser uses compiled maps up to 2048 pixels, original color corrections, roughness and normal maps, source texture placement, metal/coat settings and warm emitter temperatures. `public/materials/source-materials.json` records **85 active materials**. Stone, paving, floor and rug procedural graphs are compiled to repeating material tiles. Lighting payloads use lossless gzip compression.
- Rendering sleeps when an indoor view settles and wakes on interaction; the exterior water continues moving. Static geometry matrices are cached, and UI labels only update when their values change.
- Startup prepares the exterior, reception and spine concurrently, then shows the interactive arrival while two background workers prepare the remaining rooms. Lighting mip levels download concurrently. The camera eases to a safe reception point if a requested room is still loading, then continues automatically when ready. Content-hashed room downloads reuse the browser cache.
- Closed solids with inward-facing polygons are repaired in the web derivative. Archived source objects are excluded from the lighting bake.
- Chair exports preserve per-face source slots, including black leather, mesh, frames and rubber with separate chrome hardware. Validation checks these groups in the meeting, lab and motion-floor assets. The render-hall sculpture's internal metal stem is inset 8 mm in depth and 6 mm at each end to eliminate coplanar overlap with the letters.
- Fonts, geometry, lighting maps and shader compilers are served locally. There are no analytics, accounts or external runtime services.

`pipeline/material-validation.json` verifies the extracted image hashes and compiled maps. `pipeline/motion-response.json` measures scroll settling and reversal at 30/60/120 Hz. `pipeline/validation-report.json` records asset integrity and 100,001 route continuity samples. `pipeline/clearance-report.json` records architectural clearance sampling. `pipeline/furniture-clearance.json` checks the walking route against furniture bounds. Intermediate Blender exports and diagnostics live in `work/` and are excluded from the website build.

The real-time reflection and glass rendering use browser approximations. They do not reproduce a full offline Cycles render exactly. This folder is a local website; it has not been publicly deployed.

## Reproduce the source conversion

Run the Blender scripts against the locked master without saving it: `extract_textures.py`, `compile_materials.py`, then `source_matrices.py`. Run `node pipeline/reproject_materials.mjs` before `npm run assets:optimize`. The existing room bakes can be republished at 2K with `restore_lighting_resolution.py`. `node pipeline/check_motion.mjs` exports curved-rail samples used by the Blender architecture clearance check and the Python furniture check.

The web material conversion approximates Blender box-projection blending at rounded edges, procedural microstructure, area-light specular response and glass refraction. Source images, geometry and lighting captures are preserved; full path-traced reflection parity is outside this browser renderer.
