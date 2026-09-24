/*! Axion 0.9.3 — WebGPU, data-oriented 3D engine. MIT. */
var Axion = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    AO_BLUR_WGSL: () => AO_BLUR_WGSL,
    AO_WGSL: () => AO_WGSL,
    App: () => App,
    Arena: () => Arena,
    BLOOM_DOWN_WGSL: () => BLOOM_DOWN_WGSL,
    BLOOM_PREFILTER_WGSL: () => BLOOM_PREFILTER_WGSL,
    BLOOM_UP_WGSL: () => BLOOM_UP_WGSL,
    Bounds: () => Bounds,
    CUBE_FACES: () => CUBE_FACES,
    Camera: () => Camera,
    DOF_WGSL: () => DOF_WGSL,
    Dynamic: () => Dynamic,
    DynamicBuffer: () => DynamicBuffer,
    EXPOSURE_WGSL: () => EXPOSURE_WGSL,
    FINAL_WGSL: () => FINAL_WGSL,
    Hidden: () => Hidden,
    InstanceColor: () => InstanceColor,
    LocalToWorld: () => LocalToWorld,
    M_MATERIAL: () => M_MATERIAL,
    M_MESH: () => M_MESH,
    MeshRef: () => MeshRef,
    Motion: () => Motion,
    NULL_ENTITY: () => NULL_ENTITY,
    PointLight: () => PointLight,
    RESOLVE_WGSL: () => RESOLVE_WGSL,
    Renderer: () => Renderer,
    SHADOW_WGSL: () => SHADOW_WGSL,
    SKY_WGSL: () => SKY_WGSL,
    SSR_WGSL: () => SSR_WGSL,
    STANDARD_WGSL: () => STANDARD_WGSL,
    TERRAIN_SHADOW_WGSL: () => TERRAIN_SHADOW_WGSL,
    TERRAIN_WGSL: () => TERRAIN_WGSL,
    T_POS: () => T_POS,
    T_ROT: () => T_ROT,
    T_SCALE: () => T_SCALE,
    Terrain: () => Terrain,
    Transform: () => Transform,
    UnsupportedError: () => UnsupportedError,
    VERSION: () => VERSION,
    VERTEX_STRIDE_BYTES: () => VERTEX_STRIDE_BYTES,
    VOLUME_WGSL: () => VOLUME_WGSL,
    World: () => World,
    base64ToBytes: () => base64ToBytes,
    box: () => box,
    composeRange: () => composeRange,
    createDevice: () => createDevice,
    createFrameTrap: () => createFrameTrap,
    defineComponent: () => defineComponent,
    entityGen: () => entityGen,
    entityIndex: () => entityIndex,
    generateMips: () => generateMips,
    icosphere: () => icosphere,
    loadGLTF: () => loadGLTF,
    loadModels: () => loadModels,
    math: () => math_exports,
    motionSystem: () => motionSystem,
    parseGLB: () => parseGLB,
    parseGLTF: () => parseGLTF,
    plane: () => plane,
    readAccessor: () => readAccessor,
    resizeCanvas: () => resizeCanvas,
    roundedBox: () => roundedBox,
    skyAmbient: () => skyAmbient,
    skyRadiance: () => skyRadiance,
    solidTexture: () => solidTexture,
    sphere: () => sphere,
    sunDirection: () => sunDirection,
    sunTransmittance: () => sunTransmittance,
    textureArrayFromImages: () => textureArrayFromImages,
    textureFromImage: () => textureFromImage,
    torus: () => torus,
    transformSystem: () => transformSystem,
    unpackAsset: () => unpackAsset
  });

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
  function generateMips(device, texture, layer = -1) {
    const { pipeline, sampler } = mipPipeline(device, texture.format);
    const enc = device.createCommandEncoder({ label: "axion-mips" });
    const view = (level) => layer < 0 ? texture.createView({ baseMipLevel: level, mipLevelCount: 1 }) : texture.createView({ dimension: "2d", baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: view(level - 1) }
        ]
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: view(level),
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
  function textureArrayFromImages(device, images, { size = 1024, srgb = true, label = "axion-texture-array" } = {}) {
    const format = srgb ? "rgba8unorm-srgb" : "rgba8unorm";
    const layers = Math.max(1, images.length);
    const texture = device.createTexture({
      label,
      format,
      size: [size, size, layers],
      mipLevelCount: mipLevelsFor(size, size),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img) {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
      } else {
        ctx.fillStyle = srgb ? "rgb(128, 128, 128)" : "rgb(128, 128, 255)";
        ctx.fillRect(0, 0, size, size);
      }
      device.queue.copyExternalImageToTexture({ source: canvas }, { texture, origin: [0, 0, i] }, [size, size]);
      generateMips(device, texture, i);
    }
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
  sky      : vec4<f32>,   // x = sky on, y = sun disc, z = cloud cover, w = cloud time
  sunDir   : vec4<f32>,   // xyz = direction toward the sun, w = sun on
  sunColor : vec4<f32>,   // rgb = sun radiance at the ground, w = sun shadows on
  csmSplits : vec4<f32>,  // view distance where each shadow cascade ends
  csmParams : vec4<f32>,  // x = map size, y = PCF radius (texels), z = normal bias (texels), w = unused
  csm      : array<mat4x4<f32>, 4>,   // light view-projection per cascade
  wind     : vec4<f32>,   // xy = direction (xz), z = strength, w = time
  sky2     : vec4<f32>,   // x = sky brightness, y = cloud height, z = cloud scale, w = haze
  terrain  : vec4<f32>,   // x = origin x, y = origin z, z = size, w = terrain on
  terrain2 : vec4<f32>,   // x = height samples per side, y = water level, z = water on, w = grass fade
  grass    : vec4<f32>,   // x = radius, y = blade height, z = blade width, w = density
  extra    : vec4<f32>,   // x = fog height base, y = fog height falloff, z = cloud shadows, w = horizon shadow blend
  csmWorld : vec4<f32>,   // world-space width of each cascade
  prevViewProj : mat4x4<f32>,
  night    : vec4<f32>,   // xyz = direction toward the real sun (the sky's), w = how much night (0..1)
  moon     : vec4<f32>,   // xyz = direction toward the moon, w = moon size (0 = no moon or stars)
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
  rest  : array<vec4<f32>, 4>,
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
  var NOISE_WGSL = (
    /* wgsl */
    `
fn hash31(p : vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.1, 0.1));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

fn hash21(p : vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(0.1031, 0.1030));
  q = q + dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
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

/** 2D value noise, same fade. */
fn noise2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
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

fn fbm2(p : vec2<f32>, octaves : i32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < octaves; i = i + 1) {
    sum = sum + noise2(q) * amp;
    q = vec2<f32>(q.x * 1.6 + q.y * 1.2, q.y * 1.6 - q.x * 1.2);   // rotate so octaves never line up
    amp = amp * 0.5;
  }
  return sum;
}

/**
 * Cloud layer density at a world position on the cloud plane. Shared by the
 * sky, which draws the clouds, and the lighting, which uses the same field for
 * the shadows they cast, so the two always agree.
 */
fn cloudDensity(xz : vec2<f32>) -> f32 {
  let uv = xz * camera.sky2.z + vec2<f32>(camera.wind.x, camera.wind.y) * camera.sky.w;
  let n = fbm2(uv, 5);
  let cover = camera.sky.z;
  return smoothstep(1.0 - cover, 1.0 - cover + 0.32, n + 0.12 * cover);
}
`
  );
  var SCENE_WGSL = (
    /* wgsl */
    `
struct Light {
  posRange   : vec4<f32>,  // xyz = world position, w = range
  colorPower : vec4<f32>,  // rgb = color, a = intensity
  shadowInfo : vec4<f32>,  // x = shadow slot (-1 = none), y = near, z = bias, w = far
};

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(2) var<storage, read> lights : array<Light>;
@group(0) @binding(3) var shadowMaps : texture_depth_2d_array;
@group(0) @binding(4) var shadowSampler : sampler_comparison;
@group(0) @binding(6) var sunShadowMaps : texture_depth_2d_array;
@group(0) @binding(7) var horizonTex : texture_2d<f32>;

struct GBuffer {
  @location(0) color   : vec4<f32>,
  @location(1) surface : vec4<f32>,
  @location(2) albedo  : vec4<f32>,
};

/** Pack a lit surface into the three targets the resolve pass reads. */
fn gbuffer(lit : vec3<f32>, alpha : f32, N : vec3<f32>, albedo : vec3<f32>,
           roughness : f32, metallic : f32) -> GBuffer {
  var out : GBuffer;
  out.color = vec4<f32>(sanitize(lit), alpha);
  let viewN = normalize((camera.view * vec4<f32>(N, 0.0)).xyz);
  let oct = octEncode(viewN);
  out.surface = vec4<f32>(oct.x, oct.y, roughness, metallic);
  out.albedo = vec4<f32>(albedo, 1.0);
  return out;
}
`
  );
  var LIGHTING_WGSL = (
    /* wgsl */
    `
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

/**
 * Sun shadow from the cascades.
 *
 * The cascade is picked by view distance. Over the last part of each cascade
 * the choice is dithered toward the next one, so the seam between two maps of
 * different resolution dissolves instead of drawing a line across the ground.
 * The lookup point is pushed off the surface along its normal by a few texels
 * of the chosen cascade \u2014 acne goes away without the bias that would float
 * shadows off their contact points.
 */
fn sunShadow(P : vec3<f32>, geomN : vec3<f32>, nDotL : f32, pixel : vec2<f32>) -> f32 {
  if (camera.sunColor.w < 0.5) { return 1.0; }
  let viewZ = -(camera.view * vec4<f32>(P, 1.0)).z;
  let splits = camera.csmSplits;
  if (viewZ > splits.w) { return 1.0; }

  var c = 0;
  if (viewZ > splits.x) { c = 1; }
  if (viewZ > splits.y) { c = 2; }
  if (viewZ > splits.z) { c = 3; }

  let end = splits[c];
  var start = camera.proj.z;
  if (c > 0) { start = splits[c - 1]; }
  let band = (end - start) * 0.15;
  let noise = (f32(interleavedIndex(pixel)) + 0.5) / 16.0;
  if (c < 3 && viewZ > end - band && noise < (viewZ - (end - band)) / band) { c = c + 1; }

  let texelWorld = camera.csmWorld[c] / camera.csmParams.x;
  let slope = clamp(1.0 - nDotL, 0.0, 1.0);
  let offset = geomN * texelWorld * camera.csmParams.z * (1.0 + slope * 2.0);
  let lp = camera.csm[c] * vec4<f32>(P + offset, 1.0);
  let uv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z > 1.0) { return 1.0; }

  let radius = camera.csmParams.y / camera.csmParams.x;
  let rot = f32(interleavedIndex(pixel)) * 0.3927;
  var sum = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    let r = sqrt((f32(i) + 0.5) / 8.0);
    let theta = f32(i) * 2.39996323 + rot;
    let o = vec2<f32>(cos(theta), sin(theta)) * r * radius;
    sum = sum + textureSampleCompareLevel(sunShadowMaps, shadowSampler, uv + o, c, lp.z);
  }
  let s = sum / 8.0;
  return mix(s, 1.0, smoothstep(splits.w * 0.85, splits.w, viewZ));
}

/**
 * Shadows of the terrain itself, however far away the hill is: a map-wide grid
 * holds, per column of ground, the height below which the sun (or moon) is
 * hidden by the land toward it. Covers what the cascades can't reach.
 */
fn horizonShadow(P : vec3<f32>) -> f32 {
  if (camera.terrain.w < 0.5) { return 1.0; }
  let dims = vec2<i32>(textureDimensions(horizonTex, 0));
  if (dims.x < 2) { return 1.0; }
  let g = clamp((P.xz - camera.terrain.xy) / camera.terrain.z * vec2<f32>(dims - 1),
                vec2<f32>(0.0), vec2<f32>(dims - 1) - 0.001);
  let i = vec2<i32>(floor(g));
  let f = g - floor(g);
  // Cross-fade from the previous light direction (green) to the current one (red)
  let k = clamp(camera.extra.w, 0.0, 1.0);
  let ta = textureLoad(horizonTex, i, 0);
  let tb = textureLoad(horizonTex, i + vec2<i32>(1, 0), 0);
  let tc = textureLoad(horizonTex, i + vec2<i32>(0, 1), 0);
  let td = textureLoad(horizonTex, i + vec2<i32>(1, 1), 0);
  let a = mix(ta.g, ta.r, k);
  let b = mix(tb.g, tb.r, k);
  let c = mix(tc.g, tc.r, k);
  let d = mix(td.g, td.r, k);
  let top = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return smoothstep(top - 1.5, top + 2.5, P.y);
}

/** Shadow the clouds cast: the cloud field where the sun ray through P crosses the cloud plane. */
fn cloudShadow(P : vec3<f32>) -> f32 {
  if (camera.extra.z <= 0.0 || camera.sky.x < 0.5 || camera.sky.z <= 0.0) { return 1.0; }
  let L = camera.sunDir.xyz;
  if (L.y < 0.02) { return 1.0; }
  let t = (camera.sky2.y - P.y) / L.y;
  let d = cloudDensity(P.xz + L.xz * t);
  return 1.0 - d * camera.extra.z;
}

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

/** Cook-Torrance plus Lambert for one light direction, times n.l. */
fn brdf(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, albedo : vec3<f32>,
        roughness : f32, metallic : f32, nDotV : f32, nDotL : f32) -> vec3<f32> {
  let f0 = mix(vec3<f32>(0.04), albedo, metallic);
  let H = normalize(V + L);
  let D = distributionGGX(max(dot(N, H), 0.0), roughness);
  let G = geometrySmith(nDotV, nDotL, roughness);
  let F = fresnelSchlick(max(dot(H, V), 0.0), f0);
  let spec = (D * G * F) / max(4.0 * nDotV * nDotL, 1e-4);
  let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);
  return (kD * albedo / PI + spec) * nDotL;
}

struct Surface {
  P : vec3<f32>,
  N : vec3<f32>,          // shading normal
  geomN : vec3<f32>,      // geometric normal, for shadow offsets
  V : vec3<f32>,
  albedo : vec3<f32>,
  roughness : f32,
  metallic : f32,
  translucency : f32,     // light passing through thin leaves and blades
};

/**
 * Direct light: the sun (cascaded shadows, cloud shadows) and every point
 * light. Ambient is not here \u2014 the resolve pass adds it, under AO.
 */
fn shadeDirect(s : Surface, pixel : vec2<f32>) -> vec3<f32> {
  let nDotV = max(dot(s.N, s.V), 1e-4);
  var Lo = vec3<f32>(0.0);

  if (camera.sunDir.w > 0.5) {
    let L = camera.sunDir.xyz;
    let nl = dot(s.N, L);
    let nDotL = max(nl, 0.0);
    if (nDotL > 0.0 || s.translucency > 0.0) {
      let sh = sunShadow(s.P, s.geomN, max(dot(s.geomN, L), 0.0), pixel) * cloudShadow(s.P) * horizonShadow(s.P);
      let radiance = camera.sunColor.rgb * sh;
      if (nDotL > 0.0) {
        Lo = Lo + brdf(s.N, s.V, L, s.albedo, s.roughness, s.metallic, nDotV, nDotL) * radiance;
      }
      if (s.translucency > 0.0) {
        // Back-lit leaves glow: a wrapped diffuse from behind plus a forward
        // scattering lobe toward a viewer looking at the sun through them.
        let back = max(-nl, 0.0) * 0.6;
        let through = pow(max(dot(-s.V, L), 0.0), 6.0);
        Lo = Lo + s.albedo * radiance * s.translucency * (back + through) / PI;
      }
    }
  }

  let count = u32(camera.params.x);
  for (var i : u32 = 0u; i < count; i = i + 1u) {
    let light = lights[i];
    let toLight = light.posRange.xyz - s.P;
    let dist = length(toLight);
    if (dist > light.posRange.w) { continue; }
    let L = toLight / max(dist, 1e-4);
    let nDotL = max(dot(s.N, L), 0.0);
    if (nDotL <= 0.0) { continue; }

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
      let offset = s.geomN * camera.shadow.z;
      shadow = sampleShadow(slot, (s.P + offset) - light.posRange.xyz, nDotL,
                            light.shadowInfo.y, light.shadowInfo.z, light.shadowInfo.w);
      if (shadow <= 0.001) { continue; }
    }

    let radiance = light.colorPower.rgb * light.colorPower.a * atten * shadow;
    Lo = Lo + brdf(s.N, s.V, L, s.albedo, s.roughness, s.metallic, nDotV, nDotL) * radiance;
  }
  return Lo;
}
`
  );
  var STANDARD_WGSL = (
    /* wgsl */
    `
${COMMON}
${CUBE_WGSL}
${NOISE_WGSL}
${SCENE_WGSL}
${LIGHTING_WGSL}

struct Instance {
  model : mat4x4<f32>,
  color : vec4<f32>,   // rgb = albedo tint, a = alpha
  pbr   : vec4<f32>,   // x = metallic, y = roughness, z = emissive, w = wind
  surf  : vec4<f32>,   // x = noise scale, y = noise strength, z = bump, w = oxide
  extra : vec4<f32>,   // x = translucency, y = fade-out distance, z = leaf flutter, w = unused
};

@group(0) @binding(1) var<storage, read> instances : array<Instance>;
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
  @location(6) @interpolate(flat) extra : vec4<f32>,
};

/**
 * World position of one vertex of one instance: the model matrix, then the
 * distance fade (objects shrink away just before their draw distance instead
 * of popping), then wind. Every pass that must agree on depth calls this one
 * function, so the prepass and the shaded pass can never disagree.
 */
fn instanceWorld(inst : Instance, position : vec3<f32>) -> vec3<f32> {
  let origin = inst.model[3].xyz;
  var local = position;
  let fadeDist = inst.extra.y;
  if (fadeDist > 0.0) {
    let d = distance(origin, camera.position.xyz);
    local = local * (1.0 - smoothstep(fadeDist * 0.82, fadeDist, d));
  }
  var world = (inst.model * vec4<f32>(local, 1.0)).xyz;

  let wind = inst.pbr.w * camera.wind.z;
  if (wind > 0.0) {
    // Whole-plant sway grows with height above the root; a second, faster
    // wave rides on top, and leaves flutter on their own.
    let h = max(world.y - origin.y, 0.0);
    let t = camera.wind.w;
    let phase = dot(origin.xz, vec2<f32>(0.071, 0.053));
    let gust = 0.65 + 0.35 * sin(t * 0.31 + phase * 0.4);
    let sway = (sin(t * 1.1 + phase) * 0.7 + sin(t * 2.7 + phase * 1.9) * 0.3) * gust;
    let bend = wind * sway * h * h * 0.0025;
    let dir = vec3<f32>(camera.wind.x, 0.0, camera.wind.y);
    world = world + dir * bend;
    let flutter = inst.extra.z * wind;
    if (flutter > 0.0) {
      let k = dot(world, vec3<f32>(1.7, 2.3, 1.3));
      world = world + vec3<f32>(sin(t * 6.1 + k), sin(t * 7.3 + k * 1.3) * 0.5, cos(t * 5.3 + k)) * flutter * 0.035;
    }
  }
  return world;
}

@vertex
fn vs(
  @builtin(instance_index) ii : u32,
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
) -> VSOut {
  let inst = instances[visible[ii]];
  let world = instanceWorld(inst, position);
  let n = normalize((inst.model * vec4<f32>(normal, 0.0)).xyz);

  var out : VSOut;
  out.clip = camera.viewProj * vec4<f32>(world, 1.0);
  out.worldPos = world;
  out.normal = n;
  out.uv = uv;
  out.color = inst.color;
  out.pbr = inst.pbr;
  out.surf = inst.surf;
  out.extra = inst.extra;
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
  return camera.viewProj * vec4<f32>(instanceWorld(inst, position), 1.0);
}

struct MaskDepthOut {
  @invariant @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) @interpolate(flat) alpha : f32,
};

/** Depth prepass for alpha-tested surfaces: the same cut-out as the main pass. */
@vertex
fn vsDepthMask(@builtin(instance_index) ii : u32,
               @location(0) position : vec3<f32>,
               @location(2) uv : vec2<f32>) -> MaskDepthOut {
  let inst = instances[visible[ii]];
  var o : MaskDepthOut;
  o.clip = camera.viewProj * vec4<f32>(instanceWorld(inst, position), 1.0);
  o.uv = uv;
  o.alpha = inst.color.a;
  return o;
}

/**
 * Alpha for an alpha test, kept from thinning out with distance. Mips average
 * alpha toward the middle, so a leaf that is solid up close dissolves into
 * nothing far away; scaling by the mip level being read keeps its coverage.
 */
fn cutoutAlpha(a : f32, uv : vec2<f32>) -> f32 {
  let size = vec2<f32>(textureDimensions(baseColorTex, 0));
  let dx = dpdx(uv * size);
  let dy = dpdy(uv * size);
  let lod = max(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0);
  return a * (1.0 + lod * 0.25);
}

@fragment
fn fsDepthMask(in : MaskDepthOut) {
  let a = cutoutAlpha(textureSample(baseColorTex, matSampler, in.uv).a, in.uv) * in.alpha;
  if (a < material.alphaCutoff) { discard; }
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
  let cut = cutoutAlpha(base.a, in.uv);

  var alpha = in.color.a * base.a;
  if (material.alphaCutoff > 0.0) {
    if (in.color.a * cut < material.alphaCutoff) { discard; }
    alpha = 1.0;
  }

  var albedo = in.color.rgb * base.rgb;
  var metallic = clamp(in.pbr.x * mr.b, 0.0, 1.0);
  var roughness = clamp(in.pbr.y * mr.g, 0.04, 1.0);

  // A double-sided surface seen from behind must be lit from behind \u2014 except
  // translucent foliage, whose normals are authored to point out of the crown
  // on both sides: flipping them would leave half of every tree in the dark.
  var geomN = safeNormalize(in.normal, vec3<f32>(0.0, 1.0, 0.0));
  if (!front && in.extra.x <= 0.0) { geomN = -geomN; }
  var N = geomN;

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

  var s : Surface;
  s.P = in.worldPos;
  s.N = N;
  s.geomN = geomN;
  s.V = normalize(camera.position.xyz - in.worldPos);
  s.albedo = albedo;
  s.roughness = roughness;
  s.metallic = metallic;
  s.translucency = in.extra.x;
  let Lo = shadeDirect(s, in.clip.xy);

  // Ambient is deferred to the resolve pass so occlusion can modulate it.
  return gbuffer(Lo + albedo * in.pbr.z, alpha, N, albedo, roughness, metallic);
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
      // Tolerance grows with distance: far away, neighbouring pixels on one
      // surface can be metres apart in depth, and a fixed scale would not blur there at all.
      let w = exp(-abs(z - centerZ) / (0.5 + centerZ * 0.03));
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
@group(0) @binding(6) var sunShadowMaps : texture_depth_2d_array;
@group(0) @binding(7) var horizonTex : texture_2d<f32>;

fn horizonShadow(P : vec3<f32>) -> f32 {
  if (camera.terrain.w < 0.5) { return 1.0; }
  let dims = vec2<i32>(textureDimensions(horizonTex, 0));
  if (dims.x < 2) { return 1.0; }
  let g = clamp((P.xz - camera.terrain.xy) / camera.terrain.z * vec2<f32>(dims - 1),
                vec2<f32>(0.0), vec2<f32>(dims - 1) - 0.001);
  let i = vec2<i32>(floor(g));
  let f = g - floor(g);
  // Cross-fade from the previous light direction (green) to the current one (red)
  let k = clamp(camera.extra.w, 0.0, 1.0);
  let ta = textureLoad(horizonTex, i, 0);
  let tb = textureLoad(horizonTex, i + vec2<i32>(1, 0), 0);
  let tc = textureLoad(horizonTex, i + vec2<i32>(0, 1), 0);
  let td = textureLoad(horizonTex, i + vec2<i32>(1, 1), 0);
  let a = mix(ta.g, ta.r, k);
  let b = mix(tb.g, tb.r, k);
  let c = mix(tc.g, tc.r, k);
  let d = mix(td.g, td.r, k);
  let top = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return smoothstep(top - 1.5, top + 2.5, P.y);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/** One tap of the sun's cascades: shafts of light between trunks. */
fn sunTap(X : vec3<f32>) -> f32 {
  if (camera.sunColor.w < 0.5) { return 1.0; }
  let viewZ = -(camera.view * vec4<f32>(X, 1.0)).z;
  let splits = camera.csmSplits;
  if (viewZ > splits.w) { return 1.0; }
  var c = 0;
  if (viewZ > splits.x) { c = 1; }
  if (viewZ > splits.y) { c = 2; }
  if (viewZ > splits.z) { c = 3; }
  let lp = camera.csm[c] * vec4<f32>(X, 1.0);
  let uv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  return textureSampleCompareLevel(sunShadowMaps, shadowSampler, uv, c, lp.z);
}

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
    if (camera.sunDir.w > 0.5) {
      let phaseSun = phaseHG(dot(dir, camera.sunDir.xyz), camera.vol.z);
      light = light + camera.sunColor.rgb * phaseSun * sunTap(X) * horizonShadow(X) * camera.vol2.w * 4.0;
    }
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
  var SKY_LOOKUP_WGSL = (
    /* wgsl */
    `
fn skyUV(dir : vec3<f32>) -> vec2<f32> {
  let az = atan2(dir.z, dir.x);
  let el = asin(clamp(dir.y, -1.0, 1.0));
  let x = sign(el) * sqrt(abs(el) / (PI * 0.5));
  return vec2<f32>(az / (2.0 * PI) + 0.5, 0.5 - 0.5 * x);
}

fn skyRadiance(dir : vec3<f32>) -> vec3<f32> {
  return textureSampleLevel(skyLut, skySampler, skyUV(dir), 0.0).rgb * camera.sky2.x;
}
`
  );
  var SKY_WGSL = (
    /* wgsl */
    `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

const RG : f32 = 6360000.0;
const RT : f32 = 6420000.0;
const BR : vec3<f32> = vec3<f32>(5.802e-6, 13.558e-6, 33.1e-6);
const BM : f32 = 3.996e-6;
const HR : f32 = 8000.0;
const HM : f32 = 1200.0;

/** Distance along d from a point at height h above the ground centre line to a sphere of radius r. */
fn toSphere(oy : f32, dy : f32, r : f32) -> f32 {
  let b = oy * dy;
  let c = (oy - r) * (oy + r);
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  return -b + sqrt(disc);
}

fn hitsGround(oy : f32, dy : f32) -> f32 {
  if (dy >= 0.0) { return -1.0; }
  let b = oy * dy;
  let c = (oy - RG) * (oy + RG);
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  return -b - sqrt(disc);
}

/** Optical depth (Rayleigh, Mie) from point p toward the sun, out to the top of the atmosphere. */
fn towardSun(p : vec3<f32>, L : vec3<f32>) -> vec2<f32> {
  let r = length(p);
  let up = p / r;
  let mu = dot(up, L);
  if (hitsGround(r, mu) > 0.0) { return vec2<f32>(1e9, 1e9); }
  let len = toSphere(r, mu, RT);
  let steps = 6;
  let ds = len / f32(steps);
  var od = vec2<f32>(0.0);
  for (var i = 0; i < steps; i = i + 1) {
    let q = p + L * ((f32(i) + 0.5) * ds);
    let h = length(q) - RG;
    od = od + vec2<f32>(exp(-h / HR), exp(-h / HM)) * ds;
  }
  return od;
}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let x = 1.0 - in.uv.y * 2.0;
  let el = sign(x) * x * x * PI * 0.5;
  let az = (in.uv.x - 0.5) * 2.0 * PI;
  let dir = vec3<f32>(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  let L = camera.night.xyz;
  let haze = max(camera.sky2.w, 0.0);

  let oy = RG + clamp(camera.position.y, 0.0, 4000.0) + 50.0;
  let o = vec3<f32>(0.0, oy, 0.0);
  var len = toSphere(oy, dir.y, RT);
  let ground = hitsGround(oy, dir.y);
  if (ground > 0.0) { len = ground; }

  let steps = 16;
  let ds = len / f32(steps);
  var sumR = vec3<f32>(0.0);
  var sumM = vec3<f32>(0.0);
  var odR = 0.0;
  var odM = 0.0;
  for (var i = 0; i < steps; i = i + 1) {
    let p = o + dir * ((f32(i) + 0.5) * ds);
    let h = length(p) - RG;
    let dR = exp(-h / HR) * ds;
    let dM = exp(-h / HM) * ds;
    odR = odR + dR;
    odM = odM + dM;
    let toSun = towardSun(p, L);
    let tau = BR * (odR + toSun.x) + BM * haze * 1.11 * (odM + toSun.y);
    let att = exp(-tau);
    sumR = sumR + att * dR;
    sumM = sumM + att * dM;
  }
  let mu = dot(dir, L);
  let phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g = 0.76;
  let phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) /
               ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  var col = sumR * BR * phaseR + sumM * BM * haze * phaseM;

  // Rays that end on the ground see it lit by the sun through the same air.
  if (ground > 0.0) {
    let p = o + dir * ground;
    let toSun = towardSun(p, L);
    let sunT = exp(-(BR * toSun.x + BM * haze * 1.11 * toSun.y));
    let viewT = exp(-(BR * odR + BM * haze * 1.11 * odM));
    col = col + vec3<f32>(0.08) * sunT * max(L.y, 0.0) / PI * viewT;
  }
  return vec4<f32>(col, 1.0);
}
`
  );
  var SSR_WGSL = (
    /* wgsl */
    `
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var sceneColor : texture_2d<f32>;
@group(0) @binding(3) var surfaceTex : texture_2d<f32>;
@group(0) @binding(4) var depthTex : texture_depth_2d;

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

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
  // Sideways the fade is kept narrow: a reflection that dissolves a tenth of
  // the way in from the side reads as the water changing, not as the screen ending.
  let edgeXY = min(min(hitUV.x, 1.0 - hitUV.x) * 3.0, min(hitUV.y, 1.0 - hitUV.y));
  let edgeFade = smoothstep(0.0, 0.1, edgeXY);
  // The end is measured along the ray in the world, not across the screen:
  // depth crowds into the last few screen steps of a long ray, so a far
  // mountain hit sits at 0.97 of the screen line but halfway along the ray.
  let dz = O.z - Q.z;
  let hitZ = 1.0 / mix(invZStart, invZEnd, hi);
  let along = select(hi, clamp((O.z - hitZ) / dz, 0.0, 1.0), abs(dz) > 1e-3);
  let endFade = 1.0 - smoothstep(0.8, 1.0, along);

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
  if (d <= 1e-7) { return vec4<f32>(0.0); }
  let surf = textureSampleLevel(surfaceTex, texSampler, in.uv, 0.0);
  let roughness = surf.z;
  let P = viewPosFromUV(in.uv, d, camera.proj);
  // Same story as AO: a reflection ray from a distant, grazing pixel crosses
  // most of the depth buffer per step. Fade to the environment instead.
  let ssrFade = 1.0 - smoothstep(camera.fade.y * 0.4, camera.fade.y, -P.z);
  let weight = clamp(1.0 - roughness * 1.35, 0.0, 1.0) * camera.ssr.x * ssrFade;
  if (weight <= 0.001) { return vec4<f32>(0.0); }

  let N = octDecode(surf.xy);
  let V = normalize(-P);
  let R = normalize(reflect(-V, N));
  let jitter = f32(interleavedIndex(in.clip.xy)) / 16.0;
  let r = traceSSR(P, N, R, jitter);
  let k = r.hit * weight;
  return vec4<f32>(sanitize(r.color) * k, k);
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
@group(0) @binding(8) var skyLut : texture_2d<f32>;
@group(0) @binding(9) var skySampler : sampler;
@group(0) @binding(10) var ssrTex : texture_2d<f32>;

${NOISE_WGSL}
${SKY_LOOKUP_WGSL}

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

/** What a direction sees of the environment: the sky when it is on, the analytic bands otherwise. */
fn environment(dir : vec3<f32>, roughness : f32) -> vec3<f32> {
  if (camera.sky.x < 0.5) { return sampleEnvironment(dir, roughness, camera.ambient.rgb); }
  var d = dir;
  // Below the horizon the ground is lit by the same sky: a dim, sky-tinted floor.
  if (d.y < 0.0) {
    let ground = camera.ambient.rgb * camera.ambient.a * 1.2;
    return mix(skyRadiance(normalize(vec3<f32>(d.x, 0.02, d.z))), ground, smoothstep(0.0, 0.25, -d.y));
  }
  let sharp = skyRadiance(d);
  return mix(sharp, camera.ambient.rgb * 1.15, roughness * roughness);
}

/** Stars and the moon, over whatever the atmosphere gives. */
fn nightSky(dir : vec3<f32>, base : vec3<f32>) -> vec3<f32> {
  if (camera.moon.w <= 0.0 || dir.y < -0.02) { return base; }
  var c = base;
  let n = camera.night.w;
  let above = smoothstep(-0.02, 0.08, dir.y);
  // Stars: one hashed point per cell of a fine grid on the sky, twinkling a little
  if (n > 0.0) {
    let g = dir * 420.0;
    let cell = floor(g);
    let h = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.9965) {
      let centre = cell + 0.5 + (vec3<f32>(fract(h * 17.0), fract(h * 29.0), fract(h * 43.0)) - 0.5) * 0.6;
      let d = length(g - centre);
      let tw = 0.75 + 0.25 * sin(camera.wind.w * 3.0 + h * 900.0);
      let b = (h - 0.9965) / 0.0035;
      let tint = mix(vec3<f32>(0.75, 0.85, 1.0), vec3<f32>(1.0, 0.9, 0.75), fract(h * 7.0));
      c = c + tint * smoothstep(0.55, 0.0, d) * (0.04 + b * b * 0.5) * tw * n * n * above;
    }
    // A faint band of the galaxy across the sky
    let band = exp(-pow(dot(dir, normalize(vec3<f32>(0.3, 0.2, 0.93))) * 3.2, 2.0));
    c = c + vec3<f32>(0.006, 0.0065, 0.009) * band * n * n * above * (0.6 + 0.4 * valueNoise(dir * 9.0));
  }
  // The moon: a lit disc with darker seas; faint by day, bright at night
  let M = camera.moon.xyz;
  let cosR = cos(0.0045 * camera.moon.w);
  let mu = dot(dir, M);
  if (mu > cosR - 0.00002) {
    let right = normalize(cross(M, vec3<f32>(0.0, 1.0, 0.0001)));
    let up = cross(right, M);
    let r = sqrt(max(1.0 - mu * mu, 0.0)) / sqrt(1.0 - cosR * cosR);
    let p = vec2<f32>(dot(dir, right), dot(dir, up)) / sqrt(1.0 - cosR * cosR);
    let edge = smoothstep(1.0, 0.94, r);
    let seas = 0.72 + 0.28 * smoothstep(0.35, 0.65, valueNoise(vec3<f32>(p * 3.1, 1.7)));
    let limb = 0.75 + 0.25 * sqrt(max(1.0 - r * r, 0.0));
    let glow = mix(0.25, 0.9, n);
    c = mix(c, vec3<f32>(0.9, 0.92, 0.96) * seas * limb * glow, edge * smoothstep(-0.01, 0.02, M.y));
  }
  // A soft halo around it at night
  c = c + vec3<f32>(0.5, 0.6, 0.85) * pow(max(mu, 0.0), 900.0) * 0.08 * n;
  return c;
}

/** Clouds in front of a sky pixel. */
fn cloudLayer(dir : vec3<f32>, base : vec3<f32>) -> vec3<f32> {
  if (camera.sky.z <= 0.0 || dir.y < 0.01) { return base; }
  let t = (camera.sky2.y - camera.position.y) / dir.y;
  let p = camera.position.xz + dir.xz * t;
  let d = cloudDensity(p);
  if (d <= 0.002) { return base; }
  let L = camera.sunDir.xyz;
  // Self-shadowing: how much cloud lies a little way toward the sun.
  let d2 = cloudDensity(p + L.xz / max(L.y, 0.12) * 160.0);
  let lit = exp(-d2 * 2.4);
  let mu = dot(dir, L);
  let silver = 1.0 + 2.2 * pow(max(mu, 0.0), 10.0);
  let col = camera.sunColor.rgb * (0.2 + 0.8 * lit) * 0.36 * silver + camera.ambient.rgb * 1.5;
  // Far away, clouds melt into the haze near the horizon.
  let fade = exp(-t * 0.00003) * smoothstep(0.01, 0.1, dir.y);
  return mix(base, col, clamp(d * 1.25, 0.0, 1.0) * fade);
}

/** Share of light lost to fog along a view ray, with optional exponential height falloff. */
fn fogAmount(dir : vec3<f32>, dist : f32) -> f32 {
  let density = camera.params.z;
  if (density <= 0.0) { return 0.0; }
  let fh = camera.extra.y;
  if (fh <= 0.0) { return clamp(1.0 - exp(-dist * density), 0.0, 1.0); }
  let a = density * exp(-fh * (camera.position.y - camera.extra.x));
  let b = fh * dir.y * dist;
  var k = 1.0;
  if (abs(b) > 1e-4) { k = (1.0 - exp(-b)) / b; }
  return clamp(1.0 - exp(-a * dist * k), 0.0, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/** Volumetric fog over whatever is behind it: attenuate, then add the glow. */
fn applyVolume(c : vec3<f32>, uv : vec2<f32>) -> vec3<f32> {
  if (camera.volColor.a < 0.5) { return c; }
  let v = textureSampleLevel(volTex, texSampler, uv, 0.0);
  return c * v.a + v.rgb;
}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let d = loadDepth(in.uv);
  var hdr = textureSampleLevel(sceneColor, texSampler, in.uv, 0.0).rgb;

  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let dirView = normalize(vec3<f32>(ndc.x / camera.proj.x, ndc.y / camera.proj.y, -1.0));
  let viewDirWorld = normalize((camera.invView * vec4<f32>(dirView, 0.0)).xyz);

  if (d <= 1e-7) {
    var sky = sampleEnvironment(viewDirWorld, 0.0, camera.ambient.rgb) * 0.8;
    if (camera.sky.x > 0.5) {
      sky = environment(viewDirWorld, 0.0);
      // The sun itself, darkened toward its rim like the real one. At night the
      // light colour is the moon's, so the disc only shows while the sun lights.
      let mu = dot(viewDirWorld, camera.night.xyz);
      let disc = smoothstep(0.99990, 0.99996, mu) * (1.0 - camera.night.w);
      sky = sky + camera.sunColor.rgb * disc * camera.sky.y * 60.0 * (0.6 + 0.4 * smoothstep(0.99996, 0.99999, mu));
      sky = nightSky(viewDirWorld, sky);
      sky = cloudLayer(viewDirWorld, sky);
    }
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

  let nDotV = max(dot(N, V), 1e-4);
  // Metals tint their reflection with their own albedo \u2014 f0 is the albedo, not
  // white. Getting this wrong is what makes every metal read as chrome.
  let f0 = mix(vec3<f32>(0.04), albedo, metallic);
  // Roughness-aware Fresnel: a rough surface never reaches a full grazing
  // mirror, so the horizon does not blow out.
  let grazing = max(vec3<f32>(1.0 - roughness), f0);
  let fres = f0 + (grazing - f0) * pow(1.0 - nDotV, 5.0);
  // Screen-space reflections come from their own pass, already denoised:
  // colour premultiplied by how sure the hit is, and that certainty in alpha.
  let Rworld = normalize((camera.invView * vec4<f32>(R, 0.0)).xyz);
  var reflected = environment(Rworld, roughness);
  let ssr = textureLoad(ssrTex, pixelOf(in.uv), 0);
  reflected = reflected * (1.0 - clamp(ssr.a, 0.0, 1.0)) + ssr.rgb;

  let fog = fogAmount(viewDirWorld, length(P));
  // Occlusion applies to the environment reflection too: a crevice sees little
  // sky, and unoccluded specular is what makes AO'd scenes look plastic.
  // Mirror-smooth surfaces (still water, glass, polish) reflect in full;
  // everything else keeps a softer share so it doesn't read as plastic.
  let mirror = max(metallic, 1.0 - smoothstep(0.04, 0.15, roughness));
  hdr = hdr + reflected * fres * mix(0.35, 1.0, mirror) * (1.0 - fog) * mix(1.0, ao, 0.7);

  // Aerial perspective: distant surfaces fade toward the sky *in their own
  // view direction*, not toward one flat colour. Fog to a constant is what
  // draws a hard line along the horizon, because the ground is fading to one
  // colour while the sky right above it is another.
  var aerial = sampleEnvironment(viewDirWorld, 0.85, camera.ambient.rgb) * 0.8;
  if (camera.sky.x > 0.5) {
    // Haze takes the colour of the sky just above the horizon in the same
    // direction, sun glow included \u2014 golden toward the sun, blue away from it.
    aerial = skyRadiance(normalize(vec3<f32>(viewDirWorld.x, max(viewDirWorld.y, 0.0) * 0.5 + 0.03, viewDirWorld.z)));
  }
  let fogTarget = mix(camera.fog.rgb, aerial, camera.fog.a);
  hdr = mix(hdr, fogTarget, fog);
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

  // src/render/sky.js
  var RG = 636e4;
  var RT = 642e4;
  var BR = [5802e-9, 13558e-9, 331e-7];
  var BM = 3996e-9;
  var HR = 8e3;
  var HM = 1200;
  function toSphere(oy, dy, r) {
    const b = oy * dy;
    const c = (oy - r) * (oy + r);
    const disc = b * b - c;
    if (disc < 0) return -1;
    return -b + Math.sqrt(disc);
  }
  function hitsGround(oy, dy) {
    if (dy >= 0) return -1;
    const b = oy * dy;
    const c = (oy - RG) * (oy + RG);
    const disc = b * b - c;
    if (disc < 0) return -1;
    return -b - Math.sqrt(disc);
  }
  function towardSun(px, py, pz, L, out) {
    const r = Math.hypot(px, py, pz);
    const mu = (px * L[0] + py * L[1] + pz * L[2]) / r;
    if (hitsGround(r, mu) > 0) {
      out[0] = 1e9;
      out[1] = 1e9;
      return out;
    }
    const len = toSphere(r, mu, RT);
    const steps = 6;
    const ds = len / steps;
    let a = 0, b = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * ds;
      const h = Math.hypot(px + L[0] * t, py + L[1] * t, pz + L[2] * t) - RG;
      a += Math.exp(-h / HR) * ds;
      b += Math.exp(-h / HM) * ds;
    }
    out[0] = a;
    out[1] = b;
    return out;
  }
  var tmp = [0, 0];
  function skyRadiance(d, L, haze = 1, altitude = 0) {
    const oy = RG + Math.min(Math.max(altitude, 0), 4e3) + 50;
    let len = toSphere(oy, d[1], RT);
    const ground = hitsGround(oy, d[1]);
    if (ground > 0) len = ground;
    const steps = 16;
    const ds = len / steps;
    const sumR = [0, 0, 0], sumM = [0, 0, 0];
    let odR = 0, odM = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * ds;
      const px = d[0] * t, py = oy + d[1] * t, pz = d[2] * t;
      const h = Math.hypot(px, py, pz) - RG;
      const dR = Math.exp(-h / HR) * ds;
      const dM = Math.exp(-h / HM) * ds;
      odR += dR;
      odM += dM;
      towardSun(px, py, pz, L, tmp);
      for (let c = 0; c < 3; c++) {
        const tau = BR[c] * (odR + tmp[0]) + BM * haze * 1.11 * (odM + tmp[1]);
        const att = Math.exp(-tau);
        sumR[c] += att * dR;
        sumM[c] += att * dM;
      }
    }
    const mu = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
    const phaseR = 3 / (16 * Math.PI) * (1 + mu * mu);
    const g = 0.76;
    const phaseM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));
    return [0, 1, 2].map((c) => sumR[c] * BR[c] * phaseR + sumM[c] * BM * haze * phaseM);
  }
  function sunTransmittance(L, haze = 1, altitude = 0) {
    const oy = RG + Math.max(altitude, 0) + 50;
    towardSun(0, oy, 0, L, tmp);
    if (tmp[0] >= 1e9) return [0, 0, 0];
    return BR.map((b) => Math.exp(-(b * tmp[0] + BM * haze * 1.11 * tmp[1])));
  }
  function skyAmbient(L, haze = 1, altitude = 0) {
    const sum = [0, 0, 0];
    let wsum = 0;
    for (let i = 0; i < 6; i++) {
      const el = (i + 0.5) / 6 * Math.PI * 0.5;
      for (let j = 0; j < 8; j++) {
        const az = (j + 0.5) / 8 * Math.PI * 2;
        const d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
        const w = Math.sin(el) * Math.cos(el);
        const r = skyRadiance(d, L, haze, altitude);
        sum[0] += r[0] * w;
        sum[1] += r[1] * w;
        sum[2] += r[2] * w;
        wsum += w;
      }
    }
    return sum.map((v) => v / wsum);
  }
  function sunDirection(elevationDeg, azimuthDeg) {
    const el = elevationDeg * Math.PI / 180;
    const az = azimuthDeg * Math.PI / 180;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  }

  // src/render/renderer.js
  var INSTANCE_FLOATS = 32;
  var LIGHT_FLOATS = 12;
  var CAMERA_FLOATS = 264;
  var MAX_LIGHTS = 256;
  var FACE_SLOT_BYTES = 256;
  var CASCADES = 4;
  var HDR_FORMAT = "rgba16float";
  var ALBEDO_FORMAT = "rgba8unorm";
  var MAT_SNAP = 15;
  var TONEMAP_MODES = { linear: 0, reinhard: 1, filmic: 2, aces: 3, agx: 4 };
  var AO_FORMAT = "rgba16float";
  var SKY_W = 256;
  var SKY_H = 128;
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
      this.fogHeight = {
        base: options.fogHeight?.base ?? 0,
        falloff: options.fogHeight?.falloff ?? 0
      };
      this.aerialPerspective = options.aerialPerspective ?? 0.85;
      this.ambient = options.ambient ?? [0.09, 0.11, 0.15];
      this.groundAmbient = options.groundAmbient ?? 0.35;
      this.frustumCulling = options.frustumCulling !== false;
      this.fxaa = options.fxaa !== false;
      this.depthPrepass = options.depthPrepass !== false;
      this.lodBias = options.lodBias ?? 1;
      this.cellSize = options.cellSize ?? 32;
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
      const so = options.sun ?? {};
      this.sun = {
        enabled: so.enabled ?? !!options.sun,
        direction: so.direction ?? sunDirection(so.elevation ?? 40, so.azimuth ?? 35),
        intensity: so.intensity ?? 3,
        color: so.color ?? null,
        shadows: {
          enabled: so.shadows?.enabled !== false,
          size: so.shadows?.size ?? 2048,
          /** How far from the camera the cascades reach, in metres. */
          distance: so.shadows?.distance ?? 220,
          /** 0 = even cascades, 1 = logarithmic. */
          split: so.shadows?.split ?? 0.82,
          pcfRadius: so.shadows?.pcfRadius ?? 1.5,
          normalBias: so.shadows?.normalBias ?? 1.6,
          /** How far behind the view, toward the sun, casters are still drawn. */
          reach: so.shadows?.reach ?? 260,
          /** Casters smaller than this many texels are left out of a cascade. */
          minCasterTexels: so.shadows?.minCasterTexels ?? 1.2
        }
      };
      const ko = options.sky ?? {};
      this.sky = {
        enabled: ko.enabled ?? !!options.sky,
        brightness: ko.brightness ?? 1,
        /** Mie scattering: 1 = clear air, higher = hazier, warmer horizon. */
        haze: ko.haze ?? 1,
        sunDisc: ko.sunDisc ?? 1,
        clouds: ko.clouds ?? 0.45,
        cloudHeight: ko.cloudHeight ?? 1800,
        cloudScale: ko.cloudScale ?? 45e-5,
        cloudSpeed: ko.cloudSpeed ?? 1,
        /** How dark cloud shadows make the ground, 0..1. */
        cloudShadows: ko.cloudShadows ?? 0.35,
        autoAmbient: ko.autoAmbient ?? true,
        ambientStrength: ko.ambientStrength ?? 1
      };
      const mo = options.moon ?? {};
      this.moon = {
        enabled: mo.enabled ?? true,
        intensity: mo.intensity ?? 0.35,
        color: mo.color ?? [0.56, 0.66, 0.9],
        direction: mo.direction ?? null,
        size: mo.size ?? 3,
        stars: mo.stars ?? 1
      };
      this.wind = {
        direction: options.wind?.direction ?? [0.8, 0.6],
        strength: options.wind?.strength ?? 1,
        speed: options.wind?.speed ?? 1
      };
      this.vertexArena = new Arena(device, GPUBufferUsage.VERTEX, 4 << 20, "axion-vertices");
      this.indexArena = new Arena(device, GPUBufferUsage.INDEX, 2 << 20, "axion-indices");
      this.instances = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096 * INSTANCE_FLOATS, "axion-instances");
      this.visibleList = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096, "axion-visible");
      this.shadowModels = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096, "axion-shadow-casters");
      this.sunCasters = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096, "axion-sun-casters");
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
      this.cascadeFaceBuffer = device.createBuffer({
        size: CASCADES * FACE_SLOT_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "axion-cascade-faces"
      });
      this.cascadeFaceData = new Float32Array(CASCADES * FACE_SLOT_BYTES / 4);
      this.meshes = [];
      this.materials = [];
      this._pipelines = /* @__PURE__ */ new Map();
      this._modules = {
        standard: device.createShaderModule({ code: STANDARD_WGSL, label: "axion-standard" }),
        shadow: device.createShaderModule({ code: SHADOW_WGSL, label: "axion-shadow" }),
        ao: device.createShaderModule({ code: AO_WGSL, label: "axion-ao" }),
        aoBlur: device.createShaderModule({ code: AO_BLUR_WGSL, label: "axion-ao-blur" }),
        ssr: device.createShaderModule({ code: SSR_WGSL, label: "axion-ssr" }),
        resolve: device.createShaderModule({ code: RESOLVE_WGSL, label: "axion-resolve" }),
        bloomPrefilter: device.createShaderModule({ code: BLOOM_PREFILTER_WGSL, label: "axion-bloom-prefilter" }),
        bloomDown: device.createShaderModule({ code: BLOOM_DOWN_WGSL, label: "axion-bloom-down" }),
        bloomUp: device.createShaderModule({ code: BLOOM_UP_WGSL, label: "axion-bloom-up" }),
        final: device.createShaderModule({ code: FINAL_WGSL, label: "axion-final" }),
        volume: device.createShaderModule({ code: VOLUME_WGSL, label: "axion-volume" }),
        exposure: device.createShaderModule({ code: EXPOSURE_WGSL, label: "axion-exposure" }),
        dof: device.createShaderModule({ code: DOF_WGSL, label: "axion-dof" }),
        sky: device.createShaderModule({ code: SKY_WGSL, label: "axion-sky" })
      };
      this._buildLayouts();
      this._buildStaticPipelines();
      this._buildShadowTarget();
      this._buildSunShadowTarget();
      this._buildSky();
      this._rebuildFrameBindGroup();
      this._sig = null;
      this._groups = [];
      this._dyn = [];
      this._moved = [];
      this._instTotal = 0;
      this._instBuild = 0;
      this._draws = [];
      this._tmpSlot = new Uint32Array(4096);
      this._tmpLevel = new Uint8Array(4096);
      this._shadowState = [];
      this._frustum = new Float32Array(24);
      this._shadowBatches = [];
      this._shadowSlots = /* @__PURE__ */ new Map();
      this._cascades = [];
      for (let i = 0; i < CASCADES; i++) {
        this._cascades.push({
          viewProj: new Float32Array(16),
          view: new Float32Array(16),
          right: [1, 0, 0],
          up: [0, 1, 0],
          fwd: [0, 0, -1],
          eye: [0, 0, 0],
          radius: 1,
          depth: 1,
          world: 1,
          drawn: -1,
          key: ""
        });
      }
      this._cascadeBatches = [];
      this._frameIndex = 0;
      this._sunState = { key: "", color: [0, 0, 0], ambient: null };
      this.terrain = null;
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
        cpuMs: 0,
        sunCasters: 0,
        cascadesDrawn: 0,
        terrainPatches: 0,
        grassBlades: 0
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
          { binding: 5, visibility: VERT, buffer: { type: "read-only-storage" } },
          { binding: 6, visibility: FRAG, texture: { sampleType: "depth", viewDimension: "2d-array" } },
          { binding: 7, visibility: FRAG, texture: { sampleType: "unfilterable-float" } }
        ]
      });
      this._noHorizon = d.createTexture({
        label: "axion-no-horizon",
        size: [1, 1],
        format: "r32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      d.queue.writeTexture({ texture: this._noHorizon }, new Float32Array([-1e9]), { bytesPerRow: 4 }, [1, 1]);
      this.horizonView = this._noHorizon.createView();
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
          { binding: 0, visibility: VERT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 80 } },
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
          { binding: 5, visibility: FRAG, sampler: { type: "comparison" } },
          { binding: 6, visibility: FRAG, texture: { sampleType: "depth", viewDimension: "2d-array" } },
          { binding: 7, visibility: FRAG, texture: { sampleType: "unfilterable-float" } }
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
        entries: [
          cam,
          samp,
          tex(2),
          tex(3),
          tex(4),
          depthTex(5),
          tex(6),
          tex(7),
          tex(8),
          { binding: 9, visibility: FRAG, sampler: { type: "filtering" } },
          tex(10)
        ]
      });
      this._ssrLayout = d.createBindGroupLayout({
        label: "axion-ssr",
        entries: [cam, samp, tex(2), tex(3), depthTex(4)]
      });
      this._bloomLayout = d.createBindGroupLayout({
        label: "axion-bloom",
        entries: [cam, samp, tex(2)]
      });
      this._finalLayout = d.createBindGroupLayout({
        label: "axion-final",
        entries: [cam, samp, tex(2), tex(3), { binding: 4, visibility: FRAG, buffer: { type: "read-only-storage" } }]
      });
      this._skyLayout = d.createBindGroupLayout({ label: "axion-sky", entries: [cam] });
      this._sampler = d.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        label: "axion-linear"
      });
      this._skySampler = d.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
        label: "axion-sky-sampler"
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
    /** Depth-only caster pipelines: opaque and alpha-tested, point-light or sun flavour. */
    _shadowPipelines(label, depthBias, slopeBias) {
      const m = this._modules;
      const depthStencil = {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
        depthBias,
        depthBiasSlopeScale: slopeBias
      };
      const opaque = this.device.createRenderPipeline({
        label: `axion-${label}`,
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
        depthStencil
      });
      const masked = this.device.createRenderPipeline({
        label: `axion-${label}-mask`,
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
        depthStencil
      });
      return { opaque, masked };
    }
    _buildStaticPipelines() {
      const m = this._modules;
      const point = this._shadowPipelines("shadow", 0, 0);
      this._shadowPipeline = point.opaque;
      this._shadowMaskPipeline = point.masked;
      const sun = this._shadowPipelines("sun-shadow", 1, 1.5);
      this._sunShadowPipeline = sun.opaque;
      this._sunShadowMaskPipeline = sun.masked;
      this._aoPipeline = this._fullscreenPipeline("axion-ao", this._aoLayout, m.ao, AO_FORMAT);
      this._aoBlurPipeline = this._fullscreenPipeline("axion-ao-blur", this._aoBlurLayout, m.aoBlur, AO_FORMAT);
      this._volumePipeline = this._fullscreenPipeline("axion-volume", this._volumeLayout, m.volume, AO_FORMAT);
      this._skyPipeline = this._fullscreenPipeline("axion-sky", this._skyLayout, m.sky, "rgba16float");
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
      this._ssrPipeline = this._fullscreenPipeline("axion-ssr", this._ssrLayout, m.ssr, HDR_FORMAT);
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
      this._volumeBindGroup = null;
      this._shadowState = [];
    }
    _ensureShadowCapacity() {
      const built = this._shadowBuiltFor;
      if (built && built.maxLights === this.shadows.maxLights && built.size === this.shadows.size) return;
      this._buildShadowTarget();
      this._rebuildFrameBindGroup();
      this._rebuildShadowBindGroup();
    }
    /** The sun's four cascades: one depth array, one layer each. A 16px stand-in while the sun is off. */
    _buildSunShadowTarget() {
      const on = this.sun.enabled && this.sun.shadows.enabled;
      const size = on ? this.sun.shadows.size : 16;
      this._sunShadowSize = size;
      retire(this._sunShadowTexture);
      this._sunShadowTexture = this.device.createTexture({
        size: [size, size, CASCADES],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: "axion-sun-shadow"
      });
      this._sunShadowView = this._sunShadowTexture.createView({ dimension: "2d-array" });
      this._sunShadowLayers = [];
      for (let i = 0; i < CASCADES; i++) {
        this._sunShadowLayers.push(this._sunShadowTexture.createView({
          dimension: "2d",
          baseArrayLayer: i,
          arrayLayerCount: 1
        }));
      }
      for (const c of this._cascades ?? []) c.drawn = -1;
      this._boundInstanceBuffer = null;
      this._volumeBindGroup = null;
      this._sunNeedsClear = true;
    }
    _ensureSunShadow() {
      const on = this.sun.enabled && this.sun.shadows.enabled;
      const want = on ? this.sun.shadows.size : 16;
      if (want === this._sunShadowSize) return;
      this._buildSunShadowTarget();
      this._rebuildFrameBindGroup();
    }
    _buildSky() {
      this._skyTexture = this.device.createTexture({
        size: [SKY_W, SKY_H],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: "axion-sky-table"
      });
      this._skyView = this._skyTexture.createView();
      this._skyBindGroup = this.device.createBindGroup({
        layout: this._skyLayout,
        label: "axion-sky",
        entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
      });
      this._skyKey = "";
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
        bounds: geometry.bounds,
        drawDistance: 0
      });
      return id;
    }
    /**
     * A level-of-detail group: a mesh id that stands for several meshes, the
     * right one picked per object each frame by its distance from the camera.
     *
     *   renderer.createLod([{ mesh: a, distance: 0 }, { mesh: b, distance: 40 },
     *                       { mesh: c, distance: 120 }], { drawDistance: 400 })
     *
     * `distance` is where each level starts. Past `drawDistance` the object is
     * not drawn at all; it shrinks away over the last stretch instead of
     * popping. Use the returned id anywhere a mesh id goes.
     */
    createLod(levels, { drawDistance = 0, fade = true, name = `lod${this.meshes.length}` } = {}) {
      const sorted = [...levels].sort((a, b) => a.distance - b.distance);
      const meshes = sorted.map((l) => l.mesh);
      const dist = sorted.map((l) => l.distance);
      const base = this.meshes[meshes.find((m) => m >= 0)];
      const id = this.meshes.length;
      this.meshes.push({
        id,
        name,
        lod: { meshes, dist },
        bounds: base.bounds,
        indexCount: base.indexCount,
        drawDistance,
        fade
      });
      this.invalidate();
      return id;
    }
    /** Stop drawing a mesh (or LOD group) beyond `distance` metres. 0 = always draw. */
    setDrawDistance(mesh2, distance, { fade = true } = {}) {
      const m = this.meshes[mesh2];
      if (!m) return;
      m.drawDistance = distance;
      m.fade = fade;
      this.invalidate();
    }
    /**
     * Materials are small value records, not shader programs. Two materials that
     * differ only in color share a pipeline and therefore cause no state change
     * between their draws; they still form separate instance batches.
     *
     * `noiseScale` above zero switches on procedural surface detail: fBm
     * weathering that modulates albedo, roughness, metallic and the normal,
     * evaluated per pixel in world space. No texture, no UV seams, no memory.
     *
     * `wind` makes the surface sway (0..1, trees ~0.3, grass-like plants ~1);
     * `flutter` adds leaf shiver on top; `translucency` lets sunlight through
     * thin surfaces such as leaves, lit from behind.
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
      wind = 0,
      flutter = 0,
      translucency = 0,
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
        wind,
        flutter,
        translucency,
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
    /** Point the sun by elevation and azimuth in degrees (azimuth 0 = +x, 90 = +z). */
    setSunAngles(elevation, azimuth) {
      this.sun.direction = sunDirection(elevation, azimuth);
    }
    /** Recreated only when a buffer or texture it references was replaced. */
    _rebuildFrameBindGroup() {
      if (this._boundInstanceBuffer === this.instances.buffer && this._boundVisibleBuffer === this.visibleList.buffer && this._boundSunView === this._sunShadowView && this._boundHorizon === this.horizonView) return;
      this._boundHorizon = this.horizonView;
      this._boundInstanceBuffer = this.instances.buffer;
      this._boundVisibleBuffer = this.visibleList.buffer;
      this._boundSunView = this._sunShadowView;
      this.frameBindGroup = this.device.createBindGroup({
        layout: this._frameLayout,
        label: "axion-frame",
        entries: [
          { binding: 0, resource: { buffer: this.cameraBuffer } },
          { binding: 1, resource: { buffer: this.instances.buffer } },
          { binding: 2, resource: { buffer: this.lightBuffer } },
          { binding: 3, resource: this._shadowArrayView },
          { binding: 4, resource: this._shadowSampler },
          { binding: 5, resource: { buffer: this.visibleList.buffer } },
          { binding: 6, resource: this._sunShadowView },
          { binding: 7, resource: this.horizonView }
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
          { binding: 0, resource: { buffer: this.faceBuffer, size: 80 } },
          { binding: 1, resource: { buffer: this.instances.buffer } },
          { binding: 2, resource: { buffer: this.shadowModels.buffer } }
        ]
      });
    }
    _rebuildSunBindGroup() {
      if (this._boundSunCasters === this.sunCasters.buffer && this._boundSunInstances === this.instances.buffer) return;
      this._boundSunCasters = this.sunCasters.buffer;
      this._boundSunInstances = this.instances.buffer;
      this.sunBindGroup = this.device.createBindGroup({
        layout: this._shadowLayout,
        label: "axion-sun-shadow",
        entries: [
          { binding: 0, resource: { buffer: this.cascadeFaceBuffer, size: 80 } },
          { binding: 1, resource: { buffer: this.instances.buffer } },
          { binding: 2, resource: { buffer: this.sunCasters.buffer } }
        ]
      });
    }
    /** Opaque and alpha-tested: the materials the depth prepass can draw. */
    _inPrepass(material) {
      return this.depthPrepass && !material.transparent;
    }
    _depthPipelineFor(material) {
      const key = `depth|${material.doubleSided ? 1 : 0}|${material.masked ? 1 : 0}`;
      let p = this._pipelines.get(key);
      if (p) return p;
      this._depthLayout ??= this.device.createPipelineLayout({
        bindGroupLayouts: [this._frameLayout],
        label: "axion-depth-layout"
      });
      const masked = material.masked;
      p = this.device.createRenderPipeline({
        label: `axion-pipeline-${key}`,
        layout: masked ? this._geometryLayout : this._depthLayout,
        vertex: {
          module: this._modules.standard,
          entryPoint: masked ? "vsDepthMask" : "vsDepth",
          buffers: [{
            arrayStride: VERTEX_STRIDE_BYTES,
            attributes: masked ? [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32x2" }
            ] : [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
          }]
        },
        fragment: masked ? { module: this._modules.standard, entryPoint: "fsDepthMask", targets: [] } : void 0,
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
          targets: this.gbufferTargets(material.transparent)
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
    /** The three G-buffer targets, for any pipeline that draws into the geometry pass. */
    gbufferTargets(transparent = false) {
      return [
        {
          format: HDR_FORMAT,
          blend: transparent ? {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
          } : void 0
        },
        // Transparent surfaces must not overwrite the surface or albedo
        // buffers, or the resolve would shade a reflection for a ghost.
        { format: HDR_FORMAT, writeMask: transparent ? 0 : GPUColorWrite.ALL },
        { format: ALBEDO_FORMAT, writeMask: transparent ? 0 : GPUColorWrite.ALL }
      ];
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
      const ssr = make(HDR_FORMAT, width, height, "axion-ssr");
      const ssrBlur = make(HDR_FORMAT, width, height, "axion-ssr-blur");
      const bloom = [];
      let bw = width >> 1, bh = height >> 1;
      for (let i = 0; i < this.bloom.levels && bw > 8 && bh > 8; i++) {
        bloom.push({ tex: make(HDR_FORMAT, bw, bh, `axion-bloom-${i}`), w: bw, h: bh });
        bw >>= 1;
        bh >>= 1;
      }
      this._targets = {
        all: [color, surface, albedo, depth, hdr, ao, aoBlur, vol, volBlur, ssr, ssrBlur, ...bloom.map((b) => b.tex)],
        color,
        surface,
        albedo,
        depth,
        hdr,
        ao,
        aoBlur,
        vol,
        volBlur,
        ssr,
        ssrBlur,
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
        ssrView: ssr.createView(),
        ssrBlurView: ssrBlur.createView(),
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
        [
          camRes,
          this._sampler,
          t.colorView,
          t.surfaceView,
          t.albedoView,
          t.depthView,
          t.aoBlurView,
          t.volBlurView,
          this._skyView,
          this._skySampler,
          t.ssrBlurView
        ],
        "axion-resolve"
      );
      this.ssrBindGroup = bg(this._ssrLayout, [camRes, this._sampler, t.colorView, t.surfaceView, t.depthView], "axion-ssr");
      this.ssrBlurBindGroup = bg(this._aoBlurLayout, [camRes, this._sampler, t.ssrView, t.depthView], "axion-ssr-blur");
      this.finalBindGroup = bg(
        this._finalLayout,
        [camRes, this._sampler, t.hdrView, t.bloomViews[0] ?? t.hdrView, { buffer: this.exposureBuffer }],
        "axion-final"
      );
      this.bloomFromHdr = bg(this._bloomLayout, [camRes, this._sampler, t.hdrView], "axion-bloom-src");
      this.bloomBindGroups = t.bloomViews.map((v, i) => bg(this._bloomLayout, [camRes, this._sampler, v], `axion-bloom-${i}`));
      this._targetSize = [width, height];
    }
    /* ------------------------------------------------------ instance cache */
    /**
     * Instance data lives on the GPU between frames.
     *
     * Every renderable is written once, sorted by (mesh, material) and then by
     * the square cell of ground it stands on, into one storage buffer, along
     * with a world-space bounding sphere kept on the CPU. After that a frame only
     * rewrites the entities tagged Dynamic, culls whole cells and then the
     * objects in the cells that are partly in view, picks a level of detail for
     * each, and uploads a list of visible slot numbers — four bytes per object.
     * The cache is rebuilt when the set of entities or a material changes;
     * `invalidate()` forces it after writing component data of static entities
     * by hand.
     */
    invalidate() {
      this._sig = null;
    }
    _cacheIsCurrent(world, archetypes) {
      const sig = this._sig;
      const len = 6 + archetypes.length * 3;
      if (!sig || sig.length !== len) return false;
      if (sig[0] !== world._structureVersion || sig[1] !== this.materials.length || sig[2] !== this.meshes.length || sig[3] !== archetypes.length || sig[4] !== this.lodBias || sig[5] !== this.cellSize) return false;
      for (let i = 0; i < archetypes.length; i++) {
        const a = archetypes[i], o = 6 + i * 3;
        if (sig[o] !== a.index || sig[o + 1] !== a.count || sig[o + 2] !== a.version) return false;
      }
      return !this._materialsChanged();
    }
    _storeSignature(world, archetypes) {
      const sig = new Float64Array(6 + archetypes.length * 3);
      sig[0] = world._structureVersion;
      sig[1] = this.materials.length;
      sig[2] = this.meshes.length;
      sig[3] = archetypes.length;
      sig[4] = this.lodBias;
      sig[5] = this.cellSize;
      for (let i = 0; i < archetypes.length; i++) {
        const a = archetypes[i], o = 6 + i * 3;
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
        const vals = this._matVals ??= new Float64Array(MAT_SNAP);
        vals[0] = m.color[0];
        vals[1] = m.color[1];
        vals[2] = m.color[2];
        vals[3] = m.alpha;
        vals[4] = m.emissive;
        vals[5] = m.metallic;
        vals[6] = m.roughness;
        vals[7] = m.noiseScale;
        vals[8] = m.noiseStrength;
        vals[9] = m.bump;
        vals[10] = m.oxide;
        vals[11] = m.castShadow === false ? 0 : 1;
        vals[12] = m.wind;
        vals[13] = m.flutter;
        vals[14] = m.translucency;
        for (let k = 0; k < MAT_SNAP; k++) {
          if (snap[o + k] !== vals[k]) {
            snap[o + k] = vals[k];
            changed = true;
          }
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
      const mesh2 = this.meshes[R[r * 2 + M_MESH]];
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
      inst[o + 23] = mat.wind;
      inst[o + 24] = mat.noiseScale;
      inst[o + 25] = mat.noiseStrength;
      inst[o + 26] = mat.bump;
      inst[o + 27] = mat.oxide;
      inst[o + 28] = mat.translucency;
      inst[o + 29] = mesh2 && mesh2.drawDistance > 0 && mesh2.fade !== false ? mesh2.drawDistance * this.lodBias : 0;
      inst[o + 30] = mat.flutter;
      inst[o + 31] = 0;
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
      let total = 0;
      for (const a of archetypes) total += a.count;
      const eArch = new Uint16Array(total);
      const eRow = new Uint32Array(total);
      const eKey = new Float64Array(total);
      const cs = this.cellSize;
      let n = 0;
      for (let ai = 0; ai < archetypes.length; ai++) {
        const a = archetypes[ai];
        const R = a.columns.get(MeshRef.id);
        const W = a.columns.get(LocalToWorld.id);
        const isDyn = a.has[Dynamic.id] === 1;
        for (let r = 0; r < a.count; r++) {
          const key = R[r * 2 + M_MESH] * matCount + R[r * 2 + M_MATERIAL];
          let cell2 = 65535;
          if (!isDyn) {
            const ix = Math.floor(W[r * 16 + 12] / cs) & 255;
            const iz = Math.floor(W[r * 16 + 14] / cs) & 255;
            cell2 = ix << 8 | iz;
          }
          eArch[n] = ai;
          eRow[n] = r;
          eKey[n] = key * 65536 + cell2;
          n++;
        }
      }
      const order = new Uint32Array(total);
      for (let i = 0; i < total; i++) order[i] = i;
      order.sort((x, y) => eKey[x] - eKey[y]);
      this.instances.ensure(Math.max(1, total) * INSTANCE_FLOATS);
      if (!this._spheres || this._spheres.length < total * 4) {
        this._spheres = new Float32Array(Math.max(1024, total * 4));
      }
      if (this._tmpSlot.length < total) {
        this._tmpSlot = new Uint32Array(total);
        this._tmpLevel = new Uint8Array(total);
      }
      const rowSlots = archetypes.map((a) => a.has[Dynamic.id] === 1 ? new Uint32Array(a.count) : null);
      const groups = [];
      let g = null, cell = null;
      for (let slot = 0; slot < total; slot++) {
        const e = order[slot];
        const k = eKey[e];
        const key = Math.floor(k / 65536);
        const c = k - key * 65536;
        if (!g || g.key !== key) {
          const meshId = key / matCount | 0;
          const material = this.materials[key % matCount] ?? this.materials[0];
          g = {
            key,
            mesh: meshId,
            material: key % matCount,
            matRef: material,
            meshRef: this.meshes[meshId],
            start: slot,
            count: 0,
            castShadow: material.castShadow !== false,
            cells: []
          };
          groups.push(g);
          cell = null;
        }
        if (!cell || cell.code !== c) {
          cell = {
            code: c,
            start: slot,
            count: 0,
            dynamic: c === 65535,
            box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
          };
          g.cells.push(cell);
        }
        const a = archetypes[eArch[e]];
        this._writeInstance(slot, a, eRow[e]);
        const rs = rowSlots[eArch[e]];
        if (rs) rs[eRow[e]] = slot;
        g.count++;
        cell.count++;
        const so = slot * 4, sp = this._spheres, rad = sp[so + 3], bx = cell.box;
        bx[0] = Math.min(bx[0], sp[so] - rad);
        bx[1] = Math.min(bx[1], sp[so + 1] - rad);
        bx[2] = Math.min(bx[2], sp[so + 2] - rad);
        bx[3] = Math.max(bx[3], sp[so] + rad);
        bx[4] = Math.max(bx[4], sp[so + 1] + rad);
        bx[5] = Math.max(bx[5], sp[so + 2] + rad);
      }
      this.instances.flush(total * INSTANCE_FLOATS);
      const dyn = [];
      for (let ai = 0; ai < archetypes.length; ai++) {
        if (rowSlots[ai] && archetypes[ai].count > 0) dyn.push({ a: archetypes[ai], rowSlot: rowSlots[ai] });
      }
      this._groups = groups;
      this._dyn = dyn;
      this._instTotal = total;
      this._instBuild++;
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
    /** LOD level for a distance, and the real mesh drawn for it. */
    _levelFor(mesh2, dist) {
      const lod = mesh2.lod;
      if (!lod) return 0;
      const d = lod.dist, bias = this.lodBias;
      let l = 0;
      while (l + 1 < d.length && dist >= d[l + 1] * bias) l++;
      return l;
    }
    _meshForLevel(g, level) {
      const lod = g.meshRef?.lod;
      if (!lod) return g.mesh;
      return lod.meshes[Math.min(level, lod.meshes.length - 1)];
    }
    /** 0 = outside, 1 = fully inside, 2 = crossing. Planes point inward. */
    _boxInFrustum(bx) {
      const f = this._frustum;
      let inside = true;
      for (let i = 0; i < 6; i++) {
        const o = i * 4, nx = f[o], ny = f[o + 1], nz = f[o + 2], d = f[o + 3];
        const px = nx > 0 ? bx[3] : bx[0], py = ny > 0 ? bx[4] : bx[1], pz = nz > 0 ? bx[5] : bx[2];
        if (nx * px + ny * py + nz * pz + d < 0) return 0;
        const qx = nx > 0 ? bx[0] : bx[3], qy = ny > 0 ? bx[1] : bx[4], qz = nz > 0 ? bx[2] : bx[5];
        if (nx * qx + ny * qy + nz * qz + d < 0) inside = false;
      }
      return inside ? 1 : 2;
    }
    /**
     * Main-view culling and LOD. Fills the visible-slot list, grouped so each
     * (mesh level, material) run is contiguous, and the draw list that walks it.
     */
    _cullInstances(camera) {
      const sp = this._spheres, cull = this.frustumCulling, f = this._frustum;
      const cx = camera.position[0], cy = camera.position[1], cz = camera.position[2];
      const vis = this._u32List("visibleList", this._instTotal);
      const tmp2 = this._tmpSlot, lvl = this._tmpLevel;
      const draws = this._draws;
      draws.length = 0;
      const counts = [0, 0, 0, 0, 0, 0, 0, 0];
      let visible = 0, tris = 0;
      for (const g of this._groups) {
        const mesh2 = g.meshRef;
        if (!mesh2) continue;
        const maxD = mesh2.drawDistance > 0 ? mesh2.drawDistance * this.lodBias : Infinity;
        const maxD2 = maxD * maxD;
        const levels = mesh2.lod ? mesh2.lod.meshes.length : 1;
        for (let l = 0; l < levels; l++) counts[l] = 0;
        let k = 0;
        for (const cell of g.cells) {
          let test = 2;
          if (!cell.dynamic) {
            const bx = cell.box;
            if (maxD < Infinity) {
              const dx = Math.max(bx[0] - cx, 0, cx - bx[3]);
              const dy = Math.max(bx[1] - cy, 0, cy - bx[4]);
              const dz = Math.max(bx[2] - cz, 0, cz - bx[5]);
              if (dx * dx + dy * dy + dz * dz > maxD2) continue;
            }
            test = cull ? this._boxInFrustum(bx) : 1;
            if (test === 0) continue;
          } else if (!cull) {
            test = 1;
          }
          const end = cell.start + cell.count;
          for (let s = cell.start; s < end; s++) {
            const so = s * 4;
            const x = sp[so], y = sp[so + 1], z = sp[so + 2];
            if (test === 2) {
              const r = -sp[so + 3];
              if (f[0] * x + f[1] * y + f[2] * z + f[3] < r) continue;
              if (f[4] * x + f[5] * y + f[6] * z + f[7] < r) continue;
              if (f[8] * x + f[9] * y + f[10] * z + f[11] < r) continue;
              if (f[12] * x + f[13] * y + f[14] * z + f[15] < r) continue;
              if (f[16] * x + f[17] * y + f[18] * z + f[19] < r) continue;
              if (f[20] * x + f[21] * y + f[22] * z + f[23] < r) continue;
            }
            const dx = x - cx, dy = y - cy, dz = z - cz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > maxD2) continue;
            const l = levels > 1 ? this._levelFor(mesh2, Math.sqrt(d2)) : 0;
            tmp2[k] = s;
            lvl[k] = l;
            k++;
            counts[l]++;
          }
        }
        if (k === 0) continue;
        const starts = [0, 0, 0, 0, 0, 0, 0, 0];
        let cursor = visible;
        for (let l = 0; l < levels; l++) {
          starts[l] = cursor;
          cursor += counts[l];
        }
        for (let i = 0; i < k; i++) vis[starts[lvl[i]]++] = tmp2[i];
        let first = visible;
        for (let l = 0; l < levels; l++) {
          const meshId = this._meshForLevel(g, l);
          if (counts[l] > 0 && meshId >= 0) {
            draws.push(meshId, g, first, counts[l]);
            tris += this.meshes[meshId].indexCount / 3 * counts[l];
          }
          first += counts[l];
        }
        visible += k;
      }
      this.visibleList.flush(visible);
      this._rebuildFrameBindGroup();
      return { visible, tris };
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
    /**
     * Gather shadow casters for the lights whose maps need redrawing, as slot
     * numbers into the instance buffer, grouped by (mesh level, material). Casters
     * use one level coarser than the camera sees: a shadow shows the outline,
     * not the detail.
     */
    _buildShadowBatches(lights, camera) {
      const batches = this._shadowBatches;
      batches.length = 0;
      if (lights.length === 0) return 0;
      const sp = this._spheres;
      const cap = this.shadows.maxCasters;
      const list = this._u32List("shadowModels", Math.min(cap, this._instTotal * lights.length));
      const cx = camera.position[0], cy = camera.position[1], cz = camera.position[2];
      let written = 0;
      for (let li = 0; li < lights.length; li++) {
        const L = lights[li];
        L.casters = 0;
        for (const g of this._groups) {
          if (!g.castShadow || written >= cap || !g.meshRef) continue;
          const mesh2 = g.meshRef;
          const levels = mesh2.lod ? mesh2.lod.meshes.length : 1;
          const maxD = mesh2.drawDistance > 0 ? mesh2.drawDistance * this.lodBias : Infinity;
          const runStart = written;
          const counts = [0, 0, 0, 0, 0, 0, 0, 0];
          const tmp2 = this._tmpSlot, lvl = this._tmpLevel;
          let k = 0;
          for (const cell of g.cells) {
            if (!cell.dynamic) {
              const bx = cell.box;
              const dx = Math.max(bx[0] - L.x, 0, L.x - bx[3]);
              const dy = Math.max(bx[1] - L.y, 0, L.y - bx[4]);
              const dz = Math.max(bx[2] - L.z, 0, L.z - bx[5]);
              if (dx * dx + dy * dy + dz * dz > L.range * L.range) continue;
            }
            const end = cell.start + cell.count;
            for (let s = cell.start; s < end && written + k < cap; s++) {
              const so = s * 4;
              const radius = sp[so + 3];
              const dx = sp[so] - L.x, dy = sp[so + 1] - L.y, dz = sp[so + 2] - L.z;
              const distSq = dx * dx + dy * dy + dz * dz;
              if (distSq > (L.range + radius) * (L.range + radius)) continue;
              if (distSq < radius * radius && radius < Math.min(1, 0.1 * L.range)) continue;
              const ex = sp[so] - cx, ey = sp[so + 1] - cy, ez = sp[so + 2] - cz;
              const camDist = Math.sqrt(ex * ex + ey * ey + ez * ez);
              if (camDist > maxD) continue;
              const l = levels > 1 ? Math.min(this._levelFor(mesh2, camDist) + 1, levels - 1) : 0;
              tmp2[k] = s;
              lvl[k] = l;
              k++;
              counts[l]++;
            }
          }
          if (k === 0) continue;
          const starts = [0, 0, 0, 0, 0, 0, 0, 0];
          let cursor = runStart;
          for (let l = 0; l < levels; l++) {
            starts[l] = cursor;
            cursor += counts[l];
          }
          for (let i = 0; i < k; i++) list[starts[lvl[i]]++] = tmp2[i];
          let first = runStart;
          for (let l = 0; l < levels; l++) {
            if (counts[l] > 0) {
              batches.push({ light: L, mesh: this._meshForLevel(g, l), material: g.material, first, count: counts[l] });
            }
            first += counts[l];
          }
          written += k;
          L.casters += k;
        }
      }
      return written;
    }
    /* ----------------------------------------------------------------- sun */
    /**
     * Sun colour, sky brightness and (with autoAmbient) the ambient light, from
     * the atmosphere model. Only recomputed when the sun or the air changes.
     */
    _updateSun(camera) {
      const sun = this.sun, sky = this.sky, moon = this.moon;
      const L = sun.direction;
      const len = Math.hypot(L[0], L[1], L[2]) || 1;
      const sunDir = [L[0] / len, L[1] / len, L[2] / len];
      const moonOn = moon.enabled && sky.enabled;
      let moonDir = [0, -1, 0];
      if (moonOn) {
        const m = moon.direction ?? [-sunDir[0], -sunDir[1] * 0.85 + 0.15, -sunDir[2]];
        const ml = Math.hypot(m[0], m[1], m[2]) || 1;
        moonDir = [m[0] / ml, m[1] / ml, m[2] / ml];
      }
      const t = Math.min(Math.max((0.02 - sunDir[1]) / 0.14, 0), 1);
      const night = moonOn ? t * t * (3 - 2 * t) : 0;
      const byMoon = moonOn && sunDir[1] < -0.02;
      const dir = byMoon ? moonDir : sunDir;
      this._sunDir = dir;
      this._trueSun = sunDir;
      this._moonDir = moonDir;
      this._night = night;
      const alt = Math.round(Math.max(camera.position[1], 0) / 200) * 200;
      const key = `${sunDir.map((v) => v.toFixed(4)).join()},${moonDir.map((v) => v.toFixed(3)).join()},${sky.haze},${alt},${sun.intensity},${sky.brightness},${sky.ambientStrength},${sun.color},${moon.intensity},${moon.color},${moonOn}`;
      const st = this._sunState;
      if (st.key === key) return;
      st.key = key;
      const scatter = 3;
      const mk = moon.intensity * night * Math.min(Math.max(moonDir[1] / 0.15, 0), 1);
      if (byMoon) {
        st.color = moon.color.map((c) => c * mk);
      } else if (sun.color) {
        st.color = sun.color.map((c) => c * sun.intensity);
      } else if (sky.enabled) {
        const T = sunTransmittance(dir, sky.haze, alt);
        st.color = T.map((c) => c * sun.intensity);
      } else {
        st.color = [sun.intensity, sun.intensity, sun.intensity];
      }
      st.skyScale = sun.intensity * scatter * sky.brightness;
      if (sky.enabled) {
        const A = skyAmbient(sunDir, sky.haze, alt);
        st.ambient = A.map((c, i) => (c * st.skyScale + moon.color[i] * (mk * 0.3 + 0.012 * night * moon.intensity)) * sky.ambientStrength);
        const T = st.color;
        const skyLum = st.ambient[0] * 0.2126 + st.ambient[1] * 0.7152 + st.ambient[2] * 0.0722;
        const sunLum = (T[0] * 0.2126 + T[1] * 0.7152 + T[2] * 0.0722) * Math.max(dir[1], 0);
        const bounce = 0.18 * (sunLum / Math.PI + skyLum);
        st.groundScale = Math.min(Math.max(bounce / Math.max(skyLum, 1e-5), 0.15), 1.2);
      }
    }
    /**
     * Fit the four cascades to the view.
     *
     * The near two hug slices of the view frustum and are refitted every frame.
     * The far two are spheres around the camera itself, so turning the head
     * does not move them at all; they are redrawn every second and fourth frame,
     * and not at all while nothing changes. Every cascade is snapped to its own
     * texel grid, which is what keeps shadow edges from crawling as you walk.
     */
    _updateCascades(camera) {
      const sh = this.sun.shadows;
      const size = this._sunShadowSize;
      const near = camera.near, far = Math.max(sh.distance, near + 1);
      const lambda = sh.split;
      const splits = [];
      for (let i = 1; i <= CASCADES; i++) {
        const lg = near * Math.pow(far / near, i / CASCADES);
        const un = near + (far - near) * (i / CASCADES);
        splits.push(lambda * lg + (1 - lambda) * un);
      }
      this._csmSplits = splits;
      const iv = camera.invView;
      const fx = -iv[8], fy = -iv[9], fz = -iv[10];
      const px = iv[12], py = iv[13], pz = iv[14];
      const tanY = Math.tan(camera.fov / 2), tanX = tanY * camera.aspect;
      const k = tanX * tanX + tanY * tanY;
      const L = this._sunDir;
      const f = [-L[0], -L[1], -L[2]];
      const upRef = Math.abs(f[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
      let rx = f[1] * upRef[2] - f[2] * upRef[1];
      let ry = f[2] * upRef[0] - f[0] * upRef[2];
      let rz = f[0] * upRef[1] - f[1] * upRef[0];
      const rl = Math.hypot(rx, ry, rz);
      rx /= rl;
      ry /= rl;
      rz /= rl;
      const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];
      const out = [];
      for (let c = 0; c < CASCADES; c++) {
        const d0 = c === 0 ? near : splits[c - 1], d1 = splits[c];
        let cxw, cyw, czw, r;
        if (c < 2) {
          const zc = Math.min(d1, 0.5 * (d0 + d1) * (1 + k));
          const rFar = Math.sqrt((d1 - zc) * (d1 - zc) + d1 * d1 * k);
          const rNear = Math.sqrt((zc - d0) * (zc - d0) + d0 * d0 * k);
          r = Math.max(rFar, rNear);
          cxw = px + fx * zc;
          cyw = py + fy * zc;
          czw = pz + fz * zc;
        } else {
          r = d1;
          cxw = px;
          cyw = py;
          czw = pz;
        }
        r = Math.ceil(r * 1.04 / 2) * 2;
        const texel = 2 * r / size;
        let lx = cxw * rx + cyw * ry + czw * rz;
        let ly = cxw * ux + cyw * uy + czw * uz;
        const lz = cxw * f[0] + cyw * f[1] + czw * f[2];
        lx = Math.floor(lx / texel) * texel;
        ly = Math.floor(ly / texel) * texel;
        const sx = rx * lx + ux * ly + f[0] * lz;
        const sy = ry * lx + uy * ly + f[1] * lz;
        const sz = rz * lx + uz * ly + f[2] * lz;
        const back = r + sh.reach;
        const eye = [sx - f[0] * back, sy - f[1] * back, sz - f[2] * back];
        out.push({ r, texel, eye, center: [sx, sy, sz], depth: back + r, right: [rx, ry, rz], up: [ux, uy, uz], fwd: f });
      }
      return out;
    }
    /**
     * Casters for the cascades being redrawn this frame, grouped per cascade and
     * (mesh level, material). Objects too small to show in a cascade are left
     * out of it, which removes most small props from the far maps.
     */
    _buildCascadeBatches(fits, redraw, camera) {
      const batches = this._cascadeBatches;
      batches.length = 0;
      if (redraw.length === 0) return 0;
      const sp = this._spheres;
      const list = this._u32List("sunCasters", this._instTotal * redraw.length + 1);
      const cx = camera.position[0], cy = camera.position[1], cz = camera.position[2];
      const tmp2 = this._tmpSlot, lvl = this._tmpLevel;
      const minTexels = this.sun.shadows.minCasterTexels;
      let written = 0;
      for (const c of redraw) {
        const fit = fits[c];
        const R = fit.right, U = fit.up, F = fit.fwd, E = fit.eye;
        const half2 = fit.r, depth = fit.depth;
        const minR = c === 0 ? 0 : fit.texel * minTexels;
        for (const g of this._groups) {
          if (!g.castShadow || !g.meshRef) continue;
          const mesh2 = g.meshRef;
          const levels = mesh2.lod ? mesh2.lod.meshes.length : 1;
          const maxD = mesh2.drawDistance > 0 ? mesh2.drawDistance * this.lodBias : Infinity;
          const counts = [0, 0, 0, 0, 0, 0, 0, 0];
          let k = 0;
          for (const cell of g.cells) {
            if (!cell.dynamic) {
              const bx = cell.box;
              const mx = (bx[0] + bx[3]) * 0.5 - E[0], my = (bx[1] + bx[4]) * 0.5 - E[1], mz = (bx[2] + bx[5]) * 0.5 - E[2];
              const cr = 0.5 * Math.hypot(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]);
              const x = mx * R[0] + my * R[1] + mz * R[2];
              const y = mx * U[0] + my * U[1] + mz * U[2];
              const z = mx * F[0] + my * F[1] + mz * F[2];
              if (Math.abs(x) > half2 + cr || Math.abs(y) > half2 + cr || z < -cr || z > depth + cr) continue;
            }
            const end = cell.start + cell.count;
            for (let s = cell.start; s < end; s++) {
              const so = s * 4;
              const q = sp[so + 3];
              if (q < minR) continue;
              const mx = sp[so] - E[0], my = sp[so + 1] - E[1], mz = sp[so + 2] - E[2];
              const x = mx * R[0] + my * R[1] + mz * R[2];
              if (Math.abs(x) > half2 + q) continue;
              const y = mx * U[0] + my * U[1] + mz * U[2];
              if (Math.abs(y) > half2 + q) continue;
              const z = mx * F[0] + my * F[1] + mz * F[2];
              if (z < -q || z > depth + q) continue;
              const ex = sp[so] - cx, ey = sp[so + 1] - cy, ez = sp[so + 2] - cz;
              const camDist = Math.sqrt(ex * ex + ey * ey + ez * ez);
              if (camDist > maxD) continue;
              const l = levels > 1 ? Math.min(this._levelFor(mesh2, camDist) + (c > 0 ? 1 : 0), levels - 1) : 0;
              tmp2[k] = s;
              lvl[k] = l;
              k++;
              counts[l]++;
            }
          }
          if (k === 0) continue;
          const starts = [0, 0, 0, 0, 0, 0, 0, 0];
          let cursor = written;
          for (let l = 0; l < levels; l++) {
            starts[l] = cursor;
            cursor += counts[l];
          }
          for (let i = 0; i < k; i++) list[starts[lvl[i]]++] = tmp2[i];
          let first = written;
          for (let l = 0; l < levels; l++) {
            if (counts[l] > 0) {
              batches.push({ cascade: c, mesh: this._meshForLevel(g, l), matRef: g.matRef, first, count: counts[l] });
            }
            first += counts[l];
          }
          written += k;
        }
      }
      if (written > 0) this.sunCasters.flush(written);
      this._rebuildSunBindGroup();
      return written;
    }
    /* ------------------------------------------------------------- frame  */
    render(world, camera, time = 0) {
      const t0 = performance.now();
      sweepRetired();
      this._ensureTargets();
      this._ensureShadowCapacity();
      this._ensureSunShadow();
      const { width, height } = this.canvas;
      const t = this._targets;
      this._frameIndex++;
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
      const shadowCasters = this._buildShadowBatches(redraw, camera);
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
      const sunOn = this.sun.enabled;
      const skyOn = this.sky.enabled;
      if (sunOn || skyOn) this._updateSun(camera);
      const sunShadowsOn = sunOn && this.sun.shadows.enabled;
      const cascadeRedraw = [];
      let fits = null;
      if (sunShadowsOn) {
        fits = this._updateCascades(camera);
        const terrainVersion = this.terrain ? this.terrain.version : 0;
        const f = this._frameIndex;
        for (let c = 0; c < CASCADES; c++) {
          const fit = fits[c], st = this._cascades[c];
          const key = `${fit.center[0].toFixed(3)},${fit.center[1].toFixed(3)},${fit.center[2].toFixed(3)},${fit.r},${this._sunState.key},${this._instBuild},${terrainVersion},${this._moved.length > 0 ? f : 0}`;
          const scheduled = c < 2 || (c === 2 ? (f & 1) === 0 : (f & 3) === 1);
          const forced = st.drawn < 0 || st.sunKey !== this._sunState.key || st.build !== this._instBuild || st.terrain !== terrainVersion;
          if (scheduled && key !== st.key || forced) {
            cascadeRedraw.push(c);
            st.key = key;
            st.sunKey = this._sunState.key;
            st.build = this._instBuild;
            st.terrain = terrainVersion;
            st.drawn = f;
            st.world = 2 * fit.r;
            const view = st.view;
            const up = fit.up;
            m4lookAt(view, 0, fit.eye, 0, fit.center, 0, up, 0);
            const proj = this._orthoTmp ??= new Float32Array(16);
            m4ortho(proj, 0, -fit.r, fit.r, -fit.r, fit.r, 0, fit.depth);
            m4mul(st.viewProj, 0, proj, 0, view, 0);
            this.cascadeFaceData.set(st.viewProj, c * FACE_SLOT_BYTES / 4);
            this.cascadeFaceData[c * FACE_SLOT_BYTES / 4 + 16] = camera.position[0];
            this.cascadeFaceData[c * FACE_SLOT_BYTES / 4 + 17] = camera.position[1];
            this.cascadeFaceData[c * FACE_SLOT_BYTES / 4 + 18] = camera.position[2];
          }
        }
        if (cascadeRedraw.length > 0) {
          this.device.queue.writeBuffer(this.cascadeFaceBuffer, 0, this.cascadeFaceData);
        }
      }
      const sunCasters = sunShadowsOn ? this._buildCascadeBatches(fits, cascadeRedraw, camera) : 0;
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
      if (skyOn && this.sky.autoAmbient && this._sunState.ambient) {
        cd.set(this._sunState.ambient, 56);
        cd[59] = this._sunState.groundScale;
      } else {
        cd.set(this.ambient, 56);
        cd[59] = this.groundAmbient;
      }
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
      const sky = this.sky;
      cd[128] = skyOn ? 1 : 0;
      cd[129] = sky.sunDisc;
      cd[130] = skyOn ? sky.clouds : 0;
      cd[131] = time * 4e-3 * sky.cloudSpeed;
      const sd = this._sunDir ?? [0, 1, 0];
      cd[132] = sd[0];
      cd[133] = sd[1];
      cd[134] = sd[2];
      cd[135] = sunOn ? 1 : 0;
      const sc = this._sunState.color;
      cd[136] = sc[0];
      cd[137] = sc[1];
      cd[138] = sc[2];
      cd[139] = sunShadowsOn ? 1 : 0;
      const splits = this._csmSplits ?? [1, 2, 3, 4];
      cd[140] = splits[0];
      cd[141] = splits[1];
      cd[142] = splits[2];
      cd[143] = splits[3];
      cd[144] = this._sunShadowSize;
      cd[145] = this.sun.shadows.pcfRadius;
      cd[146] = this.sun.shadows.normalBias;
      cd[147] = 0;
      for (let c = 0; c < CASCADES; c++) {
        cd.set(this._cascades[c].viewProj, 148 + c * 16);
        cd[236 + c] = this._cascades[c].world;
      }
      const wd = this.wind.direction, wl = Math.hypot(wd[0], wd[1]) || 1;
      cd[212] = wd[0] / wl;
      cd[213] = wd[1] / wl;
      cd[214] = this.wind.strength;
      cd[215] = time * this.wind.speed;
      cd[216] = this._sunState.skyScale ?? 1;
      cd[217] = sky.cloudHeight;
      cd[218] = sky.cloudScale;
      cd[219] = sky.haze;
      const tu = this.terrain ? this.terrain.uniforms() : null;
      for (let i = 0; i < 12; i++) cd[220 + i] = tu ? tu[i] : 0;
      cd[232] = this.fogHeight.base;
      cd[233] = this.fogHeight.falloff;
      cd[234] = skyOn ? sky.cloudShadows : 0;
      cd[235] = this.terrain ? this.terrain.horizonBlend() : 1;
      const ts = this._trueSun ?? sd, md = this._moonDir ?? [0, -1, 0];
      cd[256] = ts[0];
      cd[257] = ts[1];
      cd[258] = ts[2];
      cd[259] = this._night ?? 0;
      cd[260] = md[0];
      cd[261] = md[1];
      cd[262] = md[2];
      cd[263] = skyOn && this.moon.enabled ? this.moon.size : 0;
      if (this._prevViewProj) cd.set(this._prevViewProj, 240);
      else cd.set(camera.viewProj, 240);
      (this._prevViewProj ??= new Float32Array(16)).set(camera.viewProj);
      this.device.queue.writeBuffer(this.cameraBuffer, 0, cd);
      if (this.frustumCulling) frustumFromMatrix(this._frustum, 0, camera.viewProj, 0);
      const { visible, tris: objectTris } = this._cullInstances(camera);
      const culled = this._instTotal - visible;
      const drawList = this._draws;
      if (this.terrain) {
        this.terrain.frame({
          camera,
          frustum: this.frustumCulling ? this._frustum : null,
          cascades: sunShadowsOn ? fits : null,
          cascadeRedraw
        });
      }
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
      for (const c of cascadeRedraw) {
        const pass = enc.beginRenderPass({
          label: `axion-sun-shadow-${c}`,
          colorAttachments: [],
          depthStencilAttachment: {
            view: this._sunShadowLayers[c],
            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "store"
          }
        });
        pass.setBindGroup(0, this.sunBindGroup, [c * FACE_SLOT_BYTES]);
        pass.setVertexBuffer(0, this.vertexArena.buffer);
        pass.setIndexBuffer(this.indexArena.buffer, "uint32");
        let bound = null;
        for (const b of this._cascadeBatches) {
          if (b.cascade !== c) continue;
          const m = this.meshes[b.mesh];
          if (!m) continue;
          const pipeline = b.matRef.masked ? this._sunShadowMaskPipeline : this._sunShadowPipeline;
          if (pipeline !== bound) {
            pass.setPipeline(pipeline);
            bound = pipeline;
          }
          if (b.matRef.masked) pass.setBindGroup(1, b.matRef.bindGroup);
          pass.drawIndexed(m.indexCount, b.count, m.firstIndex, m.baseVertex, b.first);
          shadowDraws++;
        }
        if (this.terrain) shadowDraws += this.terrain.drawShadow(pass, c);
        pass.end();
      }
      if (skyOn && this._skyKey !== this._sunState.key) {
        this._skyKey = this._sunState.key;
        const pass = enc.beginRenderPass({
          label: "axion-sky",
          colorAttachments: [{ view: this._skyView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
        });
        pass.setPipeline(this._skyPipeline);
        pass.setBindGroup(0, this._skyBindGroup);
        pass.draw(3);
        pass.end();
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
        for (let i = 0; i < drawList.length; i += 4) {
          const g = drawList[i + 1];
          if (!this._inPrepass(g.matRef)) continue;
          const m = this.meshes[drawList[i]];
          if (!m) continue;
          const p = this._depthPipelineFor(g.matRef);
          if (p !== bound) {
            dp.setPipeline(p);
            bound = p;
          }
          if (g.matRef.masked) dp.setBindGroup(1, g.matRef.bindGroup);
          dp.drawIndexed(m.indexCount, drawList[i + 3], m.firstIndex, m.baseVertex, drawList[i + 2]);
          prepassDraws++;
        }
        if (this.terrain) prepassDraws += this.terrain.drawDepth(dp);
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
      let draws = 0, batches = 0, currentPipeline = null, currentMaterial = null;
      let extraTris = 0;
      for (let phase = 0; phase < 2; phase++) {
        if (phase === 1 && this.terrain) {
          const td = this.terrain.drawSurface(geo);
          draws += td.draws;
          extraTris += td.tris;
          geo.setVertexBuffer(0, this.vertexArena.buffer);
          geo.setIndexBuffer(this.indexArena.buffer, "uint32");
          geo.setBindGroup(0, this.frameBindGroup);
          currentPipeline = null;
          currentMaterial = null;
        }
        for (let i = 0; i < drawList.length; i += 4) {
          const g = drawList[i + 1];
          const material = g.matRef;
          if ((material.transparent ? 1 : 0) !== phase) continue;
          const m = this.meshes[drawList[i]];
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
          geo.drawIndexed(m.indexCount, drawList[i + 3], m.firstIndex, m.baseVertex, drawList[i + 2]);
          draws++;
          batches++;
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
        if (!this._volumeBindGroup || this._volumeShadowView !== this._shadowArrayView || this._volumeSunView !== this._sunShadowView || this._volumeHorizon !== this.horizonView) {
          this._volumeHorizon = this.horizonView;
          this._volumeShadowView = this._shadowArrayView;
          this._volumeSunView = this._sunShadowView;
          this._volumeBindGroup = this.device.createBindGroup({
            layout: this._volumeLayout,
            label: "axion-volume",
            entries: [
              { binding: 0, resource: { buffer: this.cameraBuffer } },
              { binding: 1, resource: this._sampler },
              { binding: 2, resource: t.depthView },
              { binding: 3, resource: { buffer: this.lightBuffer } },
              { binding: 4, resource: this._shadowArrayView },
              { binding: 5, resource: this._shadowSampler },
              { binding: 6, resource: this._sunShadowView },
              { binding: 7, resource: this.horizonView }
            ]
          });
        }
        fullscreen("axion-volume", t.volView, this._volumePipeline, this._volumeBindGroup);
        fullscreen("axion-volume-blur", t.volBlurView, this._aoBlurPipeline, this.volBlurBindGroup);
        volumePasses = 2;
      }
      let ssrPasses = 0;
      if (this.ssr.intensity > 0) {
        fullscreen("axion-ssr", t.ssrView, this._ssrPipeline, this.ssrBindGroup);
        fullscreen("axion-ssr-blur", t.ssrBlurView, this._aoBlurPipeline, this.ssrBlurBindGroup);
        t.ssrIdle = false;
        ssrPasses = 2;
      } else if (!t.ssrIdle) {
        enc.beginRenderPass({
          label: "axion-ssr-off",
          colorAttachments: [{ view: t.ssrBlurView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        }).end();
        t.ssrIdle = true;
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
      this.stats.drawCalls = draws + prepassDraws + shadowDraws + 1 + aoPasses + volumePasses + ssrPasses + dofPasses + bloomPasses + 1;
      this.stats.batches = batches;
      this.stats.instances = visible;
      this.stats.culled = culled;
      this.stats.triangles = objectTris + extraTris;
      this.stats.shadowDraws = shadowDraws;
      this.stats.shadowCasters = shadowCasters;
      this.stats.shadowLights = shadowLights.filter((l) => l.casters > 0).length;
      this.stats.shadowRedraws = redraw.length;
      this.stats.sunCasters = sunCasters;
      this.stats.cascadesDrawn = cascadeRedraw.length;
      this.stats.terrainPatches = this.terrain ? this.terrain.stats.patches : 0;
      this.stats.grassBlades = this.terrain ? this.terrain.stats.blades : 0;
      this.stats.cpuMs = performance.now() - t0;
    }
    destroy() {
      this.vertexArena.destroy();
      this.indexArena.destroy();
      this.instances.destroy();
      this.shadowModels.destroy();
      this.visibleList.destroy();
      this.sunCasters.destroy();
      this.cameraBuffer.destroy();
      this.lightBuffer.destroy();
      this.faceBuffer.destroy();
      this.cascadeFaceBuffer.destroy();
      this.exposureBuffer.destroy();
      this._shadowTexture?.destroy();
      this._sunShadowTexture?.destroy();
      this._skyTexture?.destroy();
      this.terrain?.destroy();
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

  // src/render/terrain-shaders.js
  var TERRAIN_GROUP = (
    /* wgsl */
    `
struct TerrainParams {
  info   : vec4<f32>,               // x = origin x, y = origin z, z = size, w = height samples per side
  info2  : vec4<f32>,               // x = water level, y = water on, z = LOD range factor, w = morph start (fraction)
  info3  : vec4<f32>,               // x = grid quads per patch side, y = skirt depth, z = layer count, w = time
  rock   : vec4<f32>,               // x = rock layer, y = slope start, z = slope end, w = rock strength
  shore  : vec4<f32>,               // x = shore layer, y = shore height above water, z = underwater darkening, w = unused
  varia  : vec4<f32>,               // x = colour variation, y = variation scale, z = far blend start, w = far blend end
  water  : vec4<f32>,               // rgb = deep colour, a = clarity (per metre)
  water2 : vec4<f32>,               // rgb = shallow colour, a = wave strength
  grassA : vec4<f32>,               // rgb = base colour, a = flower share
  grassB : vec4<f32>,               // rgb = tip colour, a = dry patches
  grassC : vec4<f32>,               // x = blades per tile, y = forest density, z = max slope, w = sway
  layers : array<vec4<f32>, 8>,     // x = repeats per metre, y = roughness, z = normal strength, w = triplanar
  tint   : array<vec4<f32>, 8>,     // rgb = tint, a = unused
  snow   : vec4<f32>,               // x = snow line start, y = full snow, z = steepest slope that holds snow, w = amount
};

@group(1) @binding(0) var<storage, read> patches : array<vec4<f32>>;
@group(1) @binding(1) var heightTex : texture_2d<f32>;
@group(1) @binding(2) var normalTex : texture_2d<f32>;
@group(1) @binding(3) var splatTex : texture_2d<f32>;
@group(1) @binding(4) var albedoArr : texture_2d_array<f32>;
@group(1) @binding(5) var normalArr : texture_2d_array<f32>;
@group(1) @binding(6) var repeatSampler : sampler;
@group(1) @binding(7) var clampSampler : sampler;
@group(1) @binding(8) var<uniform> tp : TerrainParams;

/** Bilinear height, exactly as heightAt() computes it on the CPU. */
fn heightAt(xz : vec2<f32>) -> f32 {
  let n = tp.info.w;
  let g = (xz - tp.info.xy) / tp.info.z * (n - 1.0);
  let p = clamp(g, vec2<f32>(0.0), vec2<f32>(n - 1.0001));
  let i = vec2<i32>(floor(p));
  let f = p - floor(p);
  let h00 = textureLoad(heightTex, i, 0).r;
  let h10 = textureLoad(heightTex, i + vec2<i32>(1, 0), 0).r;
  let h01 = textureLoad(heightTex, i + vec2<i32>(0, 1), 0).r;
  let h11 = textureLoad(heightTex, i + vec2<i32>(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

fn terrainUV(xz : vec2<f32>) -> vec2<f32> {
  let n = tp.info.w;
  // Texel centres line up with height samples.
  return ((xz - tp.info.xy) / tp.info.z * (n - 1.0) + 0.5) / n;
}

/**
 * Where a grid vertex of one patch lands. Odd vertices slide onto their even
 * neighbours as the patch nears the distance where the next coarser level
 * takes over, so the switch happens with no visible pop (CDLOD geomorphing).
 */
fn patchVertex(p : vec4<f32>, grid : vec2<f32>) -> vec2<f32> {
  let G = tp.info3.x;
  var xz = p.xy + grid / G * p.z;
  let range = p.z * tp.info2.z;
  let h = heightAt(xz);
  let d = distance(vec3<f32>(xz.x, h, xz.y), camera.position.xyz);
  let start = range * tp.info2.w;
  let k = clamp((d - start) / max(range - start, 1e-3), 0.0, 1.0);
  let odd = fract(grid * 0.5) * 2.0;
  xz = xz - odd / G * p.z * k;
  return xz;
}
`
  );
  var TERRAIN_WGSL = (
    /* wgsl */
    `
${COMMON}
${CUBE_WGSL}
${NOISE_WGSL}
${SCENE_WGSL}
${LIGHTING_WGSL}
${TERRAIN_GROUP}

struct TOut {
  @invariant @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
};

fn terrainPosition(ii : u32, grid : vec3<f32>) -> vec3<f32> {
  let p = patches[ii];
  let xz = patchVertex(p, grid.xy);
  var h = heightAt(xz);
  if (grid.z > 0.5) { h = h - (tp.info3.y + p.z * 0.02); }   // skirt hides cracks between levels
  return vec3<f32>(xz.x, h, xz.y);
}

@vertex
fn vs(@builtin(instance_index) ii : u32, @location(0) grid : vec3<f32>) -> TOut {
  let w = terrainPosition(ii, grid);
  var o : TOut;
  o.clip = camera.viewProj * vec4<f32>(w, 1.0);
  o.world = w;
  return o;
}

@vertex
fn vsDepth(@builtin(instance_index) ii : u32, @location(0) grid : vec3<f32>) -> @invariant @builtin(position) vec4<f32> {
  return camera.viewProj * vec4<f32>(terrainPosition(ii, grid), 1.0);
}

struct LayerSample {
  albedo : vec3<f32>,
  normal : vec2<f32>,     // tangent-space xy, x along world +x, y along world +z
};

/** One layer, sampled with explicit gradients so it can be skipped when its weight is zero. */
fn sampleLayer(i : i32, world : vec3<f32>, N : vec3<f32>, dx : vec3<f32>, dy : vec3<f32>, far : f32, mean : f32) -> LayerSample {
  let s = tp.layers[i].x;
  var out : LayerSample;
  if (tp.layers[i].w > 0.5) {
    // Triplanar for rock: steep faces take their texture from the side, not stretched from above.
    var bw = pow(abs(N), vec3<f32>(4.0));
    bw = bw / (bw.x + bw.y + bw.z);
    let a = textureSampleGrad(albedoArr, repeatSampler, world.zy * s, i, dx.zy * s, dy.zy * s);
    let b = textureSampleGrad(albedoArr, repeatSampler, world.xz * s, i, dx.xz * s, dy.xz * s);
    let c = textureSampleGrad(albedoArr, repeatSampler, world.xy * s, i, dx.xy * s, dy.xy * s);
    out.albedo = (a.rgb * bw.x + b.rgb * bw.y + c.rgb * bw.z);
    if (far > 0.0) {
      // The same break-up of the repeat as flat layers get, from the side too.
      let k = 0.23;
      let a2 = textureSampleGrad(albedoArr, repeatSampler, world.zy * s * k + vec2<f32>(0.31, 0.7), i, dx.zy * s * k, dy.zy * s * k);
      let b2 = textureSampleGrad(albedoArr, repeatSampler, world.xz * s * k + vec2<f32>(0.53, 0.2), i, dx.xz * s * k, dy.xz * s * k);
      let c2 = textureSampleGrad(albedoArr, repeatSampler, world.xy * s * k + vec2<f32>(0.11, 0.4), i, dx.xy * s * k, dy.xy * s * k);
      let col2 = a2.rgb * bw.x + b2.rgb * bw.y + c2.rgb * bw.z;
      out.albedo = mix(out.albedo, (out.albedo + col2) * 0.5, far);
    }
    let nb = textureSampleGrad(normalArr, repeatSampler, world.xz * s, i, dx.xz * s, dy.xz * s).xy * 2.0 - 1.0;
    out.normal = nb * bw.y;
  } else {
    let uv = world.xz * s;
    var col = textureSampleGrad(albedoArr, repeatSampler, uv, i, dx.xz * s, dy.xz * s).rgb;
    var nrm = textureSampleGrad(normalArr, repeatSampler, uv, i, dx.xz * s, dy.xz * s).xy * 2.0 - 1.0;
    if (far > 0.0) {
      // Far away the same texture at a quarter of the frequency hides the repeat.
      let uv2 = uv * 0.27 + vec2<f32>(0.37, 0.61);
      let col2 = textureSampleGrad(albedoArr, repeatSampler, uv2, i, dx.xz * s * 0.27, dy.xz * s * 0.27).rgb;
      col = mix(col, (col + col2) * 0.5, far);
      nrm = nrm * (1.0 - far * 0.5);
    }
    out.albedo = col;
    out.normal = nrm;
  }
  // Far off, any texture repeat lines up into a grid a few pixels wide; the
  // layer's average colour (its last mip) says everything that's left to say.
  if (mean > 0.0) {
    let avg = textureSampleLevel(albedoArr, repeatSampler, vec2<f32>(0.5), i, 16.0).rgb;
    out.albedo = mix(out.albedo, avg, mean);
    out.normal = out.normal * (1.0 - mean * 0.8);
  }
  out.albedo = out.albedo * tp.tint[i].rgb;
  out.normal = out.normal * tp.layers[i].z;
  return out;
}

@fragment
fn fs(in : TOut) -> GBuffer {
  let world = in.world;
  let dx = dpdx(world);
  let dy = dpdy(world);
  let uvT = terrainUV(world.xz);
  let geomN = normalize(textureSample(normalTex, clampSampler, uvT).xyz * 2.0 - 1.0);
  let splat = textureSampleLevel(splatTex, clampSampler, uvT, 0.0);
  let count = i32(tp.info3.z);

  // Layer weights: splat channels drive layers 1..4, layer 0 takes the rest,
  // then slope hands steep ground to rock and height hands the shore to sand.
  var w = array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  w[1] = splat.r; w[2] = splat.g; w[3] = splat.b; w[4] = splat.a;
  w[0] = max(1.0 - (splat.r + splat.g + splat.b + splat.a), 0.0);

  let wet = tp.info2.y > 0.5;
  let above = world.y - tp.info2.x;
  if (wet && tp.shore.x >= 0.0) {
    let sand = 1.0 - smoothstep(tp.shore.y * 0.4, tp.shore.y, above);
    let si = i32(tp.shore.x);
    for (var i = 0; i < 8; i = i + 1) { w[i] = w[i] * (1.0 - sand); }
    w[si] = w[si] + sand;
  }
  if (tp.rock.x >= 0.0) {
    let slope = 1.0 - geomN.y;
    // A little noise on the threshold breaks the contour line along the slope.
    let jitter = (noise2(world.xz * 0.11) - 0.5) * 0.08;
    let rw = smoothstep(tp.rock.y + jitter, tp.rock.z + jitter, slope) * tp.rock.w;
    let ri = i32(tp.rock.x);
    for (var i = 0; i < 8; i = i + 1) { w[i] = w[i] * (1.0 - rw); }
    w[ri] = w[ri] + rw;
  }

  let dist = distance(world, camera.position.xyz);
  let far = smoothstep(tp.varia.z, tp.varia.w, dist);
  let mean = smoothstep(tp.varia.w * 1.6, tp.varia.w * 5.0, dist) * 0.85;

  var albedo = vec3<f32>(0.0);
  var nt = vec2<f32>(0.0);
  var rough = 0.0;
  var total = 0.0;
  for (var i = 0; i < count; i = i + 1) {
    if (w[i] < 0.02) { continue; }
    let s = sampleLayer(i, world, geomN, dx, dy, far, mean);
    // Height-aware blend: brighter texels (stones, tufts) poke through first.
    let lum = dot(s.albedo, vec3<f32>(0.3, 0.59, 0.11));
    let bw = w[i] * (0.35 + lum * 1.3);
    albedo = albedo + s.albedo * bw;
    nt = nt + s.normal * bw;
    rough = rough + tp.layers[i].y * bw;
    total = total + bw;
  }
  albedo = albedo / max(total, 1e-4);
  nt = nt / max(total, 1e-4);
  rough = rough / max(total, 1e-4);

  // Large-scale colour variation so the ground is never one flat carpet.
  let v = fbm2(world.xz * tp.varia.y, 3);
  albedo = albedo * (1.0 + (v - 0.5) * tp.varia.x);
  if (wet && above < 0.0) {
    albedo = albedo * mix(1.0, 0.45, clamp(-above * tp.shore.z, 0.0, 1.0));
  }

  // Snow on high ground, only where it is flat enough to settle; the line
  // wanders with noise so it never follows a contour exactly.
  if (tp.snow.w > 0.0) {
    let wander = (noise2(world.xz * 0.013) - 0.5) * 0.9 + (noise2(world.xz * 0.09) - 0.5) * 0.25;
    let line = smoothstep(tp.snow.x, tp.snow.y, world.y + wander * (tp.snow.y - tp.snow.x));
    let settle = 1.0 - smoothstep(tp.snow.z * 0.6, tp.snow.z, 1.0 - geomN.y);
    let sw = clamp(line * settle * tp.snow.w, 0.0, 1.0);
    albedo = mix(albedo, vec3<f32>(0.8, 0.83, 0.88), sw);
    rough = mix(rough, 0.6, sw);
    nt = nt * (1.0 - sw * 0.75);
  }

  // Detail normal in a frame that follows the terrain surface.
  let T = normalize(vec3<f32>(1.0, 0.0, 0.0) - geomN * geomN.x);
  let B = normalize(cross(T, geomN));
  let N = normalize(geomN + T * nt.x + B * -nt.y);

  var s : Surface;
  s.P = world;
  s.N = N;
  s.geomN = geomN;
  s.V = normalize(camera.position.xyz - world);
  s.albedo = albedo;
  s.roughness = clamp(rough, 0.3, 1.0);
  s.metallic = 0.0;
  s.translucency = 0.0;
  let Lo = shadeDirect(s, in.clip.xy);
  return gbuffer(Lo, 1.0, N, albedo, s.roughness, 0.0);
}

/* ---------------------------------------------------------------- water */

struct WOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
};

@vertex
fn vsWater(@builtin(instance_index) ii : u32, @location(0) grid : vec3<f32>) -> WOut {
  let p = patches[ii];
  let G = tp.info3.x;
  let xz = p.xy + grid.xy / G * p.z;
  var o : WOut;
  let w = vec3<f32>(xz.x, tp.info2.x, xz.y);
  o.clip = camera.viewProj * vec4<f32>(w, 1.0);
  o.world = w;
  return o;
}

/** Slope of a few crossing wave trains, for the water normal. */
fn waveSlope(xz : vec2<f32>, t : f32) -> vec2<f32> {
  var g = vec2<f32>(0.0);
  let dirs = array<vec2<f32>, 5>(
    vec2<f32>(0.8, 0.6), vec2<f32>(-0.45, 0.89), vec2<f32>(0.97, -0.24),
    vec2<f32>(-0.7, -0.71), vec2<f32>(0.2, 0.98));
  let lens = array<f32, 5>(4.1, 2.3, 1.37, 0.83, 0.51);
  for (var i = 0; i < 5; i = i + 1) {
    let k = 6.2831853 / lens[i];
    let c = sqrt(9.81 / k);
    let ph = dot(dirs[i], xz) * k - c * k * t * 0.35;
    let a = 0.012 * lens[i];
    g = g + dirs[i] * (a * k * cos(ph));
  }
  // Fine noise on top so the surface is never regular.
  let e = 0.15;
  let n0 = noise2(xz * 1.3 + vec2<f32>(t * 0.21, t * 0.17));
  let nx = noise2((xz + vec2<f32>(e, 0.0)) * 1.3 + vec2<f32>(t * 0.21, t * 0.17));
  let nz = noise2((xz + vec2<f32>(0.0, e)) * 1.3 + vec2<f32>(t * 0.21, t * 0.17));
  g = g + vec2<f32>(nx - n0, nz - n0) / e * 0.05;
  return g;
}

@fragment
fn fsWater(in : WOut) -> GBuffer {
  let world = in.world;
  let depth = tp.info2.x - heightAt(world.xz);
  if (depth < -0.02) { discard; }
  let t = tp.info3.w;
  let dist = distance(world, camera.position.xyz);
  // Far water calms down: distant ripples would only alias.
  // Seen at a grazing angle, steep ripples would mirror the ground below the
  // horizon as dark streaks; real lakes look glassy there, so they flatten.
  let V = normalize(camera.position.xyz - world);
  let grazing = smoothstep(0.02, 0.3, V.y);
  let strength = tp.water2.a * (1.0 - smoothstep(30.0, 220.0, dist) * 0.8) * mix(0.25, 1.0, grazing);
  let g = waveSlope(world.xz, t) * strength;
  var N = normalize(vec3<f32>(-g.x, 1.0, -g.y));
  // Never reflect below the horizon.
  let R = reflect(-V, N);
  if (R.y < 0.03) {
    N = normalize(N + vec3<f32>(0.0, (0.03 - R.y) * 2.0, 0.0));
  }

  let absorb = exp(-max(depth, 0.0) * tp.water.a);
  var albedo = mix(tp.water.rgb, tp.water2.rgb, absorb);
  // A thin line of foam where the water meets the shore.
  let foamNoise = noise2(world.xz * 2.7 + vec2<f32>(t * 0.3, 0.0));
  let foam = (1.0 - smoothstep(0.0, 0.25, depth)) * smoothstep(0.35, 0.7, foamNoise);
  albedo = mix(albedo, vec3<f32>(0.62, 0.66, 0.66), foam * 0.4);

  var s : Surface;
  s.P = world;
  s.N = N;
  s.geomN = vec3<f32>(0.0, 1.0, 0.0);
  s.V = V;
  s.albedo = albedo;
  s.roughness = mix(0.035, 0.6, foam);
  s.metallic = 0.0;
  s.translucency = 0.0;
  let Lo = shadeDirect(s, in.clip.xy);
  return gbuffer(Lo, 1.0, N, albedo, s.roughness, 0.0);
}

/* ---------------------------------------------------------------- grass */

struct GOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) color : vec3<f32>,
  @location(3) t : f32,
};

fn hash11(n : f32) -> f32 { return fract(sin(n) * 43758.5453); }

/**
 * One blade of grass per instance, built from the vertex index alone.
 *
 * Tiles are square cells around the camera; each draws the same number of
 * blades, and farther rings use bigger tiles, so density falls off with
 * distance by itself. Blade positions are hashed from world-space tile
 * coordinates, so they stay put as the camera moves.
 */
@vertex
fn vsGrass(@builtin(instance_index) ii : u32, @builtin(vertex_index) vi : u32) -> GOut {
  let perTile = u32(tp.grassC.x);
  let tile = patches[ii / perTile];
  let blade = f32(ii % perTile);
  let ring = tile.w;
  var o : GOut;
  o.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);    // outside the depth range: dropped
  o.world = vec3<f32>(0.0);
  o.normal = vec3<f32>(0.0, 1.0, 0.0);
  o.color = vec3<f32>(0.0);
  o.t = 0.0;

  let seed = hash21(tile.xy * 0.37 + vec2<f32>(blade * 0.618, blade * 0.131));
  let r2 = vec2<f32>(hash11(seed * 91.7 + 3.1), hash11(seed * 57.3 + 7.7));
  let xz = tile.xy + r2 * tile.z;
  let uvT = terrainUV(xz);
  let splat = textureSampleLevel(splatTex, clampSampler, uvT, 0.0);
  let n = normalize(textureSampleLevel(normalTex, clampSampler, uvT, 0.0).xyz * 2.0 - 1.0);
  let h = heightAt(xz);

  // Where grass grows: the meadow layer fully, the forest floor thinly, never
  // on paths, rock, sand or under water.
  let meadow = max(1.0 - (splat.r + splat.g + splat.b + splat.a), 0.0);
  var mask = meadow + splat.r * tp.grassC.y;
  mask = mask * (1.0 - smoothstep(tp.grassC.z * 0.7, tp.grassC.z, 1.0 - n.y));
  if (tp.info2.y > 0.5) { mask = mask * smoothstep(0.15, 0.6, h - tp.info2.x); }
  mask = mask * camera.grass.w;
  let keep = hash11(seed * 13.3 + 1.7);
  if (keep > mask) { return o; }

  let dist = distance(vec3<f32>(xz.x, h, xz.y), camera.position.xyz);
  let fade = 1.0 - smoothstep(camera.grass.x * camera.terrain2.w, camera.grass.x, dist);
  if (fade <= 0.0) { return o; }

  // Blade shape.
  let segs = u32(max(3.0 - ring, 1.0));
  let flower = hash11(seed * 3.7 + 9.1) < tp.grassA.a;
  var height = camera.grass.y * (0.55 + 0.9 * hash11(seed * 7.1)) * (0.5 + 0.5 * sqrt(min(mask, 1.0))) * fade;
  if (flower) { height = height * 0.8; }
  let width = camera.grass.z * (0.7 + 0.6 * hash11(seed * 5.3)) * (1.0 + ring * 0.9);
  let angle = hash11(seed * 11.9) * 6.2831853;
  let side = vec3<f32>(cos(angle), 0.0, sin(angle));
  let face = vec3<f32>(-side.z, 0.0, side.x);
  let lean = (hash11(seed * 17.3) - 0.3) * 0.6;

  // Which vertex of which segment: two triangles per segment, one at the tip.
  let quads = segs * 6u;
  var level : f32;
  var across : f32;
  if (vi < quads) {
    let q = vi / 6u;
    let c = vi % 6u;
    let top = select(0u, 1u, c == 2u || c == 4u || c == 5u);
    let right = select(0u, 1u, c == 1u || c == 4u || c == 5u);
    level = f32(q + top) / f32(segs + 1u);
    across = f32(right) * 2.0 - 1.0;
  } else {
    let c = vi - quads;
    if (c == 2u) { level = 1.0; across = 0.0; }
    else { level = f32(segs) / f32(segs + 1u); across = f32(c) * 2.0 - 1.0; }
  }

  // Wind: a travelling gust field plus a quick shiver, stronger toward the tip.
  let t = camera.wind.w;
  let wdir = vec3<f32>(camera.wind.x, 0.0, camera.wind.y);
  let gust = sin(dot(xz, camera.wind.xy) * 0.18 - t * 1.7) * 0.5 + 0.5;
  let shiver = sin(t * 5.3 + seed * 40.0) * 0.15;
  let bendAmt = (lean + (gust * 0.55 + shiver) * camera.wind.z * tp.grassC.w) * level * level;
  let tipWidth = select(1.0 - level, (1.0 - level) * 0.5 + 0.35 * step(0.99, level), flower);
  let offset = face * lean * level * level * height + wdir * bendAmt * height;
  var p = vec3<f32>(xz.x, h, xz.y) + vec3<f32>(0.0, level * height, 0.0) * (1.0 - bendAmt * bendAmt * 0.3)
        + side * across * width * 0.5 * max(tipWidth, 0.0) + offset;

  // Lit mostly like the ground it grows from, a little like its own face:
  // the soft, even look of a lawn rather than a field of mirrors.
  let bladeN = normalize(face + vec3<f32>(0.0, 0.6, 0.0) - wdir * bendAmt);
  o.normal = normalize(mix(n, bladeN, 0.35));

  // Colour: dark at the root, bright at the tip, with patches of dry grass.
  let dry = smoothstep(0.45, 0.75, fbm2(xz * 0.045, 3)) * tp.grassB.a;
  let hue = hash11(seed * 23.1) * 0.25 - 0.1;
  var base = tp.grassA.rgb * (1.0 + hue);
  var tip = mix(tp.grassB.rgb * (1.0 + hue), vec3<f32>(0.55, 0.47, 0.25), dry);
  var col = mix(base * 0.55, tip, pow(level, 0.8));
  if (flower && level > 0.9) {
    let pick = hash11(seed * 31.3);
    var petal = vec3<f32>(0.95, 0.82, 0.18);
    if (pick > 0.66) { petal = vec3<f32>(0.9, 0.9, 0.86); }
    else if (pick > 0.33) { petal = vec3<f32>(0.55, 0.36, 0.8); }
    col = petal;
  }

  o.world = p;
  o.clip = camera.viewProj * vec4<f32>(p, 1.0);
  o.color = col;
  o.t = level;
  return o;
}

@fragment
fn fsGrass(in : GOut, @builtin(front_facing) front : bool) -> GBuffer {
  var s : Surface;
  s.P = in.world;
  s.N = normalize(in.normal);
  s.geomN = s.N;
  s.V = normalize(camera.position.xyz - in.world);
  s.albedo = in.color;
  s.roughness = 0.75;
  s.metallic = 0.0;
  s.translucency = 0.55;
  let Lo = shadeDirect(s, in.clip.xy);
  return gbuffer(Lo, 1.0, s.N, in.color, 0.75, 0.0);
}
`
  );
  var TERRAIN_SHADOW_WGSL = (
    /* wgsl */
    `
struct Face {
  viewProj : mat4x4<f32>,
  eye : vec4<f32>,
};
@group(0) @binding(0) var<uniform> face : Face;

${TERRAIN_GROUP.replace(/camera\.position\.xyz/g, "face.eye.xyz")}

@vertex
fn vs(@builtin(instance_index) ii : u32, @location(0) grid : vec3<f32>) -> @builtin(position) vec4<f32> {
  let p = patches[ii];
  let G = tp.info3.x;
  let xz = p.xy + grid.xy / G * p.z;
  var h = heightAt(xz);
  if (grid.z > 0.5) { h = h - (tp.info3.y + p.z * 0.02); }
  return face.viewProj * vec4<f32>(xz.x, h, xz.y, 1.0);
}
`
  );

  // src/render/terrain.js
  var PARAM_FLOATS = 112;
  var PATCH_CAPACITY = 16384;
  var Terrain = class {
    constructor(renderer, opts = {}) {
      this.renderer = renderer;
      const device = this.device = renderer.device;
      const heights = opts.heights;
      const n = Math.round(Math.sqrt(heights.length));
      if (n * n !== heights.length) throw new Error("axion terrain: heights must be n * n");
      this.n = n;
      this.heights = heights;
      this.size = opts.size ?? n - 1;
      this.origin = opts.origin ?? [-this.size / 2, -this.size / 2];
      this.spacing = this.size / (n - 1);
      this.grid = opts.grid ?? 32;
      if ((n - 1) % this.grid !== 0) throw new Error("axion terrain: n - 1 must be a multiple of the patch grid");
      this.leafCount = (n - 1) / this.grid;
      this.levels = Math.round(Math.log2(this.leafCount));
      if (1 << this.levels !== this.leafCount) throw new Error("axion terrain: (n - 1) / grid must be a power of two");
      this.leafWorld = this.spacing * this.grid;
      this.lodRange = opts.lodRange ?? 2.4;
      this.morphStart = opts.morphStart ?? 0.65;
      this.version = 1;
      this.rock = { layer: opts.rock?.layer ?? -1, slope: opts.rock?.slope ?? [0.35, 0.55], strength: opts.rock?.strength ?? 1 };
      this.shore = { layer: opts.shore?.layer ?? -1, height: opts.shore?.height ?? 1.2, darken: opts.shore?.darken ?? 0.35 };
      this.snow = {
        height: opts.snow?.height ?? [200, 260],
        slope: opts.snow?.slope ?? 0.45,
        amount: opts.snow ? opts.snow.amount ?? 1 : 0
      };
      this.macro = { variation: opts.macro?.variation ?? 0.35, scale: opts.macro?.scale ?? 0.012, far: opts.macro?.far ?? [30, 90] };
      this.water = opts.water ? {
        enabled: opts.water.enabled !== false,
        level: opts.water.level ?? 0,
        deep: opts.water.deep ?? [0.015, 0.045, 0.05],
        shallow: opts.water.shallow ?? [0.11, 0.16, 0.12],
        clarity: opts.water.clarity ?? 0.9,
        waves: opts.water.waves ?? 1
      } : { enabled: false, level: -1e9, deep: [0, 0, 0], shallow: [0, 0, 0], clarity: 1, waves: 0 };
      const g = opts.grass ?? {};
      this.grass = {
        enabled: !!opts.grass && g.enabled !== false,
        radius: g.radius ?? 60,
        height: g.height ?? 0.45,
        width: g.width ?? 0.045,
        density: g.density ?? 1,
        bladesPerTile: g.bladesPerTile ?? 384,
        tile: g.tile ?? 4,
        forest: g.forest ?? 0.3,
        maxSlope: g.maxSlope ?? 0.45,
        base: g.base ?? [0.16, 0.24, 0.07],
        tip: g.tip ?? [0.42, 0.52, 0.2],
        flowers: g.flowers ?? 0.015,
        dry: g.dry ?? 0.6,
        sway: g.sway ?? 1,
        fade: g.fade ?? 0.72
      };
      this.layers = (opts.layers ?? [{}]).slice(0, 8).map((l) => ({
        scale: l.scale ?? 4,
        roughness: l.roughness ?? 0.9,
        normalStrength: l.normalStrength ?? 1,
        triplanar: !!l.triplanar,
        tint: l.tint ?? [1, 1, 1]
      }));
      this.stats = { patches: 0, blades: 0 };
      this._buildPyramid();
      this._buildTextures(opts);
      this._buildMesh();
      this._buildPipelines();
      this._patchData = new Float32Array(PATCH_CAPACITY * 4);
      this._params = new Float32Array(PARAM_FLOATS);
      this._segments = { main: [0, 0], water: [0, 0], grass: [], cascades: [] };
    }
    /* ------------------------------------------------------------ CPU data */
    /** Height at world x, z: bilinear, the same numbers the GPU draws. */
    heightAt(x, z) {
      const n = this.n;
      let gx = (x - this.origin[0]) / this.size * (n - 1);
      let gz = (z - this.origin[1]) / this.size * (n - 1);
      gx = Math.min(Math.max(gx, 0), n - 1.0001);
      gz = Math.min(Math.max(gz, 0), n - 1.0001);
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = gx - ix, fz = gz - iz;
      const h = this.heights, o = iz * n + ix;
      const a = h[o] + (h[o + 1] - h[o]) * fx;
      const b = h[o + n] + (h[o + n + 1] - h[o + n]) * fx;
      return a + (b - a) * fz;
    }
    /** Surface normal at world x, z. */
    normalAt(x, z) {
      const e = this.spacing;
      const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
      const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      const nx = -dx, ny = 2 * e, nz = -dz;
      const l = Math.hypot(nx, ny, nz);
      return [nx / l, ny / l, nz / l];
    }
    /** Min and max height for every quadtree node, leaf patches up to the root. */
    _buildPyramid() {
      const n = this.n, G = this.grid, h = this.heights;
      this.pyramid = [];
      let count = this.leafCount;
      const leafMin = new Float32Array(count * count), leafMax = new Float32Array(count * count);
      for (let pz = 0; pz < count; pz++) {
        for (let px = 0; px < count; px++) {
          let lo = Infinity, hi = -Infinity;
          for (let z = pz * G; z <= pz * G + G; z++) {
            for (let x = px * G; x <= px * G + G; x++) {
              const v = h[z * n + x];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
          leafMin[pz * count + px] = lo;
          leafMax[pz * count + px] = hi;
        }
      }
      this.pyramid.push({ count, min: leafMin, max: leafMax });
      while (count > 1) {
        const c2 = count >> 1;
        const prev = this.pyramid[this.pyramid.length - 1];
        const mn = new Float32Array(c2 * c2), mx = new Float32Array(c2 * c2);
        for (let z = 0; z < c2; z++) {
          for (let x = 0; x < c2; x++) {
            let lo = Infinity, hi = -Infinity;
            for (let k = 0; k < 4; k++) {
              const i = (z * 2 + (k >> 1)) * count + x * 2 + (k & 1);
              lo = Math.min(lo, prev.min[i]);
              hi = Math.max(hi, prev.max[i]);
            }
            mn[z * c2 + x] = lo;
            mx[z * c2 + x] = hi;
          }
        }
        this.pyramid.push({ count: c2, min: mn, max: mx });
        count = c2;
      }
    }
    /* ------------------------------------------------------------ GPU data */
    _buildTextures(opts) {
      const device = this.device, n = this.n;
      this.heightTex = device.createTexture({
        label: "axion-terrain-height",
        size: [n, n],
        format: "r32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      device.queue.writeTexture({ texture: this.heightTex }, this.heights, { bytesPerRow: n * 4 }, [n, n]);
      const nrm = new Uint8Array(n * n * 4);
      const h = this.heights, e = this.spacing;
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const xl = h[z * n + Math.max(x - 1, 0)], xr = h[z * n + Math.min(x + 1, n - 1)];
          const zd = h[Math.max(z - 1, 0) * n + x], zu = h[Math.min(z + 1, n - 1) * n + x];
          const nx = xl - xr, ny = 2 * e, nz = zd - zu;
          const l = Math.hypot(nx, ny, nz);
          const o = (z * n + x) * 4;
          nrm[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
          nrm[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
          nrm[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
          nrm[o + 3] = 255;
        }
      }
      this.normalTex = device.createTexture({
        label: "axion-terrain-normal",
        size: [n, n],
        format: "rgba8unorm",
        mipLevelCount: mipLevelsFor(n, n),
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      device.queue.writeTexture({ texture: this.normalTex }, nrm, { bytesPerRow: n * 4 }, [n, n]);
      generateMips(device, this.normalTex);
      const sp = opts.splat;
      const sn = sp ? sp.size : 1;
      this.splatTex = device.createTexture({
        label: "axion-terrain-splat",
        size: [sn, sn],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      device.queue.writeTexture(
        { texture: this.splatTex },
        sp ? sp.data : new Uint8Array(4),
        { bytesPerRow: sn * 4 },
        [sn, sn]
      );
      const layers = opts.layers ?? [{}];
      const size = opts.layerSize ?? 1024;
      this.albedoArr = textureArrayFromImages(
        device,
        layers.map((l) => l.albedo ?? null),
        { size, srgb: true, label: "axion-terrain-albedo" }
      );
      this.normalArr = textureArrayFromImages(
        device,
        layers.map((l) => l.normal ?? null),
        { size, srgb: false, label: "axion-terrain-normals" }
      );
      this.repeatSampler = device.createSampler({
        label: "axion-terrain-repeat",
        addressModeU: "repeat",
        addressModeV: "repeat",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        maxAnisotropy: 8
      });
      this.clampSampler = device.createSampler({
        label: "axion-terrain-clamp",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      });
      this.paramBuffer = device.createBuffer({
        label: "axion-terrain-params",
        size: PARAM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.patchBuffer = device.createBuffer({
        label: "axion-terrain-patches",
        size: PATCH_CAPACITY * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
    }
    /** One (G+1)^2 grid plus a skirt ring, shared by every patch. */
    _buildMesh() {
      const G = this.grid, V = G + 1;
      const verts = [];
      for (let z = 0; z <= G; z++) for (let x = 0; x <= G; x++) verts.push(x, z, 0);
      const idx = [];
      for (let z = 0; z < G; z++) {
        for (let x = 0; x < G; x++) {
          const a = z * V + x, b = a + 1, c = a + V, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const border = [];
      for (let x = 0; x < G; x++) border.push([x, 0, x + 1, 0]);
      for (let z = 0; z < G; z++) border.push([G, z, G, z + 1]);
      for (let x = G; x > 0; x--) border.push([x, G, x - 1, G]);
      for (let z = G; z > 0; z--) border.push([0, z, 0, z - 1]);
      for (const [x0, z0, x1, z1] of border) {
        const a = z0 * V + x0, b = z1 * V + x1;
        const base = verts.length / 3;
        verts.push(x0, z0, 1, x1, z1, 1);
        idx.push(a, b, base, b, base + 1, base);
      }
      const vdata = new Float32Array(verts);
      const idata = new Uint32Array(idx);
      this.indexCount = idata.length;
      this.vertexBuffer = this.device.createBuffer({
        label: "axion-terrain-grid",
        size: vdata.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this.vertexBuffer, 0, vdata);
      this.indexBuffer = this.device.createBuffer({
        label: "axion-terrain-grid-index",
        size: idata.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this.indexBuffer, 0, idata);
    }
    _buildPipelines() {
      const d = this.device, r = this.renderer;
      const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
      this.layout = d.createBindGroupLayout({
        label: "axion-terrain",
        entries: [
          { binding: 0, visibility: V, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: V | F, texture: { sampleType: "unfilterable-float" } },
          { binding: 2, visibility: V | F, texture: { sampleType: "float" } },
          { binding: 3, visibility: V | F, texture: { sampleType: "float" } },
          { binding: 4, visibility: F, texture: { sampleType: "float", viewDimension: "2d-array" } },
          { binding: 5, visibility: F, texture: { sampleType: "float", viewDimension: "2d-array" } },
          { binding: 6, visibility: V | F, sampler: { type: "filtering" } },
          { binding: 7, visibility: V | F, sampler: { type: "filtering" } },
          { binding: 8, visibility: V | F, buffer: { type: "uniform" } }
        ]
      });
      this.bindGroup = d.createBindGroup({
        layout: this.layout,
        label: "axion-terrain",
        entries: [
          { binding: 0, resource: { buffer: this.patchBuffer } },
          { binding: 1, resource: this.heightTex.createView() },
          { binding: 2, resource: this.normalTex.createView() },
          { binding: 3, resource: this.splatTex.createView() },
          { binding: 4, resource: this.albedoArr.createView({ dimension: "2d-array" }) },
          { binding: 5, resource: this.normalArr.createView({ dimension: "2d-array" }) },
          { binding: 6, resource: this.repeatSampler },
          { binding: 7, resource: this.clampSampler },
          { binding: 8, resource: { buffer: this.paramBuffer } }
        ]
      });
      const module = d.createShaderModule({ code: TERRAIN_WGSL, label: "axion-terrain" });
      const shadowModule = d.createShaderModule({ code: TERRAIN_SHADOW_WGSL, label: "axion-terrain-shadow" });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [r._frameLayout, this.layout] });
      const grid = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }];
      const depthState = (write, compare) => ({ format: "depth32float", depthWriteEnabled: write, depthCompare: compare });
      this.depthPipeline = d.createRenderPipeline({
        label: "axion-terrain-depth",
        layout,
        vertex: { module, entryPoint: "vsDepth", buffers: grid },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: depthState(true, "greater")
      });
      const surface = (pre) => d.createRenderPipeline({
        label: `axion-terrain-${pre ? "equal" : "greater"}`,
        layout,
        vertex: { module, entryPoint: "vs", buffers: grid },
        fragment: { module, entryPoint: "fs", targets: r.gbufferTargets(false) },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: pre ? depthState(false, "equal") : depthState(true, "greater")
      });
      this.surfacePipelines = { pre: surface(true), direct: surface(false) };
      this.waterPipeline = d.createRenderPipeline({
        label: "axion-water",
        layout,
        vertex: { module, entryPoint: "vsWater", buffers: grid },
        fragment: { module, entryPoint: "fsWater", targets: r.gbufferTargets(false) },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depthState(true, "greater")
      });
      this.grassPipeline = d.createRenderPipeline({
        label: "axion-grass",
        layout,
        vertex: { module, entryPoint: "vsGrass", buffers: [] },
        fragment: { module, entryPoint: "fsGrass", targets: r.gbufferTargets(false) },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depthState(true, "greater")
      });
      this.shadowPipeline = d.createRenderPipeline({
        label: "axion-terrain-sun-shadow",
        layout: d.createPipelineLayout({ bindGroupLayouts: [r._shadowLayout, this.layout] }),
        vertex: { module: shadowModule, entryPoint: "vs", buffers: grid },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: "depth32float",
          depthWriteEnabled: true,
          depthCompare: "less",
          depthBias: 2,
          depthBiasSlopeScale: 2.5
        }
      });
    }
    /** The twelve camera-uniform floats the terrain owns. */
    uniforms() {
      const g = this.grass, w = this.water;
      return [
        this.origin[0],
        this.origin[1],
        this.size,
        1,
        this.n,
        w.level,
        w.enabled ? 1 : 0,
        g.fade,
        g.enabled ? g.radius : 0,
        g.height,
        g.width,
        g.enabled ? g.density : 0
      ];
    }
    /* ----------------------------------------------------------- selection */
    _nodeBox(level, ix, iz, out) {
      const p = this.pyramid[level];
      const w = this.leafWorld * (1 << level);
      out[0] = this.origin[0] + ix * w;
      out[2] = this.origin[1] + iz * w;
      out[3] = out[0] + w;
      out[5] = out[2] + w;
      out[1] = p.min[iz * p.count + ix] - 1;
      out[4] = p.max[iz * p.count + ix] + 1;
      return w;
    }
    _boxInFrustum(f, bx) {
      for (let i = 0; i < 6; i++) {
        const o = i * 4, nx = f[o], ny = f[o + 1], nz = f[o + 2], d = f[o + 3];
        const px = nx > 0 ? bx[3] : bx[0], py = ny > 0 ? bx[4] : bx[1], pz = nz > 0 ? bx[5] : bx[2];
        if (nx * px + ny * py + nz * pz + d < 0) return false;
      }
      return true;
    }
    /** CDLOD: a node is drawn whole once it is farther than its children's range. */
    _selectMain(camera, frustum, out, water) {
      const cx = camera.position[0], cy = camera.position[1], cz = camera.position[2];
      const K = this.lodRange * this.renderer.lodBias;
      const bx = new Float64Array(6);
      const wl = this.water.enabled ? this.water.level : -Infinity;
      const visit = (level, ix, iz) => {
        const w = this._nodeBox(level, ix, iz, bx);
        if (frustum && !this._boxInFrustum(frustum, bx)) return;
        const dx = Math.max(bx[0] - cx, 0, cx - bx[3]);
        const dy = Math.max(bx[1] - cy, 0, cy - bx[4]);
        const dz = Math.max(bx[2] - cz, 0, cz - bx[5]);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (level === 0 || dist > w / 2 * K) {
          out.push(bx[0], bx[2], w, level);
          if (bx[1] + 1 < wl) water.push(bx[0], bx[2], w, level);
          return;
        }
        for (let k = 0; k < 4; k++) visit(level - 1, ix * 2 + (k & 1), iz * 2 + (k >> 1));
      };
      visit(this.levels, 0, 0);
    }
    /** Patches for one sun cascade: the part of the terrain inside its box, at a resolution it can use. */
    _selectCascade(fit, c, out) {
      const bx = new Float64Array(6);
      const E = fit.eye, R = fit.right, U = fit.up, F = fit.fwd;
      const maxLevel = c < 2 ? 0 : 1;
      const visit = (level, ix, iz) => {
        const w = this._nodeBox(level, ix, iz, bx);
        const mx = (bx[0] + bx[3]) * 0.5 - E[0], my = (bx[1] + bx[4]) * 0.5 - E[1], mz = (bx[2] + bx[5]) * 0.5 - E[2];
        const cr = 0.5 * Math.hypot(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]);
        const x = mx * R[0] + my * R[1] + mz * R[2];
        const y = mx * U[0] + my * U[1] + mz * U[2];
        const z = mx * F[0] + my * F[1] + mz * F[2];
        if (Math.abs(x) > fit.r + cr || Math.abs(y) > fit.r + cr || z < -cr || z > fit.depth + cr) return;
        if (level <= maxLevel) {
          out.push(bx[0], bx[2], w, level);
          return;
        }
        for (let k = 0; k < 4; k++) visit(level - 1, ix * 2 + (k & 1), iz * 2 + (k >> 1));
      };
      visit(this.levels, 0, 0);
    }
    /** Rings of grass tiles around the camera; each ring's tiles are twice the size of the last. */
    _selectGrass(camera, frustum, out, rings) {
      const g = this.grass;
      const cx = camera.position[0], cz = camera.position[2];
      const radii = [g.radius * 0.22, g.radius * 0.5, g.radius];
      let inner = null;
      for (let r = 0; r < 3; r++) {
        const s = g.tile * (1 << r);
        const outerSnap = r < 2 ? g.tile * (1 << r + 1) : s;
        const x0 = Math.floor((cx - radii[r]) / outerSnap) * outerSnap;
        const x1 = Math.ceil((cx + radii[r]) / outerSnap) * outerSnap;
        const z0 = Math.floor((cz - radii[r]) / outerSnap) * outerSnap;
        const z1 = Math.ceil((cz + radii[r]) / outerSnap) * outerSnap;
        const start = out.length / 4;
        for (let z = z0; z < z1; z += s) {
          for (let x = x0; x < x1; x += s) {
            if (inner && x >= inner[0] && x + s <= inner[1] && z >= inner[2] && z + s <= inner[3]) continue;
            const mx = x + s / 2, mz = z + s / 2;
            const dx = Math.max(Math.abs(mx - cx) - s / 2, 0), dz = Math.max(Math.abs(mz - cz) - s / 2, 0);
            if (dx * dx + dz * dz > g.radius * g.radius) continue;
            if (frustum) {
              const my = this.heightAt(mx, mz);
              const rad = s * 0.75 + g.height + 2;
              let visible = true;
              for (let i = 0; i < 6 && visible; i++) {
                const o = i * 4;
                if (frustum[o] * mx + frustum[o + 1] * my + frustum[o + 2] * mz + frustum[o + 3] < -rad) visible = false;
              }
              if (!visible) continue;
            }
            out.push(x, z, s, r);
          }
        }
        rings.push([start, out.length / 4 - start, r]);
        inner = [x0, x1, z0, z1];
      }
    }
    /**
     * Horizon shadows: for a grid over the whole map, the height below which the
     * light is hidden by terrain toward it. Rebuilt a few rows per frame when the
     * light has moved, so a moving sun never stalls a frame.
     */
    _updateHorizon() {
      const dir = this.renderer._sunDir;
      if (!dir) return;
      const H = this._horizon ??= { size: 256, row: -1, dir: null, work: null, tex: null };
      const G = H.size;
      if (H.row < 0) {
        if (H.dir && H.dir[0] * dir[0] + H.dir[1] * dir[1] + H.dir[2] * dir[2] > 0.99999) return;
        H.dir = dir.slice();
        H.row = 0;
        H.work = new Float32Array(G * G);
        let hi = -Infinity;
        for (const v of this.heights) if (v > hi) hi = v;
        H.max = hi;
      }
      const [lx, ly, lz] = H.dir;
      const flat = Math.hypot(lx, lz);
      const cell = this.size / (G - 1);
      const t0 = performance.now();
      let j = H.row;
      const budget = H.done ? 2 : 1e9;
      for (; j < G && performance.now() - t0 < budget; j++) {
        for (let i = 0; i < G; i++) {
          const x = this.origin[0] + i * cell, z = this.origin[1] + j * cell;
          let top = -1e9;
          if (ly <= 2e-3) top = 1e9;
          else if (flat > 1e-4) {
            const dx = lx / flat, dz = lz / flat, slope = ly / flat;
            let d = cell * 1.5;
            while (d < this.size) {
              if (H.max - d * slope <= top) break;
              const h = this.heightAt(x + dx * d, z + dz * d) - d * slope;
              if (h > top) top = h;
              d += cell * (0.75 + d / 400);
            }
          }
          H.work[j * G + i] = top;
        }
      }
      H.row = j;
      if (H.row < G) return;
      H.row = -1;
      if (!H.tex) {
        H.tex = this.device.createTexture({
          label: "axion-terrain-horizon",
          size: [G, G],
          format: "rg32float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        this.renderer.horizonView = H.tex.createView();
      }
      const pair = new Float32Array(G * G * 2);
      const old = H.done ?? H.work;
      for (let k = 0; k < G * G; k++) {
        pair[k * 2] = H.work[k];
        pair[k * 2 + 1] = old[k];
      }
      H.done = H.work;
      H.start = performance.now();
      this.device.queue.writeTexture({ texture: H.tex }, pair, { bytesPerRow: G * 8 }, [G, G]);
    }
    /** How far the horizon shadows have faded from the previous light direction to the new one. */
    horizonBlend() {
      const H = this._horizon;
      if (!H || !H.start) return 1;
      return Math.min((performance.now() - H.start) / 900, 1);
    }
    /** Called once per frame by the renderer, before any pass is encoded. */
    frame({ camera, frustum, cascades, cascadeRedraw }) {
      this._updateHorizon();
      const list = [], water = [], grass = [], rings = [];
      this._selectMain(camera, frustum, list, water);
      if (this.grass.enabled && this.grass.density > 0) this._selectGrass(camera, frustum, grass, rings);
      const seg = this._segments;
      const data = this._patchData;
      let o = 0;
      const put = (arr) => {
        const start = o / 4;
        const room = Math.min(arr.length, data.length - o);
        data.set(room === arr.length ? arr : arr.slice(0, room), o);
        o += room;
        return [start, room / 4];
      };
      seg.main = put(list);
      seg.water = put(water);
      const grassStart = o / 4;
      put(grass);
      seg.grass = rings.map(([s, count, r]) => [grassStart + s, count, r]);
      seg.cascades = [];
      if (cascades) {
        for (const c of cascadeRedraw) {
          const cl = [];
          this._selectCascade(cascades[c], c, cl);
          seg.cascades[c] = put(cl);
        }
      }
      if (o > 0) this.device.queue.writeBuffer(this.patchBuffer, 0, data.buffer, 0, o * 4);
      const p = this._params;
      const w = this.water, g = this.grass;
      p.set([this.origin[0], this.origin[1], this.size, this.n], 0);
      p.set([w.level, w.enabled ? 1 : 0, this.lodRange * this.renderer.lodBias, this.morphStart], 4);
      p.set([this.grid, 2, this.layers.length, performance.now() / 1e3], 8);
      p.set([this.rock.layer, this.rock.slope[0], this.rock.slope[1], this.rock.strength], 12);
      p.set([this.shore.layer, this.shore.height, this.shore.darken, 0], 16);
      p.set([this.macro.variation, this.macro.scale, this.macro.far[0], this.macro.far[1]], 20);
      p.set([...w.deep, w.clarity], 24);
      p.set([...w.shallow, w.waves], 28);
      p.set([...g.base, g.flowers], 32);
      p.set([...g.tip, g.dry], 36);
      p.set([g.bladesPerTile, g.forest, g.maxSlope, g.sway], 40);
      for (let i = 0; i < 8; i++) {
        const l = this.layers[i];
        p.set(l ? [1 / l.scale, l.roughness, l.normalStrength, l.triplanar ? 1 : 0] : [1, 1, 0, 0], 44 + i * 4);
        p.set(l ? [...l.tint, 0] : [1, 1, 1, 0], 76 + i * 4);
      }
      p.set([this.snow.height[0], this.snow.height[1], this.snow.slope, this.snow.amount], 108);
      this.device.queue.writeBuffer(this.paramBuffer, 0, p);
      this.stats.patches = seg.main[1];
      this.stats.blades = grass.length / 4 * g.bladesPerTile;
    }
    /* ---------------------------------------------------------------- draw */
    drawDepth(pass) {
      const [first, count] = this._segments.main;
      if (count === 0) return 0;
      pass.setPipeline(this.depthPipeline);
      pass.setBindGroup(1, this.bindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.setIndexBuffer(this.indexBuffer, "uint32");
      pass.drawIndexed(this.indexCount, count, 0, 0, first);
      return 1;
    }
    /** Terrain, then water, then grass, into the geometry pass. */
    drawSurface(pass) {
      let draws = 0, tris = 0;
      const seg = this._segments;
      pass.setBindGroup(1, this.bindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.setIndexBuffer(this.indexBuffer, "uint32");
      if (seg.main[1] > 0) {
        pass.setPipeline(this.renderer.depthPrepass ? this.surfacePipelines.pre : this.surfacePipelines.direct);
        pass.drawIndexed(this.indexCount, seg.main[1], 0, 0, seg.main[0]);
        draws++;
        tris += seg.main[1] * this.indexCount / 3;
      }
      if (this.water.enabled && seg.water[1] > 0) {
        pass.setPipeline(this.waterPipeline);
        pass.drawIndexed(this.indexCount, seg.water[1], 0, 0, seg.water[0]);
        draws++;
        tris += seg.water[1] * this.indexCount / 3;
      }
      if (this.grass.enabled && seg.grass.length) {
        pass.setPipeline(this.grassPipeline);
        const B = this.grass.bladesPerTile;
        for (const [first, count, ring] of seg.grass) {
          if (count === 0) continue;
          const segs = Math.max(3 - ring, 1);
          pass.draw(segs * 6 + 3, count * B, 0, first * B);
          draws++;
          tris += count * B * (segs * 2 + 1);
        }
      }
      return { draws, tris };
    }
    drawShadow(pass, c) {
      const s = this._segments.cascades[c];
      if (!s || s[1] === 0) return 0;
      pass.setPipeline(this.shadowPipeline);
      pass.setBindGroup(1, this.bindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.setIndexBuffer(this.indexBuffer, "uint32");
      pass.drawIndexed(this.indexCount, s[1], 0, 0, s[0]);
      return 1;
    }
    destroy() {
      if (this._horizon?.tex) {
        this.renderer.horizonView = this.renderer._noHorizon.createView();
        this._horizon.tex.destroy();
      }
      for (const t of [this.heightTex, this.normalTex, this.splatTex, this.albedoArr, this.normalArr]) t?.destroy();
      for (const b of [this.paramBuffer, this.patchBuffer, this.vertexBuffer, this.indexBuffer]) b?.destroy();
    }
  };

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
    /**
     * Level of detail: one mesh id that draws whichever of several meshes suits
     * each object's distance from the camera.
     *   app.lod([{ mesh: hi, distance: 0 }, { mesh: mid, distance: 30 }, { mesh: lo, distance: 90 }],
     *           { drawDistance: 300 })
     */
    lod(levels, options) {
      return this.renderer.createLod(levels, options);
    }
    /** Stop drawing a mesh beyond `distance` metres (it shrinks away just before). 0 = always. */
    drawDistance(mesh2, distance, options) {
      this.renderer.setDrawDistance(mesh2, distance, options);
      return this;
    }
    /** Heightmap terrain with optional water and grass. See Terrain for the options. */
    terrain(options) {
      this.renderer.terrain?.destroy();
      this.renderer.terrain = new Terrain(this.renderer, options);
      return this.renderer.terrain;
    }
    /**
     * Turn on the sun (and, by default, the sky). Angles in degrees; azimuth 0
     * points the sun along +x, 90 along +z.
     *   app.sun({ elevation: 35, azimuth: 120, intensity: 3 })
     */
    sun({ elevation, azimuth, direction, intensity, color, shadows, sky = true } = {}) {
      const r = this.renderer;
      r.sun.enabled = true;
      if (direction) r.sun.direction = direction;
      else if (elevation !== void 0 || azimuth !== void 0) {
        r.setSunAngles(elevation ?? 40, azimuth ?? 35);
      }
      if (intensity !== void 0) r.sun.intensity = intensity;
      if (color !== void 0) r.sun.color = color;
      if (shadows) Object.assign(r.sun.shadows, shadows);
      if (sky) r.sky.enabled = true;
      return this;
    }
    /**
     * Place many copies of a model: `list` is a flat array of
     * x, y, z, yaw (radians), scale per copy. Every part of the model is placed
     * with the same transforms, in one archetype-contiguous block per part.
     */
    place(model, list, { stride = 5 } = {}) {
      const count = Math.floor(list.length / stride);
      for (const part of model.parts) {
        this.addMany(count, part.mesh, part.material, (i, out) => {
          const o = i * stride;
          out.position[0] = list[o];
          out.position[1] = list[o + 1];
          out.position[2] = list[o + 2];
          out.rotation[0] = 0;
          out.rotation[1] = list[o + 3];
          out.rotation[2] = 0;
          out.scale = list[o + 4];
        }, { color: false });
      }
      return count;
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
  function parseGLTF(json, buffers, { nodes = null } = {}) {
    const primitives = [];
    const uvTransforms = (json.materials ?? []).map(uvTransformOf);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    const sceneIndex = json.scene ?? 0;
    const roots = nodes ?? json.scenes?.[sceneIndex]?.nodes ?? json.nodes?.map((_, i) => i) ?? [];
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
              const tmp2 = indices[t + 1];
              indices[t + 1] = indices[t + 2];
              indices[t + 2] = tmp2;
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
        doubleSided: !!m.doubleSided,
        extras: m.extras ?? {}
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
  async function readSource(source, onProgress) {
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
    const head = raw.byteLength >= 4 && new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true) === 1179937895;
    if (head) {
      const glb = parseGLB(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      json = glb.json;
      buffers = await Promise.all((json.buffers ?? []).map((b, i) => i === 0 && b.uri === void 0 ? glb.bin : fetchBytes(resolve(b.uri, base))));
    } else {
      json = JSON.parse(new TextDecoder().decode(raw));
      buffers = await Promise.all((json.buffers ?? []).map((b) => fetchBytes(resolve(b.uri, base))));
    }
    return { json, buffers, base };
  }
  async function decodeTextures(app, json, buffers, base, srgb, { maxSize = 0, onProgress = () => {
  } } = {}) {
    const device = app.device;
    const textureCount = (json.textures ?? []).length;
    let done = 0;
    return pool(json.textures ?? [], 6, async (tex, ti) => {
      const img = json.images[tex.extensions?.EXT_texture_webp?.source ?? tex.source];
      let blob;
      if (img.bufferView !== void 0) {
        blob = new Blob([bufferViewBytes(json, buffers, img.bufferView)], { type: img.mimeType });
      } else {
        blob = await (await fetch(resolve(img.uri, base))).blob();
      }
      let bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      if (maxSize > 0 && Math.max(bitmap.width, bitmap.height) > maxSize) {
        const k = maxSize / Math.max(bitmap.width, bitmap.height);
        const small = await createImageBitmap(bitmap, {
          resizeWidth: Math.max(1, Math.round(bitmap.width * k)),
          resizeHeight: Math.max(1, Math.round(bitmap.height * k)),
          resizeQuality: "high",
          colorSpaceConversion: "none",
          premultiplyAlpha: "none"
        });
        bitmap.close?.();
        bitmap = small;
      }
      const texture = textureFromImage(device, bitmap, {
        srgb: srgb.has(ti),
        label: img.name ?? img.uri ?? `texture${ti}`
      });
      bitmap.close?.();
      onProgress("textures", ++done, textureCount);
      return texture;
    });
  }
  function makeMaterials(app, materials, gpuTextures) {
    return materials.map((m) => app.material({
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
      doubleSided: m.doubleSided,
      wind: m.extras.wind ?? 0,
      flutter: m.extras.flutter ?? 0,
      translucency: m.extras.translucency ?? 0,
      castShadow: m.extras.castShadow ?? true
    }));
  }
  function colourTextures(materials) {
    const srgb = /* @__PURE__ */ new Set();
    for (const m of materials) if (m.baseColorTexture !== void 0) srgb.add(m.baseColorTexture);
    return srgb;
  }
  async function loadGLTF(app, source, { onProgress = () => {
  }, maxTextureSize = 0 } = {}) {
    const { json, buffers, base } = await readSource(source, onProgress);
    onProgress("geometry", 0, 1);
    const parsed = parseGLTF(json, buffers);
    onProgress("geometry", 1, 1);
    const gpuTextures = await decodeTextures(
      app,
      json,
      buffers,
      base,
      colourTextures(parsed.materials),
      { maxSize: maxTextureSize, onProgress }
    );
    const materialIds = makeMaterials(app, parsed.materials, gpuTextures);
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
  function mergeGeometry(list) {
    if (list.length === 1) return list[0];
    let vCount = 0, iCount = 0;
    for (const g of list) {
      vCount += g.vertexCount;
      iCount += g.indices.length;
    }
    const F = VERTEX_STRIDE_FLOATS;
    const vertices = new Float32Array(vCount * F);
    const indices = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const g of list) {
      vertices.set(g.vertices, vo * F);
      for (let i = 0; i < g.indices.length; i++) indices[io + i] = g.indices[i] + vo;
      vo += g.vertexCount;
      io += g.indices.length;
    }
    return { vertices, indices, vertexCount: vCount, bounds: sphereOf(vertices) };
  }
  function sphereOf(v) {
    const F = VERTEX_STRIDE_FLOATS, n = v.length / F;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += v[i * F];
      cy += v[i * F + 1];
      cz += v[i * F + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    let r2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = v[i * F] - cx, dy = v[i * F + 1] - cy, dz = v[i * F + 2] - cz;
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    return new Float32Array([cx, cy, cz, Math.sqrt(r2)]);
  }
  async function loadModels(app, source, { onProgress = () => {
  }, maxTextureSize = 0 } = {}) {
    const { json, buffers, base } = await readSource(source, onProgress);
    onProgress("geometry", 0, 1);
    const sceneIndex = json.scene ?? 0;
    const roots = json.scenes?.[sceneIndex]?.nodes ?? json.nodes?.map((_, i) => i) ?? [];
    const meta = json.extras?.axion?.models ?? roots.map((node) => ({
      name: json.nodes[node].name ?? `model${node}`,
      levels: [{ node, distance: 0 }]
    }));
    const materials = parseGLTF({ ...json, nodes: [], scenes: [{ nodes: [] }] }, buffers).materials;
    const gpuTextures = await decodeTextures(
      app,
      json,
      buffers,
      base,
      colourTextures(materials),
      { maxSize: maxTextureSize, onProgress }
    );
    const materialIds = makeMaterials(app, materials, gpuTextures);
    const fallback = materialIds.length ? -1 : app.material({ name: "gltf-default" });
    const matId = (i) => i >= 0 ? materialIds[i] : fallback;
    const models = {};
    meta.forEach((m, mi) => {
      const levels = m.levels.map((l) => {
        const parsed = parseGLTF(json, buffers, { nodes: [l.node] });
        const byMat = /* @__PURE__ */ new Map();
        for (const p of parsed.primitives) {
          if (!byMat.has(p.material)) byMat.set(p.material, []);
          byMat.get(p.material).push(p.geometry);
        }
        return { distance: l.distance ?? 0, byMat };
      });
      const matKeys = /* @__PURE__ */ new Set();
      for (const l of levels) for (const k of l.byMat.keys()) matKeys.add(k);
      const parts = [];
      let bounds = null;
      for (const k of matKeys) {
        const lodLevels = levels.map((l) => {
          const list = l.byMat.get(k);
          if (!list) return { mesh: -1, distance: l.distance };
          const geo = mergeGeometry(list);
          return { mesh: app.renderer.createMesh(geo, `${m.name}/${k}`), distance: l.distance, geo };
        });
        const first = lodLevels.find((l) => l.mesh >= 0);
        if (!bounds && first) bounds = first.geo.bounds;
        const mesh2 = lodLevels.length > 1 || m.drawDistance ? app.renderer.createLod(
          lodLevels.map((l) => ({ mesh: l.mesh, distance: l.distance })),
          { drawDistance: m.drawDistance ?? 0, name: m.name }
        ) : first.mesh;
        parts.push({ mesh: mesh2, material: matId(k) });
      }
      let collider = null;
      if (m.collider !== void 0 && m.collider !== null) {
        const parsed = parseGLTF(json, buffers, { nodes: [m.collider] });
        const geo = mergeGeometry(parsed.primitives.map((p) => p.geometry));
        const n = geo.vertexCount, F = VERTEX_STRIDE_FLOATS;
        const positions = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          positions[i * 3] = geo.vertices[i * F];
          positions[i * 3 + 1] = geo.vertices[i * F + 1];
          positions[i * 3 + 2] = geo.vertices[i * F + 2];
        }
        collider = { positions, indices: geo.indices };
      }
      models[m.name] = { name: m.name, parts, bounds, collider, extras: m.extras ?? {} };
      onProgress("models", mi + 1, meta.length);
    });
    onProgress("geometry", 1, 1);
    return { models, textures: gpuTextures.length, materials: materialIds };
  }

  // src/index.js
  var VERSION = "0.9.3";
  return __toCommonJS(index_exports);
})();
