# Axion

A WebGPU, data-oriented 3D engine. Not a three.js fork — a different set of
choices about the same problem.

```js
import * as AX from './src/index.js';

const app = await AX.App.create(document.querySelector('canvas'));
const mesh = app.mesh(AX.icosphere(0.5, 2));
app.add({ mesh, position: [0, 0, 0], spin: [0, 1, 0] });
app.light([4, 6, 4], { intensity: 200 });
app.start();
```

## Where it differs from three.js, and why

| | three.js | Axion |
|---|---|---|
| Scene model | `Object3D` tree, per-object traversal | archetype ECS, typed-array columns |
| Backend | WebGL2 + WebGPU behind one abstraction | WebGPU only |
| Depth | forward-Z, near/far planes | reverse-Z, infinite far plane |
| Geometry | one buffer set per `BufferGeometry` | shared vertex/index arenas, all meshes suballocated |
| Instancing | opt-in `InstancedMesh` you construct | every draw is instanced; batching is automatic |
| Math | `Vector3` / `Matrix4` objects | offset-addressed functions, zero allocation |
| Culling | per-object, inside the render traversal | one flat pass over packed columns, then a counting sort |
| Reflections | cube-map probes you author | screen-space reflections, analytic sky fallback |
| Shadows | opt-in per light and per object | point-light cube maps with soft PCF, on by default |
| Ambient | flat, or a probe you bake | deferred hemispheric ambient × horizon-based AO |
| Surface detail | textures you load and UV-map | procedural fBm evaluated in world space |
| Anti-aliasing | MSAA | FXAA in the resolve pass, so depth stays sampleable |
| Glow | a post-processing pass you add | bloom pyramid in the pipeline |

Nothing here is named like three.js, and nothing is API-compatible with it.
That is deliberate: the two should never be mistaken for one another in a
stack trace, a bundle, or a code review.

### The frame

Six stages. The geometry pass writes three targets at once — HDR direct light
and emissive, a packed surface buffer (octahedral view normal, roughness,
metallic), and albedo — so there is no depth prepass and no separate G-buffer
pass: the lighting pass already knows everything the later stages need.

```
shadow ×(6 per light) → geometry (3 MRT) → AO → AO blur → resolve → bloom ×9 → final
```

1. Systems run over archetypes. Only entities tagged `Dynamic` are visited by
   the transform system — static geometry composed its matrix once at spawn and
   is never touched again. No dirty-flag branch per object; the question was
   answered by which archetype the entity landed in.
2. Cull. One pass over `LocalToWorld` + `Bounds` columns, writing survivors
   into a flat visibility list and bumping a per-(mesh, material) counter.
3. Counting sort. Prefix-sum the counters into batch offsets, then scatter each
   visible instance into its slot. The instance buffer comes out already
   grouped, in one pass, with no comparison sort.
4. One `writeBuffer`. One vertex buffer bind, one index buffer bind.
5. One `drawIndexed` per batch. `firstInstance` selects the batch's slice, so
   a batch needs no uniform write, no dynamic offset, and no rebind.
6. Resolve. Reflection rays march the depth buffer with a geometrically growing
   step, binary-refine on a crossing, and reject hits thicker than the depth
   buffer can justify. Rays that leave the screen fall back to an analytic sky,
   so a reflective surface is never simply black. Ambient is added here, not in
   the geometry pass, multiplied by occlusion.
7. Bloom and grade. A threshold prefilter, a downsample pyramid, a tent
   upsample that accumulates through an additive blend, then ACES and FXAA.

### Design decisions worth knowing about

- **Reverse-Z is not optional.** `m4perspectiveReverseZ` maps near to 1 and
  infinity to 0, the depth buffer clears to 0 and compares `greater`. Float32
  depth then spends its precision where the scene is instead of hoarding it at
  the near plane. There is no far plane to tune.
- **Entity ids carry a generation.** A destroyed entity's slot is recycled, but
  its id is not: `world.isAlive(staleId)` is `false` rather than silently
  addressing whatever moved in.
- **Swap-remove, always.** Destroying an entity moves the last row into the
  hole and patches one lookup. Columns stay dense; iteration stays linear.
- **Tags cost nothing.** A stride-0 component allocates no column. It only
  changes which archetype the entity belongs to — which is the whole point.
- **Windowed inverse-square falloff.** Lights reach exactly zero at their range,
  so range-based culling can never pop.
- **No MSAA, deliberately.** A multisampled depth buffer cannot be resolved,
  and the reflection march needs to sample depth. FXAA in the resolve pass
  costs one pass and keeps depth readable.
- **Ambient is deferred, and that is the point of it.** Occlusion must multiply
  only the indirect term. Add ambient in the geometry pass and AO has nowhere
  to land but the whole shaded result, which reads as dirt smeared over lit
  surfaces rather than contact darkening. Deferring it costs one more render
  target and buys the difference between "has SSAO" and "looks grounded".
- **A caster that encloses a light cannot occlude it.** The glowing bulb drawn
  at a light's own position would otherwise render into that light's own cube
  map and shadow the entire scene from it. The renderer skips those casters,
  and emissive materials should set `castShadow: false` besides.
- **Shadow maps store back faces.** The shadow pass culls front faces, so a
  surface can never shadow itself, which removes acne as a class of bug rather
  than tuning a bias until it mostly goes away.
- **Metals tint their own reflection.** `f0` is the albedo for a metal, not
  white. Getting this wrong makes every metal read as chrome.
- **Aerial perspective, not flat fog.** Distant surfaces fade toward the sky
  colour *in their own view direction*. Fogging to one constant colour is what
  draws a hard line along the horizon: the ground fades to one colour while the
  sky directly above it is another, and the seam between them is the giveaway.
- **Screen-space effects fade out before they turn into noise.** Past
  `ao.fadeDistance` the occlusion kernel projects to under a pixel, and past
  `ssr.fadeDistance` a reflection ray crosses most of the depth buffer per
  step. Both then hit or miss essentially at random, which reads as dithering
  across the distance. Fading to the analytic environment is honest: no
  occlusion beats invented occlusion.
- **Reflections march in screen space.** The ray is projected once and walked
  about a pixel at a time while 1/z is interpolated — the only depth quantity
  that is linear across a screen-space line. Stepping in view space and
  projecting each sample makes the step length depend on camera orientation,
  which reads as reflections that stretch or squash as you move. The origin is
  lifted off its surface, steps are never sub-pixel, and a hit is a depth
  *overlap* with a thin slab, which together stop a ray from finding its own
  surface: the cause of black seams at contact lines and at the horizon.
- **`sign(0)` is zero in WGSL.** The octahedral normal encoding folds the
  lower hemisphere by multiplying by the sign of each component, so it needs a
  sign that is never zero. With plain `sign()`, a floor seen by a camera tilted
  upward lost its tilt on the way through the G-buffer, and reflections were
  crushed to a fraction of their height. The mirror regression test now
  includes tilted cameras, because a level one sits exactly where this error
  vanishes.
- **One pixel grid everywhere.** Depth lookups use `floor(uv * size)`, and a
  reflection takes its colour with `textureLoad` from exactly the pixel whose
  depth confirmed the hit. Scaling by `size - 1`, or fetching with a filtered
  sample, lets the depth test and the colour come from neighbouring pixels.
- **Procedural surface, not textures.** `noiseScale` above zero switches on
  four-octave fBm evaluated per pixel in world space, driving albedo,
  roughness, metallic and a gradient-derived normal. No UVs to unwrap, no seams,
  no texture memory, and the grain has a real physical size — scale an object up
  and the grain stays put rather than stretching.

## API

### App — the one-liner layer

```js
const app = await AX.App.create(canvas, {
  fov: 60, fogDensity: 0.01, ambient: [0.1, 0.13, 0.19],
  ssr: { intensity: 1, steps: 48, thickness: 0.7, maxDistance: 70 },
  ao: { intensity: 1, radius: 1.9, power: 1.5 },
  bloom: { threshold: 1.1, knee: 0.65, strength: 0.45 },
  shadows: { maxLights: 4, size: 768, pcfRadius: 1.6 },
  cameraPosition: [0, 4, 12], cameraTarget: [0, 0, 0],
});

const cube = app.mesh(AX.roundedBox(1, 1, 1, 0.06, 6));   // beveled edges catch light
const brass = app.material({
  color: [0.8, 0.6, 0.2], metallic: 0.9, roughness: 0.3,
  noiseScale: 1.2, noiseStrength: 0.7, bump: 0.4, oxide: 0.5,   // weathering
});

app.add({ mesh: cube, material: brass, position: [0, 1, 0], spin: [0, 1, 0] });
app.light([5, 8, 5], { color: [1, 0.9, 0.8], intensity: 300, range: 40 });

app.addMany(100000, cube, brass, (i, out) => {    // bulk, no garbage
  out.position[0] = Math.random() * 100 - 50;
  out.scale = 0.3;
  out.color[0] = i / 100000;
}, { dynamic: true });

app.onFrame((dt) => {        // your logic — including the camera
  app.camera.position.set([Math.cos(app.time) * 12, 4, Math.sin(app.time) * 12]);
  app.camera.target.set([0, 0, 0]);
  app.camera.update();
}).start();
console.log(app.stats);     // drawCalls, instances, culled, triangles,
                            // shadowCasters, shadowDraws, shadowLights, cpuMs
```

**Axion reads no input.** No keyboard, mouse or touch handling is built in,
and the camera only moves when your code moves it. Controls belong to the page:
`demo/controls.js` has orbit and fly controllers used by the demos, and
`examples/khan-academy-sponza.html` has a self-contained ES5 fly camera —
copy either, or write your own.

More lights than `shadows.maxLights` is fine: each frame the renderer ranks
lights by intensity and distance to the camera and gives the maps to the ones
that matter, so a scene degrades by losing its least visible shadows rather
than by failing.

### World — the layer underneath

`app.world` is a plain `World`. Nothing in the facade is privileged.

```js
const Health = AX.defineComponent('Health', 'u16', 2);   // kind, stride

world.spawn([AX.Transform, Health], (cols, row) => {
  cols.get(Health.id)[row * 2] = 100;
});

world.addSystem((world, dt) => {
  for (const a of world.query([AX.Transform, Health], [AX.Hidden])) {
    const T = a.columns.get(AX.Transform.id);
    const H = a.columns.get(Health.id);
    for (let r = 0; r < a.count; r++) { /* contiguous memory, no indirection */ }
  }
}, { order: 15 });
```

`query(all, none)` returns cached archetype lists. The inner loop is yours —
the engine never hands you an object to dereference.

### Math

Every function takes `(out, outOffset, a, aOffset, ...)`, so the same call
operates on a standalone vec3 or on row 47,000 of a packed column.

```js
AX.math.m4compose(W, row * 16, T, t, T, t + 3, T, t + 7);
AX.math.frustumFromMatrix(planes, 0, camera.viewProj, 0);
AX.math.sphereInFrustum(planes, 0, cx, cy, cz, radius);
```

## Layout

```
src/
  index.js              public surface
  app.js                ergonomic facade over World + Renderer
  core/math.js          offset-addressed vec3 / quat / mat4 / frustum
  core/ecs.js           archetypes, generational ids, queries, systems
  core/components.js    Transform, LocalToWorld, Bounds, MeshRef, Motion, …
  gpu/device.js         adapter + device + canvas configuration
  gpu/buffers.js        Arena (suballocating) and DynamicBuffer (per-frame)
  render/renderer.js    shadows → cull → counting sort → MRT draws → AO →
                        resolve → bloom → final
  render/shaders.js     WGSL: shadow, GGX + fBm geometry, AO, SSR resolve,
                        bloom, ACES + FXAA — nine programs
  render/camera.js      reverse-Z camera (no input handling)
  geometry/primitives.js box, roundedBox, sphere, icosphere, plane, torus
  systems/transform.js  motion integration, matrix composition
demo/index.html         live viewport with frame telemetry
examples/               a Khan Academy webpage program, CDN-loaded
build.mjs               esbuild -> dist/ (esm + iife + minified iife)
test/smoke.mjs          headless checks (math, ECS, geometry)
test/gpu-validate.mjs   headless GPU harness; runs any page given as an argument
test/regressions.html   pixel-measured checks for bugs that passed everything else
test/trap-check.html    the frame trap fires, attributes correctly, stays quiet
src/debug/frame-trap.js catches one-frame black regions and names the stage
src/loaders/gltf.js     glTF / GLB: pure parser plus GPU upload
src/gpu/textures.js     texture upload, GPU mip generation, 1x1 defaults
demo/sponza.html        fly-through of Crytek Sponza
scripts/fetch-sponza.mjs downloads the full-resolution Sponza
```

## Loading models

```js
const scene = await AX.loadGLTF(app, './assets/sponza.glb', {
  onProgress: (stage, done, total) => console.log(stage, done, total),
});
// { entities, bounds, triangles, primitives, materials, textures }
```

`.gltf` (external or `data:` buffers) and `.glb` both work. Node transforms
are baked into the vertices at load, so a static scene costs nothing per node
at draw time and every primitive gets an exact bounding sphere for culling.
Normals go through the inverse transpose, and mirrored nodes have their
winding flipped so front faces stay front faces.

Materials read `pbrMetallicRoughness` base colour and metallic-roughness
textures and factors, normal maps, `alphaMode` `MASK` (tested in both the
geometry and the shadow pass, so leaves cast leaf-shaped shadows) and
`doubleSided` (back faces are lit from behind). Textures upload with a full
mip chain generated on the GPU in linear light, and sample with trilinear,
8x anisotropic filtering.

Normal maps need no tangent attribute: the tangent frame is rebuilt per pixel
from screen-space derivatives of position and UV, so the vertex format stays 32
bytes for everything.

Not yet: skinning, morph targets, node animation, emissive and occlusion
textures, `KHR_` extensions, blended (`BLEND`) transparency.

### Sponza

`demo/sponza.html` flies through Crytek Sponza — 262k triangles, 69 textures —
lit by moving, shadowed torches and a skylight.

```bash
npm run fetch:sponza  # full-resolution originals into demo/assets/sponza/
npm run dev           # then open http://localhost:8080/sponza.html
```

Without the fetch it falls back to `demo/assets/sponza.glb`, a packed build
with 512px textures and the unused tangents stripped (10.8 MB). Neither is
committed. `npm run test:sponza` loads it through the public loader and
renders it headlessly.

## Lighting and camera features

All off-by-default features are plain fields on `app.renderer`, live-editable:

```js
const r = app.renderer;
r.ssil.intensity = 1;  r.ssil.radius = 3;          // screen-space indirect light (1 bounce)
r.volumetric.enabled = true;                          // volumetric fog with shadowed light shafts
Object.assign(r.volumetric, { density: 0.015, heightFalloff: 0.1, anisotropy: 0.3, steps: 24 });
r.autoExposure.enabled = true;                        // GPU-metered, eases to middle grey
Object.assign(r.dof, { enabled: true, autoFocus: true, range: 1.5, transition: 4, amount: 8 });  // depth of field
r.tonemap.mode = 'agx';                               // 'linear' | 'reinhard' | 'filmic' | 'aces' | 'agx'
Object.assign(r.tonemap, { white: 6, brightness: 1, contrast: 1, saturation: 1 });
// Physical units: light intensity in lumens, exposure from a real camera.
Object.assign(r.physical, { enabled: true, aperture: 2.8, shutter: 1 / 30, iso: 400, compensation: 0 });
```

- **SSIL** reuses the AO march's slice directions with its own radius and adds one
  diffuse bounce of the direct light, tinted by the receiving surface. Half res.
- **Volumetric fog** marches each view ray through a height-falling medium,
  Henyey-Greenstein phase, one shadow-map tap per light per step (so light
  shafts follow the shadows), energy-conserving integration. Half res, 4x4
  interleaved start offsets, depth-aware blur.
- **Auto exposure** is a single compute workgroup that measures the resolved
  frame; the result never leaves the GPU.
- **Physical camera:** EV100 = log2(N² / t · 100 / ISO), exposure = 1 / (1.2 · 2^EV100).
  Ambient is then luminance (nits). Bloom's threshold is measured after exposure,
  so it means the same in either unit system.

`npm run test:features` renders Sponza through each of these and checks that
each one changes the frame, stays finite, and (for the physical camera) that
matching settings reproduce the non-physical image.

## Big outdoor worlds

Version 0.9 adds what a large open map needs. `examples/khan-academy-valley.html`
uses all of it: a 1.5 km valley with about 52,000 placed objects.

```js
const app = await AX.App.create(canvas, {
  sun: { elevation: 20, azimuth: 150, intensity: 3.4, shadows: { size: 2048, distance: 230 } },
  sky: { clouds: 0.4, haze: 0.9, cloudShadows: 0.3 },
  wind: { direction: [0.8, 0.6], strength: 0.8 },
  fogDensity: 0.0006, fogHeight: { base: 0, falloff: 0.009 },
  lodBias: 1,                                    // below 1 faster, above 1 sharper
});

// Level of detail: one mesh id that draws the right level per object.
const tree = app.lod([{ mesh: hi, distance: 0 }, { mesh: mid, distance: 40 }, { mesh: card, distance: 200 }],
  { drawDistance: 2000 });

// Heightmap terrain: CDLOD patches, splat layers, rock on slopes, snow, water, grass.
const ground = app.terrain({
  heights, size: 1536,                           // Float32Array, n * n with n = 2^k + 1
  layers: [{ albedo, normal, scale: 3 }, /* up to 5 blended by the splat */],
  splat: { data, size: 512 },
  rock: { layer: 4, slope: [0.42, 0.62] },
  snow: { height: [215, 280], slope: 0.5 },
  water: { level: 0, clarity: 0.85, waves: 0.6 },
  grass: { radius: 55, height: 0.42, bladesPerTile: 640 },
});
ground.heightAt(x, z);                           // the exact height the GPU draws

// A model library (a GLB with LOD levels, colliders and extras per model)
const { models } = await AX.loadModels(app, AxionAssets['valley-trees']);
app.place(models.pine_a, placements);            // x, y, z, yaw, scale per copy
```

- **Sun and sky:** a directional sun with four cascaded shadow maps (texel
  snapping, staggered redraws, dithered cascade blend) and a single-scattering
  atmosphere, so the sky, the sunlight colour and the ambient all follow the sun
  angle. Clouds move and cast shadows. `app.renderer.setSunAngles(elev, azim)`.
- **Culling for many objects:** instances are grouped into 32 m cells; whole
  cells are culled and LOD-picked before single objects are looked at. Shadow
  casters use one LOD coarser than the camera.
- **Terrain:** one draw for the ground, one for the water, one for the grass,
  from a shared grid mesh; geomorphing so levels never pop; mipmapped normals and
  distance-averaged layers so far slopes do not shimmer or show texture repeats.
- **Foliage materials:** `wind`, `flutter` and `translucency` on `app.material`.
- **Reflections** run in their own pass and go through the same 4x4 depth-aware
  blur as AO, so water reflects far shores smoothly instead of in stipple. The
  ray's end fade is measured along the ray, so far mountains reflect too.

Collision is left to the page, like input. The valley example shows a cheap
approach: terrain height from `heightAt`, trees as upright cylinders, and
triangles built only for the objects within a few metres of the player, dropped
again when they are left behind.

## Packed models (one script, no fetch)

`assets/sponza.js` is the whole Sponza scene — quantized geometry
(`KHR_mesh_quantization`), 69 WebP textures at 1024 px — as a GLB, gzipped and
base64'd into one script (~16 MB, under jsDelivr's 20 MB per-file cap). Load it
with a script tag and hand it to the loader:

```html
<script src="https://cdn.jsdelivr.net/gh/SwankyMan88/Axion@v0.5.0/dist/axion.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/SwankyMan88/Axion@v0.5.0/assets/sponza.js"></script>
<script>
  const app = await Axion.App.create(canvas);
  await Axion.loadGLTF(app, AxionAssets.sponza);
</script>
```

This works where `fetch()` is blocked but CDN scripts are allowed — Khan
Academy's case. See `examples/khan-academy-sponza.html`. Rebuild with
`npm run fetch:sponza && npm run pack:sponza` (`--size`, `--quality` to trade
size for detail). Credits: `assets/NOTICE.md`.

## Debugging a one-frame glitch

`createFrameTrap` catches a transient black region and freezes on it. Each
frame it copies the centre of the presented image and of the HDR target back
to the CPU, and on the first frame whose centre suddenly goes black it stops
the loop and reports which stage produced it — `hdr` (geometry, reflections,
occlusion, resolve) or `post` (bloom, tonemap, FXAA).

```js
const app = await AX.App.create(canvas, { canvasUsage: GPUTextureUsage.COPY_SRC });
const trap = AX.createFrameTrap(app, { onCatch: (report) => console.warn(report) });
app.onAfterRender(() => trap.capture());
trap.enabled = true;
```

Its most useful answer is the one it gives by staying silent: if you can see a
black box and the trap never fires, the box is not in any frame the engine
rendered — it is being added after presentation, by the browser's compositor
or the display driver. The demo has this on its **trap** toggle.

## Shipping it

```bash
npm run build      # dist/axion.esm.js, dist/axion.js, dist/axion.min.js (~81 KB)
```

The IIFE builds expose a global `Axion`, for pages that cannot use modules.
Push a tag to GitHub and jsDelivr serves it with no publishing step:

```html
<script src="https://cdn.jsdelivr.net/gh/SwankyMan88/Axion@v0.5.0/dist/axion.min.js"></script>
<script>
  const app = await Axion.App.create(document.querySelector('canvas'));
</script>
```

Pin the tag. `@main` is served with a short cache and can change under you
mid-session.

`examples/khan-academy.html` is a complete KA webpage program using exactly
this. Two caveats live in that file: KA's Content Security Policy allows
jsDelivr for JavaScript but not for CSS, and KA programs run in a sandboxed
iframe where WebGPU availability depends on the browser and the frame's
permissions — the example detects and reports both rather than leaving a black
canvas.

## Running it

```bash
npm run dev           # http://localhost:8080 — ES modules need http, not file://
npm test              # 23 headless checks, no GPU required

npm i -D playwright   # optional: compile every shader, validate every pipeline
npm run test:gpu      # against Dawn, headless, and render three frames
npm run test:bundle   # load the minified CDN build through a plain script tag
```

`npm run test:gpu` runs three pages. `test/regressions.html` holds checks that
exist because a bug passed every other test: a pole on a mirror floor must
reflect at the same height as it stands (a physical invariant — the reflection
of its top is as far below the contact line as the top is above it), measured
at four camera heights; and no target may ever hold a non-finite value.
`test/trap-check.html` proves the frame trap fires on a black frame, names the
right stage, and stays quiet on ordinary ones.

`test/gpu-validate.mjs` is the one that catches the mistakes unit tests cannot:
a WGSL type error, a struct whose layout disagrees with the buffer feeding it,
a bind group that does not match its layout. It renders with a software adapter,
so it needs no GPU and runs in CI.

It also *measures*. After rendering, it copies the AO buffer, the resolved HDR
target and the bloom pyramid back to the CPU and asserts that occlusion
actually occludes, that shadows actually darken the frame, and that the bloom
chain actually produces light. A pass that silently returns a no-op value
compiles, validates and renders perfectly — only reading the pixels back finds
it. This is how the bulb-shadowing bug above was caught.

Requires WebGPU: Chrome/Edge 113+, Safari 18+, or Firefox with
`dom.webgpu.enabled`.

## Not built yet

Real-time global illumination beyond SSIL (Godot's SDFGI or VoxelGI): both
need a 3D distance-field or voxel representation of the scene rebuilt in
compute as the camera moves — a subsystem on the scale of the whole renderer.
SSIL covers the near-field bounce you can see; off-screen and multi-bounce
light is what those add. Reflection probes are the other big gap against Godot.

Honest list, in the order they'd matter: temporal anti-aliasing and reprojection
— it would denoise SSR and AO together and replace FXAA, and it is the
single biggest quality win left; GPU-driven culling in a compute pass with
`drawIndexedIndirect`; clustered light assignment (the fragment loop is still
over all lights in range); planar reflections for large still water; a mip
chain on the scene color so rough reflections blur instead of staying sharp;
skinned meshes; a transform hierarchy (transforms are flat today); transparency
sorting; a worker-parallel system scheduler.

**Known issue: specular highlights on very smooth surfaces are too dim.** The
GGX distribution floors its denominator at `1e-5` to avoid dividing by zero,
but for roughness below about 0.2 the true denominator is far smaller, so the
peak is capped — on the demo's wet floor (roughness 0.1), by roughly 300×. The
fix is a smaller floor plus a clamp on the lit result below the fp16 limit of
the HDR target, so an exact highlight cannot overflow to infinity. It changes
how every glossy material looks, so it is deliberately a separate change.

Shadow cost scales with shadowed lights, not with scene size: four lights is
twenty-four depth passes. Casters are culled per light against its range, and
`shadows.maxCasters` bounds the CPU side, but a scene with a hundred thousand
shadow casters wants the GPU-driven path above, not this one.

MIT.
