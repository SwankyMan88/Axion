import { TERRAIN_WGSL, TERRAIN_SHADOW_WGSL } from './terrain-shaders.js';
import { textureArrayFromImages, generateMips, mipLevelsFor } from '../gpu/textures.js';

const PARAM_FLOATS = 112;
const PATCH_CAPACITY = 16384;

/**
 * Heightmap terrain with water and grass.
 *
 * The ground is one float texture of heights. Every frame a quadtree picks
 * square patches — small near the camera, large far away — and they are all
 * drawn in one instanced call from a single shared grid mesh; the vertex
 * shader reads the heights and slides vertices smoothly between detail
 * levels, so there is no popping and no per-patch memory. The same patch list
 * draws the lake surface, and a ring of tiles around the camera grows grass.
 *
 *   const terrain = app.terrain({
 *     heights,                   // Float32Array, n * n, metres; n = 2^k + 1
 *     size: 2048,                // metres across
 *     layers: [{ albedo, normal, scale: 4, roughness: 0.9 }, ...],
 *     splat: { data, size },     // RGBA weights for layers 1..4 (layer 0 takes the rest)
 *     rock: { layer: 2, slope: [0.35, 0.55] },
 *     snow: { height: [220, 280] },   // white peaks
 *     water: { level: 12 },
 *     grass: { radius: 60, height: 0.45 },
 *   });
 *   terrain.heightAt(x, z);      // same height the GPU draws
 */
export class Terrain {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const device = this.device = renderer.device;
    const heights = opts.heights;
    const n = Math.round(Math.sqrt(heights.length));
    if (n * n !== heights.length) throw new Error('axion terrain: heights must be n * n');
    this.n = n;
    this.heights = heights;
    this.size = opts.size ?? (n - 1);
    this.origin = opts.origin ?? [-this.size / 2, -this.size / 2];
    this.spacing = this.size / (n - 1);
    this.grid = opts.grid ?? 32;
    if ((n - 1) % this.grid !== 0) throw new Error('axion terrain: n - 1 must be a multiple of the patch grid');
    this.leafCount = (n - 1) / this.grid;
    this.levels = Math.round(Math.log2(this.leafCount));
    if (1 << this.levels !== this.leafCount) throw new Error('axion terrain: (n - 1) / grid must be a power of two');
    this.leafWorld = this.spacing * this.grid;
    this.lodRange = opts.lodRange ?? 2.4;
    this.morphStart = opts.morphStart ?? 0.65;
    this.version = 1;

    this.rock = { layer: opts.rock?.layer ?? -1, slope: opts.rock?.slope ?? [0.35, 0.55], strength: opts.rock?.strength ?? 1 };
    this.shore = { layer: opts.shore?.layer ?? -1, height: opts.shore?.height ?? 1.2, darken: opts.shore?.darken ?? 0.35 };
    /** Snow above `height[0]`, full at `height[1]`, on ground flatter than `slope` (1 - normal.y). */
    this.snow = {
      height: opts.snow?.height ?? [200, 260], slope: opts.snow?.slope ?? 0.45,
      amount: opts.snow ? (opts.snow.amount ?? 1) : 0,
    };
    this.macro = { variation: opts.macro?.variation ?? 0.35, scale: opts.macro?.scale ?? 0.012, far: opts.macro?.far ?? [30, 90] };
    this.water = opts.water ? {
      enabled: opts.water.enabled !== false,
      level: opts.water.level ?? 0,
      deep: opts.water.deep ?? [0.015, 0.045, 0.05],
      shallow: opts.water.shallow ?? [0.11, 0.16, 0.12],
      clarity: opts.water.clarity ?? 0.9,
      waves: opts.water.waves ?? 1,
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
      fade: g.fade ?? 0.72,
    };
    this.layers = (opts.layers ?? [{}]).slice(0, 8).map((l) => ({
      scale: l.scale ?? 4, roughness: l.roughness ?? 0.9, normalStrength: l.normalStrength ?? 1,
      triplanar: !!l.triplanar, tint: l.tint ?? [1, 1, 1],
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
        leafMin[pz * count + px] = lo; leafMax[pz * count + px] = hi;
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
            lo = Math.min(lo, prev.min[i]); hi = Math.max(hi, prev.max[i]);
          }
          mn[z * c2 + x] = lo; mx[z * c2 + x] = hi;
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
      label: 'axion-terrain-height', size: [n, n], format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: this.heightTex }, this.heights, { bytesPerRow: n * 4 }, [n, n]);

    // Normals from central differences, one per height sample.
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
    // With mips: far away the ground's normal is the average of what the pixel
    // covers, not one sample of it, so eroded slopes don't shimmer into stripes.
    this.normalTex = device.createTexture({
      label: 'axion-terrain-normal', size: [n, n], format: 'rgba8unorm', mipLevelCount: mipLevelsFor(n, n),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture: this.normalTex }, nrm, { bytesPerRow: n * 4 }, [n, n]);
    generateMips(device, this.normalTex);

    const sp = opts.splat;
    const sn = sp ? sp.size : 1;
    this.splatTex = device.createTexture({
      label: 'axion-terrain-splat', size: [sn, sn], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: this.splatTex }, sp ? sp.data : new Uint8Array(4),
      { bytesPerRow: sn * 4 }, [sn, sn]);

    const layers = opts.layers ?? [{}];
    const size = opts.layerSize ?? 1024;
    this.albedoArr = textureArrayFromImages(device, layers.map((l) => l.albedo ?? null),
      { size, srgb: true, label: 'axion-terrain-albedo' });
    this.normalArr = textureArrayFromImages(device, layers.map((l) => l.normal ?? null),
      { size, srgb: false, label: 'axion-terrain-normals' });

    this.repeatSampler = device.createSampler({
      label: 'axion-terrain-repeat',
      addressModeU: 'repeat', addressModeV: 'repeat',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
    });
    this.clampSampler = device.createSampler({
      label: 'axion-terrain-clamp',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    });
    this.paramBuffer = device.createBuffer({
      label: 'axion-terrain-params', size: PARAM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.patchBuffer = device.createBuffer({
      label: 'axion-terrain-patches', size: PATCH_CAPACITY * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
    // Skirt: each border edge gets a strip hanging down from it.
    const border = [];
    for (let x = 0; x < G; x++) border.push([x, 0, x + 1, 0]);
    for (let z = 0; z < G; z++) border.push([G, z, G, z + 1]);
    for (let x = G; x > 0; x--) border.push([x, G, x - 1, G]);
    for (let z = G; z > 0; z--) border.push([0, z, 0, z - 1]);
    for (const [x0, z0, x1, z1] of border) {
      const a = z0 * V + x0, b = z1 * V + x1;
      const base = verts.length / 3;
      verts.push(x0, z0, 1, x1, z1, 1);
      // Wound so the outside of the skirt faces out.
      idx.push(a, b, base, b, base + 1, base);
    }
    const vdata = new Float32Array(verts);
    const idata = new Uint32Array(idx);
    this.indexCount = idata.length;
    this.vertexBuffer = this.device.createBuffer({
      label: 'axion-terrain-grid', size: vdata.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vdata);
    this.indexBuffer = this.device.createBuffer({
      label: 'axion-terrain-grid-index', size: idata.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, idata);
  }

  _buildPipelines() {
    const d = this.device, r = this.renderer;
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.layout = d.createBindGroupLayout({
      label: 'axion-terrain',
      entries: [
        { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: V | F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: V | F, texture: { sampleType: 'float' } },
        { binding: 3, visibility: V | F, texture: { sampleType: 'float' } },
        { binding: 4, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 6, visibility: V | F, sampler: { type: 'filtering' } },
        { binding: 7, visibility: V | F, sampler: { type: 'filtering' } },
        { binding: 8, visibility: V | F, buffer: { type: 'uniform' } },
      ],
    });
    this.bindGroup = d.createBindGroup({
      layout: this.layout, label: 'axion-terrain',
      entries: [
        { binding: 0, resource: { buffer: this.patchBuffer } },
        { binding: 1, resource: this.heightTex.createView() },
        { binding: 2, resource: this.normalTex.createView() },
        { binding: 3, resource: this.splatTex.createView() },
        { binding: 4, resource: this.albedoArr.createView({ dimension: '2d-array' }) },
        { binding: 5, resource: this.normalArr.createView({ dimension: '2d-array' }) },
        { binding: 6, resource: this.repeatSampler },
        { binding: 7, resource: this.clampSampler },
        { binding: 8, resource: { buffer: this.paramBuffer } },
      ],
    });

    const module = d.createShaderModule({ code: TERRAIN_WGSL, label: 'axion-terrain' });
    const shadowModule = d.createShaderModule({ code: TERRAIN_SHADOW_WGSL, label: 'axion-terrain-shadow' });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [r._frameLayout, this.layout] });
    const grid = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }];
    const depthState = (write, compare) => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: compare });

    this.depthPipeline = d.createRenderPipeline({
      label: 'axion-terrain-depth', layout,
      vertex: { module, entryPoint: 'vsDepth', buffers: grid },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: depthState(true, 'greater'),
    });
    const surface = (pre) => d.createRenderPipeline({
      label: `axion-terrain-${pre ? 'equal' : 'greater'}`, layout,
      vertex: { module, entryPoint: 'vs', buffers: grid },
      fragment: { module, entryPoint: 'fs', targets: r.gbufferTargets(false) },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: pre ? depthState(false, 'equal') : depthState(true, 'greater'),
    });
    this.surfacePipelines = { pre: surface(true), direct: surface(false) };
    this.waterPipeline = d.createRenderPipeline({
      label: 'axion-water', layout,
      vertex: { module, entryPoint: 'vsWater', buffers: grid },
      fragment: { module, entryPoint: 'fsWater', targets: r.gbufferTargets(false) },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(true, 'greater'),
    });
    this.grassPipeline = d.createRenderPipeline({
      label: 'axion-grass', layout,
      vertex: { module, entryPoint: 'vsGrass', buffers: [] },
      fragment: { module, entryPoint: 'fsGrass', targets: r.gbufferTargets(false) },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(true, 'greater'),
    });
    this.shadowPipeline = d.createRenderPipeline({
      label: 'axion-terrain-sun-shadow',
      layout: d.createPipelineLayout({ bindGroupLayouts: [r._shadowLayout, this.layout] }),
      vertex: { module: shadowModule, entryPoint: 'vs', buffers: grid },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less',
        depthBias: 2, depthBiasSlopeScale: 2.5,
      },
    });
  }

  /** The twelve camera-uniform floats the terrain owns. */
  uniforms() {
    const g = this.grass, w = this.water;
    return [
      this.origin[0], this.origin[1], this.size, 1,
      this.n, w.level, w.enabled ? 1 : 0, g.fade,
      g.enabled ? g.radius : 0, g.height, g.width, g.enabled ? g.density : 0,
    ];
  }

  /* ----------------------------------------------------------- selection */

  _nodeBox(level, ix, iz, out) {
    const p = this.pyramid[level];
    const w = this.leafWorld * (1 << level);
    out[0] = this.origin[0] + ix * w; out[2] = this.origin[1] + iz * w;
    out[3] = out[0] + w; out[5] = out[2] + w;
    out[1] = p.min[iz * p.count + ix] - 1; out[4] = p.max[iz * p.count + ix] + 1;
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
      // Under a lake the patch's box sits below the water it also carries: the
      // box is tested up to the water surface, or looking down at the lake
      // would drop the water with the lake bed out of view.
      const top = bx[4];
      if (bx[1] < wl && bx[4] < wl + 1) bx[4] = wl + 1;
      if (frustum && !this._boxInFrustum(frustum, bx)) return;
      bx[4] = top;
      const dx = Math.max(bx[0] - cx, 0, cx - bx[3]);
      const dy = Math.max(bx[1] - cy, 0, cy - bx[4]);
      const dz = Math.max(bx[2] - cz, 0, cz - bx[5]);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (level === 0 || dist > (w / 2) * K) {
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
      if (level <= maxLevel) { out.push(bx[0], bx[2], w, level); return; }
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
      const outerSnap = r < 2 ? g.tile * (1 << (r + 1)) : s;
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
    // About two milliseconds of work per frame, however fast the machine is
    const t0 = performance.now();
    let j = H.row;
    // (the very first map is made in one go, during loading)
    const budget = H.done ? 2 : 1e9;
    for (; j < G && performance.now() - t0 < budget; j++) {
      for (let i = 0; i < G; i++) {
        const x = this.origin[0] + i * cell, z = this.origin[1] + j * cell;
        let top = -1e9;
        if (ly <= 0.002) top = 1e9;                     // light below the horizon
        else if (flat > 1e-4) {
          const dx = lx / flat, dz = lz / flat, slope = ly / flat;
          let d = cell * 1.5;
          while (d < this.size) {
            if (H.max - d * slope <= top) break;       // nothing farther can be higher
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
        label: 'axion-terrain-horizon', size: [G, G], format: 'rg32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.renderer.horizonView = H.tex.createView();
    }
    // The new heights in red, the ones they replace in green: the shader
    // cross-fades between them, so a moving sun slides the shadows instead of
    // stepping them.
    const pair = new Float32Array(G * G * 2);
    const old = H.done ?? H.work;
    for (let k = 0; k < G * G; k++) { pair[k * 2] = H.work[k]; pair[k * 2 + 1] = old[k]; }
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

    // Parameters: cheap enough to write every frame, and water needs the time.
    const p = this._params;
    const w = this.water, g = this.grass;
    p.set([this.origin[0], this.origin[1], this.size, this.n], 0);
    p.set([w.level, w.enabled ? 1 : 0, this.lodRange * this.renderer.lodBias, this.morphStart], 4);
    p.set([this.grid, 2, this.layers.length, performance.now() / 1000], 8);
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
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount, count, 0, 0, first);
    return 1;
  }

  /** Terrain, then water, then grass, into the geometry pass. */
  drawSurface(pass) {
    let draws = 0, tris = 0;
    const seg = this._segments;
    pass.setBindGroup(1, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    if (seg.main[1] > 0) {
      pass.setPipeline(this.renderer.depthPrepass ? this.surfacePipelines.pre : this.surfacePipelines.direct);
      pass.drawIndexed(this.indexCount, seg.main[1], 0, 0, seg.main[0]);
      draws++; tris += seg.main[1] * this.indexCount / 3;
    }
    if (this.water.enabled && seg.water[1] > 0) {
      pass.setPipeline(this.waterPipeline);
      pass.drawIndexed(this.indexCount, seg.water[1], 0, 0, seg.water[0]);
      draws++; tris += seg.water[1] * this.indexCount / 3;
    }
    if (this.grass.enabled && seg.grass.length) {
      pass.setPipeline(this.grassPipeline);
      const B = this.grass.bladesPerTile;
      for (const [first, count, ring] of seg.grass) {
        if (count === 0) continue;
        const segs = Math.max(3 - ring, 1);
        pass.draw(segs * 6 + 3, count * B, 0, first * B);
        draws++; tris += count * B * (segs * 2 + 1);
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
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
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
}
