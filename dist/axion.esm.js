/*! Axion 0.8.0 — WebGPU, data-oriented 3D engine. MIT. */
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/gpu/device.js
var UnsupportedError = class extends Error {
};
async function createDevice(canvas, {
  powerPreference = "high-performance",
  requiredFeatures = [],
  alphaMode = "opaque",
  canvasUsage = 0
  // extra GPUTextureUsage bits for the swapchain, e.g. COPY_SRC
} = {}) {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new UnsupportedError(
      "WebGPU is not available in this browser. Axion requires WebGPU (Chrome/Edge 113+, Safari 18+, or Firefox with dom.webgpu.enabled)."
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference });
  if (!adapter) throw new UnsupportedError("No suitable GPU adapter found.");
  const features = requiredFeatures.filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(
        adapter.limits.maxStorageBufferBindingSize,
        512 * 1024 * 1024
      )
    }
  });
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | canvasUsage
  });
  const info = {
    vendor: adapter.info?.vendor ?? "unknown",
    architecture: adapter.info?.architecture ?? "unknown",
    features: [...device.features],
    limits: adapter.limits
  };
  device.lost.then((reason) => {
    console.error("[axion] GPU device lost:", reason.message);
  });
  device.addEventListener?.("uncapturederror", (e) => {
    console.error("[axion] GPU error:", e.error?.message ?? e.error);
  });
  return { device, context, format, adapter, info };
}
function resizeCanvas(canvas, maxDpr = 2) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

// src/gpu/buffers.js
var align = (n, a) => Math.ceil(n / a) * a;
var RETIRE_FRAMES = 3;
var graveyard = [];
function retire(resource) {
  if (resource) graveyard.push({ resource, age: 0 });
}
function sweepRetired() {
  for (let i = graveyard.length - 1; i >= 0; i--) {
    if (++graveyard[i].age > RETIRE_FRAMES) {
      graveyard[i].resource.destroy();
      graveyard.splice(i, 1);
    }
  }
}
var Arena = class {
  constructor(device, usage, initialBytes = 1 << 20, label = "arena") {
    this.device = device;
    this.usage = usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.label = label;
    this.capacity = align(initialBytes, 256);
    this.offset = 0;
    this.buffer = device.createBuffer({ size: this.capacity, usage: this.usage, label });
  }
  /** Reserve `bytes`, returning the byte offset. Grows (and copies) if needed. */
  alloc(bytes, alignment = 4) {
    const start = align(this.offset, alignment);
    const end = start + bytes;
    if (end > this.capacity) this._grow(end);
    this.offset = end;
    return start;
  }
  write(byteOffset, data) {
    this.device.queue.writeBuffer(
      this.buffer,
      byteOffset,
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
  }
  /** Alloc + write in one step. */
  upload(data, alignment = 4) {
    const off = this.alloc(data.byteLength, alignment);
    this.write(off, data);
    return off;
  }
  _grow(needed) {
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    const next = this.device.createBuffer({ size: cap, usage: this.usage, label: this.label });
    const enc = this.device.createCommandEncoder({ label: `${this.label}-grow` });
    enc.copyBufferToBuffer(this.buffer, 0, next, 0, this.offset);
    this.device.queue.submit([enc.finish()]);
    retire(this.buffer);
    this.buffer = next;
    this.capacity = cap;
  }
  destroy() {
    this.buffer.destroy();
  }
};
var DynamicBuffer = class {
  constructor(device, usage, floatCapacity, label = "dynamic") {
    this.device = device;
    this.usage = usage | GPUBufferUsage.COPY_DST;
    this.label = label;
    this.cpu = new Float32Array(floatCapacity);
    this.buffer = device.createBuffer({
      size: align(this.cpu.byteLength, 256),
      usage: this.usage,
      label
    });
  }
  ensure(floats) {
    if (floats <= this.cpu.length) return;
    let n = this.cpu.length;
    while (n < floats) n *= 2;
    const next = new Float32Array(n);
    next.set(this.cpu);
    this.cpu = next;
    retire(this.buffer);
    this.buffer = this.device.createBuffer({
      size: align(this.cpu.byteLength, 256),
      usage: this.usage,
      label: this.label
    });
  }
  /** Upload only the first `floats` elements actually written this frame. */
  flush(floats) {
    if (floats === 0) return;
    this.device.queue.writeBuffer(
      this.buffer,
      0,
      this.cpu.buffer,
      this.cpu.byteOffset,
      floats * 4
    );
  }
  destroy() {
    this.buffer.destroy();
  }
};

// src/gpu/textures.js
var MIP_WGSL = (
  /* wgsl */
  `
@group(0) @binding(0) var srcSampler : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct Out { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> Out {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o : Out;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@fragment
fn fs(i : Out) -> @location(0) vec4<f32> {
  return textureSampleLevel(src, srcSampler, i.uv, 0.0);
}
`
);
var mipState = /* @__PURE__ */ new WeakMap();
function mipPipeline(device, format) {
  let st = mipState.get(device);
  if (!st) {
    st = {
      module: device.createShaderModule({ code: MIP_WGSL, label: "axion-mip" }),
      sampler: device.createSampler({ minFilter: "linear", magFilter: "linear" }),
      pipelines: /* @__PURE__ */ new Map()
    };
    mipState.set(device, st);
  }
  let p = st.pipelines.get(format);
  if (!p) {
    p = device.createRenderPipeline({
      label: `axion-mip-${format}`,
      layout: "auto",
      vertex: { module: st.module, entryPoint: "vs" },
      fragment: { module: st.module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    st.pipelines.set(format, p);
  }
  return { pipeline: p, sampler: st.sampler };
}
var mipLevelsFor = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;
function generateMips(device, texture) {
  const { pipeline, sampler } = mipPipeline(device, texture.format);
  const enc = device.createCommandEncoder({ label: "axion-mips" });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) }
      ]
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}
function textureFromImage(device, image, { srgb = true, mips = true, label = "axion-texture" } = {}) {
  const format = srgb ? "rgba8unorm-srgb" : "rgba8unorm";
  const w = image.width, h = image.height;
  const texture = device.createTexture({
    label,
    format,
    size: [w, h],
    mipLevelCount: mips ? mipLevelsFor(w, h) : 1,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture({ source: image }, { texture }, [w, h]);
  if (mips && texture.mipLevelCount > 1) generateMips(device, texture);
  return texture;
}
function solidTexture(device, rgba, { srgb = false, label = "axion-solid" } = {}) {
  const texture = device.createTexture({
    label,
    size: [1, 1],
    format: srgb ? "rgba8unorm-srgb" : "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}

// src/render/shaders.js
var COMMON = (
  /* wgsl */
  `
struct Camera {
  viewProj : mat4x4<f32>,
  view     : mat4x4<f32>,
  invView  : mat4x4<f32>,
  position : vec4<f32>,   // xyz = eye, w = time
  params   : vec4<f32>,   // x = lightCount, y = exposure, z = fogDensity, w = fxaa
  ambient  : vec4<f32>,   // rgb = sky ambient, a = ground ambient scale
  fog      : vec4<f32>,   // rgb = fog color, a = aerial perspective blend
  proj     : vec4<f32>,   // x = P[0][0], y = P[1][1], z = near, w = aspect
  ssr      : vec4<f32>,   // x = intensity, y = steps, z = thickness, w = maxDistance
  screen   : vec4<f32>,   // x = width, y = height, z = 1/width, w = 1/height
  ao       : vec4<f32>,   // x = intensity, y = radius, z = power, w = bias
  bloom    : vec4<f32>,   // x = threshold, y = knee, z = strength, w = unused
  shadow   : vec4<f32>,   // x = map size, y = pcf radius, z = normal bias, w = unused
  fade     : vec4<f32>,   // x = AO fade distance, y = SSR fade distance, zw = unused
  ssil     : vec4<f32>,   // x = indirect light intensity, y = radius, zw = unused
  vol      : vec4<f32>,   // x = density, y = steps, z = anisotropy g, w = max distance
  vol2     : vec4<f32>,   // x = height base, y = height falloff, z = ambient scatter, w = light scatter
  volColor : vec4<f32>,   // rgb = scattering albedo, a = enabled
  tone     : vec4<f32>,   // x = mode (0 linear, 1 reinhard, 2 filmic, 3 aces, 4 agx), y = white, z = contrast, w = saturation
  grade    : vec4<f32>,   // x = brightness, y = auto exposure on, z = compensation (stops), w = auto key
  expo     : vec4<f32>,   // x = min log2 exposure, y = max log2 exposure, z = adapt speed, w = frame dt
  dof      : vec4<f32>,   // x = focus distance, y = in-focus half range, z = transition, w = max blur px
  dof2     : vec4<f32>,   // x = near on, y = far on, z = auto focus, w = enabled
  pad      : vec4<f32>,
};

const PI : f32 = 3.14159265359;

/**
 * Clamp a radiance value to something every later pass can survive.
 *
 * One NaN or Inf pixel in the HDR target is invisible on its own, but the
 * bloom pyramid averages it into every texel it touches on the way down and
 * back up, and the frame comes out with a solid black RECTANGLE where the
 * poisoned mip texels land. The check is done on the bits, not with x != x,
 * because shader compilers running fast-math may fold that comparison to
 * false. Negative radiance is clamped too: pow() of a negative is NaN.
 */
fn sanitize(c : vec3<f32>) -> vec3<f32> {
  let bits = bitcast<vec3<u32>>(c) & vec3<u32>(0x7f800000u);
  let bad = bits == vec3<u32>(0x7f800000u);
  return select(clamp(c, vec3<f32>(0.0), vec3<f32>(60000.0)), vec3<f32>(0.0), bad);
}

/**
 * Normalize that cannot produce NaN.
 *
 * A zero-length vector out of normalize() poisons every subsequent operation,
 * and a NaN fragment reads as a black hole in the frame. Bump mapping can
 * cancel a normal exactly, so this is not theoretical.
 */
fn safeNormalize(v : vec3<f32>, fallback : vec3<f32>) -> vec3<f32> {
  let l2 = dot(v, v);
  if (l2 < 1e-12) { return fallback; }
  return v * inverseSqrt(l2);
}

/**
 * Interleaved 4x4 sample rotation.
 *
 * Per-pixel white noise cannot be removed by a small blur \u2014 that is what
 * leaves the dithered crust on distant ground. Sixteen rotations laid out on a
 * repeating 4x4 tile can: any four consecutive pixels cover every residue, so
 * a 4x4 box blur averages exactly one complete set of directions and the noise
 * integrates away instead of smearing.
 */
fn interleavedIndex(pixel : vec2<f32>) -> i32 {
  let p = vec2<i32>(pixel);
  return (p.x & 3) + ((p.y & 3) << 2);
}

/**
 * sign() that never returns 0.
 *
 * WGSL's sign(0.0) is 0. The octahedral fold multiplies by the sign of each
 * component, so a normal with an exactly-zero component in the lower
 * hemisphere had that axis erased \u2014 and a floor seen by a camera tilted
 * upward is precisely that case. Its normal came back tilted by the camera's
 * own pitch, which at grazing angles bent reflections upward hard enough to
 * crush them into a thin band, and where the component flickered around zero
 * from pixel to pixel it produced horizontal stripes.
 */
fn signNotZero(v : vec2<f32>) -> vec2<f32> {
  return select(vec2<f32>(-1.0), vec2<f32>(1.0), v >= vec2<f32>(0.0));
}

fn octEncode(n : vec3<f32>) -> vec2<f32> {
  let d = n / (abs(n.x) + abs(n.y) + abs(n.z) + 1e-6);
  if (d.z >= 0.0) { return d.xy; }
  return (vec2<f32>(1.0) - abs(d.yx)) * signNotZero(d.xy);
}

fn octDecode(e : vec2<f32>) -> vec3<f32> {
  var n = vec3<f32>(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    let t = (vec2<f32>(1.0) - abs(n.yx)) * signNotZero(n.xy);
    n = vec3<f32>(t.x, t.y, n.z);
  }
  return normalize(n);
}

/**
 * Reverse-Z with an infinite far plane collapses to one term:
 *   depth = near / -z_view,  so  -z_view = near / depth.
 * No far plane appears, which is exactly why there is none to tune.
 */
fn linearDepth(d : f32, near : f32) -> f32 {
  return near / max(d, 1e-7);
}

fn viewPosFromUV(uv : vec2<f32>, d : f32, proj : vec4<f32>) -> vec3<f32> {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let dist = linearDepth(d, proj.z);
  return vec3<f32>(ndc.x * dist / proj.x, ndc.y * dist / proj.y, -dist);
}

// Analytic environment: a three-band sky over a dim ground. It costs nothing
// and gives metal something to reflect when a screen-space ray runs out of
// screen \u2014 the difference between "reflective" and "black".
fn sampleEnvironment(dir : vec3<f32>, roughness : f32, ambient : vec3<f32>) -> vec3<f32> {
  let up = clamp(dir.y, -1.0, 1.0);
  let sky = ambient * 1.7;
  let horizon = ambient * 2.1 + vec3<f32>(0.025, 0.022, 0.020);
  let ground = ambient * 0.40;

  var env = mix(ground, horizon, smoothstep(-0.25, 0.22, up));
  env = mix(env, sky, smoothstep(0.05, 0.85, up));
  env = env + vec3<f32>(pow(max(up, 0.0), 8.0) * 0.30);

  let avg = (sky + horizon + ground) / 3.0;
  return mix(env, avg, roughness * roughness);
}

/**
 * The full-resolution pixel containing a UV: floor(uv * size), clamped.
 *
 * This must match the rasterizer's pixel grid exactly. Scaling by (size - 1)
 * instead \u2014 an easy slip \u2014 shifts the lookup by up to a whole pixel, worst in
 * the middle of the screen, so a depth test and the colour fetched for the
 * same "hit" can come from two different pixels.
 */
fn pixelOf(uv : vec2<f32>) -> vec2<i32> {
  let size = vec2<i32>(camera.screen.xy);
  return clamp(vec2<i32>(floor(uv * camera.screen.xy)), vec2<i32>(0), size - vec2<i32>(1));
}

/** Fullscreen triangle from the vertex index alone \u2014 no vertex buffer. */
struct FSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

fn fullscreen(vi : u32) -> FSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = pos[vi];
  var out : FSOut;
  out.clip = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}
`
);
var CUBE_FACES = [
  { f: [1, 0, 0], u: [0, -1, 0] },
  { f: [-1, 0, 0], u: [0, -1, 0] },
  { f: [0, 1, 0], u: [0, 0, 1] },
  { f: [0, -1, 0], u: [0, 0, -1] },
  { f: [0, 0, 1], u: [0, -1, 0] },
  { f: [0, 0, -1], u: [0, -1, 0] }
];
var CUBE_WGSL = (
  /* wgsl */
  `
const FACE_F = array<vec3<f32>, 6>(
  vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(-1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, -1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, -1.0));
const FACE_U = array<vec3<f32>, 6>(
  vec3<f32>(0.0, -1.0, 0.0), vec3<f32>(0.0, -1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, -1.0),
  vec3<f32>(0.0, -1.0, 0.0), vec3<f32>(0.0, -1.0, 0.0));

fn faceIndex(v : vec3<f32>) -> i32 {
  let a = abs(v);
  if (a.x >= a.y && a.x >= a.z) { return select(1, 0, v.x > 0.0); }
  if (a.y >= a.z) { return select(3, 2, v.y > 0.0); }
  return select(5, 4, v.z > 0.0);
}
`
);
var MATERIAL_WGSL = (
  /* wgsl */
  `
/* Material textures: group 1, identical layout in the geometry and the
   alpha-tested shadow pass. Untextured materials bind 1x1 defaults. */
struct MaterialParams {
  alphaCutoff : f32,   // 0 = opaque; otherwise discard below this alpha
  normalScale : f32,
  hasNormalMap : f32,
  pad : f32,
};
@group(1) @binding(0) var matSampler : sampler;
@group(1) @binding(1) var baseColorTex : texture_2d<f32>;
@group(1) @binding(2) var metalRoughTex : texture_2d<f32>;   // glTF: G = roughness, B = metallic
@group(1) @binding(3) var normalTex : texture_2d<f32>;
@group(1) @binding(4) var<uniform> material : MaterialParams;
`
);
var SHADOW_WGSL = (
  /* wgsl */
  `
struct Face {
  viewProj : mat4x4<f32>,
};

// Same layout as the geometry pass's instances; only the matrix is read here.
struct Caster {
  model : mat4x4<f32>,
  rest  : array<vec4<f32>, 3>,
};

@group(0) @binding(0) var<uniform> face : Face;
@group(0) @binding(1) var<storage, read> instances : array<Caster>;
@group(0) @binding(2) var<storage, read> casters : array<u32>;

@vertex
fn vs(@builtin(instance_index) ii : u32,
      @location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
  return face.viewProj * (instances[casters[ii]].model * vec4<f32>(position, 1.0));
}

/* Alpha-tested casters: leaves, chains, grilles. Without this they cast solid
   rectangular shadows the shape of their cards. */
${MATERIAL_WGSL}

struct MaskOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMask(@builtin(instance_index) ii : u32,
          @location(0) position : vec3<f32>,
          @location(2) uv : vec2<f32>) -> MaskOut {
  var o : MaskOut;
  o.pos = face.viewProj * (instances[casters[ii]].model * vec4<f32>(position, 1.0));
  o.uv = uv;
  return o;
}

@fragment
fn fsMask(in : MaskOut) {
  if (textureSample(baseColorTex, matSampler, in.uv).a < material.alphaCutoff) { discard; }
}
`
);
var STANDARD_WGSL = (
  /* wgsl */
  `
${COMMON}
${CUBE_WGSL}

struct Instance {
  model : mat4x4<f32>,
  color : vec4<f32>,   // rgb = albedo tint, a = alpha
  pbr   : vec4<f32>,   // x = metallic, y = roughness, z = emissive, w = unused
  surf  : vec4<f32>,   // x = noise scale, y = noise strength, z = bump, w = oxide
};

struct Light {
  posRange   : vec4<f32>,  // xyz = world position, w = range
  colorPower : vec4<f32>,  // rgb = color, a = intensity
  shadowInfo : vec4<f32>,  // x = shadow slot (-1 = none), y = near, z = bias, w = far
};

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var<storage, read> instances : array<Instance>;
@group(0) @binding(2) var<storage, read> lights : array<Light>;
@group(0) @binding(3) var shadowMaps : texture_depth_2d_array;
@group(0) @binding(4) var shadowSampler : sampler_comparison;
// Slots that survived culling this frame; instance_index walks this list.
@group(0) @binding(5) var<storage, read> visible : array<u32>;
${MATERIAL_WGSL}
struct VSOut {
  @invariant @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) normal     : vec3<f32>,
  @location(2) uv         : vec2<f32>,
  // Per-object values: flat, so the rasterizer copies them instead of interpolating.
  @location(3) @interpolate(flat) color : vec4<f32>,
  @location(4) @interpolate(flat) pbr   : vec4<f32>,
  @location(5) @interpolate(flat) surf  : vec4<f32>,
};

struct GBuffer {
  @location(0) color   : vec4<f32>,
  @location(1) surface : vec4<f32>,
  @location(2) albedo  : vec4<f32>,
};

@vertex
fn vs(
  @builtin(instance_index) ii : u32,
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
) -> VSOut {
  let inst = instances[visible[ii]];
  let world = inst.model * vec4<f32>(position, 1.0);
  let n = normalize((inst.model * vec4<f32>(normal, 0.0)).xyz);

  var out : VSOut;
  out.clip = camera.viewProj * world;
  out.worldPos = world.xyz;
  out.normal = n;
  out.uv = uv;
  out.color = inst.color;
  out.pbr = inst.pbr;
  out.surf = inst.surf;
  return out;
}

/*
 * Depth prepass. Same math as vs above, and both outputs are @invariant, so
 * the main pass can test depth for equality and shade every pixel once.
 */
@vertex
fn vsDepth(@builtin(instance_index) ii : u32,
           @location(0) position : vec3<f32>) -> @invariant @builtin(position) vec4<f32> {
  let inst = instances[visible[ii]];
  let world = inst.model * vec4<f32>(position, 1.0);
  return camera.viewProj * world;
}

/* ----------------------------------------------------------- noise ----- */

fn hash31(p : vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.1, 0.1));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

/** Trilinear value noise with a smootherstep fade \u2014 no visible lattice. */
fn valueNoise(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));

  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

/** Four-octave fBm. Lacunarity 2.02 to keep octaves from lining up. */
fn fbm(p : vec3<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var freq = p;
  for (var i = 0; i < 4; i = i + 1) {
    sum = sum + valueNoise(freq) * amp;
    freq = freq * 2.02;
    amp = amp * 0.5;
  }
  return sum;
}

/* ---------------------------------------------------------- shadowing --- */

/**
 * Point-light shadow lookup.
 *
 * The stored value is the cube-face projected depth, so the reference depth
 * reduces to a single reciprocal of the major-axis distance \u2014 no per-pixel
 * matrix multiply, no six-way projection test, just the face basis this file
 * and the JS side both read from one table.
 *
 * PCF taps use a Vogel disk: evenly spaced by construction, so the penumbra
 * reads as a smooth gradient instead of the grid stipple a box kernel leaves.
 */
fn sampleShadow(slot : i32, toFrag : vec3<f32>, nDotL : f32,
                near : f32, bias : f32, far : f32) -> f32 {
  let face = faceIndex(toFrag);
  let F = FACE_F[face];
  let U = FACE_U[face];
  let R = cross(F, U);

  let ma = dot(toFrag, F);
  if (ma <= near) { return 1.0; }

  let sc = dot(toFrag, R) / ma;
  let tc = dot(toFrag, U) / ma;
  if (abs(sc) > 1.0 || abs(tc) > 1.0) { return 1.0; }

  let uv = vec2<f32>(sc * 0.5 + 0.5, 0.5 - tc * 0.5);

  // depth = A - B/distance, the exact inverse of the cube-face projection.
  let A = far / (far - near);
  let B = near * far / (far - near);

  // Slope-scaled bias: a surface nearly edge-on to the light needs far more
  // tolerance than one facing it, and a constant bias has to be set for the
  // worst case, which detaches every contact shadow.
  let slope = clamp(1.0 - nDotL, 0.0, 1.0);
  let d = ma * (1.0 + bias * (0.35 + slope * 3.0));
  let refDepth = A - B / d;

  let texel = camera.shadow.y / camera.shadow.x;
  let layer = slot * 6 + face;

  var sum = 0.0;
  let rot = fract(sin(dot(toFrag.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  for (var i = 0; i < 12; i = i + 1) {
    let r = sqrt((f32(i) + 0.5) / 12.0);
    let theta = f32(i) * 2.39996323 + rot;
    let offset = vec2<f32>(cos(theta), sin(theta)) * r * texel;
    sum = sum + textureSampleCompareLevel(shadowMaps, shadowSampler, uv + offset, layer, refDepth);
  }
  return sum / 12.0;
}

/* ---------------------------------------------------------- lighting --- */

fn distributionGGX(nDotH : f32, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-5);
}

fn geometrySmith(nDotV : f32, nDotL : f32, roughness : f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  let gv = nDotV / (nDotV * (1.0 - k) + k);
  let gl = nDotL / (nDotL * (1.0 - k) + k);
  return gv * gl;
}

fn fresnelSchlick(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fs(in : VSOut, @builtin(front_facing) front : bool) -> GBuffer {
  // Everything that needs derivatives happens first, in uniform control flow:
  // texture sampling with implicit mip selection, and the surface frame for
  // normal mapping. After a discard or a branch, neither is well defined.
  let base = textureSample(baseColorTex, matSampler, in.uv);
  let mr = textureSample(metalRoughTex, matSampler, in.uv);
  let nmap = textureSample(normalTex, matSampler, in.uv).xyz * 2.0 - 1.0;
  let dp1 = dpdx(in.worldPos);
  let dp2 = dpdy(in.worldPos);
  let duv1 = dpdx(in.uv);
  let duv2 = dpdy(in.uv);

  let alpha = in.color.a * base.a;
  if (material.alphaCutoff > 0.0 && alpha < material.alphaCutoff) { discard; }

  var albedo = in.color.rgb * base.rgb;
  var metallic = clamp(in.pbr.x * mr.b, 0.0, 1.0);
  var roughness = clamp(in.pbr.y * mr.g, 0.04, 1.0);

  // A double-sided surface seen from behind must be lit from behind.
  var N = safeNormalize(in.normal, vec3<f32>(0.0, 1.0, 0.0));
  if (!front) { N = -N; }

  if (material.hasNormalMap > 0.5) {
    /*
     * Cotangent frame from screen-space derivatives (Schueler). The tangent
     * basis is reconstructed per pixel from how position and UV change across
     * the screen, so meshes need no tangent attribute and the vertex format
     * stays 32 bytes. glTF normal maps are +Y up in image space while V grows
     * downward, hence the flipped green channel.
     */
    let dp2perp = cross(dp2, N);
    let dp1perp = cross(N, dp1);
    let T = dp2perp * duv1.x + dp1perp * duv2.x;
    let B = dp2perp * duv1.y + dp1perp * duv2.y;
    let scale = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
    let ts = vec3<f32>(nmap.xy * material.normalScale * vec2<f32>(1.0, -1.0), nmap.z);
    N = safeNormalize(T * scale * ts.x + B * scale * ts.y + N * ts.z, N);
  }

  let noiseScale = in.surf.x;
  if (noiseScale > 0.0) {
    let p = in.worldPos * noiseScale;
    let h = fbm(p);

    // Bump from the gradient of the same field. Three extra taps, and the
    // offset is tied to the feature size so detail never aliases into mush.
    let e = 0.55;
    let dx = fbm(p + vec3<f32>(e, 0.0, 0.0)) - h;
    let dy = fbm(p + vec3<f32>(0.0, e, 0.0)) - h;
    let dz = fbm(p + vec3<f32>(0.0, 0.0, e)) - h;
    let grad = vec3<f32>(dx, dy, dz) * noiseScale;
    // Project the gradient onto the tangent plane and bend the normal by it.
    // A strong bump can cancel the normal exactly, so this cannot use a bare
    // normalize: one NaN here becomes a black fragment on screen.
    let tangentGrad = grad - N * dot(grad, N);
    N = safeNormalize(N - tangentGrad * in.surf.z, N);

    // Weathering: a second, coarser field decides where the finish is gone.
    let wear = smoothstep(0.42, 0.72, fbm(p * 0.27));
    let oxide = vec3<f32>(0.21, 0.11, 0.07) * (0.6 + h * 0.8);

    albedo = mix(albedo, albedo * (0.72 + h * 0.62), in.surf.y);
    albedo = mix(albedo, oxide, wear * in.surf.w);
    roughness = clamp(roughness + (h - 0.45) * in.surf.y * 0.85 + wear * in.surf.w * 0.4, 0.05, 1.0);
    metallic = clamp(metallic * (1.0 - wear * in.surf.w * 0.85), 0.0, 1.0);
  }

  let V = normalize(camera.position.xyz - in.worldPos);
  let nDotV = max(dot(N, V), 1e-4);
  let f0 = mix(vec3<f32>(0.04), albedo, metallic);
  var Lo = vec3<f32>(0.0);

  let count = u32(camera.params.x);
  for (var i : u32 = 0u; i < count; i = i + 1u) {
    let light = lights[i];
    let toLight = light.posRange.xyz - in.worldPos;
    let dist = length(toLight);
    if (dist > light.posRange.w) { continue; }
    let L = toLight / max(dist, 1e-4);
    let nDotL = max(dot(N, L), 0.0);
    if (nDotL <= 0.0) { continue; }
    let H = normalize(V + L);

    // Windowed inverse-square: reaches exactly zero at the light's range, so
    // culling by range can never pop.
    let ratio = dist / light.posRange.w;
    let window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
    let atten = (window * window) / (dist * dist + 1.0);

    var shadow = 1.0;
    let slot = i32(light.shadowInfo.x);
    if (slot >= 0) {
      // Offset along the geometric normal before the lookup: this moves the
      // sample off the surface that casts it, which kills acne without the
      // depth bias that would otherwise detach the contact shadow.
      let offset = normalize(in.normal) * camera.shadow.z;
      shadow = sampleShadow(slot, (in.worldPos + offset) - light.posRange.xyz, nDotL,
                            light.shadowInfo.y, light.shadowInfo.z, light.shadowInfo.w);
      if (shadow <= 0.001) { continue; }
    }

    let radiance = light.colorPower.rgb * light.colorPower.a * atten * shadow;

    let D = distributionGGX(max(dot(N, H), 0.0), roughness);
    let G = geometrySmith(nDotV, nDotL, roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), f0);
    let spec = (D * G * F) / max(4.0 * nDotV * nDotL, 1e-4);
    let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);
    Lo = Lo + (kD * albedo / PI + spec) * radiance * nDotL;
  }

  var out : GBuffer;
  // Ambient is deferred to the resolve pass so occlusion can modulate it.
  out.color = vec4<f32>(sanitize(Lo + albedo * in.pbr.z), alpha);
  let viewN = normalize((camera.view * vec4<f32>(N, 0.0)).xyz);
  let oct = octEncode(viewN);
  out.surface = vec4<f32>(oct.x, oct.y, roughness, metallic);
  out.albedo = vec4<f32>(albedo, 1.0);
  return out;
}
`
);
var AO_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var depthTex : texture_depth_2d;
@group(0) @binding(3) var surfaceTex : texture_2d<f32>;
@group(0) @binding(4) var sceneColor : texture_2d<f32>;

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/**
 * Horizon-based ambient occlusion, plus screen-space indirect light (SSIL).
 *
 * Output: rgb = one bounce of indirect light arriving at this pixel, a = AO.
 * The indirect term reuses the occlusion march: every sample that raises the
 * horizon is also a surface facing this one, and its direct lighting from the
 * geometry pass is light it bounces back. Gathering it costs one extra fetch
 * per step, and only when SSIL is on.
 *
 * For each of six directions the march finds the steepest horizon the
 * neighbourhood raises against the surface, and integrates the cosine-weighted
 * visibility left over. Six slices at quarter resolution is cheap; the
 * interleaved rotation plus the depth-aware blur that follows is what turns
 * that sparse sampling into a smooth term.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let d = loadDepth(in.uv);
  if (d <= 1e-7) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  let P = viewPosFromUV(in.uv, d, camera.proj);
  let N = octDecode(textureSampleLevel(surfaceTex, texSampler, in.uv, 0.0).xy);

  // Two places this estimator has no signal, and both look like dithering if
  // you let them through:
  //
  //   Distance \u2014 the world-space radius projects to under a pixel, so
  //   neighbouring pixels sample unrelated geometry and the result is salt and
  //   pepper rather than occlusion.
  //
  //   Grazing angles \u2014 a surface nearly edge-on to the view has almost no
  //   depth resolution across a pixel, so the horizon test flips at random.
  //
  // Fading out is honest: no occlusion beats invented occlusion.
  let dist = -P.z;
  let distanceFade = 1.0 - smoothstep(camera.fade.x * 0.35, camera.fade.x, dist);
  if (distanceFade <= 0.001) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let grazeFade = smoothstep(0.12, 0.38, abs(dot(N, normalize(-P))));
  if (grazeFade <= 0.001) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  let radius = camera.ao.y;
  // Project the world-space radius to screen: distant geometry must not be
  // sampled with a metre-wide kernel measured in pixels.
  let radiusUV = clamp(radius * camera.proj.x / max(-P.z, 1e-3) * 0.5, 0.004, 0.22);

  // in.clip.xy is this pass's own pixel coordinate, which is what the 4x4 tile
  // has to be keyed on: the AO pass runs at half resolution, so keying off the
  // full-res coordinate would only ever visit the even residues and half the
  // rotations would never be used.
  let SLICES = 6;
  let STEPS = 5;
  let tile = interleavedIndex(in.clip.xy);
  let rot = f32(tile) * (PI / f32(SLICES)) / 16.0;
  let radialOffset = (f32(tile & 3) + 0.5) * 0.25;

  var occlusion = 0.0;
  var bounce = vec3<f32>(0.0);
  let gather = camera.ssil.x > 0.0;
  let GI_STEPS = 4;
  let giRadius = max(camera.ssil.y, 0.1);
  let giRadiusUV = clamp(giRadius * camera.proj.x / max(-P.z, 1e-3) * 0.5, 0.004, 0.35);

  for (var s = 0; s < SLICES; s = s + 1) {
    let theta = rot + f32(s) * (PI / f32(SLICES));
    let dir = vec2<f32>(cos(theta), sin(theta));

    var best = 0.0;
    for (var t = 1; t <= STEPS; t = t + 1) {
      let frac = (f32(t) - 1.0 + radialOffset) / f32(STEPS);
      let uv = in.uv + dir * radiusUV * frac;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }

      let sd = loadDepth(uv);
      if (sd <= 1e-7) { continue; }
      let S = viewPosFromUV(uv, sd, camera.proj);
      let v = S - P;
      let len = length(v);
      if (len < 1e-4 || len > radius) { continue; }

      // Falloff by distance keeps a far wall from occluding the foreground.
      let horizon = dot(v / len, N) - camera.ao.w;
      let falloff = 1.0 - clamp(len / radius, 0.0, 1.0);
      best = max(best, horizon * falloff);
    }

    // Indirect: light leaving nearby surfaces toward this pixel, gathered
    // along the same slice direction but over its own, wider radius \u2014 bounce
    // light carries much further than contact shadowing does.
    if (gather) {
      for (var t = 1; t <= GI_STEPS; t = t + 1) {
        let frac = (f32(t) - 1.0 + radialOffset) / f32(GI_STEPS);
        let uv = in.uv + dir * giRadiusUV * frac;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
        let sd = loadDepth(uv);
        if (sd <= 1e-7) { continue; }
        let v = viewPosFromUV(uv, sd, camera.proj) - P;
        let len = length(v);
        if (len < 1e-3 || len > giRadius) { continue; }
        let cosR = max(dot(v / len, N), 0.0);
        let falloff = 1.0 - len / giRadius;
        let Ls = textureSampleLevel(sceneColor, texSampler, uv, 0.0).rgb;
        bounce = bounce + sanitize(Ls) * cosR * falloff;
      }
    }
    occlusion = occlusion + max(best, 0.0);
  }

  let strength = camera.ao.x * distanceFade * grazeFade;
  let ao = clamp(1.0 - occlusion / f32(SLICES) * strength, 0.0, 1.0);
  let gi = bounce / f32(SLICES * GI_STEPS) * camera.ssil.x * 4.0 * distanceFade;
  return vec4<f32>(gi, pow(ao, camera.ao.z));
}
`
);
var AO_BLUR_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var aoTex : texture_2d<f32>;
@group(0) @binding(3) var depthTex : texture_depth_2d;

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/**
 * Depth-aware box blur, four channels: AO + indirect light, or the
 * volumetric fog buffer, which shares the same 4x4 interleaved jitter. Weighting each tap by how close its depth is to the
 * centre's is what stops AO from bleeding across a silhouette and drawing a
 * dark halo around every object.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(aoTex, 0));
  let texel = 1.0 / dims;
  let centerZ = linearDepth(loadDepth(in.uv), camera.proj.z);

  var sum = vec4<f32>(0.0);
  var weight = 0.0;
  // Exactly four pixels on each axis, matching the 4x4 rotation tile. Any four
  // consecutive pixels contain one of every rotation, so this kernel averages
  // one whole set of sample directions \u2014 a 5x5 would double-count some and
  // leave a residual pattern behind.
  for (var y = -1; y <= 2; y = y + 1) {
    for (var x = -1; x <= 2; x = x + 1) {
      let uv = in.uv + vec2<f32>(f32(x), f32(y)) * texel;
      let z = linearDepth(loadDepth(uv), camera.proj.z);
      let w = exp(-abs(z - centerZ) * 2.0);
      sum = sum + textureSampleLevel(aoTex, texSampler, uv, 0.0) * w;
      weight = weight + w;
    }
  }
  return sum / max(weight, 1e-4);
}
`
);
var VOLUME_WGSL = (
  /* wgsl */
  `
${COMMON}
${CUBE_WGSL}

struct Light {
  posRange   : vec4<f32>,
  colorPower : vec4<f32>,
  shadowInfo : vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var depthTex : texture_depth_2d;
@group(0) @binding(3) var<storage, read> lights : array<Light>;
@group(0) @binding(4) var shadowMaps : texture_depth_2d_array;
@group(0) @binding(5) var shadowSampler : sampler_comparison;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/** Henyey-Greenstein: g > 0 scatters forward, toward the viewer looking at a light. */
fn phaseHG(cosT : f32, g : f32) -> f32 {
  let g2 = g * g;
  let denom = max(1.0 + g2 - 2.0 * g * cosT, 1e-4);
  return (1.0 - g2) / (4.0 * PI * denom * sqrt(denom));
}

/** One hardware-filtered shadow tap: in a medium, soft PCF is invisible. */
fn shadowTap(slot : i32, toFrag : vec3<f32>, near : f32, far : f32) -> f32 {
  let face = faceIndex(toFrag);
  let F = FACE_F[face];
  let U = FACE_U[face];
  let R = cross(F, U);
  let ma = dot(toFrag, F);
  if (ma <= near) { return 1.0; }
  let uv = vec2<f32>(dot(toFrag, R) / ma * 0.5 + 0.5, 0.5 - dot(toFrag, U) / ma * 0.5);
  let A = far / (far - near);
  let B = near * far / (far - near);
  let refDepth = A - B / (ma * 1.01);
  return textureSampleCompareLevel(shadowMaps, shadowSampler, uv, slot * 6 + face, refDepth);
}

/**
 * Volumetric fog: march the view ray through a height-falling medium and
 * integrate light scattered toward the eye, with each point light's shadow
 * map deciding where its shafts are. Half resolution, 4x4 interleaved start
 * offsets, then the shared depth-aware blur \u2014 the same budget trick as AO.
 *
 * Output: rgb = in-scattered light, a = transmittance to the surface.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let d = textureLoad(depthTex, pixelOf(in.uv), 0);
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let dirView = normalize(vec3<f32>(ndc.x / camera.proj.x, ndc.y / camera.proj.y, -1.0));
  let dir = normalize((camera.invView * vec4<f32>(dirView, 0.0)).xyz);

  var dist = camera.vol.w;
  if (d > 1e-7) {
    dist = min(length(viewPosFromUV(in.uv, d, camera.proj)), camera.vol.w);
  }

  let steps = max(i32(camera.vol.y), 1);
  let dt = dist / f32(steps);
  let jitter = (f32(interleavedIndex(in.clip.xy)) + 0.5) / 16.0;
  let origin = camera.position.xyz;
  let count = u32(camera.params.x);
  let ambient = camera.ambient.rgb * camera.vol2.z;

  var T = 1.0;
  var L = vec3<f32>(0.0);

  for (var i = 0; i < steps; i = i + 1) {
    let t = (f32(i) + jitter) * dt;
    let X = origin + dir * t;
    let density = camera.vol.x * exp(-max(X.y - camera.vol2.x, 0.0) * camera.vol2.y);
    if (density < 1e-6) { continue; }

    var light = ambient;
    for (var li : u32 = 0u; li < count; li = li + 1u) {
      let l = lights[li];
      let toL = l.posRange.xyz - X;
      let ld = length(toL);
      if (ld > l.posRange.w) { continue; }
      let ratio = ld / l.posRange.w;
      let window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
      let atten = (window * window) / (ld * ld + 1.0);

      var vis = 1.0;
      let slot = i32(l.shadowInfo.x);
      if (slot >= 0) {
        vis = shadowTap(slot, X - l.posRange.xyz, l.shadowInfo.y, l.shadowInfo.w);
      }
      let phase = phaseHG(dot(dir, toL / max(ld, 1e-4)), camera.vol.z);
      light = light + l.colorPower.rgb * l.colorPower.a * atten * phase * vis * camera.vol2.w;
    }

    // Energy-conserving step integration (Hillaire 2015): exact for a
    // constant medium across the step, so the result does not change with the
    // step count, only its noise does.
    let sampleT = exp(-density * dt);
    let S = light * camera.volColor.rgb;
    L = L + T * S * (1.0 - sampleT);
    T = T * sampleT;
    if (T < 0.003) { break; }
  }

  return vec4<f32>(sanitize(L), T);
}
`
);
var EXPOSURE_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var hdrTex : texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> state : array<f32, 4>;

var<workgroup> sums : array<vec2<f32>, 256>;

@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_index) li : u32,
        @builtin(local_invocation_id) lid : vec3<u32>) {
  let dims = vec2<f32>(textureDimensions(hdrTex, 0));
  var acc = vec2<f32>(0.0);
  for (var k = 0u; k < 4u; k = k + 1u) {
    let cell = vec2<f32>(f32(lid.x * 2u + (k & 1u)), f32(lid.y * 2u + (k >> 1u)));
    let uv = (cell + 0.5) / 32.0;
    let c = textureLoad(hdrTex, vec2<i32>(uv * dims), 0).rgb;
    // Measured after the camera's exposure, so auto exposure is a correction
    // on top of it: the same in arbitrary units and in lumens.
    let lum = dot(sanitize(c), vec3<f32>(0.2126, 0.7152, 0.0722)) * camera.params.y;
    // Centre-weighted: the middle of the frame is what you are looking at.
    let w = 1.0 - 0.7 * length(uv - 0.5) * 1.41421;
    acc = acc + vec2<f32>(log2(lum + 1e-4) * w, w);
  }
  sums[li] = acc;
  workgroupBarrier();

  var stride = 128u;
  while (stride > 0u) {
    if (li < stride) { sums[li] = sums[li] + sums[li + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  if (li == 0u) {
    let goal = sums[0].x / max(sums[0].y, 1e-4);
    if (state[1] < 0.5) {
      state[0] = goal;
      state[1] = 1.0;
    } else {
      let k = 1.0 - exp(-camera.expo.w * camera.expo.z);
      state[0] = state[0] + (goal - state[0]) * k;
    }
  }
}
`
);
var DOF_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var hdrTex : texture_2d<f32>;
@group(0) @binding(3) var depthTex : texture_depth_2d;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

fn viewDist(uv : vec2<f32>) -> f32 {
  let d = textureLoad(depthTex, pixelOf(uv), 0);
  if (d <= 1e-7) { return 1e5; }            // sky: infinitely far
  return length(viewPosFromUV(uv, d, camera.proj));
}

/** Where the lens is focused: fixed, or the median-ish of five centre taps. */
fn focusDistance() -> f32 {
  if (camera.dof2.z < 0.5) { return camera.dof.x; }
  let o = 0.03;
  let a = viewDist(vec2<f32>(0.5, 0.5));
  let b = viewDist(vec2<f32>(0.5 - o, 0.5));
  let c = viewDist(vec2<f32>(0.5 + o, 0.5));
  let d = viewDist(vec2<f32>(0.5, 0.5 - o));
  let e = viewDist(vec2<f32>(0.5, 0.5 + o));
  // Nearest of the five: focusing on a thin foreground edge beats focusing
  // on the wall behind it, which is what a photographer would pick.
  return min(min(min(a, b), min(c, d)), e);
}

/** Signed circle of confusion in [-1, 1]: negative = near blur, positive = far. */
fn coc(dist : f32, focus : f32) -> f32 {
  let half = camera.dof.y;
  let t = max(camera.dof.z, 0.01);
  var c = 0.0;
  if (camera.dof2.y > 0.5) { c = clamp((dist - (focus + half)) / t, 0.0, 1.0); }
  if (camera.dof2.x > 0.5 && dist < focus - half) { c = -clamp(((focus - half) - dist) / t, 0.0, 1.0); }
  return c;
}

/**
 * Depth of field as a scatter-as-gather disk blur.
 *
 * Every pixel gathers a golden-angle disk out to the maximum blur radius; a
 * sample counts if ITS OWN circle of confusion reaches this pixel. That is
 * what lets a blurry foreground spill over a sharp background (near field),
 * while a background sample is clipped to this pixel's own radius so a
 * blurred wall can never bleed across an in-focus object in front of it.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let center = textureSampleLevel(hdrTex, texSampler, in.uv, 0.0).rgb;
  let focus = focusDistance();
  let dC = viewDist(in.uv);
  let cocC = coc(dC, focus);
  let maxPx = camera.dof.w;
  let rC = abs(cocC) * maxPx;

  let TAPS = 40;
  let rot = f32(interleavedIndex(in.clip.xy)) * 0.3927;   // 4x4 rotation, hides the pattern
  var sum = center;
  var wsum = 1.0;
  for (var i = 0; i < TAPS; i = i + 1) {
    let r = sqrt((f32(i) + 0.5) / f32(TAPS)) * maxPx;
    let a = f32(i) * 2.39996323 + rot;
    let uv = in.uv + vec2<f32>(cos(a), sin(a)) * r * camera.screen.zw;
    let dS = viewDist(uv);
    let cocS = coc(dS, focus);
    var rS = abs(cocS) * maxPx;
    // Behind the centre pixel: may not spread further than the centre's own blur.
    if (dS > dC) { rS = min(rS, rC); }
    let w = clamp(rS - r + 1.0, 0.0, 1.0);
    sum = sum + textureSampleLevel(hdrTex, texSampler, uv, 0.0).rgb * w;
    wsum = wsum + w;
  }
  return vec4<f32>(sanitize(sum / wsum), 1.0);
}
`
);
var RESOLVE_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var sceneColor : texture_2d<f32>;
@group(0) @binding(3) var surfaceTex : texture_2d<f32>;
@group(0) @binding(4) var albedoTex : texture_2d<f32>;
@group(0) @binding(5) var depthTex : texture_depth_2d;
@group(0) @binding(6) var aoTex : texture_2d<f32>;
@group(0) @binding(7) var volTex : texture_2d<f32>;

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/** Volumetric fog over whatever is behind it: attenuate, then add the glow. */
fn applyVolume(c : vec3<f32>, uv : vec2<f32>) -> vec3<f32> {
  if (camera.volColor.a < 0.5) { return c; }
  let v = textureSampleLevel(volTex, texSampler, uv, 0.0);
  return c * v.a + v.rgb;
}

fn viewToUV(p : vec3<f32>) -> vec2<f32> {
  let dist = max(-p.z, 1e-5);
  let ndc = vec2<f32>(camera.proj.x * p.x / dist, camera.proj.y * p.y / dist);
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

struct Reflection {
  color : vec3<f32>,
  hit   : f32,
};

/**
 * Screen-space reflection.
 *
 * March the reflected ray in view space with a geometrically growing step, so
 * near contacts are precise and distant ones are still reached in a bounded
 * number of taps. On a crossing, binary-refine, then reject anything thicker
 * than the depth buffer can justify \u2014 that rejection is what keeps thin
 * geometry from smearing a false reflection across the floor.
 */
/**
 * Screen-space reflection, marched in screen space.
 *
 * The ray is projected to the screen once, then walked at roughly one pixel
 * per step while 1/z is interpolated linearly along that line \u2014 1/z being the
 * only depth quantity that varies linearly across a screen-space line, which
 * is what makes the march independent of camera orientation.
 *
 * Three rules keep a reflection ray from finding its own surface, which is
 * the failure that shows up as black seams at contact lines, a dark band at
 * the horizon, and reflections that shrink as the camera nears the ground:
 *
 *   1. The origin is lifted off the surface along its normal, so the pixel it
 *      starts on is unambiguously *behind* the ray, never level with it.
 *   2. Steps are never shorter than a pixel. Sub-pixel steps re-sample the
 *      origin pixel, and at grazing angles its depth matches the ray to within
 *      precision \u2014 a guaranteed false hit.
 *   3. A hit is an *overlap*: the depth range the ray covered during the step
 *      must intersect a thin slab behind the visible surface. A threshold on
 *      "how far behind" alone accepts hits too early along grazing rays, which
 *      compresses the reflection toward its contact point.
 */
fn traceSSR(P : vec3<f32>, N : vec3<f32>, R : vec3<f32>, jitter : f32) -> Reflection {
  var result : Reflection;
  result.color = vec3<f32>(0.0);
  result.hit = 0.0;

  let near = camera.proj.z;

  // Rule 1. The lift grows with distance because depth precision does.
  let lift = max(0.01, -P.z * 0.0025);
  let O = P + N * lift;
  if (O.z > -near) { return result; }

  // Clip to the near plane: past it the ray is behind the eye and projecting
  // it would fold the line back on itself.
  var Q = O + R * camera.ssr.w;
  if (Q.z > -near) {
    if (abs(R.z) < 1e-6) { return result; }
    let tClip = (-near - O.z) / R.z;
    if (tClip <= 0.0) { return result; }
    Q = O + R * tClip;
  }

  let pxStart = viewToUV(O) * camera.screen.xy;
  let pxEnd = viewToUV(Q) * camera.screen.xy;
  let delta = pxEnd - pxStart;
  let span = max(abs(delta.x), abs(delta.y));
  if (span < 1.0) { return result; }

  // Rule 2. One step per pixel, never fewer pixels than steps.
  let stepCount = min(span, camera.ssr.y);
  let invStep = 1.0 / stepCount;

  let invZStart = 1.0 / O.z;
  let invZEnd = 1.0 / Q.z;

  // The first sample lands a full step out, jittered within that step.
  var prevT = 0.0;
  var prevRayZ = O.z;
  var t = invStep * (1.0 + jitter);
  var hitT = -1.0;
  var hitPx = vec2<i32>(0);

  for (var i = 0; i < i32(stepCount); i = i + 1) {
    if (t > 1.0) { break; }

    let uv = (pxStart + delta * t) * camera.screen.zw;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }

    let rayZ = 1.0 / mix(invZStart, invZEnd, t);
    let sceneZ = -linearDepth(loadDepth(uv), near);

    // Rule 3. View z is negative: larger is nearer the eye. The ray spans
    // [rayFar, rayNear] over this step; the surface occupies a slab from its
    // visible face (sceneZ) back to sceneZ - thickness.
    let rayNear = max(prevRayZ, rayZ);
    let rayFar = min(prevRayZ, rayZ);
    let thickness = camera.ssr.z + (-sceneZ) * 0.02;
    if (rayFar <= sceneZ && rayNear >= sceneZ - thickness) {
      hitT = t;
      hitPx = pixelOf(uv);
      break;
    }

    prevT = t;
    prevRayZ = rayZ;
    t = t + invStep;
  }

  if (hitT < 0.0) { return result; }

  // Refine the crossing between the last clear step and the hit. The lower
  // bound is the last point known to be in front of everything, so the search
  // cannot drift back to the origin the way an unbounded one can.
  var lo = prevT;
  var hi = hitT;
  for (var i = 0; i < 5; i = i + 1) {
    let mid = (lo + hi) * 0.5;
    let uv = (pxStart + delta * mid) * camera.screen.zw;
    let rayZ = 1.0 / mix(invZStart, invZEnd, mid);
    if (-linearDepth(loadDepth(uv), near) >= rayZ) {
      hi = mid;
      hitPx = pixelOf(uv);   // only ever a pixel that passed the depth test
    } else {
      lo = mid;
    }
  }
  let hitUV = (vec2<f32>(hitPx) + 0.5) * camera.screen.zw;

  // Fade where the march has no information: at the edge of the screen and at
  // the very end of the ray.
  let edge = min(min(hitUV.x, 1.0 - hitUV.x), min(hitUV.y, 1.0 - hitUV.y));
  let edgeFade = smoothstep(0.0, 0.1, edge);
  let endFade = 1.0 - smoothstep(0.8, 1.0, hi);

  // textureLoad, not a filtered sample: a bilinear fetch at a sub-pixel hit
  // blends in the neighbour behind the occluder, and at a contact line that
  // neighbour is the dark floor \u2014 which is exactly what drew a black seam.
  result.color = textureLoad(sceneColor, hitPx, 0).rgb;
  result.hit = edgeFade * endFade;
  return result;
}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let d = loadDepth(in.uv);
  var hdr = textureSampleLevel(sceneColor, texSampler, in.uv, 0.0).rgb;

  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let dirView = normalize(vec3<f32>(ndc.x / camera.proj.x, ndc.y / camera.proj.y, -1.0));
  let viewDirWorld = normalize((camera.invView * vec4<f32>(dirView, 0.0)).xyz);

  if (d <= 1e-7) {
    let sky = sampleEnvironment(viewDirWorld, 0.0, camera.ambient.rgb) * 0.8;
    return vec4<f32>(sanitize(applyVolume(sky, in.uv)), 1.0);
  }

  let surf = textureSampleLevel(surfaceTex, texSampler, in.uv, 0.0);
  let albedo = textureSampleLevel(albedoTex, texSampler, in.uv, 0.0).rgb;
  let aoGi = textureSampleLevel(aoTex, texSampler, in.uv, 0.0);
  let ao = aoGi.a;

  let N = octDecode(surf.xy);
  let roughness = surf.z;
  let metallic = surf.w;

  let P = viewPosFromUV(in.uv, d, camera.proj);
  let V = normalize(-P);
  let R = normalize(reflect(-V, N));
  let Nworld = normalize((camera.invView * vec4<f32>(N, 0.0)).xyz);

  // Deferred hemispheric ambient, occluded. Doing this here rather than in the
  // geometry pass is the whole reason AO reads as contact darkening instead of
  // a grey wash over lit surfaces.
  let up = clamp(Nworld.y * 0.5 + 0.5, 0.0, 1.0);
  let ground = camera.ambient.rgb * camera.ambient.a;
  let ambient = mix(ground, camera.ambient.rgb, up) * albedo * (1.0 - metallic * 0.6) * ao;
  hdr = hdr + ambient;

  // Screen-space indirect light: one bounce, tinted by this surface's albedo.
  // Metals have no diffuse response to bounce light into.
  hdr = hdr + aoGi.rgb * albedo * (1.0 - metallic);

  // Same 4x4 tile as the occlusion pass: sixteen fixed step phases rather than
  // per-pixel white noise, so what undersampling remains is a faint regular
  // pattern instead of stipple.
  let jitter = f32(interleavedIndex(in.clip.xy)) / 16.0;

  let nDotV = max(dot(N, V), 1e-4);
  // Metals tint their reflection with their own albedo \u2014 f0 is the albedo, not
  // white. Getting this wrong is what makes every metal read as chrome.
  let f0 = mix(vec3<f32>(0.04), albedo, metallic);
  // Roughness-aware Fresnel: a rough surface never reaches a full grazing
  // mirror, so the horizon does not blow out.
  let grazing = max(vec3<f32>(1.0 - roughness), f0);
  let fres = f0 + (grazing - f0) * pow(1.0 - nDotV, 5.0);
  // Same story as AO: a reflection ray from a distant, grazing pixel crosses
  // most of the depth buffer per step, so it hits or misses essentially at
  // random. Fade to the analytic environment instead of stippling.
  let viewDist = -P.z;
  let ssrFade = 1.0 - smoothstep(camera.fade.y * 0.4, camera.fade.y, viewDist);
  let weight = clamp(1.0 - roughness * 1.35, 0.0, 1.0) * camera.ssr.x * ssrFade;

  let Rworld = normalize((camera.invView * vec4<f32>(R, 0.0)).xyz);
  var reflected = sampleEnvironment(Rworld, roughness, camera.ambient.rgb);

  if (weight > 0.001) {
    let ssr = traceSSR(P, N, R, jitter);
    reflected = mix(reflected, ssr.color, ssr.hit * weight);
  }

  let fogAmount = clamp(1.0 - exp(-(-P.z) * camera.params.z), 0.0, 1.0);
  // Occlusion applies to the environment reflection too: a crevice sees little
  // sky, and unoccluded specular is what makes AO'd scenes look plastic.
  hdr = hdr + reflected * fres * mix(0.35, 1.0, metallic) * (1.0 - fogAmount) * mix(1.0, ao, 0.7);

  // Aerial perspective: distant surfaces fade toward the sky *in their own
  // view direction*, not toward one flat colour. Fog to a constant is what
  // draws a hard line along the horizon, because the ground is fading to one
  // colour while the sky right above it is another.
  let aerial = sampleEnvironment(viewDirWorld, 0.85, camera.ambient.rgb) * 0.8;
  let fogTarget = mix(camera.fog.rgb, aerial, camera.fog.a);
  hdr = mix(hdr, fogTarget, fogAmount);
  hdr = applyVolume(hdr, in.uv);

  return vec4<f32>(sanitize(hdr), 1.0);
}
`
);
var BLOOM_COMMON = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var src : texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/** Thirteen-tap downsample (Jimenez). Stable under motion; no pulsing fireflies. */
fn tap(uv : vec2<f32>) -> vec3<f32> { return sanitize(textureSampleLevel(src, texSampler, uv, 0.0).rgb); }

fn downsample13(uv : vec2<f32>, texel : vec2<f32>) -> vec3<f32> {
  let a = tap(uv + texel * vec2<f32>(-2.0,  2.0));
  let b = tap(uv + texel * vec2<f32>( 0.0,  2.0));
  let c = tap(uv + texel * vec2<f32>( 2.0,  2.0));
  let d = tap(uv + texel * vec2<f32>(-2.0,  0.0));
  let e = tap(uv);
  let f = tap(uv + texel * vec2<f32>( 2.0,  0.0));
  let g = tap(uv + texel * vec2<f32>(-2.0, -2.0));
  let h = tap(uv + texel * vec2<f32>( 0.0, -2.0));
  let i = tap(uv + texel * vec2<f32>( 2.0, -2.0));
  let j = tap(uv + texel * vec2<f32>(-1.0,  1.0));
  let k = tap(uv + texel * vec2<f32>( 1.0,  1.0));
  let l = tap(uv + texel * vec2<f32>(-1.0, -1.0));
  let m = tap(uv + texel * vec2<f32>( 1.0, -1.0));

  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 +
         (j + k + l + m) * 0.125;
}
`
);
var BLOOM_PREFILTER_WGSL = (
  /* wgsl */
  `
${BLOOM_COMMON}

/**
 * Soft-knee threshold: a hard cut makes bloom flicker on moving highlights.
 * The threshold is measured after exposure, so it means the same thing
 * whether lights are in arbitrary units or in lumens with a physical camera.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src, 0));
  let c = downsample13(in.uv, texel);

  let brightness = max(c.r, max(c.g, c.b)) * camera.params.y;
  let knee = camera.bloom.y;
  let threshold = camera.bloom.x;
  var soft = brightness - threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  let contribution = max(soft, brightness - threshold) / max(brightness, 1e-4);

  return vec4<f32>(c * contribution, 1.0);
}
`
);
var BLOOM_DOWN_WGSL = (
  /* wgsl */
  `
${BLOOM_COMMON}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src, 0));
  return vec4<f32>(downsample13(in.uv, texel), 1.0);
}
`
);
var BLOOM_UP_WGSL = (
  /* wgsl */
  `
${BLOOM_COMMON}

/**
 * Tent upsample, blended additively onto the larger mip. Walking the pyramid
 * back up with a small filter produces a wide, smooth glow from cheap passes \u2014
 * far better than one big gaussian at full resolution.
 */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src, 0));
  let r = texel * 1.0;

  let a = textureSampleLevel(src, texSampler, in.uv + vec2<f32>(-r.x,  r.y), 0.0).rgb;
  let b = textureSampleLevel(src, texSampler, in.uv + vec2<f32>( 0.0,  r.y), 0.0).rgb;
  let c = textureSampleLevel(src, texSampler, in.uv + vec2<f32>( r.x,  r.y), 0.0).rgb;
  let d = textureSampleLevel(src, texSampler, in.uv + vec2<f32>(-r.x,  0.0), 0.0).rgb;
  let e = textureSampleLevel(src, texSampler, in.uv, 0.0).rgb;
  let f = textureSampleLevel(src, texSampler, in.uv + vec2<f32>( r.x,  0.0), 0.0).rgb;
  let g = textureSampleLevel(src, texSampler, in.uv + vec2<f32>(-r.x, -r.y), 0.0).rgb;
  let h = textureSampleLevel(src, texSampler, in.uv + vec2<f32>( 0.0, -r.y), 0.0).rgb;
  let i = textureSampleLevel(src, texSampler, in.uv + vec2<f32>( r.x, -r.y), 0.0).rgb;

  let sum = e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i);
  return vec4<f32>(sum / 16.0, 1.0);
}
`
);
var FINAL_WGSL = (
  /* wgsl */
  `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var hdrTex : texture_2d<f32>;
@group(0) @binding(3) var bloomTex : texture_2d<f32>;
@group(0) @binding(4) var<storage, read> exposureState : array<f32, 4>;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

fn tonemapACES(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn luma(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

/** Reinhard, extended: white is the input that maps to 1. */
fn tonemapReinhard(x : vec3<f32>, white : f32) -> vec3<f32> {
  let w2 = white * white;
  return clamp(x * (1.0 + x / w2) / (1.0 + x), vec3<f32>(0.0), vec3<f32>(1.0));
}

/** Hable's filmic curve, normalised so white maps to 1. */
fn hable(x : vec3<f32>) -> vec3<f32> {
  let A = 0.15; let B = 0.50; let C = 0.10; let D = 0.20; let E = 0.02; let F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
fn tonemapFilmic(x : vec3<f32>, white : f32) -> vec3<f32> {
  return clamp(hable(x * 2.0) / hable(vec3<f32>(white)), vec3<f32>(0.0), vec3<f32>(1.0));
}

/**
 * AgX (Troy Sobotka), minimal form: an inset into a wider working space, a
 * log2 encode, a fitted sigmoid, and back out. Bright saturated light
 * desaturates toward white the way film does, instead of clipping to a hue.
 */
fn agxContrast(x : vec3<f32>) -> vec3<f32> {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
       + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn tonemapAgX(c : vec3<f32>) -> vec3<f32> {
  let inset = mat3x3<f32>(
    vec3<f32>(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let outset = mat3x3<f32>(
    vec3<f32>(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3<f32>(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3<f32>(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var x = inset * max(c, vec3<f32>(1e-10));
  x = clamp((log2(x) - minEv) / (maxEv - minEv), vec3<f32>(0.0), vec3<f32>(1.0));
  x = agxContrast(x);
  x = outset * x;
  // The curve's output is display-encoded; return linear so gamma applies once.
  return pow(max(x, vec3<f32>(0.0)), vec3<f32>(2.2));
}

fn tonemap(x : vec3<f32>) -> vec3<f32> {
  let mode = i32(camera.tone.x + 0.5);
  let white = max(camera.tone.y, 0.01);
  if (mode == 0) { return clamp(x, vec3<f32>(0.0), vec3<f32>(1.0)); }
  if (mode == 1) { return tonemapReinhard(x, white); }
  if (mode == 2) { return tonemapFilmic(x, white); }
  if (mode == 4) { return clamp(tonemapAgX(x), vec3<f32>(0.0), vec3<f32>(1.0)); }
  return tonemapACES(x);
}

/** Exposure from the camera, times the auto-exposure factor when it is on. */
fn exposure() -> f32 {
  var e = camera.params.y;
  if (camera.grade.y > 0.5) {
    // Bring the average exposed luminance to the key value, within limits.
    // The camera's own exposure cancels out here, as it does on a real
    // camera in auto mode; compensation below is how to push it either way.
    let ev = clamp(log2(camera.grade.w) - exposureState[0], camera.expo.x, camera.expo.y);
    e = e * exp2(ev);
  }
  return e * exp2(camera.grade.z);
}

/** Graded pixel: HDR + bloom, exposed, tonemapped, adjusted, gamma-encoded. FXAA runs on this. */
fn gradeAt(uv : vec2<f32>) -> vec3<f32> {
  let hdr = sanitize(textureSampleLevel(hdrTex, texSampler, uv, 0.0).rgb);
  let bloom = sanitize(textureSampleLevel(bloomTex, texSampler, uv, 0.0).rgb);
  var c = tonemap((hdr + bloom * camera.bloom.z) * exposure());

  // Adjustments, Godot-style: brightness, saturation, then contrast around mid grey.
  c = c * camera.grade.x;
  c = max(mix(vec3<f32>(luma(c)), c, camera.tone.w), vec3<f32>(0.0));
  var g = pow(c, vec3<f32>(1.0 / 2.2));
  g = (g - 0.5) * camera.tone.z + 0.5;
  return clamp(g, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  var color = gradeAt(in.uv);

  // Last line of defence. Anything upstream that produced a NaN would show up
  // here as a black fragment, and a black fragment on screen is a far worse
  // failure than a slightly wrong colour.
  color = select(color, vec3<f32>(0.0), color != color);

  // FXAA (console variant): one diagonal blend along the detected edge. Cheap,
  // and it is the reason this pipeline can skip MSAA and still keep its depth
  // buffer sampleable for the reflection march and the occlusion pass.
  if (camera.params.w > 0.5) {
    let texel = camera.screen.zw;
    let lNW = luma(gradeAt(in.uv + vec2<f32>(-texel.x, -texel.y)));
    let lNE = luma(gradeAt(in.uv + vec2<f32>( texel.x, -texel.y)));
    let lSW = luma(gradeAt(in.uv + vec2<f32>(-texel.x,  texel.y)));
    let lSE = luma(gradeAt(in.uv + vec2<f32>( texel.x,  texel.y)));
    let lM = luma(color);

    let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    let range = lMax - lMin;

    if (range >= max(0.0312, lMax * 0.125)) {
      var dir = vec2<f32>(
        -((lNW + lNE) - (lSW + lSE)),
         ((lNW + lSW) - (lNE + lSE)));
      let reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
      let scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * scale, vec2<f32>(-8.0), vec2<f32>(8.0)) * texel;

      let a = 0.5 * (gradeAt(in.uv + dir * (1.0 / 3.0 - 0.5)) +
                     gradeAt(in.uv + dir * (2.0 / 3.0 - 0.5)));
      let b = a * 0.5 + 0.25 * (gradeAt(in.uv - dir * 0.5) + gradeAt(in.uv + dir * 0.5));
      let lB = luma(b);
      if (lB >= lMin && lB <= lMax) { color = b; } else { color = a; }
    }
  }

  return vec4<f32>(color, 1.0);
}
`
);

// src/geometry/primitives.js
var primitives_exports = {};
__export(primitives_exports, {
  VERTEX_STRIDE_BYTES: () => VERTEX_STRIDE_BYTES,
  VERTEX_STRIDE_FLOATS: () => VERTEX_STRIDE_FLOATS,
  box: () => box,
  icosphere: () => icosphere,
  plane: () => plane,
  roundedBox: () => roundedBox,
  sphere: () => sphere,
  torus: () => torus
});
var VERTEX_STRIDE_FLOATS = 8;
var VERTEX_STRIDE_BYTES = 32;
function mesh(positions, normals, uvs, indices) {
  const n = positions.length / 3;
  const v = new Float32Array(n * VERTEX_STRIDE_FLOATS);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    v[o] = positions[i * 3];
    v[o + 1] = positions[i * 3 + 1];
    v[o + 2] = positions[i * 3 + 2];
    v[o + 3] = normals[i * 3];
    v[o + 4] = normals[i * 3 + 1];
    v[o + 5] = normals[i * 3 + 2];
    v[o + 6] = uvs[i * 2];
    v[o + 7] = uvs[i * 2 + 1];
    cx += v[o];
    cy += v[o + 1];
    cz += v[o + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const dx = v[o] - cx, dy = v[o + 1] - cy, dz = v[o + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return {
    vertices: v,
    indices: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
    vertexCount: n,
    bounds: new Float32Array([cx, cy, cz, Math.sqrt(r2)])
  };
}
function box(w = 1, h = 1, d = 1) {
  const half2 = [w / 2, h / 2, d / 2];
  const p = [], nm = [], uv = [], idx = [];
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
  ];
  faces.forEach((f, fi) => {
    for (const [su, sv, tu, tv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      p.push(
        (f.n[0] + f.u[0] * su + f.v[0] * sv) * half2[0],
        (f.n[1] + f.u[1] * su + f.v[1] * sv) * half2[1],
        (f.n[2] + f.u[2] * su + f.v[2] * sv) * half2[2]
      );
      nm.push(f.n[0], f.n[1], f.n[2]);
      uv.push(tu, tv);
    }
    const b = fi * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return mesh(p, nm, uv, idx);
}
function roundedBox(w = 1, h = 1, d = 1, radius = 0.08, segments = 6) {
  const half2 = [w / 2, h / 2, d / 2];
  const r = Math.min(radius, Math.min(half2[0], Math.min(half2[1], half2[2])) * 0.999);
  const inner = [
    Math.max(half2[0] - r, 0),
    Math.max(half2[1] - r, 0),
    Math.max(half2[2] - r, 0)
  ];
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
  ];
  const p = [], nm = [], uv = [], idx = [];
  const row = segments + 1;
  const clampAbs = (x, lim) => Math.max(-lim, Math.min(lim, x));
  faces.forEach((f, fi) => {
    const base = fi * row * row;
    for (let j = 0; j <= segments; j++) {
      const sv = j / segments * 2 - 1;
      for (let i = 0; i <= segments; i++) {
        const su = i / segments * 2 - 1;
        const s = [
          (f.n[0] + f.u[0] * su + f.v[0] * sv) * half2[0],
          (f.n[1] + f.u[1] * su + f.v[1] * sv) * half2[1],
          (f.n[2] + f.u[2] * su + f.v[2] * sv) * half2[2]
        ];
        const c = [clampAbs(s[0], inner[0]), clampAbs(s[1], inner[1]), clampAbs(s[2], inner[2])];
        let nx = s[0] - c[0], ny = s[1] - c[1], nz = s[2] - c[2];
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) {
          nx = f.n[0];
          ny = f.n[1];
          nz = f.n[2];
        } else {
          nx /= len;
          ny /= len;
          nz /= len;
        }
        p.push(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r);
        nm.push(nx, ny, nz);
        uv.push(i / segments, j / segments);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * row + i, b = a + row;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  });
  return mesh(p, nm, uv, idx);
}
function sphere(radius = 0.5, segments = 24, rings = 16) {
  const p = [], nm = [], uv = [], idx = [];
  for (let y = 0; y <= rings; y++) {
    const vt = y / rings, phi = vt * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments, theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      p.push(nx * radius, ny * radius, nz * radius);
      nm.push(nx, ny, nz);
      uv.push(u, 1 - vt);
    }
  }
  const row = segments + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * row + x, b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh(p, nm, uv, idx);
}
function plane(w = 1, d = 1, sx = 1, sz = 1) {
  const p = [], nm = [], uv = [], idx = [];
  for (let z = 0; z <= sz; z++) {
    for (let x = 0; x <= sx; x++) {
      p.push((x / sx - 0.5) * w, 0, (z / sz - 0.5) * d);
      nm.push(0, 1, 0);
      uv.push(x / sx, z / sz);
    }
  }
  const row = sx + 1;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const a = z * row + x, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(p, nm, uv, idx);
}
function torus(radius = 0.5, tube = 0.2, radial = 24, tubular = 16) {
  const p = [], nm = [], uv = [], idx = [];
  for (let j = 0; j <= radial; j++) {
    const u = j / radial * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let i = 0; i <= tubular; i++) {
      const v = i / tubular * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const x = (radius + tube * cv) * cu;
      const y = tube * sv;
      const z = (radius + tube * cv) * su;
      p.push(x, y, z);
      nm.push(cv * cu, sv, cv * su);
      uv.push(j / radial, i / tubular);
    }
  }
  const row = tubular + 1;
  for (let j = 0; j < radial; j++) {
    for (let i = 0; i < tubular; i++) {
      const a = j * row + i, b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh(p, nm, uv, idx);
}
function icosphere(radius = 0.5, subdivisions = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ].map((v) => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = /* @__PURE__ */ new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = cache.get(key);
      if (m !== void 0) return m;
      const va = verts[a], vb = verts[b];
      const v = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
      const l = Math.hypot(...v);
      verts.push([v[0] / l, v[1] / l, v[2] / l]);
      m = verts.length - 1;
      cache.set(key, m);
      return m;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const p = [], nm = [], uv = [], idx = [];
  for (const v of verts) {
    p.push(v[0] * radius, v[1] * radius, v[2] * radius);
    nm.push(v[0], v[1], v[2]);
    uv.push(Math.atan2(v[2], v[0]) / (Math.PI * 2) + 0.5, Math.asin(v[1]) / Math.PI + 0.5);
  }
  for (const f of faces) idx.push(f[0], f[1], f[2]);
  return mesh(p, nm, uv, idx);
}

// src/core/ecs.js
var INDEX_BITS = 22;
var INDEX_MASK = (1 << INDEX_BITS) - 1;
var GEN_MASK = 1023;
var entityIndex = (e) => e & INDEX_MASK;
var entityGen = (e) => e >>> INDEX_BITS & GEN_MASK;
var makeEntity = (i, g) => ((g & GEN_MASK) << INDEX_BITS | i & INDEX_MASK) >>> 0;
var NULL_ENTITY = 4294967295;
var ARRAY_KINDS = {
  f32: Float32Array,
  f64: Float64Array,
  i32: Int32Array,
  u32: Uint32Array,
  i16: Int16Array,
  u16: Uint16Array,
  i8: Int8Array,
  u8: Uint8Array
};
var nextComponentId = 0;
function defineComponent(name, kind = "f32", stride = 1) {
  const Ctor = ARRAY_KINDS[kind];
  if (!Ctor) throw new Error(`axion: unknown component kind "${kind}"`);
  if (nextComponentId >= 256) throw new Error("axion: component limit (256) reached");
  return { id: nextComponentId++, name, kind, Ctor, stride, tag: stride === 0 };
}
var Archetype = class {
  constructor(components, capacity) {
    this.components = components;
    this.ids = components.map((c) => c.id);
    this.key = this.ids.join(",");
    this.has = new Uint8Array(256);
    for (const c of components) this.has[c.id] = 1;
    this.capacity = capacity;
    this.count = 0;
    this.entities = new Uint32Array(capacity);
    this.columns = /* @__PURE__ */ new Map();
    for (const c of components) {
      if (!c.tag) this.columns.set(c.id, new c.Ctor(capacity * c.stride));
    }
    this.version = 0;
  }
  grow() {
    const cap = this.capacity * 2;
    const ents = new Uint32Array(cap);
    ents.set(this.entities);
    this.entities = ents;
    for (const c of this.components) {
      if (c.tag) continue;
      const old = this.columns.get(c.id);
      const next = new c.Ctor(cap * c.stride);
      next.set(old);
      this.columns.set(c.id, next);
    }
    this.capacity = cap;
  }
  addRow(entity) {
    if (this.count === this.capacity) this.grow();
    const row = this.count++;
    this.entities[row] = entity;
    return row;
  }
  /** Swap-remove. Returns the entity that was moved into `row`, or NULL. */
  removeRow(row) {
    const last = --this.count;
    if (row !== last) {
      this.entities[row] = this.entities[last];
      for (const c of this.components) {
        if (c.tag) continue;
        const col = this.columns.get(c.id);
        col.copyWithin(row * c.stride, last * c.stride, (last + 1) * c.stride);
      }
      this.version++;
      return this.entities[row];
    }
    this.version++;
    return NULL_ENTITY;
  }
};
var World = class {
  constructor({ initialCapacity = 1024 } = {}) {
    this.initialCapacity = initialCapacity;
    this.archetypes = [];
    this.archetypeByKey = /* @__PURE__ */ new Map();
    this.generations = new Uint16Array(initialCapacity);
    this.locArchetype = new Int32Array(initialCapacity).fill(-1);
    this.locRow = new Uint32Array(initialCapacity);
    this.alive = new Uint8Array(initialCapacity);
    this.freeList = [];
    this.nextIndex = 0;
    this.resources = /* @__PURE__ */ new Map();
    this._systems = [];
    this._queryCache = /* @__PURE__ */ new Map();
    this._structureVersion = 0;
  }
  /* -- entity lifecycle -- */
  _reserveIndex() {
    if (this.freeList.length) return this.freeList.pop();
    const i = this.nextIndex++;
    if (i >= this.generations.length) this._growEntityTables();
    return i;
  }
  _growEntityTables() {
    const n = this.generations.length * 2;
    const g = new Uint16Array(n);
    g.set(this.generations);
    this.generations = g;
    const a = new Int32Array(n).fill(-1);
    a.set(this.locArchetype);
    this.locArchetype = a;
    const r = new Uint32Array(n);
    r.set(this.locRow);
    this.locRow = r;
    const al = new Uint8Array(n);
    al.set(this.alive);
    this.alive = al;
  }
  /**
   * Create an entity.
   *   world.spawn([Transform, Renderable])
   *   world.spawn([Transform], (cols, row) => { ... })  // init in place
   */
  spawn(components, init) {
    const idx = this._reserveIndex();
    this.alive[idx] = 1;
    const e = makeEntity(idx, this.generations[idx]);
    const arch = this._archetypeFor(components);
    const row = arch.addRow(e);
    this.locArchetype[idx] = arch.index;
    this.locRow[idx] = row;
    if (init) init(arch.columns, row, e);
    return e;
  }
  /** Bulk spawn: one archetype, n contiguous rows. Returns the first row. */
  spawnMany(components, n, init) {
    const arch = this._archetypeFor(components);
    const archIndex = arch.index;
    const first = arch.count;
    while (arch.capacity < arch.count + n) arch.grow();
    for (let k = 0; k < n; k++) {
      const idx = this._reserveIndex();
      this.alive[idx] = 1;
      const e = makeEntity(idx, this.generations[idx]);
      const row = arch.addRow(e);
      this.locArchetype[idx] = archIndex;
      this.locRow[idx] = row;
    }
    if (init) init(arch.columns, first, n, arch.entities);
    return { archetype: arch, first, count: n };
  }
  isAlive(e) {
    const i = entityIndex(e);
    return this.alive[i] === 1 && this.generations[i] === entityGen(e);
  }
  destroy(e) {
    const i = entityIndex(e);
    if (!this.isAlive(e)) return false;
    const arch = this.archetypes[this.locArchetype[i]];
    const moved = arch.removeRow(this.locRow[i]);
    if (moved !== NULL_ENTITY) this.locRow[entityIndex(moved)] = this.locRow[i];
    this.alive[i] = 0;
    this.locArchetype[i] = -1;
    this.generations[i] = this.generations[i] + 1 & GEN_MASK;
    this.freeList.push(i);
    return true;
  }
  /** Column view + row for a single entity. Convenience, not a hot path. */
  get(e, component) {
    const i = entityIndex(e);
    if (!this.isAlive(e)) return null;
    const arch = this.archetypes[this.locArchetype[i]];
    const col = arch.columns.get(component.id);
    if (!col) return null;
    return { array: col, offset: this.locRow[i] * component.stride, row: this.locRow[i] };
  }
  /* -- archetypes -- */
  _archetypeFor(components) {
    const sorted = [...components].sort((a, b) => a.id - b.id);
    const key = sorted.map((c) => c.id).join(",");
    let arch = this.archetypeByKey.get(key);
    if (!arch) {
      arch = new Archetype(sorted, this.initialCapacity);
      arch.index = this.archetypes.length;
      this.archetypeByKey.set(key, arch);
      this.archetypes.push(arch);
      this._structureVersion++;
      this._queryCache.clear();
    }
    return arch;
  }
  /* -- queries -- */
  /**
   * Match archetypes containing all of `all` and none of `none`.
   * Returns a cached array of archetypes; iterate them yourself for speed:
   *
   *   for (const a of world.query([Transform, Velocity])) {
   *     const t = a.columns.get(Transform.id);
   *     for (let r = 0; r < a.count; r++) { ... }
   *   }
   */
  query(all, none = []) {
    const key = all.map((c) => c.id).join(",") + "|" + none.map((c) => c.id).join(",");
    let list = this._queryCache.get(key);
    if (list) return list;
    list = this.archetypes.filter((a) => all.every((c) => a.has[c.id]) && none.every((c) => !a.has[c.id]));
    this._queryCache.set(key, list);
    return list;
  }
  /* -- resources & systems -- */
  setResource(name, value) {
    this.resources.set(name, value);
    return value;
  }
  getResource(name) {
    return this.resources.get(name);
  }
  /**
   * Systems run in ascending `order`. A system is just a function
   * (world, dt) => void — no base class, no lifecycle to remember.
   */
  addSystem(fn, { order = 0, name = fn.name || "system" } = {}) {
    this._systems.push({ fn, order, name, ms: 0 });
    this._systems.sort((a, b) => a.order - b.order);
    return fn;
  }
  removeSystem(fn) {
    const i = this._systems.findIndex((s) => s.fn === fn);
    if (i >= 0) this._systems.splice(i, 1);
  }
  /** Run one frame of simulation. `profile` records per-system ms. */
  step(dt, profile = false) {
    const sys = this._systems;
    if (!profile) {
      for (let i = 0; i < sys.length; i++) sys[i].fn(this, dt);
      return;
    }
    for (let i = 0; i < sys.length; i++) {
      const t0 = performance.now();
      sys[i].fn(this, dt);
      sys[i].ms = performance.now() - t0;
    }
  }
  get systemTimings() {
    return this._systems.map((s) => ({ name: s.name, ms: s.ms }));
  }
  get entityCount() {
    let n = 0;
    for (const a of this.archetypes) n += a.count;
    return n;
  }
};

// src/core/components.js
var Transform = defineComponent("Transform", "f32", 10);
var T_POS = 0;
var T_ROT = 3;
var T_SCALE = 7;
var LocalToWorld = defineComponent("LocalToWorld", "f32", 16);
var Bounds = defineComponent("Bounds", "f32", 4);
var MeshRef = defineComponent("MeshRef", "u32", 2);
var M_MESH = 0;
var M_MATERIAL = 1;
var Motion = defineComponent("Motion", "f32", 6);
var InstanceColor = defineComponent("InstanceColor", "f32", 4);
var Dynamic = defineComponent("Dynamic", "u8", 0);
var Hidden = defineComponent("Hidden", "u8", 0);
var PointLight = defineComponent("PointLight", "f32", 5);

// src/core/math.js
var math_exports = {};
__export(math_exports, {
  DEG2RAD: () => DEG2RAD,
  EPSILON: () => EPSILON,
  RAD2DEG: () => RAD2DEG,
  f32: () => f32,
  frustumFromMatrix: () => frustumFromMatrix,
  m4compose: () => m4compose,
  m4copy: () => m4copy,
  m4identity: () => m4identity,
  m4invert: () => m4invert,
  m4lookAt: () => m4lookAt,
  m4mul: () => m4mul,
  m4ortho: () => m4ortho,
  m4perspectiveReverseZ: () => m4perspectiveReverseZ,
  m4transformPoint: () => m4transformPoint,
  qFromAxisAngle: () => qFromAxisAngle,
  qFromEulerYXZ: () => qFromEulerYXZ,
  qidentity: () => qidentity,
  qmul: () => qmul,
  qnormalize: () => qnormalize,
  qrotateV3: () => qrotateV3,
  qslerp: () => qslerp,
  scratch: () => scratch,
  sphereInFrustum: () => sphereInFrustum,
  v3add: () => v3add,
  v3addScaled: () => v3addScaled,
  v3copy: () => v3copy,
  v3cross: () => v3cross,
  v3dot: () => v3dot,
  v3len: () => v3len,
  v3lenSq: () => v3lenSq,
  v3lerp: () => v3lerp,
  v3normalize: () => v3normalize,
  v3scale: () => v3scale,
  v3set: () => v3set,
  v3sub: () => v3sub
});
var EPSILON = 1e-6;
var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;
var f32 = (n) => new Float32Array(n);
function v3set(o, oi, x, y, z) {
  o[oi] = x;
  o[oi + 1] = y;
  o[oi + 2] = z;
  return o;
}
function v3copy(o, oi, a, ai) {
  o[oi] = a[ai];
  o[oi + 1] = a[ai + 1];
  o[oi + 2] = a[ai + 2];
  return o;
}
function v3add(o, oi, a, ai, b, bi) {
  o[oi] = a[ai] + b[bi];
  o[oi + 1] = a[ai + 1] + b[bi + 1];
  o[oi + 2] = a[ai + 2] + b[bi + 2];
  return o;
}
function v3sub(o, oi, a, ai, b, bi) {
  o[oi] = a[ai] - b[bi];
  o[oi + 1] = a[ai + 1] - b[bi + 1];
  o[oi + 2] = a[ai + 2] - b[bi + 2];
  return o;
}
function v3scale(o, oi, a, ai, s) {
  o[oi] = a[ai] * s;
  o[oi + 1] = a[ai + 1] * s;
  o[oi + 2] = a[ai + 2] * s;
  return o;
}
function v3addScaled(o, oi, a, ai, b, bi, s) {
  o[oi] = a[ai] + b[bi] * s;
  o[oi + 1] = a[ai + 1] + b[bi + 1] * s;
  o[oi + 2] = a[ai + 2] + b[bi + 2] * s;
  return o;
}
function v3dot(a, ai, b, bi) {
  return a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2];
}
function v3cross(o, oi, a, ai, b, bi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2];
  o[oi] = ay * bz - az * by;
  o[oi + 1] = az * bx - ax * bz;
  o[oi + 2] = ax * by - ay * bx;
  return o;
}
function v3len(a, ai) {
  return Math.hypot(a[ai], a[ai + 1], a[ai + 2]);
}
function v3lenSq(a, ai) {
  return a[ai] * a[ai] + a[ai + 1] * a[ai + 1] + a[ai + 2] * a[ai + 2];
}
function v3normalize(o, oi, a, ai) {
  const l = v3len(a, ai);
  const s = l > EPSILON ? 1 / l : 0;
  return v3scale(o, oi, a, ai, s);
}
function v3lerp(o, oi, a, ai, b, bi, t) {
  o[oi] = a[ai] + (b[bi] - a[ai]) * t;
  o[oi + 1] = a[ai + 1] + (b[bi + 1] - a[ai + 1]) * t;
  o[oi + 2] = a[ai + 2] + (b[bi + 2] - a[ai + 2]) * t;
  return o;
}
function qidentity(o, oi) {
  o[oi] = 0;
  o[oi + 1] = 0;
  o[oi + 2] = 0;
  o[oi + 3] = 1;
  return o;
}
function qFromAxisAngle(o, oi, a, ai, angle) {
  const h = angle * 0.5, s = Math.sin(h);
  o[oi] = a[ai] * s;
  o[oi + 1] = a[ai + 1] * s;
  o[oi + 2] = a[ai + 2] * s;
  o[oi + 3] = Math.cos(h);
  return o;
}
function qFromEulerYXZ(o, oi, yaw, pitch, roll) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cx = Math.cos(pitch * 0.5), sx = Math.sin(pitch * 0.5);
  const cz = Math.cos(roll * 0.5), sz = Math.sin(roll * 0.5);
  o[oi] = sx * cy * cz + cx * sy * sz;
  o[oi + 1] = cx * sy * cz - sx * cy * sz;
  o[oi + 2] = cx * cy * sz - sx * sy * cz;
  o[oi + 3] = cx * cy * cz + sx * sy * sz;
  return o;
}
function qmul(o, oi, a, ai, b, bi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
function qnormalize(o, oi, a, ai) {
  const x = a[ai], y = a[ai + 1], z = a[ai + 2], w = a[ai + 3];
  const l = Math.hypot(x, y, z, w) || 1;
  const s = 1 / l;
  o[oi] = x * s;
  o[oi + 1] = y * s;
  o[oi + 2] = z * s;
  o[oi + 3] = w * s;
  return o;
}
function qrotateV3(o, oi, q, qi, v, vi) {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const vx = v[vi], vy = v[vi + 1], vz = v[vi + 2];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  o[oi] = vx + qw * tx + (qy * tz - qz * ty);
  o[oi + 1] = vy + qw * ty + (qz * tx - qx * tz);
  o[oi + 2] = vz + qw * tz + (qx * ty - qy * tx);
  return o;
}
function qslerp(o, oi, a, ai, b, bi, t) {
  let ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0, s1;
  if (1 - cos > EPSILON) {
    const omega = Math.acos(cos), sin = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sin;
    s1 = Math.sin(t * omega) / sin;
  } else {
    s0 = 1 - t;
    s1 = t;
  }
  o[oi] = s0 * ax + s1 * bx;
  o[oi + 1] = s0 * ay + s1 * by;
  o[oi + 2] = s0 * az + s1 * bz;
  o[oi + 3] = s0 * aw + s1 * bw;
  return o;
}
function m4identity(o, oi) {
  o.fill(0, oi, oi + 16);
  o[oi] = 1;
  o[oi + 5] = 1;
  o[oi + 10] = 1;
  o[oi + 15] = 1;
  return o;
}
function m4copy(o, oi, a, ai) {
  for (let i = 0; i < 16; i++) o[oi + i] = a[ai + i];
  return o;
}
function m4compose(o, oi, p, pi, q, qi, s, si) {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[si], sy = s[si + 1], sz = s[si + 2];
  o[oi] = (1 - (yy + zz)) * sx;
  o[oi + 1] = (xy + wz) * sx;
  o[oi + 2] = (xz - wy) * sx;
  o[oi + 3] = 0;
  o[oi + 4] = (xy - wz) * sy;
  o[oi + 5] = (1 - (xx + zz)) * sy;
  o[oi + 6] = (yz + wx) * sy;
  o[oi + 7] = 0;
  o[oi + 8] = (xz + wy) * sz;
  o[oi + 9] = (yz - wx) * sz;
  o[oi + 10] = (1 - (xx + yy)) * sz;
  o[oi + 11] = 0;
  o[oi + 12] = p[pi];
  o[oi + 13] = p[pi + 1];
  o[oi + 14] = p[pi + 2];
  o[oi + 15] = 1;
  return o;
}
function m4mul(o, oi, a, ai, b, bi) {
  const a00 = a[ai], a01 = a[ai + 1], a02 = a[ai + 2], a03 = a[ai + 3];
  const a10 = a[ai + 4], a11 = a[ai + 5], a12 = a[ai + 6], a13 = a[ai + 7];
  const a20 = a[ai + 8], a21 = a[ai + 9], a22 = a[ai + 10], a23 = a[ai + 11];
  const a30 = a[ai + 12], a31 = a[ai + 13], a32 = a[ai + 14], a33 = a[ai + 15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[bi + c * 4], b1 = b[bi + c * 4 + 1], b2 = b[bi + c * 4 + 2], b3 = b[bi + c * 4 + 3];
    o[oi + c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    o[oi + c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    o[oi + c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    o[oi + c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return o;
}
function m4invert(o, oi, a, ai) {
  const m = a, i = ai;
  const a00 = m[i], a01 = m[i + 1], a02 = m[i + 2], a03 = m[i + 3];
  const a10 = m[i + 4], a11 = m[i + 5], a12 = m[i + 6], a13 = m[i + 7];
  const a20 = m[i + 8], a21 = m[i + 9], a22 = m[i + 10], a23 = m[i + 11];
  const a30 = m[i + 12], a31 = m[i + 13], a32 = m[i + 14], a33 = m[i + 15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return m4identity(o, oi);
  det = 1 / det;
  o[oi] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[oi + 1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[oi + 2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[oi + 3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[oi + 4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[oi + 5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[oi + 6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[oi + 7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[oi + 8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[oi + 9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[oi + 10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[oi + 11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[oi + 12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[oi + 13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[oi + 14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[oi + 15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
function m4perspectiveReverseZ(o, oi, fovY, aspect, near) {
  const f = 1 / Math.tan(fovY * 0.5);
  o.fill(0, oi, oi + 16);
  o[oi] = f / aspect;
  o[oi + 5] = f;
  o[oi + 10] = 0;
  o[oi + 11] = -1;
  o[oi + 14] = near;
  return o;
}
function m4ortho(o, oi, l, r, b, t, near, far) {
  o.fill(0, oi, oi + 16);
  o[oi] = 2 / (r - l);
  o[oi + 5] = 2 / (t - b);
  o[oi + 10] = 1 / (near - far);
  o[oi + 12] = (r + l) / (l - r);
  o[oi + 13] = (t + b) / (b - t);
  o[oi + 14] = near / (near - far);
  o[oi + 15] = 1;
  return o;
}
function m4lookAt(o, oi, eye, ei, target, ti, up, ui) {
  const zx = eye[ei] - target[ti], zy = eye[ei + 1] - target[ti + 1], zz = eye[ei + 2] - target[ti + 2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl, z1 = zy / zl, z2 = zz / zl;
  let x0 = up[ui + 1] * z2 - up[ui + 2] * z1;
  let x1 = up[ui + 2] * z0 - up[ui] * z2;
  let x2 = up[ui] * z1 - up[ui + 1] * z0;
  const xl = Math.hypot(x0, x1, x2) || 1;
  x0 /= xl;
  x1 /= xl;
  x2 /= xl;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  o[oi] = x0;
  o[oi + 1] = y0;
  o[oi + 2] = z0;
  o[oi + 3] = 0;
  o[oi + 4] = x1;
  o[oi + 5] = y1;
  o[oi + 6] = z1;
  o[oi + 7] = 0;
  o[oi + 8] = x2;
  o[oi + 9] = y2;
  o[oi + 10] = z2;
  o[oi + 11] = 0;
  o[oi + 12] = -(x0 * eye[ei] + x1 * eye[ei + 1] + x2 * eye[ei + 2]);
  o[oi + 13] = -(y0 * eye[ei] + y1 * eye[ei + 1] + y2 * eye[ei + 2]);
  o[oi + 14] = -(z0 * eye[ei] + z1 * eye[ei + 1] + z2 * eye[ei + 2]);
  o[oi + 15] = 1;
  return o;
}
function m4transformPoint(o, oi, m, mi, v, vi) {
  const x = v[vi], y = v[vi + 1], z = v[vi + 2];
  const w = m[mi + 3] * x + m[mi + 7] * y + m[mi + 11] * z + m[mi + 15] || 1;
  o[oi] = (m[mi] * x + m[mi + 4] * y + m[mi + 8] * z + m[mi + 12]) / w;
  o[oi + 1] = (m[mi + 1] * x + m[mi + 5] * y + m[mi + 9] * z + m[mi + 13]) / w;
  o[oi + 2] = (m[mi + 2] * x + m[mi + 6] * y + m[mi + 10] * z + m[mi + 14]) / w;
  return o;
}
function frustumFromMatrix(out, oi, m, mi) {
  const rows = [
    [m[mi + 3], m[mi + 7], m[mi + 11], m[mi + 15]],
    [m[mi], m[mi + 4], m[mi + 8], m[mi + 12]],
    [m[mi + 1], m[mi + 5], m[mi + 9], m[mi + 13]],
    [m[mi + 2], m[mi + 6], m[mi + 10], m[mi + 14]]
  ];
  const put = (i, a, b, s) => {
    let x = rows[a][0] + s * rows[b][0];
    let y = rows[a][1] + s * rows[b][1];
    let z = rows[a][2] + s * rows[b][2];
    let w = rows[a][3] + s * rows[b][3];
    const l = Math.hypot(x, y, z) || 1;
    out[oi + i * 4] = x / l;
    out[oi + i * 4 + 1] = y / l;
    out[oi + i * 4 + 2] = z / l;
    out[oi + i * 4 + 3] = w / l;
  };
  put(0, 0, 1, 1);
  put(1, 0, 1, -1);
  put(2, 0, 2, 1);
  put(3, 0, 2, -1);
  put(4, 0, 3, 1);
  put(5, 0, 3, -1);
  return out;
}
function sphereInFrustum(planes, pi, cx, cy, cz, r) {
  for (let i = 0; i < 6; i++) {
    const o = pi + i * 4;
    if (planes[o] * cx + planes[o + 1] * cy + planes[o + 2] * cz + planes[o + 3] < -r) return false;
  }
  return true;
}
var scratch = {
  v3: [f32(3), f32(3), f32(3), f32(3)],
  q: [f32(4), f32(4)],
  m4: [f32(16), f32(16), f32(16)]
};

// src/render/renderer.js
var INSTANCE_FLOATS = 28;
var LIGHT_FLOATS = 12;
var CAMERA_FLOATS = 132;
var MAX_LIGHTS = 256;
var FACE_SLOT_BYTES = 256;
var HDR_FORMAT = "rgba16float";
var ALBEDO_FORMAT = "rgba8unorm";
var MAT_SNAP = 12;
var TONEMAP_MODES = { linear: 0, reinhard: 1, filmic: 2, aces: 3, agx: 4 };
var AO_FORMAT = "rgba16float";
var Renderer = class {
  constructor({ device, context, format, canvas }, options = {}) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.clearColor = options.clearColor ?? [0.02, 0.025, 0.035, 1];
    this.exposure = options.exposure ?? 1;
    this.fogDensity = options.fogDensity ?? 0;
    this.fogColor = options.fogColor ?? [0.02, 0.025, 0.035];
    this.aerialPerspective = options.aerialPerspective ?? 0.85;
    this.ambient = options.ambient ?? [0.09, 0.11, 0.15];
    this.groundAmbient = options.groundAmbient ?? 0.35;
    this.frustumCulling = options.frustumCulling !== false;
    this.depthPrepass = options.depthPrepass !== false;
    this.fxaa = options.fxaa !== false;
    this.ssr = {
      intensity: options.ssr?.intensity ?? 1,
      steps: options.ssr?.steps ?? 48,
      /** World-space depth a surface is assumed to have behind its visible face. */
      thickness: options.ssr?.thickness ?? 0.5,
      maxDistance: options.ssr?.maxDistance ?? 70,
      fadeDistance: options.ssr?.fadeDistance ?? 90
    };
    this.ao = {
      intensity: options.ao?.intensity ?? 1,
      radius: options.ao?.radius ?? 1.6,
      power: options.ao?.power ?? 1.4,
      bias: options.ao?.bias ?? 0.04,
      fadeDistance: options.ao?.fadeDistance ?? 55
    };
    this.ssil = {
      intensity: options.ssil?.intensity ?? 0,
      radius: options.ssil?.radius ?? 3
    };
    this.volumetric = {
      enabled: options.volumetric?.enabled ?? false,
      density: options.volumetric?.density ?? 0.03,
      steps: options.volumetric?.steps ?? 24,
      anisotropy: options.volumetric?.anisotropy ?? 0.3,
      maxDistance: options.volumetric?.maxDistance ?? 60,
      heightBase: options.volumetric?.heightBase ?? 0,
      heightFalloff: options.volumetric?.heightFalloff ?? 0.15,
      ambient: options.volumetric?.ambient ?? 1,
      lightScatter: options.volumetric?.lightScatter ?? 1,
      color: options.volumetric?.color ?? [1, 1, 1]
    };
    this.tonemap = {
      mode: options.tonemap?.mode ?? "aces",
      white: options.tonemap?.white ?? 6,
      brightness: options.tonemap?.brightness ?? 1,
      contrast: options.tonemap?.contrast ?? 1,
      saturation: options.tonemap?.saturation ?? 1
    };
    this.dof = {
      enabled: options.dof?.enabled ?? false,
      focus: options.dof?.focus ?? 5,
      range: options.dof?.range ?? 1.5,
      transition: options.dof?.transition ?? 4,
      amount: options.dof?.amount ?? 8,
      near: options.dof?.near ?? true,
      far: options.dof?.far ?? true,
      autoFocus: options.dof?.autoFocus ?? false
    };
    this.exposureCompensation = options.exposureCompensation ?? 0;
    this.autoExposure = {
      enabled: options.autoExposure?.enabled ?? false,
      /** Target average (log-mean) luminance. 0.18 is photographic middle grey. */
      key: options.autoExposure?.key ?? 0.12,
      speed: options.autoExposure?.speed ?? 1.5,
      min: options.autoExposure?.min ?? -6,
      max: options.autoExposure?.max ?? 6
    };
    this.physical = {
      enabled: options.physical?.enabled ?? false,
      aperture: options.physical?.aperture ?? 16,
      shutter: options.physical?.shutter ?? 1 / 100,
      iso: options.physical?.iso ?? 100,
      compensation: options.physical?.compensation ?? 0
    };
    this.bloom = {
      threshold: options.bloom?.threshold ?? 1,
      knee: options.bloom?.knee ?? 0.6,
      strength: options.bloom?.strength ?? 0.5,
      levels: options.bloom?.levels ?? 5
    };
    this.shadows = {
      enabled: options.shadows?.enabled !== false,
      maxLights: options.shadows?.maxLights ?? 4,
      size: options.shadows?.size ?? 512,
      pcfRadius: options.shadows?.pcfRadius ?? 1.6,
      normalBias: options.shadows?.normalBias ?? 0.045,
      bias: options.shadows?.bias ?? 35e-4,
      near: options.shadows?.near ?? 0.25,
      maxCasters: options.shadows?.maxCasters ?? 4e4
    };
    this.vertexArena = new Arena(device, GPUBufferUsage.VERTEX, 4 << 20, "axion-vertices");
    this.indexArena = new Arena(device, GPUBufferUsage.INDEX, 2 << 20, "axion-indices");
    this.instances = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096 * INSTANCE_FLOATS, "axion-instances");
    this.visibleList = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096, "axion-visible");
    this.shadowModels = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096, "axion-shadow-casters");
    this.cameraBuffer = device.createBuffer({
      size: CAMERA_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "axion-camera"
    });
    this.cameraData = new Float32Array(CAMERA_FLOATS);
    this.lightBuffer = device.createBuffer({
      size: MAX_LIGHTS * LIGHT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "axion-lights"
    });
    this.lightData = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);
    this.meshes = [];
    this.materials = [];
    this._pipelines = /* @__PURE__ */ new Map();
    this._modules = {
      standard: device.createShaderModule({ code: STANDARD_WGSL, label: "axion-standard" }),
      shadow: device.createShaderModule({ code: SHADOW_WGSL, label: "axion-shadow" }),
      ao: device.createShaderModule({ code: AO_WGSL, label: "axion-ao" }),
      aoBlur: device.createShaderModule({ code: AO_BLUR_WGSL, label: "axion-ao-blur" }),
      resolve: device.createShaderModule({ code: RESOLVE_WGSL, label: "axion-resolve" }),
      bloomPrefilter: device.createShaderModule({ code: BLOOM_PREFILTER_WGSL, label: "axion-bloom-prefilter" }),
      bloomDown: device.createShaderModule({ code: BLOOM_DOWN_WGSL, label: "axion-bloom-down" }),
      bloomUp: device.createShaderModule({ code: BLOOM_UP_WGSL, label: "axion-bloom-up" }),
      final: device.createShaderModule({ code: FINAL_WGSL, label: "axion-final" }),
      volume: device.createShaderModule({ code: VOLUME_WGSL, label: "axion-volume" }),
      exposure: device.createShaderModule({ code: EXPOSURE_WGSL, label: "axion-exposure" }),
      dof: device.createShaderModule({ code: DOF_WGSL, label: "axion-dof" })
    };
    this._buildLayouts();
    this._buildStaticPipelines();
    this._buildShadowTarget();
    this._rebuildFrameBindGroup();
    this._sig = null;
    this._groups = [];
    this._dyn = [];
    this._moved = [];
    this._instTotal = 0;
    this._draws = [];
    this._shadowState = [];
    this._frustum = new Float32Array(24);
    this._shadowBatches = [];
    this._shadowSlots = /* @__PURE__ */ new Map();
    this._targets = null;
    this._targetSize = [0, 0];
    this.stats = {
      drawCalls: 0,
      instances: 0,
      culled: 0,
      triangles: 0,
      batches: 0,
      shadowDraws: 0,
      shadowCasters: 0,
      shadowLights: 0,
      cpuMs: 0
    };
    this.defaultMaterial = this.createMaterial({ color: [0.8, 0.8, 0.82] });
  }
  /* ------------------------------------------------------------- layouts */
  _buildLayouts() {
    const d = this.device;
    const FRAG = GPUShaderStage.FRAGMENT;
    const VERT = GPUShaderStage.VERTEX;
    this._frameLayout = d.createBindGroupLayout({
      label: "axion-frame",
      entries: [
        { binding: 0, visibility: VERT | FRAG, buffer: { type: "uniform" } },
        { binding: 1, visibility: VERT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: FRAG, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: FRAG, texture: { sampleType: "depth", viewDimension: "2d-array" } },
        { binding: 4, visibility: FRAG, sampler: { type: "comparison" } },
        { binding: 5, visibility: VERT, buffer: { type: "read-only-storage" } }
      ]
    });
    this._materialLayout = d.createBindGroupLayout({
      label: "axion-material",
      entries: [
        { binding: 0, visibility: FRAG, sampler: { type: "filtering" } },
        { binding: 1, visibility: FRAG, texture: { sampleType: "float" } },
        { binding: 2, visibility: FRAG, texture: { sampleType: "float" } },
        { binding: 3, visibility: FRAG, texture: { sampleType: "float" } },
        { binding: 4, visibility: FRAG, buffer: { type: "uniform" } }
      ]
    });
    this._geometryLayout = d.createPipelineLayout({
      bindGroupLayouts: [this._frameLayout, this._materialLayout],
      label: "axion-geometry-layout"
    });
    this._materialSampler = d.createSampler({
      label: "axion-material",
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8
    });
    this._defaultTextures = {
      white: solidTexture(d, [255, 255, 255, 255], { srgb: true, label: "axion-white" }),
      data: solidTexture(d, [255, 255, 255, 255], { label: "axion-white-linear" }),
      normal: solidTexture(d, [128, 128, 255, 255], { label: "axion-flat-normal" })
    };
    this._shadowLayout = d.createBindGroupLayout({
      label: "axion-shadow",
      entries: [
        { binding: 0, visibility: VERT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 64 } },
        { binding: 1, visibility: VERT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: VERT, buffer: { type: "read-only-storage" } }
      ]
    });
    const tex = (n) => ({ binding: n, visibility: FRAG, texture: { sampleType: "float" } });
    const depthTex = (n) => ({ binding: n, visibility: FRAG, texture: { sampleType: "depth" } });
    const cam = { binding: 0, visibility: FRAG, buffer: { type: "uniform" } };
    const samp = { binding: 1, visibility: FRAG, sampler: { type: "filtering" } };
    this._aoLayout = d.createBindGroupLayout({
      label: "axion-ao",
      entries: [cam, samp, depthTex(2), tex(3), tex(4)]
    });
    this._volumeLayout = d.createBindGroupLayout({
      label: "axion-volume",
      entries: [
        cam,
        samp,
        depthTex(2),
        { binding: 3, visibility: FRAG, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: FRAG, texture: { sampleType: "depth", viewDimension: "2d-array" } },
        { binding: 5, visibility: FRAG, sampler: { type: "comparison" } }
      ]
    });
    this._exposureLayout = d.createBindGroupLayout({
      label: "axion-exposure",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    this._aoBlurLayout = d.createBindGroupLayout({
      label: "axion-ao-blur",
      entries: [cam, samp, tex(2), depthTex(3)]
    });
    this._resolveLayout = d.createBindGroupLayout({
      label: "axion-resolve",
      entries: [cam, samp, tex(2), tex(3), tex(4), depthTex(5), tex(6), tex(7)]
    });
    this._bloomLayout = d.createBindGroupLayout({
      label: "axion-bloom",
      entries: [cam, samp, tex(2)]
    });
    this._finalLayout = d.createBindGroupLayout({
      label: "axion-final",
      entries: [cam, samp, tex(2), tex(3), { binding: 4, visibility: FRAG, buffer: { type: "read-only-storage" } }]
    });
    this._sampler = d.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      label: "axion-linear"
    });
    this._shadowSampler = d.createSampler({
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      label: "axion-shadow-cmp"
    });
  }
  _fullscreenPipeline(label, layout, module, format, blend) {
    return this.device.createRenderPipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format, blend }] },
      primitive: { topology: "triangle-list" }
    });
  }
  _buildStaticPipelines() {
    const m = this._modules;
    this._shadowPipeline = this.device.createRenderPipeline({
      label: "axion-shadow",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._shadowLayout] }),
      vertex: {
        module: m.shadow,
        entryPoint: "vs",
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
        }]
      },
      // No fragment stage at all: a depth-only pass needs none, and leaving it
      // out lets the driver take its fast path.
      primitive: { topology: "triangle-list", cullMode: "front", frontFace: "ccw" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" }
    });
    this._shadowMaskPipeline = this.device.createRenderPipeline({
      label: "axion-shadow-mask",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._shadowLayout, this._materialLayout] }),
      vertex: {
        module: m.shadow,
        entryPoint: "vsMask",
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x2" }
          ]
        }]
      },
      fragment: { module: m.shadow, entryPoint: "fsMask", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" }
    });
    this._aoPipeline = this._fullscreenPipeline("axion-ao", this._aoLayout, m.ao, AO_FORMAT);
    this._aoBlurPipeline = this._fullscreenPipeline("axion-ao-blur", this._aoBlurLayout, m.aoBlur, AO_FORMAT);
    this._volumePipeline = this._fullscreenPipeline("axion-volume", this._volumeLayout, m.volume, AO_FORMAT);
    this._exposurePipeline = this.device.createComputePipeline({
      label: "axion-exposure",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._exposureLayout] }),
      compute: { module: m.exposure, entryPoint: "main" }
    });
    this.exposureBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "axion-exposure-state"
    });
    this._dofLayout = this.device.createBindGroupLayout({
      label: "axion-dof",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
      ]
    });
    this._dofPipeline = this._fullscreenPipeline("axion-dof", this._dofLayout, m.dof, HDR_FORMAT);
    this._resolvePipeline = this._fullscreenPipeline("axion-resolve", this._resolveLayout, m.resolve, HDR_FORMAT);
    this._bloomPrefilterPipeline = this._fullscreenPipeline("axion-bloom-prefilter", this._bloomLayout, m.bloomPrefilter, HDR_FORMAT);
    this._bloomDownPipeline = this._fullscreenPipeline("axion-bloom-down", this._bloomLayout, m.bloomDown, HDR_FORMAT);
    this._bloomUpPipeline = this._fullscreenPipeline("axion-bloom-up", this._bloomLayout, m.bloomUp, HDR_FORMAT, {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
    });
    this._finalPipeline = this._fullscreenPipeline("axion-final", this._finalLayout, m.final, this.format);
  }
  /**
   * (Re)allocate the shadow atlas and the per-face uniform slots.
   *
   * `shadows.maxLights` and `shadows.size` are plain writable fields, so they
   * can change at any time — including mid-session from a UI slider. Anything
   * derived from them has to be rebuilt here rather than assumed fixed at
   * construction, or a raised limit indexes past the end of the atlas.
   */
  _buildShadowTarget() {
    const layers = Math.max(6, this.shadows.maxLights * 6);
    const size = this.shadows.size;
    this._shadowBuiltFor = { maxLights: this.shadows.maxLights, size };
    const faceBytes = Math.max(FACE_SLOT_BYTES, layers * FACE_SLOT_BYTES);
    if (!this.faceBuffer || this.faceBuffer.size < faceBytes) {
      retire(this.faceBuffer);
      this.faceBuffer = this.device.createBuffer({
        size: faceBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "axion-shadow-faces"
      });
      this.faceData = new Float32Array(faceBytes / 4);
      this._boundShadowBuffer = null;
    }
    retire(this._shadowTexture);
    this._shadowTexture = this.device.createTexture({
      size: [size, size, layers],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: "axion-shadow-array"
    });
    this._shadowArrayView = this._shadowTexture.createView({ dimension: "2d-array" });
    this._shadowFaceViews = [];
    for (let i = 0; i < layers; i++) {
      this._shadowFaceViews.push(this._shadowTexture.createView({
        dimension: "2d",
        baseArrayLayer: i,
        arrayLayerCount: 1
      }));
    }
    this._boundInstanceBuffer = null;
    this._shadowState = [];
  }
  _ensureShadowCapacity() {
    const built = this._shadowBuiltFor;
    if (built && built.maxLights === this.shadows.maxLights && built.size === this.shadows.size) return;
    this._buildShadowTarget();
    this._rebuildFrameBindGroup();
    this._rebuildShadowBindGroup();
  }
  /* ------------------------------------------------------------ registry */
  /** Upload a mesh into the shared arenas. Returns a mesh id. */
  createMesh(geometry, name = `mesh${this.meshes.length}`) {
    const vOffset = this.vertexArena.upload(geometry.vertices, VERTEX_STRIDE_BYTES);
    const iOffset = this.indexArena.upload(geometry.indices, 4);
    const id = this.meshes.length;
    this.meshes.push({
      id,
      name,
      baseVertex: vOffset / VERTEX_STRIDE_BYTES,
      firstIndex: iOffset / 4,
      indexCount: geometry.indices.length,
      bounds: geometry.bounds
    });
    return id;
  }
  /**
   * Materials are small value records, not shader programs. Two materials that
   * differ only in color share a pipeline and therefore cause no state change
   * between their draws; they still form separate instance batches.
   *
   * `noiseScale` above zero switches on procedural surface detail: fBm
   * weathering that modulates albedo, roughness, metallic and the normal,
   * evaluated per pixel in world space. No texture, no UV seams, no memory.
   */
  createMaterial({
    color = [1, 1, 1],
    alpha = 1,
    metallic = 0,
    roughness = 0.6,
    emissive = 0,
    transparent = false,
    doubleSided = false,
    castShadow = true,
    noiseScale = 0,
    noiseStrength = 0.6,
    bump = 0.5,
    oxide = 0,
    // Textures, as GPUTextures. Base colour must be an sRGB format; the
    // metallic-roughness (G = roughness, B = metallic) and normal maps linear.
    baseColorTexture = null,
    metallicRoughnessTexture = null,
    normalTexture = null,
    normalScale = 1,
    // 'OPAQUE' or 'MASK'. MASK discards below alphaCutoff, in both the
    // geometry pass and the shadow pass.
    alphaMode = "OPAQUE",
    alphaCutoff = 0.5,
    name = `material${this.materials.length}`
  } = {}) {
    const id = this.materials.length;
    const masked = alphaMode === "MASK";
    const params = this.device.createBuffer({
      label: `axion-material-${name}`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(params, 0, new Float32Array([
      masked ? alphaCutoff : 0,
      normalScale,
      normalTexture ? 1 : 0,
      0
    ]));
    const d = this._defaultTextures;
    const bindGroup = this.device.createBindGroup({
      layout: this._materialLayout,
      label: `axion-material-${name}`,
      entries: [
        { binding: 0, resource: this._materialSampler },
        { binding: 1, resource: (baseColorTexture ?? d.white).createView() },
        { binding: 2, resource: (metallicRoughnessTexture ?? d.data).createView() },
        { binding: 3, resource: (normalTexture ?? d.normal).createView() },
        { binding: 4, resource: { buffer: params } }
      ]
    });
    this.materials.push({
      id,
      name,
      color,
      alpha,
      metallic,
      roughness,
      emissive,
      transparent,
      doubleSided,
      castShadow,
      noiseScale,
      noiseStrength,
      bump,
      oxide,
      masked,
      bindGroup,
      params
    });
    return id;
  }
  /**
   * The exposure the final pass multiplies by, before auto exposure. With the
   * physical camera on it is metered from aperture, shutter and ISO (the
   * standard saturation-based formula, 1.2 * 2^EV100); otherwise `exposure`.
   */
  effectiveExposure() {
    const p = this.physical;
    if (!p.enabled) return this.exposure;
    const ev100 = Math.log2(p.aperture * p.aperture / p.shutter * 100 / p.iso);
    return Math.pow(2, p.compensation) / (1.2 * Math.pow(2, ev100));
  }
  /** Recreated only when the instance buffer was reallocated by a grow. */
  _rebuildFrameBindGroup() {
    if (this._boundInstanceBuffer === this.instances.buffer && this._boundVisibleBuffer === this.visibleList.buffer) return;
    this._boundInstanceBuffer = this.instances.buffer;
    this._boundVisibleBuffer = this.visibleList.buffer;
    this.frameBindGroup = this.device.createBindGroup({
      layout: this._frameLayout,
      label: "axion-frame",
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.instances.buffer } },
        { binding: 2, resource: { buffer: this.lightBuffer } },
        { binding: 3, resource: this._shadowArrayView },
        { binding: 4, resource: this._shadowSampler },
        { binding: 5, resource: { buffer: this.visibleList.buffer } }
      ]
    });
  }
  _rebuildShadowBindGroup() {
    if (this._boundShadowBuffer === this.shadowModels.buffer && this._boundShadowInstances === this.instances.buffer) return;
    this._boundShadowBuffer = this.shadowModels.buffer;
    this._boundShadowInstances = this.instances.buffer;
    this.shadowBindGroup = this.device.createBindGroup({
      layout: this._shadowLayout,
      label: "axion-shadow",
      entries: [
        { binding: 0, resource: { buffer: this.faceBuffer, size: 64 } },
        { binding: 1, resource: { buffer: this.instances.buffer } },
        { binding: 2, resource: { buffer: this.shadowModels.buffer } }
      ]
    });
  }
  /** Opaque, not alpha-tested: the materials the depth prepass can draw. */
  _inPrepass(material) {
    return this.depthPrepass && !material.transparent && !material.masked;
  }
  _depthPipelineFor(material) {
    const key = `depth|${material.doubleSided ? 1 : 0}`;
    let p = this._pipelines.get(key);
    if (p) return p;
    this._depthLayout ??= this.device.createPipelineLayout({
      bindGroupLayouts: [this._frameLayout],
      label: "axion-depth-layout"
    });
    p = this.device.createRenderPipeline({
      label: `axion-pipeline-${key}`,
      layout: this._depthLayout,
      vertex: {
        module: this._modules.standard,
        entryPoint: "vsDepth",
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
        }]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: material.doubleSided ? "none" : "back",
        frontFace: "ccw"
      },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" }
    });
    this._pipelines.set(key, p);
    return p;
  }
  _pipelineFor(material) {
    const pre = this._inPrepass(material);
    const key = `${material.transparent ? 1 : 0}|${material.doubleSided ? 1 : 0}|${pre ? 1 : 0}`;
    let p = this._pipelines.get(key);
    if (p) return p;
    p = this.device.createRenderPipeline({
      label: `axion-pipeline-${key}`,
      layout: this._geometryLayout,
      vertex: {
        module: this._modules.standard,
        entryPoint: "vs",
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module: this._modules.standard,
        entryPoint: "fs",
        targets: [
          {
            format: HDR_FORMAT,
            blend: material.transparent ? {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
            } : void 0
          },
          // Transparent surfaces must not overwrite the surface or albedo
          // buffers, or the resolve would shade a reflection for a ghost.
          { format: HDR_FORMAT, writeMask: material.transparent ? 0 : GPUColorWrite.ALL },
          { format: ALBEDO_FORMAT, writeMask: material.transparent ? 0 : GPUColorWrite.ALL }
        ]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: material.doubleSided ? "none" : "back",
        frontFace: "ccw"
      },
      // Reverse-Z: clear to 0, keep the greater depth. Gives float32 depth its
      // precision where it matters instead of wasting it near the near plane.
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: !material.transparent && !pre,
        depthCompare: pre ? "equal" : "greater"
      }
    });
    this._pipelines.set(key, p);
    return p;
  }
  /* -------------------------------------------------------- attachments */
  _ensureTargets() {
    const { width, height } = this.canvas;
    if (this._targetSize[0] === width && this._targetSize[1] === height) return;
    for (const t2 of this._targets?.all ?? []) retire(t2);
    const make = (format, w, h, label) => this.device.createTexture({
      size: [Math.max(1, w), Math.max(1, h)],
      format,
      label,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    });
    const color = make(HDR_FORMAT, width, height, "axion-scene-color");
    const surface = make(HDR_FORMAT, width, height, "axion-surface");
    const albedo = make(ALBEDO_FORMAT, width, height, "axion-albedo");
    const depth = make("depth32float", width, height, "axion-depth");
    const hdr = make(HDR_FORMAT, width, height, "axion-hdr");
    const aoW = Math.max(1, width >> 1), aoH = Math.max(1, height >> 1);
    const ao = make(AO_FORMAT, aoW, aoH, "axion-ao");
    const aoBlur = make(AO_FORMAT, aoW, aoH, "axion-ao-blur");
    const vol = make(AO_FORMAT, aoW, aoH, "axion-volume");
    const volBlur = make(AO_FORMAT, aoW, aoH, "axion-volume-blur");
    const bloom = [];
    let bw = width >> 1, bh = height >> 1;
    for (let i = 0; i < this.bloom.levels && bw > 8 && bh > 8; i++) {
      bloom.push({ tex: make(HDR_FORMAT, bw, bh, `axion-bloom-${i}`), w: bw, h: bh });
      bw >>= 1;
      bh >>= 1;
    }
    this._targets = {
      all: [color, surface, albedo, depth, hdr, ao, aoBlur, vol, volBlur, ...bloom.map((b) => b.tex)],
      color,
      surface,
      albedo,
      depth,
      hdr,
      ao,
      aoBlur,
      vol,
      volBlur,
      bloom,
      colorView: color.createView(),
      surfaceView: surface.createView(),
      albedoView: albedo.createView(),
      depthView: depth.createView(),
      hdrView: hdr.createView(),
      aoView: ao.createView(),
      aoBlurView: aoBlur.createView(),
      volView: vol.createView(),
      volBlurView: volBlur.createView(),
      bloomViews: bloom.map((b) => b.tex.createView())
    };
    const t = this._targets;
    const bg = (layout, resources, label) => this.device.createBindGroup({
      layout,
      label,
      entries: resources.map((resource, i) => ({ binding: i, resource }))
    });
    const camRes = { buffer: this.cameraBuffer };
    this.aoBindGroup = bg(this._aoLayout, [camRes, this._sampler, t.depthView, t.surfaceView, t.colorView], "axion-ao");
    this.volBlurBindGroup = bg(this._aoBlurLayout, [camRes, this._sampler, t.volView, t.depthView], "axion-volume-blur");
    this.dofBindGroup = bg(this._dofLayout, [camRes, this._sampler, t.hdrView, t.depthView], "axion-dof");
    this.exposureBindGroup = bg(this._exposureLayout, [camRes, t.hdrView, { buffer: this.exposureBuffer }], "axion-exposure");
    this._volumeBindGroup = null;
    this.aoBlurBindGroup = bg(this._aoBlurLayout, [camRes, this._sampler, t.aoView, t.depthView], "axion-ao-blur");
    this.resolveBindGroup = bg(
      this._resolveLayout,
      [camRes, this._sampler, t.colorView, t.surfaceView, t.albedoView, t.depthView, t.aoBlurView, t.volBlurView],
      "axion-resolve"
    );
    this.finalBindGroup = bg(
      this._finalLayout,
      [camRes, this._sampler, t.hdrView, t.bloomViews[0] ?? t.hdrView, { buffer: this.exposureBuffer }],
      "axion-final"
    );
    this.bloomFromHdr = bg(this._bloomLayout, [camRes, this._sampler, t.hdrView], "axion-bloom-src");
    this.bloomBindGroups = t.bloomViews.map((v, i) => bg(this._bloomLayout, [camRes, this._sampler, v], `axion-bloom-${i}`));
    this._targetSize = [width, height];
  }
  /* --------------------------------------------------------- shadow prep */
  /**
   * Build the cube-face view-projection matrices for one light.
   *
   * The basis comes from the same CUBE_FACES table the shader reads, so the
   * render and the lookup cannot disagree — which is how cube shadows usually
   * end up subtly, maddeningly wrong.
   */
  _writeFaceMatrices(slot, lx, ly, lz, near, far) {
    const stride = FACE_SLOT_BYTES / 4;
    const p10 = far / (near - far);
    const p14 = near * far / (near - far);
    for (let i = 0; i < 6; i++) {
      const F = CUBE_FACES[i].f, U = CUBE_FACES[i].u;
      const R = [
        F[1] * U[2] - F[2] * U[1],
        F[2] * U[0] - F[0] * U[2],
        F[0] * U[1] - F[1] * U[0]
      ];
      const base = (slot * 6 + i) * stride;
      const m = this.faceData;
      const tx = -(R[0] * lx + R[1] * ly + R[2] * lz);
      const ty = -(U[0] * lx + U[1] * ly + U[2] * lz);
      const tz = F[0] * lx + F[1] * ly + F[2] * lz;
      m[base + 0] = R[0];
      m[base + 1] = U[0];
      m[base + 2] = -F[0] * p10;
      m[base + 3] = F[0];
      m[base + 4] = R[1];
      m[base + 5] = U[1];
      m[base + 6] = -F[1] * p10;
      m[base + 7] = F[1];
      m[base + 8] = R[2];
      m[base + 9] = U[2];
      m[base + 10] = -F[2] * p10;
      m[base + 11] = F[2];
      m[base + 12] = tx;
      m[base + 13] = ty;
      m[base + 14] = tz * p10 + p14;
      m[base + 15] = -tz;
    }
  }
  /* ------------------------------------------------------ instance cache */
  /**
   * Instance data lives on the GPU between frames.
   *
   * Every renderable is written once, sorted by (mesh, material), into one
   * storage buffer, along with a world-space bounding sphere kept on the CPU.
   * After that a frame only rewrites the entities tagged Dynamic, culls the
   * spheres, and uploads a list of visible slot numbers — four bytes per
   * object instead of a hundred and twelve. The cache is rebuilt when the set
   * of entities or a material changes; `invalidate()` forces it after writing
   * component data of static entities by hand.
   */
  invalidate() {
    this._sig = null;
  }
  _cacheIsCurrent(world, archetypes) {
    const sig = this._sig;
    const len = 4 + archetypes.length * 3;
    if (!sig || sig.length !== len) return false;
    if (sig[0] !== world._structureVersion || sig[1] !== this.materials.length || sig[2] !== this.meshes.length || sig[3] !== archetypes.length) return false;
    for (let i = 0; i < archetypes.length; i++) {
      const a = archetypes[i], o = 4 + i * 3;
      if (sig[o] !== a.index || sig[o + 1] !== a.count || sig[o + 2] !== a.version) return false;
    }
    return !this._materialsChanged();
  }
  _storeSignature(world, archetypes) {
    const sig = new Float64Array(4 + archetypes.length * 3);
    sig[0] = world._structureVersion;
    sig[1] = this.materials.length;
    sig[2] = this.meshes.length;
    sig[3] = archetypes.length;
    for (let i = 0; i < archetypes.length; i++) {
      const a = archetypes[i], o = 4 + i * 3;
      sig[o] = a.index;
      sig[o + 1] = a.count;
      sig[o + 2] = a.version;
    }
    this._sig = sig;
  }
  /** Material fields are plain properties, so compare them with last frame's copy. */
  _materialsChanged() {
    const mats = this.materials;
    let snap = this._matSnap;
    const need = mats.length * MAT_SNAP;
    let changed = false;
    if (!snap || snap.length !== need) {
      snap = this._matSnap = new Float64Array(need);
      changed = true;
    }
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i], o = i * MAT_SNAP;
      const v0 = m.color[0], v1 = m.color[1], v2 = m.color[2];
      if (snap[o] !== v0 || snap[o + 1] !== v1 || snap[o + 2] !== v2 || snap[o + 3] !== m.alpha || snap[o + 4] !== m.emissive || snap[o + 5] !== m.metallic || snap[o + 6] !== m.roughness || snap[o + 7] !== m.noiseScale || snap[o + 8] !== m.noiseStrength || snap[o + 9] !== m.bump || snap[o + 10] !== m.oxide || snap[o + 11] !== (m.castShadow === false ? 0 : 1)) {
        snap[o] = v0;
        snap[o + 1] = v1;
        snap[o + 2] = v2;
        snap[o + 3] = m.alpha;
        snap[o + 4] = m.emissive;
        snap[o + 5] = m.metallic;
        snap[o + 6] = m.roughness;
        snap[o + 7] = m.noiseScale;
        snap[o + 8] = m.noiseStrength;
        snap[o + 9] = m.bump;
        snap[o + 10] = m.oxide;
        snap[o + 11] = m.castShadow === false ? 0 : 1;
        changed = true;
      }
    }
    return changed;
  }
  /** Write one entity into its slot: instance data on the CPU mirror, sphere into `_spheres`. */
  _writeInstance(slot, a, r) {
    const inst = this.instances.cpu;
    const o = slot * INSTANCE_FLOATS;
    const W = a.columns.get(LocalToWorld.id);
    const R = a.columns.get(MeshRef.id);
    const B = a.columns.get(Bounds.id);
    const w = r * 16, b = r * 4;
    for (let m = 0; m < 16; m++) inst[o + m] = W[w + m];
    const mat = this.materials[R[r * 2 + M_MATERIAL]] ?? this.materials[0];
    const C = a.columns.get(InstanceColor.id);
    if (C) {
      inst[o + 16] = C[b];
      inst[o + 17] = C[b + 1];
      inst[o + 18] = C[b + 2];
      inst[o + 22] = C[b + 3];
    } else {
      inst[o + 16] = mat.color[0];
      inst[o + 17] = mat.color[1];
      inst[o + 18] = mat.color[2];
      inst[o + 22] = mat.emissive;
    }
    inst[o + 19] = mat.alpha;
    inst[o + 20] = mat.metallic;
    inst[o + 21] = mat.roughness;
    inst[o + 23] = 0;
    inst[o + 24] = mat.noiseScale;
    inst[o + 25] = mat.noiseStrength;
    inst[o + 26] = mat.bump;
    inst[o + 27] = mat.oxide;
    const sp = this._spheres, so = slot * 4;
    sp[so] = W[w] * B[b] + W[w + 4] * B[b + 1] + W[w + 8] * B[b + 2] + W[w + 12];
    sp[so + 1] = W[w + 1] * B[b] + W[w + 5] * B[b + 1] + W[w + 9] * B[b + 2] + W[w + 13];
    sp[so + 2] = W[w + 2] * B[b] + W[w + 6] * B[b + 1] + W[w + 10] * B[b + 2] + W[w + 14];
    sp[so + 3] = B[b + 3] * Math.max(
      Math.hypot(W[w], W[w + 1], W[w + 2]),
      Math.hypot(W[w + 4], W[w + 5], W[w + 6]),
      Math.hypot(W[w + 8], W[w + 9], W[w + 10])
    );
  }
  _rebuildInstances(world, archetypes) {
    const matCount = Math.max(1, this.materials.length);
    const keyCount = Math.max(1, this.meshes.length) * matCount;
    const counts = new Uint32Array(keyCount);
    let total = 0;
    for (const a of archetypes) {
      const R = a.columns.get(MeshRef.id);
      for (let r = 0; r < a.count; r++) {
        counts[R[r * 2 + M_MESH] * matCount + R[r * 2 + M_MATERIAL]]++;
      }
      total += a.count;
    }
    const groups = [];
    const cursor = new Uint32Array(keyCount);
    let running = 0;
    for (let k = 0; k < keyCount; k++) {
      cursor[k] = running;
      if (counts[k] > 0) {
        const material = this.materials[k % matCount] ?? this.materials[0];
        groups.push({
          mesh: k / matCount | 0,
          material: k % matCount,
          matRef: material,
          start: running,
          count: counts[k],
          castShadow: material.castShadow !== false
        });
      }
      running += counts[k];
    }
    this.instances.ensure(Math.max(1, total) * INSTANCE_FLOATS);
    if (!this._spheres || this._spheres.length < total * 4) {
      this._spheres = new Float32Array(Math.max(1024, total * 4));
    }
    const dyn = [];
    for (const a of archetypes) {
      const R = a.columns.get(MeshRef.id);
      const isDyn = a.has[Dynamic.id] === 1;
      const rowSlot = isDyn ? new Uint32Array(a.count) : null;
      for (let r = 0; r < a.count; r++) {
        const slot = cursor[R[r * 2 + M_MESH] * matCount + R[r * 2 + M_MATERIAL]]++;
        this._writeInstance(slot, a, r);
        if (rowSlot) rowSlot[r] = slot;
      }
      if (rowSlot && a.count > 0) dyn.push({ a, rowSlot });
    }
    this.instances.flush(total * INSTANCE_FLOATS);
    this._groups = groups;
    this._dyn = dyn;
    this._instTotal = total;
    this._instBuild = (this._instBuild ?? 0) + 1;
    this._storeSignature(world, archetypes);
  }
  /**
   * Rewrite the Dynamic entities. Spheres that moved are remembered (old and
   * new position) so only shadow maps they can touch are redrawn.
   */
  _updateDynamic() {
    const moved = this._moved;
    moved.length = 0;
    if (this._dyn.length === 0) return;
    const sp = this._spheres;
    let lo = Infinity, hi = -1;
    for (const d of this._dyn) {
      const rowSlot = d.rowSlot, a = d.a;
      for (let r = 0; r < rowSlot.length; r++) {
        const slot = rowSlot[r], so = slot * 4;
        const ox = sp[so], oy = sp[so + 1], oz = sp[so + 2], or = sp[so + 3];
        this._writeInstance(slot, a, r);
        if (sp[so] !== ox || sp[so + 1] !== oy || sp[so + 2] !== oz || sp[so + 3] !== or) {
          moved.push(ox, oy, oz, or, sp[so], sp[so + 1], sp[so + 2], sp[so + 3]);
        }
        if (slot < lo) lo = slot;
        if (slot > hi) hi = slot;
      }
    }
    if (hi >= lo) {
      const cpu = this.instances.cpu;
      this.device.queue.writeBuffer(
        this.instances.buffer,
        lo * INSTANCE_FLOATS * 4,
        cpu.buffer,
        cpu.byteOffset + lo * INSTANCE_FLOATS * 4,
        (hi - lo + 1) * INSTANCE_FLOATS * 4
      );
    }
  }
  /** Did anything that moved this frame pass through this light's range? */
  _movedNear(L) {
    const m = this._moved;
    for (let i = 0; i < m.length; i += 4) {
      const dx = m[i] - L.x, dy = m[i + 1] - L.y, dz = m[i + 2] - L.z;
      const reach = L.range + m[i + 3];
      if (dx * dx + dy * dy + dz * dz <= reach * reach) return true;
    }
    return false;
  }
  /** Slot numbers as u32, in a buffer that grows by doubling. */
  _u32List(name, n) {
    const buf = this[name];
    buf.ensure(Math.max(1, n));
    if (!buf.u32 || buf.u32.buffer !== buf.cpu.buffer) buf.u32 = new Uint32Array(buf.cpu.buffer);
    return buf.u32;
  }
  /**
   * Gather shadow casters for the lights whose maps need redrawing, as slot
   * numbers into the instance buffer, grouped by (mesh, material).
   */
  _buildShadowBatches(lights) {
    const batches = this._shadowBatches;
    batches.length = 0;
    if (lights.length === 0) return 0;
    const sp = this._spheres;
    const cap = this.shadows.maxCasters;
    const list = this._u32List("shadowModels", Math.min(cap, this._instTotal * lights.length));
    let written = 0;
    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      L.casters = 0;
      for (const g of this._groups) {
        if (!g.castShadow || written >= cap) continue;
        const first = written;
        const end = g.start + g.count;
        for (let s = g.start; s < end && written < cap; s++) {
          const so = s * 4;
          const radius = sp[so + 3];
          const dx = sp[so] - L.x, dy = sp[so + 1] - L.y, dz = sp[so + 2] - L.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > (L.range + radius) * (L.range + radius)) continue;
          if (distSq < radius * radius && radius < Math.min(1, 0.1 * L.range)) continue;
          list[written++] = s;
        }
        if (written > first) {
          batches.push({ light: L, mesh: g.mesh, material: g.material, first, count: written - first });
          L.casters += written - first;
        }
      }
    }
    return written;
  }
  /* ------------------------------------------------------------- frame  */
  render(world, camera, time = 0) {
    const t0 = performance.now();
    sweepRetired();
    this._ensureTargets();
    this._ensureShadowCapacity();
    const { width, height } = this.canvas;
    const t = this._targets;
    const lightList = [];
    for (const a of world.query([Transform, PointLight])) {
      const T = a.columns.get(Transform.id);
      const L = a.columns.get(PointLight.id);
      for (let r = 0; r < a.count && lightList.length < MAX_LIGHTS; r++) {
        const tOff = r * 10 + T_POS, l = r * 5;
        lightList.push({
          entity: a.entities[r],
          x: T[tOff],
          y: T[tOff + 1],
          z: T[tOff + 2],
          r: L[l],
          g: L[l + 1],
          b: L[l + 2],
          intensity: L[l + 3],
          range: L[l + 4],
          slot: -1
        });
      }
    }
    let shadowLights = [];
    if (this.shadows.enabled && this.shadows.maxLights > 0) {
      const ex = camera.position[0], ey = camera.position[1], ez = camera.position[2];
      const ranked = lightList.map((l) => {
        const d = Math.hypot(l.x - ex, l.y - ey, l.z - ez);
        return { l, score: l.intensity / (1 + d * d * 0.01) };
      }).sort((a, b) => b.score - a.score);
      const max = this.shadows.maxLights;
      const margin = Math.min(ranked.length, max + 2);
      const next = /* @__PURE__ */ new Map();
      const taken = /* @__PURE__ */ new Set();
      for (let i = 0; i < margin && next.size < max; i++) {
        const l = ranked[i].l;
        const held = this._shadowSlots.get(l.entity);
        if (held !== void 0 && !taken.has(held)) {
          next.set(l.entity, held);
          taken.add(held);
        }
      }
      const free = [];
      for (let sIdx = max - 1; sIdx >= 0; sIdx--) if (!taken.has(sIdx)) free.push(sIdx);
      for (const { l } of ranked) {
        if (next.size >= max) break;
        if (next.has(l.entity)) continue;
        const slot = free.pop();
        if (slot === void 0) break;
        next.set(l.entity, slot);
      }
      this._shadowSlots = next;
      for (const l of lightList) {
        const slot = next.get(l.entity);
        if (slot !== void 0) {
          l.slot = slot;
          shadowLights.push(l);
        }
      }
    } else {
      this._shadowSlots.clear();
    }
    const archetypes = world.query([LocalToWorld, MeshRef, Bounds], [Hidden]);
    if (this._cacheIsCurrent(world, archetypes)) {
      this._updateDynamic();
    } else {
      this._rebuildInstances(world, archetypes);
      this._moved.length = 0;
    }
    const near = this.shadows.near;
    const redraw = [];
    for (const l of shadowLights) {
      const st = this._shadowState[l.slot];
      const same = st && st.entity === l.entity && st.x === l.x && st.y === l.y && st.z === l.z && st.range === l.range && st.near === near && st.build === this._instBuild;
      if (same && !this._movedNear(l)) {
        l.casters = st.casters;
      } else {
        redraw.push(l);
      }
    }
    const shadowCasters = this._buildShadowBatches(redraw);
    for (const l of redraw) {
      this._shadowState[l.slot] = {
        entity: l.entity,
        x: l.x,
        y: l.y,
        z: l.z,
        range: l.range,
        near,
        build: this._instBuild,
        casters: l.casters
      };
    }
    if (shadowCasters > 0) {
      this.shadowModels.flush(shadowCasters);
      for (const l of redraw) {
        if (l.casters > 0) this._writeFaceMatrices(l.slot, l.x, l.y, l.z, near, l.range);
      }
      this.device.queue.writeBuffer(this.faceBuffer, 0, this.faceData);
    }
    this._rebuildShadowBindGroup();
    for (let i = 0; i < lightList.length; i++) {
      const l = lightList[i], o = i * LIGHT_FLOATS;
      this.lightData[o] = l.x;
      this.lightData[o + 1] = l.y;
      this.lightData[o + 2] = l.z;
      this.lightData[o + 3] = l.range;
      this.lightData[o + 4] = l.r;
      this.lightData[o + 5] = l.g;
      this.lightData[o + 6] = l.b;
      this.lightData[o + 7] = this.physical.enabled ? l.intensity / (4 * Math.PI) : l.intensity;
      this.lightData[o + 8] = l.slot >= 0 && l.casters > 0 ? l.slot : -1;
      this.lightData[o + 9] = this.shadows.near;
      this.lightData[o + 10] = this.shadows.bias;
      this.lightData[o + 11] = l.range;
    }
    if (lightList.length > 0) {
      this.device.queue.writeBuffer(
        this.lightBuffer,
        0,
        this.lightData.buffer,
        0,
        lightList.length * LIGHT_FLOATS * 4
      );
    }
    const cd = this.cameraData;
    cd.set(camera.viewProj, 0);
    cd.set(camera.view, 16);
    cd.set(camera.invView, 32);
    cd[48] = camera.position[0];
    cd[49] = camera.position[1];
    cd[50] = camera.position[2];
    cd[51] = time;
    cd[52] = lightList.length;
    cd[53] = this.effectiveExposure();
    cd[54] = this.fogDensity;
    cd[55] = this.fxaa ? 1 : 0;
    cd.set(this.ambient, 56);
    cd[59] = this.groundAmbient;
    cd.set(this.fogColor, 60);
    cd[63] = this.aerialPerspective;
    cd[64] = camera.projection[0];
    cd[65] = camera.projection[5];
    cd[66] = camera.near;
    cd[67] = camera.aspect;
    cd[68] = this.ssr.intensity;
    cd[69] = this.ssr.steps;
    cd[70] = this.ssr.thickness;
    cd[71] = this.ssr.maxDistance;
    cd[72] = width;
    cd[73] = height;
    cd[74] = 1 / width;
    cd[75] = 1 / height;
    cd[76] = this.ao.intensity;
    cd[77] = this.ao.radius;
    cd[78] = this.ao.power;
    cd[79] = this.ao.bias;
    cd[80] = this.bloom.threshold;
    cd[81] = this.bloom.knee;
    cd[82] = this.bloom.strength;
    cd[83] = 0;
    cd[84] = this.shadows.size;
    cd[85] = this.shadows.pcfRadius;
    cd[86] = this.shadows.normalBias;
    cd[87] = 0;
    cd[88] = this.ao.fadeDistance;
    cd[89] = this.ssr.fadeDistance;
    cd[90] = 0;
    cd[91] = 0;
    const dtFrame = this._lastTime === void 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 0.25);
    this._lastTime = time;
    cd[92] = this.ssil.intensity;
    cd[93] = this.ssil.radius;
    cd[94] = 0;
    cd[95] = 0;
    const v = this.volumetric;
    cd[96] = v.density;
    cd[97] = v.steps;
    cd[98] = v.anisotropy;
    cd[99] = v.maxDistance;
    cd[100] = v.heightBase;
    cd[101] = v.heightFalloff;
    cd[102] = v.ambient;
    cd[103] = v.lightScatter;
    cd[104] = v.color[0];
    cd[105] = v.color[1];
    cd[106] = v.color[2];
    cd[107] = v.enabled ? 1 : 0;
    const tm = this.tonemap;
    cd[108] = TONEMAP_MODES[tm.mode] ?? 3;
    cd[109] = tm.white;
    cd[110] = tm.contrast;
    cd[111] = tm.saturation;
    const ae = this.autoExposure;
    cd[112] = tm.brightness;
    cd[113] = ae.enabled ? 1 : 0;
    cd[114] = this.exposureCompensation;
    cd[115] = ae.key;
    cd[116] = ae.min;
    cd[117] = ae.max;
    cd[118] = ae.speed;
    cd[119] = dtFrame;
    const df = this.dof;
    cd[120] = df.focus;
    cd[121] = df.range;
    cd[122] = df.transition;
    cd[123] = df.amount;
    cd[124] = df.near ? 1 : 0;
    cd[125] = df.far ? 1 : 0;
    cd[126] = df.autoFocus ? 1 : 0;
    cd[127] = df.enabled ? 1 : 0;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cd);
    if (this.frustumCulling) frustumFromMatrix(this._frustum, 0, camera.viewProj, 0);
    const sp = this._spheres, fr = this._frustum, cull = this.frustumCulling;
    const vis = this._u32List("visibleList", this._instTotal);
    const drawList = this._draws;
    drawList.length = 0;
    let visible = 0;
    for (const g of this._groups) {
      const first = visible, end = g.start + g.count;
      if (!cull) {
        for (let s = g.start; s < end; s++) vis[visible++] = s;
      } else {
        for (let s = g.start; s < end; s++) {
          const so = s * 4;
          const x = sp[so], y = sp[so + 1], z = sp[so + 2], r = -sp[so + 3];
          if (fr[0] * x + fr[1] * y + fr[2] * z + fr[3] < r) continue;
          if (fr[4] * x + fr[5] * y + fr[6] * z + fr[7] < r) continue;
          if (fr[8] * x + fr[9] * y + fr[10] * z + fr[11] < r) continue;
          if (fr[12] * x + fr[13] * y + fr[14] * z + fr[15] < r) continue;
          if (fr[16] * x + fr[17] * y + fr[18] * z + fr[19] < r) continue;
          if (fr[20] * x + fr[21] * y + fr[22] * z + fr[23] < r) continue;
          vis[visible++] = s;
        }
      }
      if (visible > first) drawList.push(g, first, visible - first);
    }
    const culled = this._instTotal - visible;
    this.visibleList.flush(visible);
    this._rebuildFrameBindGroup();
    const enc = this.device.createCommandEncoder({ label: "axion-frame" });
    let shadowDraws = 0;
    if (shadowCasters > 0) {
      const maxSlot = this._shadowFaceViews.length / 6 | 0;
      for (const light of redraw) {
        if (light.slot < 0 || light.slot >= maxSlot || !(light.casters > 0)) continue;
        const batches2 = this._shadowBatches.filter((b) => b.light === light);
        for (let face = 0; face < 6; face++) {
          const layer = light.slot * 6 + face;
          const pass = enc.beginRenderPass({
            label: `axion-shadow-${layer}`,
            colorAttachments: [],
            depthStencilAttachment: {
              view: this._shadowFaceViews[layer],
              depthClearValue: 1,
              depthLoadOp: "clear",
              depthStoreOp: "store"
            }
          });
          pass.setBindGroup(0, this.shadowBindGroup, [layer * FACE_SLOT_BYTES]);
          pass.setVertexBuffer(0, this.vertexArena.buffer);
          pass.setIndexBuffer(this.indexArena.buffer, "uint32");
          let bound = null;
          for (const b of batches2) {
            const m = this.meshes[b.mesh];
            if (!m) continue;
            const mat = this.materials[b.material];
            const pipeline = mat?.masked ? this._shadowMaskPipeline : this._shadowPipeline;
            if (pipeline !== bound) {
              pass.setPipeline(pipeline);
              bound = pipeline;
            }
            if (mat?.masked) pass.setBindGroup(1, mat.bindGroup);
            pass.drawIndexed(m.indexCount, b.count, m.firstIndex, m.baseVertex, b.first);
            shadowDraws++;
          }
          pass.end();
        }
      }
    }
    let prepassDraws = 0;
    if (this.depthPrepass) {
      const dp = enc.beginRenderPass({
        label: "axion-depth-prepass",
        colorAttachments: [],
        depthStencilAttachment: {
          view: t.depthView,
          depthClearValue: 0,
          depthLoadOp: "clear",
          depthStoreOp: "store"
        }
      });
      dp.setBindGroup(0, this.frameBindGroup);
      dp.setVertexBuffer(0, this.vertexArena.buffer);
      dp.setIndexBuffer(this.indexArena.buffer, "uint32");
      let bound = null;
      for (let i = 0; i < drawList.length; i += 3) {
        const g = drawList[i];
        if (!this._inPrepass(g.matRef)) continue;
        const m = this.meshes[g.mesh];
        if (!m) continue;
        const p = this._depthPipelineFor(g.matRef);
        if (p !== bound) {
          dp.setPipeline(p);
          bound = p;
        }
        dp.drawIndexed(m.indexCount, drawList[i + 2], m.firstIndex, m.baseVertex, drawList[i + 1]);
        prepassDraws++;
      }
      dp.end();
    }
    const geo = enc.beginRenderPass({
      label: "axion-geometry",
      colorAttachments: [
        {
          view: t.colorView,
          clearValue: { r: this.clearColor[0], g: this.clearColor[1], b: this.clearColor[2], a: this.clearColor[3] },
          loadOp: "clear",
          storeOp: "store"
        },
        { view: t.surfaceView, clearValue: { r: 0, g: 0, b: 1, a: 0 }, loadOp: "clear", storeOp: "store" },
        { view: t.albedoView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }
      ],
      depthStencilAttachment: {
        view: t.depthView,
        depthClearValue: 0,
        // reverse-Z
        depthLoadOp: this.depthPrepass ? "load" : "clear",
        depthStoreOp: "store"
      }
    });
    geo.setBindGroup(0, this.frameBindGroup);
    geo.setVertexBuffer(0, this.vertexArena.buffer);
    geo.setIndexBuffer(this.indexArena.buffer, "uint32");
    let draws = 0, tris = 0, batches = 0, currentPipeline = null, currentMaterial = null;
    for (let phase = 0; phase < 2; phase++) {
      for (let i = 0; i < drawList.length; i += 3) {
        const g = drawList[i], start = drawList[i + 1], count = drawList[i + 2];
        const material = g.matRef;
        if ((material.transparent ? 1 : 0) !== phase) continue;
        const m = this.meshes[g.mesh];
        if (!m) continue;
        const pipeline = this._pipelineFor(material);
        if (pipeline !== currentPipeline) {
          geo.setPipeline(pipeline);
          currentPipeline = pipeline;
        }
        if (material !== currentMaterial) {
          geo.setBindGroup(1, material.bindGroup);
          currentMaterial = material;
        }
        geo.drawIndexed(m.indexCount, count, m.firstIndex, m.baseVertex, start);
        draws++;
        batches++;
        tris += m.indexCount / 3 * count;
      }
    }
    geo.end();
    const fullscreen = (label, view, pipeline, bindGroup, load = "clear") => {
      const pass = enc.beginRenderPass({
        label,
        colorAttachments: [{
          view,
          loadOp: load,
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    };
    let aoPasses = 0;
    if (this.ao.intensity > 0 || this.ssil.intensity > 0) {
      fullscreen("axion-ao", t.aoView, this._aoPipeline, this.aoBindGroup);
      fullscreen("axion-ao-blur", t.aoBlurView, this._aoBlurPipeline, this.aoBlurBindGroup);
      t.aoIdle = false;
      aoPasses = 2;
    } else if (!t.aoIdle) {
      enc.beginRenderPass({
        label: "axion-ao-off",
        colorAttachments: [{ view: t.aoBlurView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
      }).end();
      t.aoIdle = true;
    }
    let volumePasses = 0;
    if (this.volumetric.enabled && this.volumetric.density > 0) {
      if (!this._volumeBindGroup || this._volumeShadowView !== this._shadowArrayView) {
        this._volumeShadowView = this._shadowArrayView;
        this._volumeBindGroup = this.device.createBindGroup({
          layout: this._volumeLayout,
          label: "axion-volume",
          entries: [
            { binding: 0, resource: { buffer: this.cameraBuffer } },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: t.depthView },
            { binding: 3, resource: { buffer: this.lightBuffer } },
            { binding: 4, resource: this._shadowArrayView },
            { binding: 5, resource: this._shadowSampler }
          ]
        });
      }
      fullscreen("axion-volume", t.volView, this._volumePipeline, this._volumeBindGroup);
      fullscreen("axion-volume-blur", t.volBlurView, this._aoBlurPipeline, this.volBlurBindGroup);
      volumePasses = 2;
    }
    fullscreen("axion-resolve", t.hdrView, this._resolvePipeline, this.resolveBindGroup);
    const dof = this.dof;
    let dofPasses = 0;
    if (dof.enabled && dof.amount > 0 && (dof.near || dof.far)) {
      fullscreen("axion-dof", t.colorView, this._dofPipeline, this.dofBindGroup);
      enc.copyTextureToTexture({ texture: t.color }, { texture: t.hdr }, [width, height, 1]);
      dofPasses = 1;
    }
    if (this.autoExposure.enabled) {
      const cp = enc.beginComputePass({ label: "axion-exposure" });
      cp.setPipeline(this._exposurePipeline);
      cp.setBindGroup(0, this.exposureBindGroup);
      cp.dispatchWorkgroups(1);
      cp.end();
    }
    if (t.bloom.length > 0 && this.bloom.strength > 0) {
      fullscreen("axion-bloom-prefilter", t.bloomViews[0], this._bloomPrefilterPipeline, this.bloomFromHdr);
      for (let i = 1; i < t.bloom.length; i++) {
        fullscreen(`axion-bloom-down-${i}`, t.bloomViews[i], this._bloomDownPipeline, this.bloomBindGroups[i - 1]);
      }
      for (let i = t.bloom.length - 1; i > 0; i--) {
        fullscreen(
          `axion-bloom-up-${i}`,
          t.bloomViews[i - 1],
          this._bloomUpPipeline,
          this.bloomBindGroups[i],
          "load"
        );
      }
    }
    const final = enc.beginRenderPass({
      label: "axion-final",
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });
    final.setPipeline(this._finalPipeline);
    final.setBindGroup(0, this.finalBindGroup);
    final.draw(3);
    final.end();
    this.device.queue.submit([enc.finish()]);
    const bloomPasses = t.bloom.length > 0 && this.bloom.strength > 0 ? t.bloom.length * 2 - 1 : 0;
    this.stats.drawCalls = draws + prepassDraws + shadowDraws + 1 + aoPasses + volumePasses + dofPasses + bloomPasses + 1;
    this.stats.batches = batches;
    this.stats.instances = visible;
    this.stats.culled = culled;
    this.stats.triangles = tris;
    this.stats.shadowDraws = shadowDraws;
    this.stats.shadowCasters = shadowCasters;
    this.stats.shadowLights = shadowLights.filter((l) => l.casters > 0).length;
    this.stats.shadowRedraws = redraw.length;
    this.stats.cpuMs = performance.now() - t0;
  }
  destroy() {
    this.vertexArena.destroy();
    this.indexArena.destroy();
    this.instances.destroy();
    this.shadowModels.destroy();
    this.visibleList.destroy();
    this.cameraBuffer.destroy();
    this.lightBuffer.destroy();
    this.faceBuffer.destroy();
    this.exposureBuffer.destroy();
    this._shadowTexture?.destroy();
    for (const tex of this._targets?.all ?? []) tex.destroy();
  }
};

// src/render/camera.js
var Camera = class {
  constructor({ fov = 60, near = 0.1, aspect = 1 } = {}) {
    this.fov = fov * Math.PI / 180;
    this.near = near;
    this.aspect = aspect;
    this.position = f32(3);
    this.target = f32(3);
    this.up = f32([0, 1, 0]);
    this.view = f32(16);
    this.invView = f32(16);
    this.projection = f32(16);
    this.viewProj = f32(16);
    this.update();
  }
  setAspect(a) {
    if (a !== this.aspect) {
      this.aspect = a;
    }
    return this;
  }
  setOrthographic(size) {
    this._ortho = size;
    return this;
  }
  update() {
    if (this._ortho) {
      const h = this._ortho, w = h * this.aspect;
      m4ortho(this.projection, 0, -w, w, -h, h, this.near, this.near + 4e3);
    } else {
      m4perspectiveReverseZ(this.projection, 0, this.fov, this.aspect, this.near);
    }
    m4lookAt(this.view, 0, this.position, 0, this.target, 0, this.up, 0);
    m4mul(this.viewProj, 0, this.projection, 0, this.view, 0);
    m4invert(this.invView, 0, this.view, 0);
    return this;
  }
};

// src/systems/transform.js
function motionSystem(world, dt) {
  const q = scratch.q[0];
  for (const a of world.query([Transform, Motion, Dynamic])) {
    const T = a.columns.get(Transform.id);
    const M = a.columns.get(Motion.id);
    const n = a.count;
    for (let r = 0; r < n; r++) {
      const t = r * 10, m = r * 6;
      T[t + T_POS] += M[m] * dt;
      T[t + T_POS + 1] += M[m + 1] * dt;
      T[t + T_POS + 2] += M[m + 2] * dt;
      const ax = M[m + 3], ay = M[m + 4], az = M[m + 5];
      const speed = Math.hypot(ax, ay, az);
      if (speed > 1e-6) {
        const inv = 1 / speed;
        q[0] = ax * inv;
        q[1] = ay * inv;
        q[2] = az * inv;
        qFromAxisAngle(q, 0, q, 0, speed * dt);
        qmul(T, t + T_ROT, q, 0, T, t + T_ROT);
        qnormalize(T, t + T_ROT, T, t + T_ROT);
      }
    }
  }
}
function transformSystem(world) {
  for (const a of world.query([Transform, LocalToWorld, Dynamic])) {
    const T = a.columns.get(Transform.id);
    const W = a.columns.get(LocalToWorld.id);
    const n = a.count;
    for (let r = 0; r < n; r++) {
      const t = r * 10;
      m4compose(W, r * 16, T, t + T_POS, T, t + T_ROT, T, t + T_SCALE);
    }
  }
}
function composeRange(archetype, first, count) {
  const T = archetype.columns.get(Transform.id);
  const W = archetype.columns.get(LocalToWorld.id);
  for (let r = first; r < first + count; r++) {
    m4compose(W, r * 16, T, r * 10 + T_POS, T, r * 10 + T_ROT, T, r * 10 + T_SCALE);
  }
}

// src/app.js
var App = class _App {
  static async create(canvas, options = {}) {
    _App.disposeStale(canvas);
    const gpu = await createDevice(canvas, options);
    return new _App(canvas, gpu, options);
  }
  /**
   * Dispose every live app whose canvas is gone from the page or is the one
   * about to be reused. Live editors (Khan Academy, CodePen) re-run the page
   * on every edit or reload without always giving the GPU a clean slate; the
   * previous app's loop, device and render targets would otherwise pile up
   * and each run would be slower than the last.
   */
  static disposeStale(canvas) {
    for (const app of [...liveApps()]) {
      if (app.canvas === canvas || !app.canvas.isConnected) app.dispose();
    }
  }
  constructor(canvas, gpu, options = {}) {
    this.canvas = canvas;
    this.device = gpu.device;
    this.info = gpu.info;
    this.renderer = new Renderer({ ...gpu, canvas }, options);
    this.world = new World({ initialCapacity: options.initialCapacity ?? 4096 });
    this.camera = new Camera({ fov: options.fov ?? 60, near: options.near ?? 0.1 });
    this.camera.position.set(options.cameraPosition ?? [0, 2, 8]);
    this.camera.target.set(options.cameraTarget ?? [0, 0, 0]);
    this.camera.update();
    this.time = 0;
    this.frame = 0;
    this.running = false;
    this.maxDpr = options.maxDpr ?? 2;
    this.fixedStep = options.fixedStep ?? 0;
    this._accumulator = 0;
    this._onFrame = null;
    this.world.setResource("app", this);
    this.world.addSystem(motionSystem, { order: 10, name: "motion" });
    this.world.addSystem(transformSystem, { order: 20, name: "transform" });
    this._resize();
    liveApps().add(this);
    if (options.thumbnail !== false) installKhanThumbnail();
    this._onPageHide = () => this.dispose();
    addEventListener("pagehide", this._onPageHide);
    addEventListener("beforeunload", this._onPageHide);
  }
  /* --------------------------------------------------------- resources */
  /** app.mesh(Axion.box(1,1,1)) or app.mesh('sphere', { radius: 0.4 }) */
  mesh(geometryOrName, args = {}) {
    let geo = geometryOrName;
    if (typeof geometryOrName === "string") {
      const fn = primitives_exports[geometryOrName];
      if (!fn) throw new Error(`axion: unknown primitive "${geometryOrName}"`);
      geo = fn(...Array.isArray(args) ? args : Object.values(args));
    }
    return this.renderer.createMesh(geo);
  }
  material(desc) {
    return this.renderer.createMaterial(desc);
  }
  /* ------------------------------------------------------------ scene  */
  /**
   * Add one object.
   *   app.add({ mesh, material, position: [0,1,0], rotation: [0,0,0],
   *             scale: 1, color: [1,0,0], velocity: [0,0,0], spin: [0,1,0],
   *             dynamic: true })
   */
  add(desc = {}) {
    const dynamic = desc.dynamic ?? !!(desc.velocity || desc.spin);
    const comps = [Transform, LocalToWorld, Bounds, MeshRef];
    if (desc.color) comps.push(InstanceColor);
    if (dynamic) comps.push(Dynamic);
    if (desc.velocity || desc.spin) comps.push(Motion);
    if (desc.light) comps.push(PointLight);
    if (desc.hidden) comps.push(Hidden);
    const meshId = desc.mesh ?? 0;
    const meshBounds = this.renderer.meshes[meshId]?.bounds ?? new Float32Array([0, 0, 0, 1]);
    return this.world.spawn(comps, (cols, row) => {
      const T = cols.get(Transform.id);
      const t = row * 10;
      const p = desc.position ?? [0, 0, 0];
      T[t] = p[0];
      T[t + 1] = p[1];
      T[t + 2] = p[2];
      if (desc.rotation) {
        qFromEulerYXZ(T, t + T_ROT, desc.rotation[1] ?? 0, desc.rotation[0] ?? 0, desc.rotation[2] ?? 0);
      } else qidentity(T, t + T_ROT);
      const s = desc.scale ?? 1;
      if (typeof s === "number") {
        T[t + T_SCALE] = s;
        T[t + T_SCALE + 1] = s;
        T[t + T_SCALE + 2] = s;
      } else {
        T[t + T_SCALE] = s[0];
        T[t + T_SCALE + 1] = s[1];
        T[t + T_SCALE + 2] = s[2];
      }
      cols.get(Bounds.id).set(meshBounds, row * 4);
      const R = cols.get(MeshRef.id);
      R[row * 2 + M_MESH] = meshId;
      R[row * 2 + M_MATERIAL] = desc.material ?? this.renderer.defaultMaterial;
      if (desc.color) {
        const C = cols.get(InstanceColor.id);
        C[row * 4] = desc.color[0];
        C[row * 4 + 1] = desc.color[1];
        C[row * 4 + 2] = desc.color[2];
        C[row * 4 + 3] = desc.emissive ?? 0;
      }
      if (desc.velocity || desc.spin) {
        const M = cols.get(Motion.id);
        const v = desc.velocity ?? [0, 0, 0], w = desc.spin ?? [0, 0, 0];
        M[row * 6] = v[0];
        M[row * 6 + 1] = v[1];
        M[row * 6 + 2] = v[2];
        M[row * 6 + 3] = w[0];
        M[row * 6 + 4] = w[1];
        M[row * 6 + 5] = w[2];
      }
      if (desc.light) {
        const L = cols.get(PointLight.id);
        const l = desc.light;
        L[row * 5] = l.color?.[0] ?? 1;
        L[row * 5 + 1] = l.color?.[1] ?? 1;
        L[row * 5 + 2] = l.color?.[2] ?? 1;
        L[row * 5 + 3] = l.intensity ?? 10;
        L[row * 5 + 4] = l.range ?? 20;
      }
      if (!dynamic) {
        m4compose(cols.get(LocalToWorld.id), row * 16, T, t + T_POS, T, t + T_ROT, T, t + T_SCALE);
      }
    });
  }
  /**
   * Add `count` objects in one archetype-contiguous block.
   * `fill(i, out)` writes into a reusable descriptor — no per-object garbage.
   */
  addMany(count, mesh2, material, fill, { dynamic = false, color = true } = {}) {
    const comps = [Transform, LocalToWorld, Bounds, MeshRef];
    if (color) comps.push(InstanceColor);
    if (dynamic) comps.push(Dynamic, Motion);
    const meshBounds = this.renderer.meshes[mesh2]?.bounds ?? new Float32Array([0, 0, 0, 1]);
    const out = {
      position: [0, 0, 0],
      scale: 1,
      color: [1, 1, 1],
      emissive: 0,
      velocity: [0, 0, 0],
      spin: [0, 0, 0],
      rotation: [0, 0, 0]
    };
    return this.world.spawnMany(comps, count, (cols, first) => {
      const T = cols.get(Transform.id);
      const W = cols.get(LocalToWorld.id);
      const B = cols.get(Bounds.id);
      const R = cols.get(MeshRef.id);
      const C = color ? cols.get(InstanceColor.id) : null;
      const M = dynamic ? cols.get(Motion.id) : null;
      for (let i = 0; i < count; i++) {
        const row = first + i, t = row * 10;
        out.scale = 1;
        out.emissive = 0;
        fill(i, out);
        T[t] = out.position[0];
        T[t + 1] = out.position[1];
        T[t + 2] = out.position[2];
        qFromEulerYXZ(T, t + T_ROT, out.rotation[1], out.rotation[0], out.rotation[2]);
        const s = out.scale;
        if (typeof s === "number") {
          T[t + 7] = s;
          T[t + 8] = s;
          T[t + 9] = s;
        } else {
          T[t + 7] = s[0];
          T[t + 8] = s[1];
          T[t + 9] = s[2];
        }
        B.set(meshBounds, row * 4);
        R[row * 2 + M_MESH] = mesh2;
        R[row * 2 + M_MATERIAL] = material;
        if (C) {
          C[row * 4] = out.color[0];
          C[row * 4 + 1] = out.color[1];
          C[row * 4 + 2] = out.color[2];
          C[row * 4 + 3] = out.emissive;
        }
        if (M) {
          M[row * 6] = out.velocity[0];
          M[row * 6 + 1] = out.velocity[1];
          M[row * 6 + 2] = out.velocity[2];
          M[row * 6 + 3] = out.spin[0];
          M[row * 6 + 4] = out.spin[1];
          M[row * 6 + 5] = out.spin[2];
        }
        if (!dynamic) m4compose(W, row * 16, T, t, T, t + T_ROT, T, t + T_SCALE);
      }
    });
  }
  light(position, { color = [1, 1, 1], intensity = 20, range = 30 } = {}) {
    return this.world.spawn([Transform, PointLight], (cols, row) => {
      const T = cols.get(Transform.id);
      T[row * 10] = position[0];
      T[row * 10 + 1] = position[1];
      T[row * 10 + 2] = position[2];
      qidentity(T, row * 10 + T_ROT);
      T[row * 10 + 7] = 1;
      T[row * 10 + 8] = 1;
      T[row * 10 + 9] = 1;
      const L = cols.get(PointLight.id);
      L[row * 5] = color[0];
      L[row * 5 + 1] = color[1];
      L[row * 5 + 2] = color[2];
      L[row * 5 + 3] = intensity;
      L[row * 5 + 4] = range;
    });
  }
  /* ------------------------------------------------------------ loop   */
  onFrame(fn) {
    this._onFrame = fn;
    return this;
  }
  /** Runs after each frame is rendered, before it is presented. */
  onAfterRender(fn) {
    this._afterRender = fn;
    return this;
  }
  _resize() {
    if (resizeCanvas(this.canvas, this.maxDpr) || this.camera.aspect === 1) {
      this.camera.aspect = this.canvas.width / this.canvas.height;
      this.camera.update();
    }
  }
  start() {
    if (this.running) return this;
    this.running = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      if (!this.canvas.isConnected) {
        this.dispose();
        return;
      }
      const dt = Math.min((now - last) / 1e3, 0.1);
      last = now;
      this.time += dt;
      this.frame++;
      this._resize();
      if (this.fixedStep > 0) {
        this._accumulator += dt;
        let guard = 8;
        while (this._accumulator >= this.fixedStep && guard-- > 0) {
          this.world.step(this.fixedStep, this.profile);
          this._accumulator -= this.fixedStep;
        }
      } else {
        this.world.step(dt, this.profile);
      }
      this._onFrame?.(dt, this);
      this.renderer.render(this.world, this.camera, this.time);
      this._afterRender?.(this);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    return this;
  }
  /**
   * Copy the current view into a new 2D canvas (for thumbnails, screenshots).
   *
   * A WebGPU canvas only holds its image during the task that drew it; once
   * the frame is presented, drawImage() and toDataURL() on it read black. So
   * this renders a fresh frame and copies it in the same task. Unset sizes
   * follow the canvas; `fit: 'cover'` crops to the target aspect instead of
   * stretching.
   */
  snapshot(width = this.canvas.width, height = this.canvas.height, { fit = "cover" } = {}) {
    this.renderer.render(this.world, this.camera, this.time);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const src = this.canvas;
    let sx = 0, sy = 0, sw = src.width, sh = src.height;
    if (fit === "cover") {
      const k = Math.min(sw / width, sh / height);
      sx = (sw - width * k) / 2;
      sy = (sh - height * k) / 2;
      sw = width * k;
      sh = height * k;
    }
    out.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
    return out;
  }
  /** The most recently created app that is still alive, or null. */
  static get current() {
    let last = null;
    for (const a of liveApps()) last = a;
    return last;
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    return this;
  }
  get stats() {
    return this.renderer.stats;
  }
  /**
   * Static objects are uploaded to the GPU once. Adding or removing objects and
   * changing materials is noticed on its own; call this after writing the
   * components of a static (non-Dynamic) object by hand.
   */
  refresh() {
    this.renderer.invalidate();
    return this;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    liveApps().delete(this);
    removeEventListener("pagehide", this._onPageHide);
    removeEventListener("beforeunload", this._onPageHide);
    try {
      this.renderer.destroy();
    } catch {
    }
    try {
      this.renderer.context?.unconfigure?.();
    } catch {
    }
    try {
      this.device.destroy();
    } catch {
    }
  }
};
function installKhanThumbnail() {
  if (globalThis.__axionThumbnail) return;
  let onKhan = false;
  try {
    onKhan = /(^|\.)kasandbox\.org$/.test(location.hostname) || /(^|\.)khanacademy\.org$/.test(new URL(document.referrer).hostname);
  } catch {
  }
  if (!onKhan || window.parent === window) return;
  try {
    const previous = window.parent.html2canvas;
    window.parent.html2canvas = function() {
      const app = App.current;
      if (!app) return previous ? previous.apply(this, arguments) : void 0;
      let url;
      try {
        url = app.snapshot(600, 600).toDataURL();
      } catch {
        url = document.createElement("canvas").toDataURL();
      }
      window.top.postMessage(url, "*");
      return void 0;
    };
    globalThis.__axionThumbnail = true;
  } catch {
  }
}
function liveApps() {
  return globalThis.__axionLiveApps ??= /* @__PURE__ */ new Set();
}

// src/debug/frame-trap.js
var aces = (x) => Math.min(1, Math.max(
  0,
  x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14)
));
var displayed = (x) => Math.pow(aces(x), 1 / 2.2) * 255;
var half = (h) => {
  const e = h >> 10 & 31, f = h & 1023;
  if (e === 31) return NaN;
  return (h & 32768 ? -1 : 1) * (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * (f / 1024));
};
function createFrameTrap(app, {
  size = 192,
  // centre region, in pixels; size*4 and size*8 must be 256-aligned
  warmup = 30,
  // frames to learn the baseline before arming
  minFraction = 0.02,
  // black share of the region that counts as a region
  onCatch = () => {
  }
} = {}) {
  if (size * 4 % 256 !== 0) throw new Error("frame trap: size * 4 must be a multiple of 256");
  const device = app.device;
  const bgra = navigator.gpu.getPreferredCanvasFormat() === "bgra8unorm";
  const slots = [0, 1, 2].map(() => ({
    busy: false,
    final: device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    hdr: device.createBuffer({ size: size * size * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  }));
  let enabled = false, baseline = 0, seen = 0;
  const pending = /* @__PURE__ */ new Set();
  function capture() {
    if (!enabled) return;
    const slot = slots.find((s) => !s.busy);
    if (!slot) return;
    const tex = app.renderer.context.getCurrentTexture();
    const hdr = app.renderer._targets?.hdr;
    if (!hdr || hdr.width !== tex.width || hdr.height !== tex.height) return;
    const w = Math.min(size, tex.width), h = Math.min(size, tex.height);
    const origin = [(tex.width - w) / 2 | 0, (tex.height - h) / 2 | 0];
    const enc = device.createCommandEncoder({ label: "frame-trap" });
    enc.copyTextureToBuffer({ texture: tex, origin }, { buffer: slot.final, bytesPerRow: size * 4 }, [w, h]);
    enc.copyTextureToBuffer({ texture: hdr, origin }, { buffer: slot.hdr, bytesPerRow: size * 8 }, [w, h]);
    device.queue.submit([enc.finish()]);
    slot.busy = true;
    const meta = {
      frame: app.frame,
      time: app.time,
      w,
      h,
      camera: Array.from(app.camera.position),
      target: Array.from(app.camera.target)
    };
    const job = Promise.all([
      slot.final.mapAsync(GPUMapMode.READ),
      slot.hdr.mapAsync(GPUMapMode.READ)
    ]).then(() => {
      const px = new Uint8Array(slot.final.getMappedRange()).slice();
      const hx = new Uint16Array(slot.hdr.getMappedRange()).slice();
      slot.final.unmap();
      slot.hdr.unmap();
      slot.busy = false;
      if (enabled) analyse(px, hx, meta);
    }).catch(() => {
      slot.busy = false;
    });
    pending.add(job);
    job.finally(() => pending.delete(job));
  }
  function analyse(px, hx, meta) {
    let finalBlack = 0, hdrBlack = 0, unexplained = 0;
    for (let y = 0; y < meta.h; y++) {
      for (let x = 0; x < meta.w; x++) {
        const o = y * size + x;
        const isBlack = px[o * 4] <= 2 && px[o * 4 + 1] <= 2 && px[o * 4 + 2] <= 2;
        const r = half(hx[o * 4]), g = half(hx[o * 4 + 1]), b = half(hx[o * 4 + 2]);
        const peak = Math.max(r, g, b);
        const hdrShowsBlack = !(displayed(peak) > 3);
        if (hdrShowsBlack) hdrBlack++;
        if (isBlack) {
          finalBlack++;
          if (!hdrShowsBlack && displayed(peak) > 6) unexplained++;
        }
      }
    }
    seen++;
    const area = meta.w * meta.h;
    const tripped = seen > warmup && finalBlack > area * minFraction && finalBlack > baseline * 4 + 50;
    if (!tripped) {
      baseline = baseline * 0.95 + finalBlack * 0.05;
      return;
    }
    enabled = false;
    app.stop();
    const rgba = new Uint8ClampedArray(area * 4);
    for (let y = 0; y < meta.h; y++) {
      for (let x = 0; x < meta.w; x++) {
        const s = (y * size + x) * 4, d = (y * meta.w + x) * 4;
        rgba[d] = px[s + (bgra ? 2 : 0)];
        rgba[d + 1] = px[s + 1];
        rgba[d + 2] = px[s + (bgra ? 0 : 2)];
        rgba[d + 3] = 255;
      }
    }
    onCatch({
      ...meta,
      area,
      finalBlack,
      hdrBlack,
      unexplained,
      rgba,
      // Mostly explained by the HDR target means the black was already there.
      stage: unexplained * 2 < finalBlack ? "hdr" : "post"
    });
  }
  return {
    capture,
    /** Resolves once every in-flight readback has been analysed. */
    settle: () => Promise.all([...pending]),
    get enabled() {
      return enabled;
    },
    set enabled(on) {
      enabled = on;
      baseline = 0;
      seen = 0;
    },
    destroy() {
      for (const s of slots) {
        s.final.destroy();
        s.hdr.destroy();
      }
    }
  };
}

// src/loaders/packed.js
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var lookup = null;
function base64ToBytes(b64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(b64);
  if (!lookup) {
    lookup = new Uint8Array(128);
    for (let i2 = 0; i2 < 64; i2++) lookup[B64.charCodeAt(i2)] = i2;
  }
  let len = b64.length;
  while (len && b64.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array(len * 3 >> 2);
  let o = 0, i = 0;
  for (; i + 4 <= len; i += 4) {
    const n = lookup[b64.charCodeAt(i)] << 18 | lookup[b64.charCodeAt(i + 1)] << 12 | lookup[b64.charCodeAt(i + 2)] << 6 | lookup[b64.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    out[o++] = n >> 8 & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest >= 2) {
    const n = lookup[b64.charCodeAt(i)] << 18 | lookup[b64.charCodeAt(i + 1)] << 12 | (rest === 3 ? lookup[b64.charCodeAt(i + 2)] << 6 : 0);
    out[o++] = n >> 16;
    if (rest === 3) out[o++] = n >> 8 & 255;
  }
  return out;
}
async function gunzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("packed asset: this browser has no DecompressionStream");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
async function unpackAsset(entry) {
  if (typeof entry === "string") {
    entry = globalThis.AxionAssets?.[entry];
    if (!entry) throw new Error("packed asset not found \u2014 is its <script> tag on the page?");
  }
  const layers = entry.format.split(".");
  let data = entry.data;
  for (let i = layers.length - 1; i > 0; i--) {
    const layer = layers[i];
    if (layer === "b64") data = base64ToBytes(data);
    else if (layer === "gz") data = await gunzip(data);
    else throw new Error(`packed asset: unknown layer "${layer}"`);
  }
  const buffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (entry.bytes && buffer.byteLength !== entry.bytes) {
    throw new Error(`packed asset: expected ${entry.bytes} bytes, got ${buffer.byteLength}`);
  }
  return buffer;
}

// src/loaders/gltf.js
var COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
var TYPED = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array
};
var NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function parseGLB(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 1179937895) throw new Error("glb: bad magic");
  if (view.getUint32(4, true) !== 2) throw new Error("glb: only version 2 is supported");
  let offset = 12, json = null, bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 1313821514) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
    else if (type === 5130562) bin = new Uint8Array(arrayBuffer, start, length);
    offset = start + length;
  }
  if (!json) throw new Error("glb: no JSON chunk");
  return { json, bin };
}
var isGLB = (arrayBuffer) => arrayBuffer.byteLength >= 4 && new DataView(arrayBuffer).getUint32(0, true) === 1179937895;
function bufferViewBytes(json, buffers, index) {
  const bv = json.bufferViews[index];
  const buf = buffers[bv.buffer];
  return new Uint8Array(buf.buffer, buf.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
}
function readAccessor(json, buffers, index) {
  const acc = json.accessors[index];
  const n = COMPONENTS[acc.type];
  const Typed = TYPED[acc.componentType];
  const count = acc.count;
  const out = acc.componentType === 5126 || acc.normalized ? new Float32Array(count * n) : new (Typed === Uint32Array ? Uint32Array : Float32Array)(count * n);
  if (acc.bufferView === void 0) return { data: out, n, count };
  const bv = json.bufferViews[acc.bufferView];
  const base = bufferViewBytes(json, buffers, acc.bufferView);
  const elemBytes = Typed.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || elemBytes * n;
  const start = acc.byteOffset ?? 0;
  const dv = new DataView(base.buffer, base.byteOffset, base.byteLength);
  const scale = acc.normalized ? 1 / NORMALIZE[acc.componentType] : 1;
  const get = {
    5120: (o) => dv.getInt8(o),
    5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true),
    5126: (o) => dv.getFloat32(o, true)
  }[acc.componentType];
  for (let i = 0; i < count; i++) {
    const o = start + i * stride;
    for (let c = 0; c < n; c++) {
      const v = get(o + c * elemBytes);
      out[i * n + c] = acc.normalized ? Math.max(v * scale, -1) : v;
    }
  }
  return { data: out, n, count };
}
function composeTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / (det || 1);
  return {
    det,
    n: [
      A * k,
      B * k,
      C * k,
      -(b * i - c * h) * k,
      (a * i - c * g) * k,
      -(a * h - b * g) * k,
      (b * f - c * e) * k,
      -(a * f - c * d) * k,
      (a * e - b * d) * k
    ]
  };
}
function uvTransformOf(material) {
  const pbr = material?.pbrMetallicRoughness ?? {};
  const ref = pbr.baseColorTexture ?? pbr.metallicRoughnessTexture ?? material?.normalTexture;
  const t = ref?.extensions?.KHR_texture_transform;
  if (!t) return null;
  const [ox, oy] = t.offset ?? [0, 0];
  const [sx, sy] = t.scale ?? [1, 1];
  const r = t.rotation ?? 0, c = Math.cos(r), sn = Math.sin(r);
  return [c * sx, sn * sy, ox, -sn * sx, c * sy, oy];
}
function parseGLTF(json, buffers) {
  const primitives = [];
  const uvTransforms = (json.materials ?? []).map(uvTransformOf);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? json.nodes?.map((_, i) => i) ?? [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const visit = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const local = node.matrix ? node.matrix.slice() : composeTRS(node.translation, node.rotation, node.scale);
    const world = mul(parent, local);
    if (node.mesh !== void 0) {
      const mesh2 = json.meshes[node.mesh];
      const { n: nm, det } = normalMatrix(world);
      mesh2.primitives.forEach((prim, pi) => {
        if ((prim.mode ?? 4) !== 4) return;
        const pos = readAccessor(json, buffers, prim.attributes.POSITION);
        const count = pos.count;
        const nor = prim.attributes.NORMAL !== void 0 ? readAccessor(json, buffers, prim.attributes.NORMAL) : null;
        const uv = prim.attributes.TEXCOORD_0 !== void 0 ? readAccessor(json, buffers, prim.attributes.TEXCOORD_0) : null;
        const uvT = uvTransforms[prim.material] ?? null;
        let idx = prim.indices !== void 0 ? readAccessor(json, buffers, prim.indices).data : null;
        if (!idx) {
          idx = new Uint32Array(count);
          for (let i = 0; i < count; i++) idx[i] = i;
        }
        const indices = new Uint32Array(idx);
        if (det < 0) {
          for (let t = 0; t < indices.length; t += 3) {
            const tmp = indices[t + 1];
            indices[t + 1] = indices[t + 2];
            indices[t + 2] = tmp;
          }
        }
        const F = VERTEX_STRIDE_FLOATS;
        const v = new Float32Array(count * F);
        for (let i = 0; i < count; i++) {
          const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
          const wx = world[0] * x + world[4] * y + world[8] * z + world[12];
          const wy = world[1] * x + world[5] * y + world[9] * z + world[13];
          const wz = world[2] * x + world[6] * y + world[10] * z + world[14];
          v[i * F] = wx;
          v[i * F + 1] = wy;
          v[i * F + 2] = wz;
          if (wx < min[0]) min[0] = wx;
          if (wy < min[1]) min[1] = wy;
          if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx;
          if (wy > max[1]) max[1] = wy;
          if (wz > max[2]) max[2] = wz;
          if (uv) {
            const u0 = uv.data[i * 2], v0 = uv.data[i * 2 + 1];
            if (uvT) {
              v[i * F + 6] = uvT[0] * u0 + uvT[1] * v0 + uvT[2];
              v[i * F + 7] = uvT[3] * u0 + uvT[4] * v0 + uvT[5];
            } else {
              v[i * F + 6] = u0;
              v[i * F + 7] = v0;
            }
          }
        }
        if (nor) {
          for (let i = 0; i < count; i++) {
            const x = nor.data[i * 3], y = nor.data[i * 3 + 1], z = nor.data[i * 3 + 2];
            let nx = nm[0] * x + nm[3] * y + nm[6] * z;
            let ny = nm[1] * x + nm[4] * y + nm[7] * z;
            let nz = nm[2] * x + nm[5] * y + nm[8] * z;
            const l = Math.hypot(nx, ny, nz) || 1;
            v[i * F + 3] = nx / l;
            v[i * F + 4] = ny / l;
            v[i * F + 5] = nz / l;
          }
        } else {
          for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * F, b = indices[t + 1] * F, c = indices[t + 2] * F;
            const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
            const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
            const fx = e1[1] * e2[2] - e1[2] * e2[1];
            const fy = e1[2] * e2[0] - e1[0] * e2[2];
            const fz = e1[0] * e2[1] - e1[1] * e2[0];
            for (const k of [a, b, c]) {
              v[k + 3] += fx;
              v[k + 4] += fy;
              v[k + 5] += fz;
            }
          }
          for (let i = 0; i < count; i++) {
            const o = i * F, l = Math.hypot(v[o + 3], v[o + 4], v[o + 5]) || 1;
            v[o + 3] /= l;
            v[o + 4] /= l;
            v[o + 5] /= l;
          }
        }
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < count; i++) {
          cx += v[i * F];
          cy += v[i * F + 1];
          cz += v[i * F + 2];
        }
        cx /= count;
        cy /= count;
        cz /= count;
        let r2 = 0;
        for (let i = 0; i < count; i++) {
          const dx = v[i * F] - cx, dy = v[i * F + 1] - cy, dz = v[i * F + 2] - cz;
          r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
        }
        triangles += indices.length / 3;
        primitives.push({
          name: `${mesh2.name ?? `mesh${node.mesh}`}/${pi}`,
          material: prim.material ?? -1,
          geometry: {
            vertices: v,
            indices,
            vertexCount: count,
            bounds: new Float32Array([cx, cy, cz, Math.sqrt(r2)])
          }
        });
      });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const r of roots) visit(r, identity);
  const materials = (json.materials ?? []).map((m, i) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
    return {
      name: m.name ?? `material${i}`,
      color: [f[0], f[1], f[2]],
      alpha: f[3],
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      baseColorTexture: pbr.baseColorTexture?.index,
      metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index,
      normalTexture: m.normalTexture?.index,
      normalScale: m.normalTexture?.scale ?? 1,
      alphaMode: m.alphaMode ?? "OPAQUE",
      alphaCutoff: m.alphaCutoff ?? 0.5,
      doubleSided: !!m.doubleSided
    };
  });
  return { primitives, materials, bounds: { min, max }, triangles };
}
function resolve(uri, base) {
  if (uri.startsWith("data:")) return uri;
  return new URL(uri, base).href;
}
async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gltf: ${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function loadGLTF(app, source, { onProgress = () => {
} } = {}) {
  let raw, base;
  if (typeof source === "string") {
    base = new URL(source, globalThis.location?.href ?? "http://localhost/").href;
    raw = await fetchBytes(base);
  } else if (source?.format && source?.data !== void 0) {
    onProgress("unpacking", 0, 1);
    raw = new Uint8Array(await unpackAsset(source));
    onProgress("unpacking", 1, 1);
    base = globalThis.location?.href ?? "http://localhost/";
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    raw = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    base = globalThis.location?.href ?? "http://localhost/";
  } else {
    throw new Error("loadGLTF: expected a URL, an ArrayBuffer, or a packed asset");
  }
  let json, buffers;
  if (isGLB(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))) {
    const glb = parseGLB(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    json = glb.json;
    buffers = await Promise.all((json.buffers ?? []).map((b, i) => i === 0 && b.uri === void 0 ? glb.bin : fetchBytes(resolve(b.uri, base))));
  } else {
    json = JSON.parse(new TextDecoder().decode(raw));
    buffers = await Promise.all((json.buffers ?? []).map((b) => fetchBytes(resolve(b.uri, base))));
  }
  onProgress("geometry", 0, 1);
  const parsed = parseGLTF(json, buffers);
  onProgress("geometry", 1, 1);
  const srgbTextures = /* @__PURE__ */ new Set();
  for (const m of parsed.materials) if (m.baseColorTexture !== void 0) srgbTextures.add(m.baseColorTexture);
  const device = app.device;
  const textureCount = (json.textures ?? []).length;
  let done = 0;
  const gpuTextures = await pool(json.textures ?? [], 6, async (tex, ti) => {
    const img = json.images[tex.extensions?.EXT_texture_webp?.source ?? tex.source];
    let blob;
    if (img.bufferView !== void 0) {
      blob = new Blob([bufferViewBytes(json, buffers, img.bufferView)], { type: img.mimeType });
    } else {
      blob = await (await fetch(resolve(img.uri, base))).blob();
    }
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const texture = textureFromImage(device, bitmap, {
      srgb: srgbTextures.has(ti),
      label: img.name ?? img.uri ?? `texture${ti}`
    });
    bitmap.close?.();
    onProgress("textures", ++done, textureCount);
    return texture;
  });
  const materialIds = parsed.materials.map((m) => app.material({
    name: m.name,
    color: m.color,
    alpha: m.alpha,
    metallic: m.metallic,
    roughness: m.roughness,
    baseColorTexture: gpuTextures[m.baseColorTexture] ?? null,
    metallicRoughnessTexture: gpuTextures[m.metallicRoughnessTexture] ?? null,
    normalTexture: gpuTextures[m.normalTexture] ?? null,
    normalScale: m.normalScale,
    alphaMode: m.alphaMode,
    alphaCutoff: m.alphaCutoff,
    doubleSided: m.doubleSided
  }));
  const fallback = materialIds.length ? null : app.material({ name: "gltf-default" });
  const entities = parsed.primitives.map((p) => {
    const mesh2 = app.renderer.createMesh(p.geometry, p.name);
    const material = p.material >= 0 ? materialIds[p.material] : fallback ?? app.renderer.defaultMaterial;
    return app.add({ mesh: mesh2, material });
  });
  return {
    entities,
    bounds: parsed.bounds,
    triangles: parsed.triangles,
    primitives: parsed.primitives.length,
    materials: materialIds.length,
    textures: gpuTextures.length
  };
}

// src/index.js
var VERSION = "0.8.0";
export {
  AO_BLUR_WGSL,
  AO_WGSL,
  App,
  Arena,
  BLOOM_DOWN_WGSL,
  BLOOM_PREFILTER_WGSL,
  BLOOM_UP_WGSL,
  Bounds,
  CUBE_FACES,
  Camera,
  DOF_WGSL,
  Dynamic,
  DynamicBuffer,
  EXPOSURE_WGSL,
  FINAL_WGSL,
  Hidden,
  InstanceColor,
  LocalToWorld,
  M_MATERIAL,
  M_MESH,
  MeshRef,
  Motion,
  NULL_ENTITY,
  PointLight,
  RESOLVE_WGSL,
  Renderer,
  SHADOW_WGSL,
  STANDARD_WGSL,
  T_POS,
  T_ROT,
  T_SCALE,
  Transform,
  UnsupportedError,
  VERSION,
  VERTEX_STRIDE_BYTES,
  VOLUME_WGSL,
  World,
  base64ToBytes,
  box,
  composeRange,
  createDevice,
  createFrameTrap,
  defineComponent,
  entityGen,
  entityIndex,
  generateMips,
  icosphere,
  loadGLTF,
  math_exports as math,
  motionSystem,
  parseGLB,
  parseGLTF,
  plane,
  readAccessor,
  resizeCanvas,
  roundedBox,
  solidTexture,
  sphere,
  textureFromImage,
  torus,
  transformSystem,
  unpackAsset
};
