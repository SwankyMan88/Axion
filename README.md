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
  controls: { distance: 40, autoRotate: 0.05 },   // fly: { speed: 10 } too
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

app.onFrame((dt) => { /* your logic */ }).start();
app.setCameraMode('fly');   // WASD + mouse-look; 'orbit' to go back
console.log(app.stats);     // drawCalls, instances, culled, triangles,
                            // shadowCasters, shadowDraws, shadowLights, cpuMs
```

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
  render/camera.js      reverse-Z camera, orbit controls, free-fly controls
  geometry/primitives.js box, roundedBox, sphere, icosphere, plane, torus
  systems/transform.js  motion integration, matrix composition
demo/index.html         live viewport with frame telemetry
examples/               a Khan Academy webpage program, CDN-loaded
build.mjs               esbuild -> dist/ (esm + iife + minified iife)
test/smoke.mjs          headless checks (math, ECS, geometry)
test/gpu-validate.mjs   headless GPU validation + measured pass checks
```

## Shipping it

```bash
npm run build      # dist/axion.esm.js, dist/axion.js, dist/axion.min.js (~81 KB)
```

The IIFE builds expose a global `Axion`, for pages that cannot use modules.
Push a tag to GitHub and jsDelivr serves it with no publishing step:

```html
<script src="https://cdn.jsdelivr.net/gh/SwankyMan88/Axion@v0.2.0/dist/axion.min.js"></script>
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

Honest list, in the order they'd matter: temporal anti-aliasing and reprojection
— it would denoise SSR and AO together and replace FXAA, and it is now the
single biggest quality win left; GPU-driven culling in a compute pass with
`drawIndexedIndirect`; clustered light assignment (the fragment loop is still
over all lights in range); cascaded shadow maps for a directional sun, since
only point lights cast today; a mip chain on the scene color so rough
reflections blur instead of staying sharp; glTF loading; textures and a
sampler/bind-group cache; skinned meshes; a transform hierarchy (transforms are
flat today); transparency sorting; a worker-parallel system scheduler.

Shadow cost scales with shadowed lights, not with scene size: four lights is
twenty-four depth passes. Casters are culled per light against its range, and
`shadows.maxCasters` bounds the CPU side, but a scene with a hundred thousand
shadow casters wants the GPU-driven path above, not this one.

MIT.
