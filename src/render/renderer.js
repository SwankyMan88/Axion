import { Arena, DynamicBuffer, retire, sweepRetired } from '../gpu/buffers.js';
import { solidTexture } from '../gpu/textures.js';
import {
  STANDARD_WGSL, SHADOW_WGSL, AO_WGSL, AO_BLUR_WGSL, RESOLVE_WGSL, VOLUME_WGSL, EXPOSURE_WGSL, DOF_WGSL,
  BLOOM_PREFILTER_WGSL, BLOOM_DOWN_WGSL, BLOOM_UP_WGSL, FINAL_WGSL, CUBE_FACES,
} from './shaders.js';
import { VERTEX_STRIDE_BYTES } from '../geometry/primitives.js';
import {
  Bounds, Hidden, InstanceColor, LocalToWorld, MeshRef, PointLight, Transform,
  M_MESH, M_MATERIAL, T_POS,
} from '../core/components.js';
import { frustumFromMatrix, sphereInFrustum } from '../core/math.js';

const INSTANCE_FLOATS = 28;   // mat4(16) + color(4) + pbr(4) + surface(4)
const LIGHT_FLOATS = 12;      // posRange(4) + colorPower(4) + shadowInfo(4)
const CAMERA_FLOATS = 132;
const MAX_LIGHTS = 256;
const FACE_SLOT_BYTES = 256;  // uniform dynamic offsets must be 256-aligned

const HDR_FORMAT = 'rgba16float';
const TONEMAP_MODES = { linear: 0, reinhard: 1, filmic: 2, aces: 3, agx: 4 };
const AO_FORMAT = 'rgba16float';   // rgb = indirect light (SSIL), a = AO

/**
 * Deferred-ambient forward renderer.
 *
 * The frame is a pass stack:
 *
 *   1. Shadow   — six depth-only cube faces per shadowed point light, all into
 *                 one depth array texture.
 *   2. Geometry — one pass, three targets: HDR direct light + emissive, a
 *                 packed surface buffer (octahedral view normal, roughness,
 *                 metallic), and albedo. Ambient is left out on purpose.
 *   3. AO       — horizon-based occlusion at half resolution, then a
 *                 depth-aware blur.
 *   4. Resolve  — screen-space reflections, ambient × AO, fog. HDR out.
 *   5. Bloom    — threshold, downsample pyramid, tent upsample.
 *   6. Final    — bloom composite, ACES, gamma, FXAA to the swapchain.
 *
 * Deferring ambient is the decision that makes occlusion look like contact
 * darkening rather than dirt: AO must multiply only the indirect term, and the
 * geometry pass is the wrong place to know it.
 */
export class Renderer {
  constructor({ device, context, format, canvas }, options = {}) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    this.clearColor = options.clearColor ?? [0.02, 0.025, 0.035, 1];
    this.exposure = options.exposure ?? 1.0;
    this.fogDensity = options.fogDensity ?? 0.0;
    this.fogColor = options.fogColor ?? [0.02, 0.025, 0.035];
    /** How much of the fog colour comes from the sky in the view direction. */
    this.aerialPerspective = options.aerialPerspective ?? 0.85;
    this.ambient = options.ambient ?? [0.09, 0.11, 0.15];
    this.groundAmbient = options.groundAmbient ?? 0.35;
    this.frustumCulling = options.frustumCulling !== false;
    this.fxaa = options.fxaa !== false;

    /** Screen-space reflections. `intensity` 0 falls back to the analytic sky. */
    this.ssr = {
      intensity: options.ssr?.intensity ?? 1.0,
      steps: options.ssr?.steps ?? 48,
      /** World-space depth a surface is assumed to have behind its visible face. */
      thickness: options.ssr?.thickness ?? 0.5,
      maxDistance: options.ssr?.maxDistance ?? 70,
      fadeDistance: options.ssr?.fadeDistance ?? 90,
    };

    /**
     * Horizon-based ambient occlusion, half resolution.
     *
     * `fadeDistance` is not a quality knob to taste — past it the screen-space
     * estimator has less than a pixel of radius to work with and degenerates
     * into per-pixel noise. Fading it out is what keeps distant ground clean.
     */
    this.ao = {
      intensity: options.ao?.intensity ?? 1.0,
      radius: options.ao?.radius ?? 1.6,
      power: options.ao?.power ?? 1.4,
      bias: options.ao?.bias ?? 0.04,
      fadeDistance: options.ao?.fadeDistance ?? 55,
    };

    /** Screen-space indirect light: one diffuse bounce gathered by the AO march. 0 = off. */
    this.ssil = {
      intensity: options.ssil?.intensity ?? 0,
      radius: options.ssil?.radius ?? 3,
    };

    /**
     * Volumetric fog: a height-falling medium lit by every point light, with
     * shadowed light shafts. Half resolution. `density` is extinction per metre.
     */
    this.volumetric = {
      enabled: options.volumetric?.enabled ?? false,
      density: options.volumetric?.density ?? 0.03,
      steps: options.volumetric?.steps ?? 24,
      anisotropy: options.volumetric?.anisotropy ?? 0.3,
      maxDistance: options.volumetric?.maxDistance ?? 60,
      heightBase: options.volumetric?.heightBase ?? 0,
      heightFalloff: options.volumetric?.heightFalloff ?? 0.15,
      ambient: options.volumetric?.ambient ?? 1.0,
      lightScatter: options.volumetric?.lightScatter ?? 1.0,
      color: options.volumetric?.color ?? [1, 1, 1],
    };

    /**
     * Tonemapping and colour adjustments. mode: 'linear' | 'reinhard' |
     * 'filmic' | 'aces' | 'agx'. `white` is the scene value that maps to
     * white for reinhard and filmic.
     */
    this.tonemap = {
      mode: options.tonemap?.mode ?? 'aces',
      white: options.tonemap?.white ?? 6,
      brightness: options.tonemap?.brightness ?? 1,
      contrast: options.tonemap?.contrast ?? 1,
      saturation: options.tonemap?.saturation ?? 1,
    };

    /**
     * Auto exposure: the frame's average luminance is brought to middle grey,
     * adapting at `speed`. `exposure` (or the physical camera) still applies on
     * top as compensation. min/max are limits in stops.
     */
    /**
     * Depth of field. Everything within `range` metres of `focus` is sharp;
     * blur ramps up over `transition` metres beyond that, to `amount` pixels.
     * `autoFocus` focuses on whatever is at the centre of the screen.
     */
    this.dof = {
      enabled: options.dof?.enabled ?? false,
      focus: options.dof?.focus ?? 5,
      range: options.dof?.range ?? 1.5,
      transition: options.dof?.transition ?? 4,
      amount: options.dof?.amount ?? 8,
      near: options.dof?.near ?? true,
      far: options.dof?.far ?? true,
      autoFocus: options.dof?.autoFocus ?? false,
    };

    /** Stops added after everything else: manual, physical or auto exposure. */
    this.exposureCompensation = options.exposureCompensation ?? 0;

    this.autoExposure = {
      enabled: options.autoExposure?.enabled ?? false,
      /** Target average (log-mean) luminance. 0.18 is photographic middle grey. */
      key: options.autoExposure?.key ?? 0.12,
      speed: options.autoExposure?.speed ?? 1.5,
      min: options.autoExposure?.min ?? -6,
      max: options.autoExposure?.max ?? 6,
    };

    /**
     * Physical camera and light units. When enabled, light `intensity` is in
     * lumens and exposure comes from aperture (f-stop), shutter (seconds) and
     * ISO, exactly as a real camera meters it: EV100 = log2(N^2 / t * 100 / ISO).
     */
    this.physical = {
      enabled: options.physical?.enabled ?? false,
      aperture: options.physical?.aperture ?? 16,
      shutter: options.physical?.shutter ?? 1 / 100,
      iso: options.physical?.iso ?? 100,
      compensation: options.physical?.compensation ?? 0,
    };

    this.bloom = {
      threshold: options.bloom?.threshold ?? 1.0,
      knee: options.bloom?.knee ?? 0.6,
      strength: options.bloom?.strength ?? 0.5,
      levels: options.bloom?.levels ?? 5,
    };

    /**
     * Point-light shadows. `maxLights` cube maps are allocated up front; lights
     * are assigned to them each frame, brightest and nearest first, so a scene
     * with more lights than maps degrades by losing the least visible shadows
     * rather than by failing.
     */
    this.shadows = {
      enabled: options.shadows?.enabled !== false,
      maxLights: options.shadows?.maxLights ?? 4,
      size: options.shadows?.size ?? 512,
      pcfRadius: options.shadows?.pcfRadius ?? 1.6,
      normalBias: options.shadows?.normalBias ?? 0.045,
      bias: options.shadows?.bias ?? 0.0035,
      near: options.shadows?.near ?? 0.25,
      maxCasters: options.shadows?.maxCasters ?? 40000,
    };

    this.vertexArena = new Arena(device, GPUBufferUsage.VERTEX, 4 << 20, 'axion-vertices');
    this.indexArena = new Arena(device, GPUBufferUsage.INDEX, 2 << 20, 'axion-indices');
    this.instances = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096 * INSTANCE_FLOATS, 'axion-instances');
    this.shadowModels = new DynamicBuffer(device, GPUBufferUsage.STORAGE, 4096 * 16, 'axion-shadow-models');

    this.cameraBuffer = device.createBuffer({
      size: CAMERA_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'axion-camera',
    });
    this.cameraData = new Float32Array(CAMERA_FLOATS);

    this.lightBuffer = device.createBuffer({
      size: MAX_LIGHTS * LIGHT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'axion-lights',
    });
    this.lightData = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);

    this.meshes = [];
    this.materials = [];
    this._pipelines = new Map();

    this._modules = {
      standard: device.createShaderModule({ code: STANDARD_WGSL, label: 'axion-standard' }),
      shadow: device.createShaderModule({ code: SHADOW_WGSL, label: 'axion-shadow' }),
      ao: device.createShaderModule({ code: AO_WGSL, label: 'axion-ao' }),
      aoBlur: device.createShaderModule({ code: AO_BLUR_WGSL, label: 'axion-ao-blur' }),
      resolve: device.createShaderModule({ code: RESOLVE_WGSL, label: 'axion-resolve' }),
      bloomPrefilter: device.createShaderModule({ code: BLOOM_PREFILTER_WGSL, label: 'axion-bloom-prefilter' }),
      bloomDown: device.createShaderModule({ code: BLOOM_DOWN_WGSL, label: 'axion-bloom-down' }),
      bloomUp: device.createShaderModule({ code: BLOOM_UP_WGSL, label: 'axion-bloom-up' }),
      final: device.createShaderModule({ code: FINAL_WGSL, label: 'axion-final' }),
      volume: device.createShaderModule({ code: VOLUME_WGSL, label: 'axion-volume' }),
      exposure: device.createShaderModule({ code: EXPOSURE_WGSL, label: 'axion-exposure' }),
      dof: device.createShaderModule({ code: DOF_WGSL, label: 'axion-dof' }),
    };

    this._buildLayouts();
    this._buildStaticPipelines();
    this._buildShadowTarget();
    this._rebuildFrameBindGroup();

    // Visibility scratch — grown, never reallocated per frame.
    this._visArch = new Uint16Array(4096);
    this._visRow = new Uint32Array(4096);
    this._visKey = new Uint32Array(4096);
    this._sVisArch = new Uint16Array(4096);
    this._sVisRow = new Uint32Array(4096);
    this._sVisMesh = new Uint32Array(4096);
    this._frustum = new Float32Array(24);
    this._shadowBatches = [];
    /** entity -> cube map slot, held across frames so shadows do not blink. */
    this._shadowSlots = new Map();

    this._targets = null;
    this._targetSize = [0, 0];

    this.stats = {
      drawCalls: 0, instances: 0, culled: 0, triangles: 0, batches: 0,
      shadowDraws: 0, shadowCasters: 0, shadowLights: 0, cpuMs: 0,
    };
    this.defaultMaterial = this.createMaterial({ color: [0.8, 0.8, 0.82] });
  }

  /* ------------------------------------------------------------- layouts */

  _buildLayouts() {
    const d = this.device;
    const FRAG = GPUShaderStage.FRAGMENT;
    const VERT = GPUShaderStage.VERTEX;

    this._frameLayout = d.createBindGroupLayout({
      label: 'axion-frame',
      entries: [
        { binding: 0, visibility: VERT | FRAG, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VERT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: FRAG, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: FRAG, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
        { binding: 4, visibility: FRAG, sampler: { type: 'comparison' } },
      ],
    });
    // Group 1: one bind group per material. Same layout in the geometry pass
    // and the alpha-tested shadow pass.
    this._materialLayout = d.createBindGroupLayout({
      label: 'axion-material',
      entries: [
        { binding: 0, visibility: FRAG, sampler: { type: 'filtering' } },
        { binding: 1, visibility: FRAG, texture: { sampleType: 'float' } },
        { binding: 2, visibility: FRAG, texture: { sampleType: 'float' } },
        { binding: 3, visibility: FRAG, texture: { sampleType: 'float' } },
        { binding: 4, visibility: FRAG, buffer: { type: 'uniform' } },
      ],
    });
    this._geometryLayout = d.createPipelineLayout({
      bindGroupLayouts: [this._frameLayout, this._materialLayout], label: 'axion-geometry-layout',
    });

    // Tiling, trilinear, anisotropic: what authored textures expect. Without
    // anisotropy a floor seen at a grazing angle turns to mush a few metres out.
    this._materialSampler = d.createSampler({
      label: 'axion-material',
      addressModeU: 'repeat', addressModeV: 'repeat',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      maxAnisotropy: 8,
    });
    this._defaultTextures = {
      white: solidTexture(d, [255, 255, 255, 255], { srgb: true, label: 'axion-white' }),
      data: solidTexture(d, [255, 255, 255, 255], { label: 'axion-white-linear' }),
      normal: solidTexture(d, [128, 128, 255, 255], { label: 'axion-flat-normal' }),
    };

    this._shadowLayout = d.createBindGroupLayout({
      label: 'axion-shadow',
      entries: [
        { binding: 0, visibility: VERT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
        { binding: 1, visibility: VERT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const tex = (n) => ({ binding: n, visibility: FRAG, texture: { sampleType: 'float' } });
    const depthTex = (n) => ({ binding: n, visibility: FRAG, texture: { sampleType: 'depth' } });
    const cam = { binding: 0, visibility: FRAG, buffer: { type: 'uniform' } };
    const samp = { binding: 1, visibility: FRAG, sampler: { type: 'filtering' } };

    this._aoLayout = d.createBindGroupLayout({
      label: 'axion-ao', entries: [cam, samp, depthTex(2), tex(3), tex(4)],
    });
    this._volumeLayout = d.createBindGroupLayout({
      label: 'axion-volume',
      entries: [
        cam, samp, depthTex(2),
        { binding: 3, visibility: FRAG, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: FRAG, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
        { binding: 5, visibility: FRAG, sampler: { type: 'comparison' } },
      ],
    });
    this._exposureLayout = d.createBindGroupLayout({
      label: 'axion-exposure',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._aoBlurLayout = d.createBindGroupLayout({
      label: 'axion-ao-blur', entries: [cam, samp, tex(2), depthTex(3)],
    });
    this._resolveLayout = d.createBindGroupLayout({
      label: 'axion-resolve', entries: [cam, samp, tex(2), tex(3), tex(4), depthTex(5), tex(6), tex(7)],
    });
    this._bloomLayout = d.createBindGroupLayout({
      label: 'axion-bloom', entries: [cam, samp, tex(2)],
    });
    this._finalLayout = d.createBindGroupLayout({
      label: 'axion-final',
      entries: [cam, samp, tex(2), tex(3), { binding: 4, visibility: FRAG, buffer: { type: 'read-only-storage' } }],
    });

    this._sampler = d.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      label: 'axion-linear',
    });
    // Comparison sampler with linear filtering gives hardware 2x2 PCF under
    // every Vogel tap, so twelve taps behave like forty-eight.
    this._shadowSampler = d.createSampler({
      compare: 'less', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      label: 'axion-shadow-cmp',
    });
  }

  _fullscreenPipeline(label, layout, module, format, blend) {
    return this.device.createRenderPipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  _buildStaticPipelines() {
    const m = this._modules;

    this._shadowPipeline = this.device.createRenderPipeline({
      label: 'axion-shadow',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._shadowLayout] }),
      vertex: {
        module: m.shadow, entryPoint: 'vs',
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      // No fragment stage at all: a depth-only pass needs none, and leaving it
      // out lets the driver take its fast path.
      primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // Alpha-tested casters need their texture to know where they are solid.
    // Cards like leaves are usually single planes seen from both sides, so no
    // face is culled here.
    this._shadowMaskPipeline = this.device.createRenderPipeline({
      label: 'axion-shadow-mask',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._shadowLayout, this._materialLayout] }),
      vertex: {
        module: m.shadow, entryPoint: 'vsMask',
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
          ],
        }],
      },
      fragment: { module: m.shadow, entryPoint: 'fsMask', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this._aoPipeline = this._fullscreenPipeline('axion-ao', this._aoLayout, m.ao, AO_FORMAT);
    this._aoBlurPipeline = this._fullscreenPipeline('axion-ao-blur', this._aoBlurLayout, m.aoBlur, AO_FORMAT);
    this._volumePipeline = this._fullscreenPipeline('axion-volume', this._volumeLayout, m.volume, AO_FORMAT);
    this._exposurePipeline = this.device.createComputePipeline({
      label: 'axion-exposure',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._exposureLayout] }),
      compute: { module: m.exposure, entryPoint: 'main' },
    });
    // [adapted log2 luminance, initialised flag, -, -]
    this.exposureBuffer = this.device.createBuffer({
      size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: 'axion-exposure-state',
    });
    this._dofLayout = this.device.createBindGroupLayout({
      label: 'axion-dof',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ],
    });
    this._dofPipeline = this._fullscreenPipeline('axion-dof', this._dofLayout, m.dof, HDR_FORMAT);
    this._resolvePipeline = this._fullscreenPipeline('axion-resolve', this._resolveLayout, m.resolve, HDR_FORMAT);
    this._bloomPrefilterPipeline = this._fullscreenPipeline('axion-bloom-prefilter', this._bloomLayout, m.bloomPrefilter, HDR_FORMAT);
    this._bloomDownPipeline = this._fullscreenPipeline('axion-bloom-down', this._bloomLayout, m.bloomDown, HDR_FORMAT);
    this._bloomUpPipeline = this._fullscreenPipeline('axion-bloom-up', this._bloomLayout, m.bloomUp, HDR_FORMAT, {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    });
    this._finalPipeline = this._fullscreenPipeline('axion-final', this._finalLayout, m.final, this.format);
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
        label: 'axion-shadow-faces',
      });
      this.faceData = new Float32Array(faceBytes / 4);
      this._boundShadowBuffer = null;   // force the bind group to be rebuilt
    }
    retire(this._shadowTexture);
    this._shadowTexture = this.device.createTexture({
      size: [size, size, layers],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'axion-shadow-array',
    });
    this._shadowArrayView = this._shadowTexture.createView({ dimension: '2d-array' });
    this._shadowFaceViews = [];
    for (let i = 0; i < layers; i++) {
      this._shadowFaceViews.push(this._shadowTexture.createView({
        dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1,
      }));
    }
    this._boundInstanceBuffer = null;   // frame bind group references the array
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
      id, name,
      baseVertex: vOffset / VERTEX_STRIDE_BYTES,
      firstIndex: iOffset / 4,
      indexCount: geometry.indices.length,
      bounds: geometry.bounds,
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
    color = [1, 1, 1], alpha = 1, metallic = 0, roughness = 0.6, emissive = 0,
    transparent = false, doubleSided = false, castShadow = true,
    noiseScale = 0, noiseStrength = 0.6, bump = 0.5, oxide = 0,
    // Textures, as GPUTextures. Base colour must be an sRGB format; the
    // metallic-roughness (G = roughness, B = metallic) and normal maps linear.
    baseColorTexture = null, metallicRoughnessTexture = null, normalTexture = null,
    normalScale = 1,
    // 'OPAQUE' or 'MASK'. MASK discards below alphaCutoff, in both the
    // geometry pass and the shadow pass.
    alphaMode = 'OPAQUE', alphaCutoff = 0.5,
    name = `material${this.materials.length}`,
  } = {}) {
    const id = this.materials.length;
    const masked = alphaMode === 'MASK';

    const params = this.device.createBuffer({
      label: `axion-material-${name}`, size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(params, 0, new Float32Array([
      masked ? alphaCutoff : 0, normalScale, normalTexture ? 1 : 0, 0,
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
        { binding: 4, resource: { buffer: params } },
      ],
    });

    this.materials.push({
      id, name, color, alpha, metallic, roughness, emissive, transparent,
      doubleSided, castShadow, noiseScale, noiseStrength, bump, oxide,
      masked, bindGroup, params,
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
    const ev100 = Math.log2((p.aperture * p.aperture) / p.shutter * 100 / p.iso);
    return Math.pow(2, p.compensation) / (1.2 * Math.pow(2, ev100));
  }

  /** Recreated only when the instance buffer was reallocated by a grow. */
  _rebuildFrameBindGroup() {
    if (this._boundInstanceBuffer === this.instances.buffer) return;
    this._boundInstanceBuffer = this.instances.buffer;
    this.frameBindGroup = this.device.createBindGroup({
      layout: this._frameLayout,
      label: 'axion-frame',
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.instances.buffer } },
        { binding: 2, resource: { buffer: this.lightBuffer } },
        { binding: 3, resource: this._shadowArrayView },
        { binding: 4, resource: this._shadowSampler },
      ],
    });
  }

  _rebuildShadowBindGroup() {
    if (this._boundShadowBuffer === this.shadowModels.buffer) return;
    this._boundShadowBuffer = this.shadowModels.buffer;
    this.shadowBindGroup = this.device.createBindGroup({
      layout: this._shadowLayout,
      label: 'axion-shadow',
      entries: [
        { binding: 0, resource: { buffer: this.faceBuffer, size: 64 } },
        { binding: 1, resource: { buffer: this.shadowModels.buffer } },
      ],
    });
  }

  _pipelineFor(material) {
    const key = `${material.transparent ? 1 : 0}|${material.doubleSided ? 1 : 0}`;
    let p = this._pipelines.get(key);
    if (p) return p;
    p = this.device.createRenderPipeline({
      label: `axion-pipeline-${key}`,
      layout: this._geometryLayout,
      vertex: {
        module: this._modules.standard, entryPoint: 'vs',
        buffers: [{
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: this._modules.standard, entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            blend: material.transparent ? {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            } : undefined,
          },
          // Transparent surfaces must not overwrite the surface or albedo
          // buffers, or the resolve would shade a reflection for a ghost.
          { format: HDR_FORMAT, writeMask: material.transparent ? 0 : GPUColorWrite.ALL },
          { format: HDR_FORMAT, writeMask: material.transparent ? 0 : GPUColorWrite.ALL },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: material.doubleSided ? 'none' : 'back',
        frontFace: 'ccw',
      },
      // Reverse-Z: clear to 0, keep the greater depth. Gives float32 depth its
      // precision where it matters instead of wasting it near the near plane.
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: !material.transparent,
        depthCompare: 'greater',
      },
    });
    this._pipelines.set(key, p);
    return p;
  }

  /* -------------------------------------------------------- attachments */

  _ensureTargets() {
    const { width, height } = this.canvas;
    if (this._targetSize[0] === width && this._targetSize[1] === height) return;

    for (const t of this._targets?.all ?? []) retire(t);

    // COPY_SRC costs nothing and makes every intermediate target readable —
    // which is how you prove a pass does what it claims rather than assuming.
    const make = (format, w, h, label) => this.device.createTexture({
      size: [Math.max(1, w), Math.max(1, h)], format, label,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });

    const color = make(HDR_FORMAT, width, height, 'axion-scene-color');
    const surface = make(HDR_FORMAT, width, height, 'axion-surface');
    const albedo = make(HDR_FORMAT, width, height, 'axion-albedo');
    const depth = make('depth32float', width, height, 'axion-depth');
    const hdr = make(HDR_FORMAT, width, height, 'axion-hdr');
    const aoW = Math.max(1, width >> 1), aoH = Math.max(1, height >> 1);
    const ao = make(AO_FORMAT, aoW, aoH, 'axion-ao');
    const aoBlur = make(AO_FORMAT, aoW, aoH, 'axion-ao-blur');
    const vol = make(AO_FORMAT, aoW, aoH, 'axion-volume');
    const volBlur = make(AO_FORMAT, aoW, aoH, 'axion-volume-blur');

    const bloom = [];
    let bw = width >> 1, bh = height >> 1;
    for (let i = 0; i < this.bloom.levels && bw > 8 && bh > 8; i++) {
      bloom.push({ tex: make(HDR_FORMAT, bw, bh, `axion-bloom-${i}`), w: bw, h: bh });
      bw >>= 1; bh >>= 1;
    }

    this._targets = {
      all: [color, surface, albedo, depth, hdr, ao, aoBlur, vol, volBlur, ...bloom.map((b) => b.tex)],
      color, surface, albedo, depth, hdr, ao, aoBlur, vol, volBlur, bloom,
      colorView: color.createView(),
      surfaceView: surface.createView(),
      albedoView: albedo.createView(),
      depthView: depth.createView(),
      hdrView: hdr.createView(),
      aoView: ao.createView(),
      aoBlurView: aoBlur.createView(),
      volView: vol.createView(),
      volBlurView: volBlur.createView(),
      bloomViews: bloom.map((b) => b.tex.createView()),
    };

    const t = this._targets;
    const bg = (layout, resources, label) => this.device.createBindGroup({
      layout, label,
      entries: resources.map((resource, i) => ({ binding: i, resource })),
    });
    const camRes = { buffer: this.cameraBuffer };

    this.aoBindGroup = bg(this._aoLayout, [camRes, this._sampler, t.depthView, t.surfaceView, t.colorView], 'axion-ao');
    this.volBlurBindGroup = bg(this._aoBlurLayout, [camRes, this._sampler, t.volView, t.depthView], 'axion-volume-blur');
    // Depth of field reads the resolved frame and writes into the scene colour
    // target, which is free by then; the result is copied back over the frame.
    this.dofBindGroup = bg(this._dofLayout, [camRes, this._sampler, t.hdrView, t.depthView], 'axion-dof');
    this.exposureBindGroup = bg(this._exposureLayout, [camRes, t.hdrView, { buffer: this.exposureBuffer }], 'axion-exposure');
    this._volumeBindGroup = null;
    this.aoBlurBindGroup = bg(this._aoBlurLayout, [camRes, this._sampler, t.aoView, t.depthView], 'axion-ao-blur');
    this.resolveBindGroup = bg(this._resolveLayout,
      [camRes, this._sampler, t.colorView, t.surfaceView, t.albedoView, t.depthView, t.aoBlurView, t.volBlurView], 'axion-resolve');
    this.finalBindGroup = bg(this._finalLayout,
      [camRes, this._sampler, t.hdrView, t.bloomViews[0] ?? t.hdrView, { buffer: this.exposureBuffer }], 'axion-final');

    // One bind group per bloom level, made once here rather than every frame.
    this.bloomFromHdr = bg(this._bloomLayout, [camRes, this._sampler, t.hdrView], 'axion-bloom-src');
    this.bloomBindGroups = t.bloomViews.map((v, i) =>
      bg(this._bloomLayout, [camRes, this._sampler, v], `axion-bloom-${i}`));

    this._targetSize = [width, height];
  }

  _growVisibility(n) {
    if (n <= this._visArch.length) return;
    let cap = this._visArch.length;
    while (cap < n) cap *= 2;
    this._visArch = new Uint16Array(cap);
    this._visRow = new Uint32Array(cap);
    this._visKey = new Uint32Array(cap);
    this._sVisArch = new Uint16Array(cap);
    this._sVisRow = new Uint32Array(cap);
    this._sVisMesh = new Uint32Array(cap);
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
    // Standard (not reverse) Z for shadows: the compare is 'less', and depth
    // precision matters least where shadow acne is already handled by bias.
    const p10 = far / (near - far);
    const p14 = (near * far) / (near - far);

    for (let i = 0; i < 6; i++) {
      const F = CUBE_FACES[i].f, U = CUBE_FACES[i].u;
      const R = [
        F[1] * U[2] - F[2] * U[1],
        F[2] * U[0] - F[0] * U[2],
        F[0] * U[1] - F[1] * U[0],
      ];
      const base = (slot * 6 + i) * stride;
      const m = this.faceData;

      // view: x = dot(p-eye, R), y = dot(p-eye, U), z = -dot(p-eye, F)
      // then projected by a 90° perspective with aspect 1, so P00 = P11 = 1.
      const tx = -(R[0] * lx + R[1] * ly + R[2] * lz);
      const ty = -(U[0] * lx + U[1] * ly + U[2] * lz);
      const tz = F[0] * lx + F[1] * ly + F[2] * lz;

      // Columns of P * V, written directly: P only scales rows 2 and 3.
      m[base + 0] = R[0];   m[base + 1] = U[0];   m[base + 2] = -F[0] * p10;  m[base + 3] = F[0];
      m[base + 4] = R[1];   m[base + 5] = U[1];   m[base + 6] = -F[1] * p10;  m[base + 7] = F[1];
      m[base + 8] = R[2];   m[base + 9] = U[2];   m[base + 10] = -F[2] * p10; m[base + 11] = F[2];
      m[base + 12] = tx;    m[base + 13] = ty;    m[base + 14] = tz * p10 + p14; m[base + 15] = -tz;
    }
  }

  /**
   * Gather shadow casters per light and scatter their matrices into one
   * buffer, grouped by mesh. Materials do not matter for a depth-only pass, so
   * the sort key is just the mesh — fewer, bigger batches than the main pass.
   */
  _buildShadowBatches(world, lights) {
    const batches = this._shadowBatches;
    batches.length = 0;
    if (lights.length === 0) return 0;

    const archetypes = world.query([LocalToWorld, MeshRef, Bounds], [Hidden]);
    // Keyed by (mesh, material), not mesh alone: an alpha-tested material needs
    // its own pipeline and texture in the depth pass.
    const matCount = Math.max(1, this.materials.length);
    const meshCount = Math.max(1, this.meshes.length) * matCount;
    if (!this._sCounts || this._sCounts.length < meshCount + 1) {
      this._sCounts = new Uint32Array(meshCount + 1);
      this._sCursor = new Uint32Array(meshCount + 1);
    }

    let total = 0;
    for (const a of archetypes) total += a.count;
    this._growVisibility(total);

    let written = 0;
    const cap = this.shadows.maxCasters;

    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      this._sCounts.fill(0, 0, meshCount + 1);

      let visible = 0;
      for (let ai = 0; ai < archetypes.length && written + visible < cap; ai++) {
        const a = archetypes[ai];
        const W = a.columns.get(LocalToWorld.id);
        const R = a.columns.get(MeshRef.id);
        const B = a.columns.get(Bounds.id);
        for (let r = 0; r < a.count; r++) {
          const mat = this.materials[R[r * 2 + M_MATERIAL]];
          if (mat && mat.castShadow === false) continue;

          // Cull against the light's sphere of influence: everything outside
          // the range contributes nothing, and cube maps are expensive enough
          // that this one test pays for itself many times over.
          const w = r * 16, b = r * 4;
          const cx = W[w] * B[b] + W[w + 4] * B[b + 1] + W[w + 8] * B[b + 2] + W[w + 12];
          const cy = W[w + 1] * B[b] + W[w + 5] * B[b + 1] + W[w + 9] * B[b + 2] + W[w + 13];
          const cz = W[w + 2] * B[b] + W[w + 6] * B[b + 1] + W[w + 10] * B[b + 2] + W[w + 14];
          const s = Math.max(
            Math.hypot(W[w], W[w + 1], W[w + 2]),
            Math.hypot(W[w + 4], W[w + 5], W[w + 6]),
            Math.hypot(W[w + 8], W[w + 9], W[w + 10]));
          const radius = B[b + 3] * s;
          const dx = cx - L.x, dy = cy - L.y, dz = cz - L.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > (L.range + radius) * (L.range + radius)) continue;
          // A small caster that encloses the light is its bulb: drawn into the
          // light's own cube map it would shadow the whole scene. Only small
          // ones, though — a wall or a whole building also "encloses" a light
          // inside its bounding sphere, and skipping those made shadows blink
          // on and off as lights crossed the sphere boundary.
          if (distSq < radius * radius && radius < Math.min(1, 0.1 * L.range)) continue;

          const mesh = R[r * 2 + M_MESH] * matCount + R[r * 2 + M_MATERIAL];
          this._sVisArch[visible] = ai;
          this._sVisRow[visible] = r;
          this._sVisMesh[visible] = mesh;
          this._sCounts[mesh]++;
          visible++;
        }
      }
      if (visible === 0) { L.slot = -1; continue; }

      let running = written;
      for (let k = 0; k < meshCount; k++) {
        this._sCursor[k] = running;
        if (this._sCounts[k] > 0) {
          batches.push({
            light: li, mesh: (k / matCount) | 0, material: k % matCount,
            first: running, count: this._sCounts[k],
          });
        }
        running += this._sCounts[k];
      }

      this.shadowModels.ensure((written + visible) * 16);
      const dst = this.shadowModels.cpu;
      for (let i = 0; i < visible; i++) {
        const a = archetypes[this._sVisArch[i]];
        const r = this._sVisRow[i];
        const slot = this._sCursor[this._sVisMesh[i]]++;
        const W = a.columns.get(LocalToWorld.id);
        for (let m = 0; m < 16; m++) dst[slot * 16 + m] = W[r * 16 + m];
      }
      written += visible;
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

    /* ---- lights, and which of them get a shadow map ---- */
    const lightList = [];
    for (const a of world.query([Transform, PointLight])) {
      const T = a.columns.get(Transform.id);
      const L = a.columns.get(PointLight.id);
      for (let r = 0; r < a.count && lightList.length < MAX_LIGHTS; r++) {
        const tOff = r * 10 + T_POS, l = r * 5;
        lightList.push({
          entity: a.entities[r],
          x: T[tOff], y: T[tOff + 1], z: T[tOff + 2],
          r: L[l], g: L[l + 1], b: L[l + 2],
          intensity: L[l + 3], range: L[l + 4], slot: -1,
        });
      }
    }

    let shadowLights = [];
    if (this.shadows.enabled && this.shadows.maxLights > 0) {
      // Rank by how much of the view each light can plausibly affect: bright,
      // near lights keep their maps, distant dim ones lose theirs first.
      const ex = camera.position[0], ey = camera.position[1], ez = camera.position[2];
      const ranked = lightList
        .map((l) => {
          const d = Math.hypot(l.x - ex, l.y - ey, l.z - ez);
          return { l, score: l.intensity / (1 + d * d * 0.01) };
        })
        .sort((a, b) => b.score - a.score);

      /*
       * Assignment is sticky, and it has to be.
       *
       * Equally bright lights orbiting at the same radius score within a
       * rounding error of each other, so a plain "top N by score" reshuffles
       * the winners every frame and shadows visibly blink in and out. A light
       * therefore keeps the map it already holds while it stays anywhere near
       * the cut, and only loses it to a light that is clearly ahead.
       */
      const max = this.shadows.maxLights;
      const margin = Math.min(ranked.length, max + 2);
      const next = new Map();
      const taken = new Set();

      for (let i = 0; i < margin && next.size < max; i++) {
        const l = ranked[i].l;
        const held = this._shadowSlots.get(l.entity);
        if (held !== undefined && !taken.has(held)) {
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
        if (slot === undefined) break;
        next.set(l.entity, slot);
      }

      this._shadowSlots = next;
      for (const l of lightList) {
        const slot = next.get(l.entity);
        if (slot !== undefined) { l.slot = slot; shadowLights.push(l); }
      }
    } else {
      this._shadowSlots.clear();
    }

    const shadowCasters = this.shadows.enabled
      ? this._buildShadowBatches(world, shadowLights) : 0;
    if (shadowCasters > 0) {
      this.shadowModels.flush(shadowCasters * 16);
      for (const l of shadowLights) {
        if (l.slot < 0) continue;
        this._writeFaceMatrices(l.slot, l.x, l.y, l.z, this.shadows.near, l.range);
      }
      this.device.queue.writeBuffer(this.faceBuffer, 0, this.faceData);
    }
    this._rebuildShadowBindGroup();

    /* ---- light buffer ---- */
    for (let i = 0; i < lightList.length; i++) {
      const l = lightList[i], o = i * LIGHT_FLOATS;
      this.lightData[o] = l.x; this.lightData[o + 1] = l.y; this.lightData[o + 2] = l.z;
      this.lightData[o + 3] = l.range;
      this.lightData[o + 4] = l.r; this.lightData[o + 5] = l.g; this.lightData[o + 6] = l.b;
      // Physical units: lumens to candela for an isotropic point light.
      this.lightData[o + 7] = this.physical.enabled ? l.intensity / (4 * Math.PI) : l.intensity;
      this.lightData[o + 8] = shadowCasters > 0 ? l.slot : -1;
      this.lightData[o + 9] = this.shadows.near;
      this.lightData[o + 10] = this.shadows.bias;
      this.lightData[o + 11] = l.range;
    }
    if (lightList.length > 0) {
      this.device.queue.writeBuffer(
        this.lightBuffer, 0, this.lightData.buffer, 0, lightList.length * LIGHT_FLOATS * 4);
    }

    /* ---- camera uniform ---- */
    const cd = this.cameraData;
    cd.set(camera.viewProj, 0);
    cd.set(camera.view, 16);
    cd.set(camera.invView, 32);
    cd[48] = camera.position[0]; cd[49] = camera.position[1];
    cd[50] = camera.position[2]; cd[51] = time;
    cd[52] = lightList.length;
    cd[53] = this.effectiveExposure();
    cd[54] = this.fogDensity;
    cd[55] = this.fxaa ? 1 : 0;
    cd.set(this.ambient, 56); cd[59] = this.groundAmbient;
    cd.set(this.fogColor, 60); cd[63] = this.aerialPerspective;
    cd[64] = camera.projection[0];
    cd[65] = camera.projection[5];
    cd[66] = camera.near;
    cd[67] = camera.aspect;
    cd[68] = this.ssr.intensity;
    cd[69] = this.ssr.steps;
    cd[70] = this.ssr.thickness;
    cd[71] = this.ssr.maxDistance;
    cd[72] = width; cd[73] = height; cd[74] = 1 / width; cd[75] = 1 / height;
    cd[76] = this.ao.intensity; cd[77] = this.ao.radius;
    cd[78] = this.ao.power; cd[79] = this.ao.bias;
    cd[80] = this.bloom.threshold; cd[81] = this.bloom.knee;
    cd[82] = this.bloom.strength; cd[83] = 0;
    cd[84] = this.shadows.size; cd[85] = this.shadows.pcfRadius;
    cd[86] = this.shadows.normalBias; cd[87] = 0;
    cd[88] = this.ao.fadeDistance; cd[89] = this.ssr.fadeDistance;
    cd[90] = 0; cd[91] = 0;

    const dtFrame = this._lastTime === undefined ? 0 : Math.min(Math.max(time - this._lastTime, 0), 0.25);
    this._lastTime = time;
    cd[92] = this.ssil.intensity; cd[93] = this.ssil.radius; cd[94] = 0; cd[95] = 0;
    const v = this.volumetric;
    cd[96] = v.density; cd[97] = v.steps; cd[98] = v.anisotropy; cd[99] = v.maxDistance;
    cd[100] = v.heightBase; cd[101] = v.heightFalloff; cd[102] = v.ambient; cd[103] = v.lightScatter;
    cd[104] = v.color[0]; cd[105] = v.color[1]; cd[106] = v.color[2]; cd[107] = v.enabled ? 1 : 0;
    const tm = this.tonemap;
    cd[108] = TONEMAP_MODES[tm.mode] ?? 3; cd[109] = tm.white; cd[110] = tm.contrast; cd[111] = tm.saturation;
    const ae = this.autoExposure;
    cd[112] = tm.brightness; cd[113] = ae.enabled ? 1 : 0; cd[114] = this.exposureCompensation; cd[115] = ae.key;
    cd[116] = ae.min; cd[117] = ae.max; cd[118] = ae.speed; cd[119] = dtFrame;
    const df = this.dof;
    cd[120] = df.focus; cd[121] = df.range; cd[122] = df.transition; cd[123] = df.amount;
    cd[124] = df.near ? 1 : 0; cd[125] = df.far ? 1 : 0; cd[126] = df.autoFocus ? 1 : 0; cd[127] = df.enabled ? 1 : 0;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cd);

    if (this.frustumCulling) frustumFromMatrix(this._frustum, 0, camera.viewProj, 0);

    /* ---- cull, and key each survivor by (mesh, material) ---- */
    const archetypes = world.query([LocalToWorld, MeshRef, Bounds], [Hidden]);
    let total = 0;
    for (const a of archetypes) total += a.count;
    this._growVisibility(total);

    const matCount = Math.max(1, this.materials.length);
    const keyCount = Math.max(1, this.meshes.length) * matCount;
    if (!this._counts || this._counts.length < keyCount + 1) {
      this._counts = new Uint32Array(keyCount + 1);
      this._cursor = new Uint32Array(keyCount + 1);
    } else {
      this._counts.fill(0, 0, keyCount + 1);
    }

    let visible = 0, culled = 0;
    for (let ai = 0; ai < archetypes.length; ai++) {
      const a = archetypes[ai];
      const W = a.columns.get(LocalToWorld.id);
      const R = a.columns.get(MeshRef.id);
      const B = a.columns.get(Bounds.id);
      const n = a.count;
      for (let r = 0; r < n; r++) {
        if (this.frustumCulling) {
          const w = r * 16, b = r * 4;
          // World-space sphere: transform the center, scale the radius by the
          // largest axis scale. Three hypots, no matrix decomposition.
          const cx = W[w] * B[b] + W[w + 4] * B[b + 1] + W[w + 8] * B[b + 2] + W[w + 12];
          const cy = W[w + 1] * B[b] + W[w + 5] * B[b + 1] + W[w + 9] * B[b + 2] + W[w + 13];
          const cz = W[w + 2] * B[b] + W[w + 6] * B[b + 1] + W[w + 10] * B[b + 2] + W[w + 14];
          const s = Math.max(
            Math.hypot(W[w], W[w + 1], W[w + 2]),
            Math.hypot(W[w + 4], W[w + 5], W[w + 6]),
            Math.hypot(W[w + 8], W[w + 9], W[w + 10]));
          if (!sphereInFrustum(this._frustum, 0, cx, cy, cz, B[b + 3] * s)) { culled++; continue; }
        }
        const key = R[r * 2 + M_MESH] * matCount + R[r * 2 + M_MATERIAL];
        this._visArch[visible] = ai;
        this._visRow[visible] = r;
        this._visKey[visible] = key;
        this._counts[key]++;
        visible++;
      }
    }

    let running = 0;
    for (let k = 0; k < keyCount; k++) {
      this._cursor[k] = running;
      running += this._counts[k];
    }

    this.instances.ensure(visible * INSTANCE_FLOATS);
    const inst = this.instances.cpu;
    for (let i = 0; i < visible; i++) {
      const a = archetypes[this._visArch[i]];
      const r = this._visRow[i];
      const slot = this._cursor[this._visKey[i]]++;
      const o = slot * INSTANCE_FLOATS;

      const W = a.columns.get(LocalToWorld.id);
      for (let m = 0; m < 16; m++) inst[o + m] = W[r * 16 + m];

      const mat = this.materials[a.columns.get(MeshRef.id)[r * 2 + M_MATERIAL]] ?? this.materials[0];
      const C = a.columns.get(InstanceColor.id);
      if (C) {
        inst[o + 16] = C[r * 4]; inst[o + 17] = C[r * 4 + 1];
        inst[o + 18] = C[r * 4 + 2]; inst[o + 19] = mat.alpha;
        inst[o + 22] = C[r * 4 + 3];
      } else {
        inst[o + 16] = mat.color[0]; inst[o + 17] = mat.color[1];
        inst[o + 18] = mat.color[2]; inst[o + 19] = mat.alpha;
        inst[o + 22] = mat.emissive;
      }
      inst[o + 20] = mat.metallic;
      inst[o + 21] = mat.roughness;
      inst[o + 23] = 0;
      inst[o + 24] = mat.noiseScale;
      inst[o + 25] = mat.noiseStrength;
      inst[o + 26] = mat.bump;
      inst[o + 27] = mat.oxide;
    }
    this.instances.flush(visible * INSTANCE_FLOATS);
    this._rebuildFrameBindGroup();

    /* ================================ encode ============================= */
    const enc = this.device.createCommandEncoder({ label: 'axion-frame' });
    let shadowDraws = 0;

    /* ---- 1. shadow cube faces ---- */
    if (shadowCasters > 0) {
      const maxSlot = (this._shadowFaceViews.length / 6) | 0;
      for (const light of shadowLights) {
        if (light.slot < 0 || light.slot >= maxSlot) continue;
        const batches = this._shadowBatches.filter((b) => shadowLights[b.light] === light);
        for (let face = 0; face < 6; face++) {
          const layer = light.slot * 6 + face;
          const pass = enc.beginRenderPass({
            label: `axion-shadow-${layer}`,
            colorAttachments: [],
            depthStencilAttachment: {
              view: this._shadowFaceViews[layer],
              depthClearValue: 1.0,
              depthLoadOp: 'clear', depthStoreOp: 'store',
            },
          });
          pass.setBindGroup(0, this.shadowBindGroup, [layer * FACE_SLOT_BYTES]);
          pass.setVertexBuffer(0, this.vertexArena.buffer);
          pass.setIndexBuffer(this.indexArena.buffer, 'uint32');
          let bound = null;
          for (const b of batches) {
            const m = this.meshes[b.mesh];
            if (!m) continue;
            const mat = this.materials[b.material];
            const pipeline = mat?.masked ? this._shadowMaskPipeline : this._shadowPipeline;
            if (pipeline !== bound) { pass.setPipeline(pipeline); bound = pipeline; }
            if (mat?.masked) pass.setBindGroup(1, mat.bindGroup);
            pass.drawIndexed(m.indexCount, b.count, m.firstIndex, m.baseVertex, b.first);
            shadowDraws++;
          }
          pass.end();
        }
      }
    }

    /* ---- 2. geometry ---- */
    const geo = enc.beginRenderPass({
      label: 'axion-geometry',
      colorAttachments: [
        {
          view: t.colorView,
          clearValue: { r: this.clearColor[0], g: this.clearColor[1], b: this.clearColor[2], a: this.clearColor[3] },
          loadOp: 'clear', storeOp: 'store',
        },
        { view: t.surfaceView, clearValue: { r: 0, g: 0, b: 1, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: t.albedoView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
      depthStencilAttachment: {
        view: t.depthView,
        depthClearValue: 0.0,          // reverse-Z
        depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    geo.setBindGroup(0, this.frameBindGroup);
    geo.setVertexBuffer(0, this.vertexArena.buffer);
    geo.setIndexBuffer(this.indexArena.buffer, 'uint32');

    let draws = 0, tris = 0, batches = 0, currentPipeline = null, currentMaterial = null;
    for (let phase = 0; phase < 2; phase++) {
      for (let k = 0; k < keyCount; k++) {
        const count = this._counts[k];
        const start = this._cursor[k] - count;
        if (count === 0) continue;
        const material = this.materials[k % matCount] ?? this.materials[0];
        if ((material.transparent ? 1 : 0) !== phase) continue;
        const m = this.meshes[(k / matCount) | 0];
        if (!m) continue;

        const pipeline = this._pipelineFor(material);
        if (pipeline !== currentPipeline) { geo.setPipeline(pipeline); currentPipeline = pipeline; }
        if (material !== currentMaterial) { geo.setBindGroup(1, material.bindGroup); currentMaterial = material; }
        geo.drawIndexed(m.indexCount, count, m.firstIndex, m.baseVertex, start);
        draws++; batches++;
        tris += (m.indexCount / 3) * count;
      }
    }
    geo.end();

    /* ---- 3. ambient occlusion ---- */
    const fullscreen = (label, view, pipeline, bindGroup, load = 'clear') => {
      const pass = enc.beginRenderPass({
        label,
        colorAttachments: [{
          view, loadOp: load, storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    };

    fullscreen('axion-ao', t.aoView, this._aoPipeline, this.aoBindGroup);
    fullscreen('axion-ao-blur', t.aoBlurView, this._aoBlurPipeline, this.aoBlurBindGroup);

    /* ---- 3b. volumetric fog ---- */
    let volumePasses = 0;
    if (this.volumetric.enabled && this.volumetric.density > 0) {
      if (!this._volumeBindGroup || this._volumeShadowView !== this._shadowArrayView) {
        this._volumeShadowView = this._shadowArrayView;
        this._volumeBindGroup = this.device.createBindGroup({
          layout: this._volumeLayout, label: 'axion-volume',
          entries: [
            { binding: 0, resource: { buffer: this.cameraBuffer } },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: t.depthView },
            { binding: 3, resource: { buffer: this.lightBuffer } },
            { binding: 4, resource: this._shadowArrayView },
            { binding: 5, resource: this._shadowSampler },
          ],
        });
      }
      fullscreen('axion-volume', t.volView, this._volumePipeline, this._volumeBindGroup);
      fullscreen('axion-volume-blur', t.volBlurView, this._aoBlurPipeline, this.volBlurBindGroup);
      volumePasses = 2;
    }

    /* ---- 4. resolve ---- */
    fullscreen('axion-resolve', t.hdrView, this._resolvePipeline, this.resolveBindGroup);

    /* ---- 4a. depth of field ---- */
    const dof = this.dof;
    let dofPasses = 0;
    if (dof.enabled && dof.amount > 0 && (dof.near || dof.far)) {
      fullscreen('axion-dof', t.colorView, this._dofPipeline, this.dofBindGroup);
      enc.copyTextureToTexture({ texture: t.color }, { texture: t.hdr }, [width, height, 1]);
      dofPasses = 1;
    }

    /* ---- 4b. auto exposure: measure the resolved frame on the GPU ---- */
    if (this.autoExposure.enabled) {
      const cp = enc.beginComputePass({ label: 'axion-exposure' });
      cp.setPipeline(this._exposurePipeline);
      cp.setBindGroup(0, this.exposureBindGroup);
      cp.dispatchWorkgroups(1);
      cp.end();
    }

    /* ---- 5. bloom ---- */
    if (t.bloom.length > 0 && this.bloom.strength > 0) {
      fullscreen('axion-bloom-prefilter', t.bloomViews[0], this._bloomPrefilterPipeline, this.bloomFromHdr);
      for (let i = 1; i < t.bloom.length; i++) {
        fullscreen(`axion-bloom-down-${i}`, t.bloomViews[i], this._bloomDownPipeline, this.bloomBindGroups[i - 1]);
      }
      // Upsample walks back down the array, adding each blurred level onto the
      // next larger one. The additive blend does the accumulation, so there is
      // no ping-pong target and no extra copy.
      for (let i = t.bloom.length - 1; i > 0; i--) {
        fullscreen(`axion-bloom-up-${i}`, t.bloomViews[i - 1], this._bloomUpPipeline,
          this.bloomBindGroups[i], 'load');
      }
    }

    /* ---- 6. final ---- */
    const final = enc.beginRenderPass({
      label: 'axion-final',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    final.setPipeline(this._finalPipeline);
    final.setBindGroup(0, this.finalBindGroup);
    final.draw(3);
    final.end();

    this.device.queue.submit([enc.finish()]);

    const bloomPasses = t.bloom.length > 0 && this.bloom.strength > 0
      ? t.bloom.length * 2 - 1 : 0;
    this.stats.drawCalls = draws + shadowDraws + 3 + volumePasses + dofPasses + bloomPasses + 1;
    this.stats.batches = batches;
    this.stats.instances = visible;
    this.stats.culled = culled;
    this.stats.triangles = tris;
    this.stats.shadowDraws = shadowDraws;
    this.stats.shadowCasters = shadowCasters;
    this.stats.shadowLights = shadowCasters > 0 ? shadowLights.filter((l) => l.slot >= 0).length : 0;
    this.stats.cpuMs = performance.now() - t0;
  }

  destroy() {
    this.vertexArena.destroy();
    this.indexArena.destroy();
    this.instances.destroy();
    this.shadowModels.destroy();
    this.cameraBuffer.destroy();
    this.lightBuffer.destroy();
    this.faceBuffer.destroy();
    this.exposureBuffer.destroy();
    this._shadowTexture?.destroy();
    for (const tex of this._targets?.all ?? []) tex.destroy();
  }
}
