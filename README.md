# Convalt Energy — homepage prototype (factory intro, scenes 01–04, portfolio, company)

One scroll-driven WebGL journey on a single canvas, followed by two ordinary sections on the same dark palette. Every journey state derives from one scroll progress value, so reversing, fast scrolling, reloading and deep links always agree.

| | Section | What happens |
|---|---|---|
| — | **Factory intro** | An ambient opening loop, then scroll-controlled assembly footage. The filmed panel hands off to the 3D model (sub-pixel registration). |
| 01 | **Overview** — “Energy, connected.” | The supplied 72-cell panel at a three-quarter angle, a restrained settle and one light sweep. |
| 02 | **Module** — “Precision, layer by layer.” | The panel opens into an *illustrative* three-group anatomy with accessible controls, then reassembles and centres. |
| 03 | **Power generation** — “From one module. To a field of possibility.” | The Overview panel itself settles onto a ground mount in a green field; neighbours, rows and a **672-module** installation appear — every module is that same panel (one mesh, instanced) — while the camera pulls back and rises. |
| 04 | **Data centers** — “Infrastructure for a connected world.” | A quick scroll-driven change to a dark room. The camera starts close to server cabinets and pulls back to the supplied model's reference three-quarter view. |
| — | **Project portfolio** — “Local foundations. Global aspiration.” | A scroll-driven sequence of the five U.S. projects: each image holds while its text is in focus, then the next slides up over it; an index rail shows where you are. Ends with “View all projects”. |
| — | **Company** — “Built for the next generation. And the one after that.” | An infrastructure image beside the founding story and “Meet our team”. |
| — | **Footer** | Dark. **From the data centers to the footer the page stays dark.** |

## Preview

Requires Node 20.11+ (tested with Node 24.21, npm 11.19).

```bash
npm install
npm run dev                          # http://localhost:5173/
npm run build && npm run preview     # production build at http://localhost:4173/
```

The npm scripts call `node node_modules/...` directly: npm's Windows `.cmd` shims break when the path contains `&` (as in `Freelance & bot`).

`node scripts/serve.mjs <command>` runs one command against a temporary preview server (dist/, port 4173) and stops it afterwards. With `--dev`, it uses the dev server instead. All validation below was run this way, with no long-lived servers.

### Deployment

Production: **https://convalt-gilt.vercel.app** — the Vercel project `hakims-projects-8cc34b62/convalt`, connected to the GitHub repository `lonadonia/convalt`: every push to `main` is built (`npm run build`) and deployed by Vercel's Git integration. (`convalt.vercel.app` is an unrelated project.)

### Repository contents

The repository holds the source, the delivery assets in `public/` (everything the site needs to run) and the validation evidence in `docs/`. Kept out of it (local only): the original source archives (`*.zip`, the loose 4K `2.mp4`), the image crawl `Convalt_Energy_Images/`, the client documents (PDF), `asset-source/`, `node_modules/` and `dist/`. The asset pipelines (`npm run assets*`) need those archives in the project root; `npm run assets:portfolio` falls back to downloading the official image URLs.

## Stack

| | Version | Notes |
|---|---|---|
| React / React DOM | 19.3 | UI and the HTML overlay (all copy, links and controls are HTML) |
| TypeScript | 6.0 | |
| Vite | 8.3 | Build, dev server, and the SSR loader used by the layout report |
| three.js | **0.182** | Kept below 0.183 (R3F 9.8 still constructs `THREE.Clock`) |
| @react-three/fiber | 9.8 | One canvas, `frameloop="demand"`; rendering is taken over for the scene blend |
| GSAP + ScrollTrigger | 3.15 | Scroll measurement only; all motion derives from one progress value |
| Inter (variable) | self-hosted (OFL) | Latin subset, 47 KB |
| Asset tooling (dev only) | gltf-transform 4.5, meshoptimizer 0.22, sharp, ffmpeg-static, gltf-validator | |

## Project structure

```
src/
  content/story.ts            all copy and links of the journey and footer
  content/portfolio.ts        portfolio projects and company copy: links, statuses, official summaries, alt text
  content/portfolioMedia.ts   generated image manifest (srcset, dimensions)
  config/journey.ts           the four journey segments (scroll lengths per tier) + place conversions
  config/intro.ts             factory intro timing, footage frame mapping, layer tracks
  config/choreography.ts      scenes 01–02: ranges, key poses, explode distance
  config/field.ts             scene 03: site, array, reveal, camera keys, light
  config/datacenter.ts        scene 04: timing, transition band, camera keys, fitted framing, look
  lib/journeyDriver.ts        progress → DOM (text, scrims, dark treatment, header colour)
  lib/scroll.ts               ScrollTrigger binding, places (tier-independent), chapters, history
  field/layout.ts             deterministic installation layout (terrain-aware)
  field/terrainSampler.ts     exact heights/slopes on the rendered terrain triangles
  field/timeline.ts, datacenter/timeline.ts   pure samples of each section's progress
  three/StoryCanvas.tsx       the one <Canvas>; asset loaders (panel, field, data center); context loss
  three/StoryController.tsx   the only animation controller (camera, poses, sections) + the render pass
  three/field/*               FieldWorld (terrain, sky, instanced installation), camera path, materials
  three/datacenter/*          DataCenterWorld (dark room, floor reflection, camera path), SceneBlend
  components/*                story chapters, stage media, intro, static document
  components/LowerSections.tsx   project portfolio (scroll sequence / list) and company section
  hooks/usePortfolioScroll.ts the portfolio's scroll layout: arrival, cover, focus, index rail, keyboard
  hooks/useReveal.ts          restrained entrance for the lower sections (reduced-motion aware)
  styles/sections.css         lower sections: portfolio (scroll and list layouts), status badges, company split
scripts/
  prepare-assets.mjs / prepare-intro.mjs / prepare-field.mjs / prepare-datacenter.mjs   asset pipelines
  field-layout-report.mjs     runs the layout generator in Node → counts, rejections, top-view plan
  capture.mjs                 screenshots, posters, checks, recordings, perf logs
  field-frames.mjs            section frame sheets (field or data centers)
  dc-lab-shots.mjs + dev/dc-lab.html   data-center look development against the reference
  dc-reference-fit.mjs        recovers the reference screenshot's camera (evidence for the final view)
  page-frames.mjs             header over every scene, the pin release, footer, mobile menu (review frames)
  prepare-brand.mjs           trimmed logo derivatives (white / petrol), favicons
  prepare-portfolio.mjs       portfolio and company imagery → cropped delivery WebPs + manifest + report
  cross-browser.mjs           Chrome / Edge / Firefox / WebKit smoke test
  serve.mjs                   temporary preview/dev server around one command
docs/                         asset reports, layout plan, screenshots, recordings, perf logs
```

## Assets

All archives are preserved untouched. Extraction is zip-slip safe, into `asset-source/`, which is git-ignored and regenerable. No 4K original is ever served. **None of the archives contains a licence or attribution file**, so terms must be confirmed before production use. Every report records this.

### Logo — `npm run assets` (`scripts/prepare-brand.mjs`)

- The official `logo.png` (988×304, a white wordmark) carries transparent padding around the artwork (884×266). Displayed as-is, its visible lettering was about 10% smaller than its box: roughly **99 × 30 px** in the old header.
- The derivatives are **trimmed to the artwork** (+2 px so antialiased edges are never clipped) and exported at 400×122. A petrol version for the ivory scenes is made by recolouring the same artwork, with alpha and shapes untouched.
- They are displayed at **157 × 48 px** on desktop (≈ 2.5× resolution headroom), 137 × 42 below 1280 px and 118 × 36 on phones.
- The original is preserved untouched.

### Module (scenes 01–02) — `npm run assets`

- `simple-72-cell-solar-panel.zip`: a binary FBX slab (1.864 × 0.935 × 0.030 m after normalisation) with 4K PBR maps. It ships as two GLBs with WebP textures: 2K at 824 KB for desktop, 1K at 234 KB for phones and Save-Data. Both pass the Khronos validator with 0 issues.
- The supplied normal map was baked against smoothed low-poly normals, leaving a mean error of about 38° on the flat face. It is **re-baked as detail-only**: the frame lip, cells and busbars are kept and the compensation is removed. Details are in `docs/asset-report.json`.

### Factory footage (intro) — `npm run assets:intro`

- `intro.zip › 1.mp4` (4K, 8 s) becomes the **ambient loop**. It uses 166 frames, with its end crossfaded into its start.
- `2.mp4` (4K, 143 frames) becomes the **scroll-controlled footage**. It has a keyframe every 6 frames and no B-frames, chosen by measured seek latency (`docs/intro-seek-benchmark.json`).
- Each has 1080p, 720p and 720×1280 portrait H.264 derivatives. They are BT.709-tagged and silent (audio removed, plus muted attributes). The posters are exact first frames.
- Details are in `docs/intro-asset-report.json`.

### Power generation (scene 03) — `npm run assets:field`

**The installation is the Overview panel.** Every module — the hero and the 671 instanced copies — uses the Module scene's own panel (`public/models/solar-panel-{2k,1k}.glb` from `simple-72-cell-solar-panel.zip`): the same mesh (shared, 44 triangles), the same maps and the same material values, at 1:1 (1.864 × 0.935 × 0.030 m). No separate field module is downloaded. (`solar-panel.zip`'s module, used before, is only built on request: `prepare-field.mjs --legacy-module`.)

**`lorton-field.zip`**: a photogrammetry OBJ with 1.44 M triangles and two 8192² texture atlases.
- The terrain is rasterised top-down into a 0.25 m heightfield. Trees and hedges up to 21 m are softened to at most 5 m, so they read as hedgerows, not walls. The mesh is simplified with an error bound: 180k triangles (≤ 1.1 cm error) for desktop and 70k (≤ 3.3 cm) for phones, meshopt-compressed.
- Three orthophoto layers are used: site inset, full scan, and a 300 m apron that extends the ground without tiling any landmark.
- Details are in `docs/field-asset-report.json`.

**Scale assumptions** (estimates, not survey data):
- **10 m per scan unit.** This comes from recognisable features: a single-track lane (≈ 3 m), UK road markings (6 m + 3 m period) and sheep.
- The panel is 1.864 m wide. Real 72-cell modules are ≈ 1.95–2.0 m, so it is slightly small. This is a visualisation scale, not a product specification.

### Data centers (scene 04) — `npm run assets:datacenter`

`data-center.zip` contains the four reference screenshots (in a nested zip, used for composition only, never shipped) and `data-center-low-poly.zip`. Inspection findings:

| Question | Finding |
|---|---|
| Format | Binary FBX: 4 meshes, 22,982 triangles, node transforms −90° X ×100. The front texture (800×508) is embedded, and pixel-identical to the loose copy. |
| Server racks | **5 rows × 6 cabinets = 30**, merged into one mesh (`Cluster`) with **901 alternating material runs**. Fronts face +Z. |
| Floor platform | Part of the model: **10 × 10 white tiles** plus a separate dark grout mesh, coplanar but not overlapping (no z-fighting). 7.8 m square. |
| Ceiling fixtures | **Geometry only:** 9 fixtures, each a dark casing and a light face. No light objects exist in the file. |
| Indicators | Green (`Verde`, 12k triangles) and amber (`Amarelo`, 1.5k) are **separate geometry with their own materials**. They carried no emissive values, so they are made emissive. |
| Walls / obstructions | **None.** The model is open: racks, a floating platform and floating fixtures. |
| Unused | `internal_ground_ao_texture.jpeg`, a generic viewer ground shadow that no mesh references. |

- **Scale:** the cabinets are 1,130 units tall and set to **2.0 m** (a typical 42U cabinet), so 1 unit = 1.770 mm. The stylised cabinets are then 0.93 m wide and 0.64 m deep, with 0.96 m aisles and fixtures at 3.2 m. No single real scale fits every dimension. Height sets the human scale, and the reference camera then stands at 1.73 m, eye height.
- **Conversion:**
  - Transforms are baked, and the geometry is converted to metres with the origin at the platform centre.
  - The 901 runs are **regrouped per material into 8 primitives (8 draw calls)**. Every primitive is welded and indexed, and UVs are converted to glTF convention.
  - The front texture becomes WebP, with meshopt compression and quantisation.
  - The rows, cabinets, tiles and fixtures are measured into node extras.
- **Output:** `public/models/datacenter.glb` at **246 KB**, validator 0 errors and 0 warnings. Details are in `docs/datacenter-asset-report.json`.

### Project portfolio and company — `npm run assets:portfolio`

- **Sources:** official convalt.com images, taken from `Convalt_Energy_Images/` (matched by their original URL through `image_sources.csv`); if missing, the exact URL is downloaded into `asset-source/portfolio/`. Originals are never modified.
- **The five projects** use the sharpest official copy of each picture: Project Solis's 1,792 px rendering, and the 1,672 px originals of the Watertown, River Drivers, New Mexico Recycling and Northern Maine images (the 836 px `/pic/` copies are reduced versions of the same pictures; the report records the difference). The company image uses the supplied picture's 1,100 px original (the `/pic/` copy is 598 px).
- **Delivery:** one intentional crop per image (3:2 with a chosen focal point; 5:4 for the company), WebP at 640/960/1,280/≈1,500 px (never wider than the crop), `srcset` + `sizes`, fixed `width`/`height` (no layout shift). 3.2 MB in total; a visitor loads one size per image, lazily.
- Details: `docs/portfolio-asset-report.json`.

## How the journey works

One tall section with a sticky full-screen stage. ScrollTrigger maps its scroll range to `story.target` (0–1). The frame loop damps it into `story.progress`, and every visual derives from that one value through pure `sample*()` functions. There is no snapping, no scroll-jacking, no timers and no nested pins. Down advances, up reverses, stopping holds after a short catch-up, and fast scrolling lands on the right state.

| Segment | Desktop | Phones |
|---|---|---|
| Factory intro | 400 vh | 280 vh |
| Overview → module | 240 vh | 200 vh |
| Power generation | 480 vh | 360 vh |
| Data centers | 300 vh | 240 vh |

Anchors `#overview`, `#module`, `#power-generation` and `#data-centers` sit at each chapter's resting state. The reader's place is stored per segment, independent of the tier, so resizes across the breakpoint, reloads and history navigation keep the place rather than the pixel offset.

In-page links ("Skip intro", "Explore the module" and the anchors above) scroll smoothly between neighbouring scenes. A jump across the opening (for example, a `#data-centers` link followed from the factory video) is a **cut** instead: the stage fades out, the page moves instantly, and the destination fades in. There is no fast-forward through every scene in between. When either end is the dark lower page, the cut fades through charcoal, so it never flashes the ivory page. Between two light scenes (the opening video and the power-generation field, say) it fades through the ivory page, as it always has.

### 03 · Power generation

| Field progress | What happens (brief's suggested phase) |
|---|---|
| (end of 02: story 82–100%) | The panel reassembles and moves to a centred presentation pose *(reassemble and centre)* |
| 0–12% | A short approach toward the centred panel |
| 5–24% | Studio → outdoors: ivory haze thins, sky and terrain appear, sun and sky light fade in, reflections re-rendered in 40 steps *(approach and environment reveal)* |
| 0% | The field's copy of the panel takes over from the Module scene's panel — the same mesh, material and pose, while the light is still the studio's: no crossfade, no size jump, no visible change (checked: 0 pixels differ) |
| 15–30% | The same panel settles onto its table; the table's structure fades in beneath it *(settle)* |
| 30–44% | First neighbours → its table *(first neighbours)* |
| 44–78% | Its row → 3 rows → the first block → all 12 rows; the camera retreats and rises *(rows, retreat)* |
| 78–82% | Full installation; camera settles *(full installation)* |
| 80–88% | Copy appears over a soft ivory haze *(text)* |
| 88–100% | Reading interval *(reading)* |

**Layout.** The generator is deterministic and runs from the panel's measured size, the rendered terrain and the site polygon. `node scripts/field-layout-report.mjs` reproduces it in Node and writes `docs/field-layout/field-layout-plan.png`.

| Parameter | Value |
|---|---|
| Modules | **672** (was 448, +50%): 12 rows × 4 tables × 14 (2 landscape levels × 7). No slot rejected. |
| Table | 13.17 m long (7 panels in landscape), 1.89 m along the slope; **tilt 25°**, facing the lane |
| Row pitch | 4.73 m (ground-coverage ratio 0.4) |
| Green corridors | 5 m north–south service corridor; 6 m east–west access corridor after row 6 (four blocks) |
| Terrain | Tables are planar and roll with the ground along the row (≤ 3.1%). The lower edge keeps **0.75–0.83 m** clearance. **Legs are vertical, cut to the sampled ground plus a 12 cm embed (0.72–1.34 m)**. |
| Site | The central field, 8 m inside its traced boundary; slope ≤ 10% under every table |
| Supports | 912 galvanised-steel boxes: 4 rails per table, and 5 posts of rafter plus front and rear leg |

**Reveal:** reveal distance = |Δx from the hero| + 1.1 × level + 24 × row. The order is therefore hero → neighbours → its table → its row → row after row. There is no checkerboard, no scaling from points, and nothing growing out of the ground. Each module fades in while settling 32 cm along its normal, its shadow fading in with it.

**Camera:** one monotone-cubic path (target, azimuth, elevation, log-distance, lens shift), starting exactly at scene 02's final camera with the lens unchanged (26° desktop, 30° phones). On desktop, the final overview **fits the installation's bounds into the area beside the measured copy**, so the composition holds from 4:3 to 21:9. On portrait screens it sits above the copy.

**Light:** Khronos PBR Neutral tone mapping. The sun has one 2048² shadow map (1024² on phones), rendered only when the installation changes. The overcast orthophoto is graded into a sunlit albedo (a fixed saturation and tint, identical for every pixel).

### 04 · Data centers

| Section progress | What happens (brief's suggested phase) |
|---|---|
| 0–3.5% | The power-generation copy leaves |
| 2–7.5% | **Dark transition band** (5.5% ≈ 17 vh): the field darkens to charcoal while the server close-up rises out of it; the header turns light-on-dark *(0–8%)* |
| 7.5–22% | Close view of the front-right cabinet: rack structure, server slots, green and amber indicators, metal highlights *(8–22%)* |
| 22–66% | Pullback: several racks → aisles and platform → the whole installation with its fixtures *(22–68%)* |
| 66–80% | Settles, decelerating, into the reference three-quarter view *(68–82%)* |
| 82–90% | Copy appears *(82–92%)* |
| 90–100% | Reading interval; the page then continues *(92–100%)* |

**Transition:** one renderer, no second context.
- Before the band, only the field renders.
- In the band, a charcoal layer darkens the field. While both are dim, the close-up (rendered to a 75%-size target) is composited over it. The two scenes are never readable together, and the server indicators already glow faintly at the darkest point, so there is no empty black frame.
- After the band, **the field is no longer rendered at all**.
- The page's own backdrop under the canvas turns charcoal, so no fade can flash ivory.
- The dark treatment is scroll-driven and scene-specific. No theme preference is read or written.

**Reference 170556.** Its camera was recovered by fitting 7 picked model↔pixel points (RMS 2.4 px). The nine fixtures were not used in the fit and land within 1.5–6 px of the screenshot. Result: camera at (8.43, 1.73, 5.17) m, azimuth 58.5°, a **44° lens**.
- **Desktop:** the final view keeps that direction, elevation and lens. A lens shift (the perspective is untouched) and a fitted distance place the silhouette (platform, racks, fixtures) in the area right of the measured copy. At 1903×843 the copy occupies the left 31% and the installation the right 56%.
- **Phones:** 58° lens, the installation fitted above the copy, eye kept below the fixtures.

**Camera path:** close view (1.4 m from a cabinet front) → 2.6 m → 5.2 m → 8.2 m → the fitted final view.
- It uses a fixed lens, a level horizon and no roll.
- The eye rises gently from 1.28 m to 1.74 m, the azimuth swings 44° → 58.5°, and the lens shift is shared out along the pullback, so nothing slides sideways at the end.
- The whole path is audited when it is built: its nearest approach to any rack row or fixture is reported and checked.

**Look:**
- Deep charcoal (#0B1214, the dark palette's background) and graphite cabinets.
- A reflection environment made from the nine fixtures plus two faint side panels, which puts a subtle sheen on the rack edges.
- A small light rig: overhead key, front fill, sky/ground fill. No light per indicator; indicators are emissive, with no bloom.
- Glossy tiles with a **planar reflection** (half resolution, mip-blurred, Fresnel-weighted) and analytic contact darkening around the rows.
- Optional indicator activity: a few indicators dim briefly, updated at 4 fps. It is off for reduced motion.

**Copy and link:**
- The copy is as suggested in the brief.
- convalt.com has no data-centers page: the projects index filters client-side, with no linkable URL. The CTA therefore opens the company's data-center project page, `/projects/northern-maine-data-center/`, which was checked live, and its label says so: **“Explore our data center project”**.
- A note states that the interior is illustrative.
- No capacity, customer, certification, uptime or status claims are made.

### Header and the dark lower page

- **Header:**
  - 84 px on desktop and 68 px on phones. The logo, links and Contact share one vertical axis, and the links are 16 px.
  - **Transparent in every scene:** no background, blur, shadow, border or pseudo-element behind it. The logo and links switch between white (over the video and the dark scenes) and petrol (over the ivory scenes and the field), driven by the same scroll progress. The white and petrol logos cross-fade (never recoloured live).
  - Where the scene behind is busy (terrain and hedgerows, ceiling lights), a soft halo in the opposite tone hugs the letters, the logo and the menu icon. It is invisible against plain backgrounds. The factory video keeps its own soft top gradient, which is part of the footage layer, not the header.
  - Contrast of the link glyphs against what is directly behind them (scene plus halo), worst pixel: video 15.4, module 12.1, field 7.4–10.1, data centers 7.8–19.0 : 1. The phone's "Menu" label: at least 7.4:1.
  - **Leaves with the journey:** the header stays at the top through every scene. When the pinned stage is released, it scrolls away together with the stage (CSS sticky on a track exactly as tall as the journey, so it moves with the scroll, not after it). Ordinary content therefore never passes beneath the transparent header; scrolling back brings it back with the stage. The footer has its own logo and links. In the no-WebGL document the header sits over the opening and scrolls away with the page.
- **Dark palette:**
  - Variables in `tokens.css`: `--dark-bg #0B1214`, `--dark-surface #111D20`, `--dark-raised #17272A`, `--dark-text #F2F5F2` (17.6:1), `--dark-text-2 #B5C2C1` (10.5:1), `--dark-muted #8A9A98` (6.6:1), `--dark-accent #5FD3C4` (10.2:1), and 12% / 26% light lines.
  - The data-center scene, its transition band, the stage backdrop, the copy and the footer all use them, so there is one continuous dark from the band to the page bottom.
- **Scene state:**
  - `html[data-scene]` switches to `dark` in the middle of the data-center transition band and back when scrolling up. It is derived from scroll only: nothing is stored, and no theme preference is read or written.
  - It drives the body background, the mobile menu (dark panel, light links), and the browser UI colour (`theme-color`).
  - The page canvas (overscroll above and below) is dark, so no ivory can appear below the footer.
- **Pin release:** at the end of the journey the pinned stage (copy, scene and header) scrolls away natively into the dark footer. There is no spacer gap, no overlap and no canvas left underneath.
- **Reload and history in the lower page:**
  - Positions below the pinned section are stored as pixels past its end, so a reload or back/forward at the footer returns exactly there.
  - The boot script in `index.html` sets the dark scene before the first paint, so a lower-page reload never flashes ivory.
  - The `#power-generation` and `#data-centers` links skip the opening poster.
- **Footer:** the white logo, the company links and Contact, and the legal line **as on convalt.com** (checked live: “© 2026 Convalt Energy, Inc. All rights reserved. A portfolio company of ACO Investment Group LLC”). No address, email or social accounts are shown, because the live site shows none.
- **No-WebGL document:** it turns dark from its data-center section to the footer.

### Project portfolio and company (after the data centers)

- **Placement:** in ordinary document flow, directly after the pinned journey and before the footer (also in the no-WebGL document). The released data-center scene scrolls away into the portfolio on the same charcoal: no blank band, no canvas left behind, and no WebGL frame is drawn while the portfolio is on screen.
- **Content:** the five U.S. projects in the supplied order, with their statuses exactly as published (checked on the official project pages on 2026-09-26): Project Solis **UNDER FINANCING**, Watertown Factory **ON HOLD**, River Drivers Solar, New Mexico Panel Recycling and Northern Maine Data Center **UNDER DEVELOPMENT**. Each has its location, a one-sentence summary taken from its official page (only shortened where it did not stand alone — nothing is added, nothing is described as built), its scope · category, and a “View project ↗” link to its page. Every link answered HTTP 200. The section ends with “View all projects ↗”.
- **Scroll layout (wide screens, motion allowed):** each project's image is `position: sticky` and the next one slides up over it while the text scrolls beside it — CSS does the positioning, so wheel, trackpad, touch, keyboard and reverse scrolling behave natively, with no snapping. Each image holds alone for 26 % of a screen, then the next covers it over exactly its own height; the project's text is centred on its hold. A script adds the finish: the arriving image settles inside its frame, the covered one recedes (scales back, dims), the project in focus is emphasized (the others dim), and an index rail (01–05, with progress) marks it. About 4.3 screens of scroll for the five projects.
- **List layout (phones, reduced motion, before scripts):** each project as a plain card — image, then status, title, location, summary, scope and link — side by side on wide screens, stacked on narrow ones. No pinning, no animation.
- **Accessibility:** one real link per project (its accessible name includes the title); the images also open the project for pointer users but are hidden from assistive technology, whose users get a description of each picture. Tabbing to a project link brings that project into focus; the rail's numbers are links too.
- **Company:** a balanced split (image and copy side by side from 900 px, stacked below), the supplied copy, and "Meet our team ↗".
- **Links into the sections:** `#portfolio` and `#company` land on them, dark from the first paint. A reload in the lower page returns to the same place, re-applied once the web font has set the text.
- **Header:** the transparent header leaves with the released stage, so it never overlaps the projects or the copy; the footer carries the logo and links.

## Accessibility and fallbacks

- **Content:** all copy, links and controls are HTML; the canvas is decorative inside a labelled `role="img"` region, and the label follows the chapter. Headings are semantic, there is a skip link, the focus ring is visible (lightened on the dark section), and touch targets are at least 44 px.
- **Contrast** (measured on the rendered backgrounds):
  - power generation, over its haze: eyebrow 4.7–5.0:1, lede 5.9:1, accent 3.2:1 (large text)
  - data centers, on charcoal: headline 17:1, lede 12:1, accent 10:1, note 6.7:1
  - header links over every scene: see Header above
- **Reduced motion:** the preference is resolved before the first render, so the opening loop never starts (checked: `play()` is never called). There is no camera travel. Each section is a still composition: the overview, the opened module, the completed installation with its text, and the settled data-center view with its copy. Changes cross-fade through a short fade, and the stage is kept dark between the field and the data centers. There is no on-page switch: the site follows the operating system setting, including a change while the page is open (a choice saved by the former Motion switch is ignored).
- **Opening video:** muted and looping; it has no on-page Pause/Play control (see Known limitations). It never plays when the system asks for reduced motion, and if autoplay is refused its matching poster stays.
- **Loading:** the power-generation and data-center assets load in the background after the module, on idle, and are compiled before they can be seen. A tier change or context loss during that compile ends it cleanly. Downloads give up only after 60 s (the panel) or 120 s (field, data centers), so slow connections (≈ 0.5 Mbit/s, measured here) still get the scenes; meanwhile the page stays usable. If a visitor arrives early, the previous scene stays in view with a small note. There is never a blank stage.
- **Failures:**
  - model: posters, including the field and data-center stills
  - field: the module stays, with a note
  - data centers: charcoal stage, with a note
  - context loss: posters, then recovery

  In every case the copy and links keep working.
- **No WebGL:** a normal document with every chapter, still images and all links.

## Validation

All validation ran locally against the production build. Each command ran under `node scripts/serve.mjs` (a temporary preview server), in headless Chrome 153 via Playwright unless noted.

**Automated checks** — `node scripts/capture.mjs checks`: **131 of 131 pass** (`docs/screenshots/checks.json`). They drive the real page and assert, among other things:
- **Intro:** the loop poster at first paint; silent 1080p derivatives only (never the 4K originals); the exact footage frame for each scroll position; coalesced seeks; the film-to-model handoff.
- **Scenes 01–02:** the choreography, the anatomy controls, keyboard use and reduced motion.
- **Failures:** model, footage, field, data centers, context loss and no WebGL each keep the copy and links working.
- **Power generation:** the installation and the hero are the Overview panel (one geometry, the same textures and values; the handoff switch changes no pixels), 620–700 modules laid out with no rejected slot, the reveal order, identical states forward and in reverse, and the poster.
- **Data centers:**
  - the camera path's clearance, and the band's render modes
  - no white frame and no empty black frame in the band; a readable close view
  - the dark treatment, copy timing and final composition
  - reverse and fast scrolling
  - the CTA, deep link, reload, resize and asset failure
- **Header and lower page:**
  - logo size; no background, blur, shadow, border or pseudo-element behind the header in any scene, on desktop and phone
  - the header's link glyphs (and the phone's "Menu" label) keep ≥ 4.5:1 against the scene and halo behind them
  - the chapter bar, Motion switch and Pause/Play are gone, and bottom-anchored copy uses the freed space
  - the header stays through the journey, leaves with the released stage and comes back with it
  - dark continuity to the footer, and the reverse
  - reload at the footer (dark from the first paint)
  - hash jumps across the opening (`#data-centers` from the factory video, and back) fading through charcoal (at most 0.9% light pixels, the same share as the light copy on the settled dark page)
  - no horizontal overflow on phones, and the dark mobile menu
- **Project portfolio and company:**
  - section order (journey → portfolio → company → footer), also in the no-WebGL document
  - the five projects: exact title, status, location, scope, official summary, link and image
  - scroll layout, forward and in reverse: each project in turn has its text centred and emphasized, its image on top and the rail marking it
  - mouse wheel (in order, and back; the page rests where the wheel leaves it), touch drags on a tablet, keyboard (Tab brings each project into focus), the rail's links
  - no WebGL frames while the portfolio is on screen; no layout shift (CLS 0); all images loaded; "View all projects ↗" at the end
  - phone and reduced motion: the plain list (no pinning, no animation); no overflow; the section's length
  - the company copy, CTA and image exactly as supplied; the `#portfolio` deep link (dark from the first paint); header clear of the sections; dark throughout

**Other artefacts:**

| What | Command | Output |
|---|---|---|
| Every state on six viewports: 1903×843 (the reference screenshot's), 1920×1080, 1440×900, 1024×768 and 768×1024 at 2×, 390×844 at 3×, including the portfolio heading, its grid and the company section (`31`–`33`). Plus fallbacks, reduced motion, keyboard focus and menus. | `capture.mjs shots`, `ui` | `docs/screenshots/` |
| Scroll recordings (WebM, filmstrip, per-frame JSON), forward then reverse, desktop and phone | `capture.mjs record`, with `--field` or `--dc`, and `--mobile` | `docs/intro-recording/`, `docs/field-recording/`, `docs/datacenter-recording/` |
| The header over the video, module, field (two views) and data centers (pullback and ending); the pin release; the portfolio (heading, each project in focus, a transition, the end); the company section; the footer; the phone menu over light and dark. Each frame logs the header's computed surface. | `scripts/page-frames.mjs`, with `--mobile` | `docs/page/` |
| The final data-center view beside reference 170556, and the camera path | `node scripts/serve.mjs --dev node scripts/dc-lab-shots.mjs` | `docs/datacenter-lab/` |
| Installation layout: counts, clearances, plan before (448) and after (672) | `npm run layout:field` | `docs/field-layout/` |

**Recording results:**
- **Intro:** footage lag p50 0 frames. During the slow read-through and its reverse it stays within 3 frames; in the deliberate rapid-reversal and back-to-the-top segments it peaked at 16–19 frames on desktop and 29 on the phone in the final runs (p99 overall 10–13 and 16). An earlier run of the same segments peaked at 9 and 7: seek latency varies with this machine's load, and the footage still settles on the right frame within 0.6 s (checked).
- **Power generation:** the reveal is monotone forward and in reverse. Draw calls p50 7, max 14.
- **Data centers:** field → band → close view → pullback → copy, then the reverse and rapid reversals across the band; every frame is in the field, band or data-center mode, and the dark page never flashes ivory. Draw calls p50 14, max 21 (the band's composite).

**Cross-browser** — `scripts/cross-browser.mjs` (Playwright's browser builds, headless, on Windows):
- Chrome 153, Edge 153, Firefox 155 (WebGL forced on) and WebKit 26.6 all reached the ready state with WebGL.
- All four rendered the power-generation and data-center sections, the portfolio (scroll layout, the right project in focus, images loaded) and the company section, and logged no errors.
- Footage frame presented against the frame mapped to the scroll position, final run: Chrome 82/82, Edge 82/82, Firefox 81/82, WebKit 82/82. In an earlier run WebKit showed frame 28 when frame 51 was mapped: its seeks can lag behind the scroll.

## Performance

Measured with `node scripts/capture.mjs perf`: a scripted scroll through the whole journey, logging requestAnimationFrame intervals, GPU timer queries and CPU render time per section.

**Test device:**
- A laptop with an **AMD Ryzen 5 PRO 5650U and its integrated Radeon graphics**, 15.3 GB RAM, Windows 11 Pro, 60 Hz.
- Chrome 153 headless (Playwright), ANGLE on Direct3D 11.
- The machine was short of memory while testing (about 2 GB free), which shows as variance between runs.
- "Phone" is the same laptop emulating a 390×844 screen at 3×; the adaptive resolution settled between 1.26× and 1.75×. **No physical phone or tablet was tested.**

**Dropped frames** (intervals over 1.5 vsyncs), two consecutive runs on the same build. They were measured before the later changes (the chapter-link cut, the motion-preference timing, the compile guard, and removing the header surface, chapter bar and controls), none of which adds WebGL work.

| Viewport | Run | Intro | Overview → module | Power generation | Data centers | GPU frame p50 / p95 / p99 |
|---|---|---|---|---|---|---|
| 1903×843 | A | 5.9% | 0.9% | 8.8% | 5.3% | 2.6 / 11.6 / 20.4 ms |
| | B | 2.6% | 0.7% | 5.9% | 0.5% | 1.6 / 9.0 / 10.4 ms |
| 1440×900 | A | 7.7% | 0% | 13.3% | 5.7% | 1.3 / 25.8 / 37.6 ms |
| | B | 2.3% | 0% | 3.9% | 1.6% | 1.3 / 9.3 / 11.5 ms |
| Phone (emulated) | A | 3.3% | 0.1% | 5.0% | 2.4% | 0.9 / 12.1 / 20.8 ms |
| | B | 1.1% | 0% | 2.8% | 0% | 1.6 / 7.3 / 16.8 ms |

- The median frame interval was 16.7 ms in every section of both runs.
- Section GPU time (p95) in run B: power generation 8.0–11.1 ms, data centers 4.2–11.6 ms.
- Per frame: the power generation draws at most 12 calls and 330k triangles (220k on phones). The data centers draw 14 calls and 45k triangles, including the floor reflection; the transition band peaks at 21 calls.
- Nothing renders while the page is at rest (on-demand frames). The indicator activity redraws at 4 fps, and the field stops rendering once the data centers take over.
- These runs show that the journey usually holds the display rate on this integrated GPU, with a few percent of late frames that vary with the machine's load. They are not a claim of a steady 60 fps on every device.

## Test hooks (URL parameters)

| Parameter | Effect |
|---|---|
| `?webgl=0` | Force the static no-WebGL document |
| `?model=fail` | Simulate a panel model failure |
| `?lose=3000` | Lose the WebGL context after 3 s, restore 2.5 s later |
| `?motion=0` / `?motion=1` | Override the motion preference |
| `?capture=1` | Poster capture mode (UI hidden) |
| `?perf=1` | GPU/CPU timers for `capture.mjs perf` |
| `?fieldcam=az,el,dist,tx,tz,sx,sy` | Override the final power-generation camera (composition work) |
| `?inspect=1` | Expose renderer/scene/camera as `window.__three` (debugging) |

## Known limitations

- **Portfolio records are a snapshot:** the five projects' statuses and summaries were checked on convalt.com on 2026-09-26 and can change — update `src/content/portfolio.ts`. The regional tabs (Africa, India, Southeast Asia) of the previous version were replaced by this five-project sequence; the full portfolio is one link away ("View all projects").
- **Official images:** the portfolio and company pictures are convalt.com's own; the archive carries no licence file, so confirm usage terms before production. The company image is only 1,100 px wide, so it may look slightly soft on very wide high-density screens.
- **Licensing:** none of the four archives (module, factory footage, field scan, data center) contains a licence or attribution file. Terms must be confirmed before production.
- **Scales are estimates:**
  - The field scan is taken as 10 m per unit, from recognisable features.
  - The data-center cabinets are set to 2.0 m tall. Their stylised proportions (0.93 m wide, 0.64 m deep) mean no single real scale fits every dimension.
- **Close view:** the data-center front texture is 800×508 (embedded in the model), so cabinet fronts are soft at close range. The close view stays 1.4 m from the cabinets rather than magnifying it further.
- **Illustrative interior:** the data center is a generic low-poly model, not a Convalt facility, and the page says so. The CTA opens the one data-center project page, because convalt.com has no data-centers page.
- **Browsers:**
  - WebKit (Playwright's Windows build) can lag behind the scroll when seeking the footage (in one of two runs).
  - Safari on macOS or iOS and physical phones and tablets were not tested.
- **Performance:** measured on one memory-constrained laptop, with run-to-run variance (see above).
- **No pause for the opening loop:** the on-page Pause/Play control was removed on request. The loop respects the system's reduced-motion setting, but WCAG 2.2.2 (Pause, Stop, Hide) expects a way to pause moving content that plays for more than 5 seconds.
- **Header halo:** the transparent header relies on a soft halo around its letters over busy backgrounds; the logo is an image, so its legibility was reviewed in the frames rather than measured.
