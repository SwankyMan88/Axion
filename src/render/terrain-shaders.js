/**
 * Terrain, water and grass (WGSL).
 *
 * All three are drawn from one shared grid mesh and a list of placements in a
 * storage buffer: terrain patches of different sizes, water patches, and
 * grass tiles. Heights come from one float texture that the vertex shader
 * reads directly, so the ground has no vertex buffer of its own at all.
 */

import { COMMON, CUBE_WGSL, NOISE_WGSL, SCENE_WGSL, LIGHTING_WGSL } from './shaders.js';

/** Group 1 for everything the terrain draws. */
const TERRAIN_GROUP = /* wgsl */`
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
`;

/* ------------------------------------------------------------ terrain --- */

export const TERRAIN_WGSL = /* wgsl */`
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

/**
 * Slope of the lake surface, for the water normal. Wind-driven ripples: wave
 * trains spread around the wind's direction with wavelengths that never line
 * up, a slow patchwork of calmer and gustier water drifting downwind (the
 * dark "cat's paws" on a real lake), and fine noise on top, so no pattern
 * repeats across the lake.
 */
fn waveSlope(xz : vec2<f32>, t : f32) -> vec2<f32> {
  var wd = camera.wind.xy;
  if (dot(wd, wd) < 1e-4) { wd = vec2<f32>(0.8, 0.6); }
  wd = normalize(wd);
  let side = vec2<f32>(-wd.y, wd.x);

  // Gust patches, drifting with the wind
  let drift = xz - wd * t * 1.6;
  let gust = 0.35 + 0.9 * smoothstep(0.3, 0.75, fbm2(drift * 0.012, 3));

  var g = vec2<f32>(0.0);
  let spread = array<f32, 8>(0.0, 0.55, -0.42, 0.95, -0.8, 0.25, -1.2, 1.35);
  let lens = array<f32, 8>(5.3, 3.1, 2.37, 1.61, 1.13, 0.83, 0.59, 0.41);
  let phase = array<f32, 8>(0.0, 1.7, 4.1, 2.6, 5.3, 0.9, 3.8, 2.2);
  for (var i = 0; i < 8; i = i + 1) {
    let dir = normalize(wd * cos(spread[i]) + side * sin(spread[i]));
    let k = 6.2831853 / lens[i];
    let c = sqrt(9.81 / k);
    // Each train warps a little across the lake so crests aren't ruler-straight
    let bend = noise2(xz * (0.05 + f32(i) * 0.013) + vec2<f32>(f32(i) * 7.1, 3.3)) * 2.4;
    let ph = dot(dir, xz) * k + bend - c * k * t * 0.35 + phase[i];
    let a = 0.011 * lens[i] * (0.6 + 0.4 * sin(f32(i) * 2.3 + dot(xz, side) * 0.01));
    g = g + dir * (a * k * cos(ph));
  }
  g = g * gust;

  // Fine chop: two layers of noise sliding at different speeds
  let e = 0.12;
  let s1 = xz * 1.7 + wd * t * 0.55;
  let s2 = xz * 3.9 - side * t * 0.35 + wd * t * 0.9;
  let n1 = noise2(s1);
  let n2 = noise2(s2);
  let dx = (noise2(s1 + vec2<f32>(e * 1.7, 0.0)) - n1) + (noise2(s2 + vec2<f32>(e * 3.9, 0.0)) - n2) * 0.5;
  let dz = (noise2(s1 + vec2<f32>(0.0, e * 1.7)) - n1) + (noise2(s2 + vec2<f32>(0.0, e * 3.9)) - n2) * 0.5;
  g = g + vec2<f32>(dx, dz) / e * 0.035 * (0.5 + gust * 0.5);
  return g * (0.5 + 0.5 * camera.wind.z);
}

/** Top of the ground at xz, with the forest canopy on it where there is forest. */
fn canopyTop(xz : vec2<f32>) -> f32 {
  let h = heightAt(xz);
  let forest = textureSampleLevel(splatTex, clampSampler, terrainUV(xz), 0.0).r;
  return h + smoothstep(0.25, 0.6, forest) * 14.0;
}

/**
 * What the lake mirrors where the screen has no picture of it (off the edge of
 * the screen, or hidden behind something near): the reflected ray is marched
 * over the heightmap itself, with forest canopy standing on the ground where
 * the map says there is forest. Returns the lit colour and the distance, or a
 * negative distance when the ray only finds sky.
 */
fn mirrorMarch(start : vec3<f32>, R : vec3<f32>) -> vec4<f32> {
  if (R.y > 0.6) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  var t = 1.5;
  var prev = 0.0;
  var hit = false;
  for (var i = 0; i < 64; i = i + 1) {
    let p = start + R * t;
    if (p.y > 700.0 || t > 1800.0) { break; }
    if (p.y < canopyTop(p.xz)) { hit = true; break; }
    prev = t;
    t = t + 1.0 + t * 0.1;
  }
  if (!hit) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  // Close in on the crossing
  var lo = prev;
  var hi = t;
  for (var k = 0; k < 5; k = k + 1) {
    let mid = (lo + hi) * 0.5;
    let q = start + R * mid;
    if (q.y < canopyTop(q.xz)) { hi = mid; } else { lo = mid; }
  }
  let p = start + R * hi;
  let uvT = terrainUV(p.xz);
  let h = heightAt(p.xz);
  var N = normalize(textureSampleLevel(normalTex, clampSampler, uvT, 0.0).xyz * 2.0 - 1.0);
  let splat = textureSampleLevel(splatTex, clampSampler, uvT, 0.0);

  // The ground's colour: each layer's average, mixed as the ground mixes them
  var w = array<f32, 5>(max(1.0 - (splat.r + splat.g + splat.b + splat.a), 0.0), splat.r, splat.g, splat.b, splat.a);
  if (tp.rock.x >= 0.0) {
    let rw = smoothstep(tp.rock.y, tp.rock.z, 1.0 - N.y) * tp.rock.w;
    for (var j = 0; j < 5; j = j + 1) { w[j] = w[j] * (1.0 - rw); }
    w[i32(tp.rock.x)] = w[i32(tp.rock.x)] + rw;
  }
  var col = vec3<f32>(0.0);
  var total = 0.0;
  let count = min(i32(tp.info3.z), 5);
  for (var j = 0; j < count; j = j + 1) {
    let avg = textureSampleLevel(albedoArr, repeatSampler, vec2<f32>(0.5), j, 16.0).rgb * tp.tint[j].rgb;
    col = col + avg * w[j];
    total = total + w[j];
  }
  col = col / max(total, 1e-4);
  if (tp.snow.w > 0.0) {
    let sw = smoothstep(tp.snow.x, tp.snow.y, p.y) * (1.0 - smoothstep(tp.snow.z * 0.6, tp.snow.z, 1.0 - N.y));
    col = mix(col, vec3<f32>(0.8, 0.83, 0.88), sw * tp.snow.w);
  }
  // Treetops: dark needles, lit mostly from above
  if (p.y > h + 1.0) {
    col = vec3<f32>(0.035, 0.06, 0.03);
    N = normalize(N + vec3<f32>(0.0, 1.5, 0.0));
  }
  let L = camera.sunDir.xyz;
  var sun = vec3<f32>(0.0);
  if (camera.sunDir.w > 0.5) {
    sun = camera.sunColor.rgb * max(dot(N, L), 0.0) * horizonShadow(p + N * 2.0);
  }
  let lit = col * (sun + camera.ambient.rgb * (0.6 + 0.4 * N.y));
  return vec4<f32>(lit, hi);
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
  let foam = (1.0 - smoothstep(0.0, 0.12, depth)) * smoothstep(0.45, 0.8, foamNoise);
  albedo = mix(albedo, vec3<f32>(0.62, 0.66, 0.66), foam * 0.25);

  var s : Surface;
  s.P = world;
  s.N = N;
  s.geomN = vec3<f32>(0.0, 1.0, 0.0);
  s.V = V;
  s.albedo = albedo;
  s.roughness = mix(0.035, 0.6, foam);
  s.metallic = 0.0;
  s.translucency = 0.0;
  // The water's own sky light: the resolve leaves water out of its ambient,
  // because water's albedo slot carries the reflection below instead
  let Lo = shadeDirect(s, in.clip.xy) + albedo * camera.ambient.rgb;

  // The fallback reflection, packed into the albedo target: colour (square
  // root, over 8) and the distance it was found at (0 = only sky)
  // Looking steeply down, water reflects almost nothing: skip the march there
  let R2 = reflect(-V, N);
  var m = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  if (dot(N, V) < 0.6) {
    m = mirrorMarch(world + vec3<f32>(0.0, 0.05, 0.0), R2);
  }
  var out = gbuffer(Lo, 1.0, N, albedo, s.roughness, 0.0);
  if (m.w > 0.0) {
    out.albedo = vec4<f32>(sqrt(clamp(m.rgb / 8.0, vec3<f32>(0.0), vec3<f32>(1.0))), 0.02 + 0.98 * (1.0 - exp(-m.w / 800.0)));
  } else {
    out.albedo = vec4<f32>(0.0);
  }
  out.surface.w = 2.0;          // marks water for the resolve
  return out;
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
`;

/* ------------------------------------------------------ terrain shadow -- */

/** Terrain into the sun's cascades: the same patches and heights, depth only. */
export const TERRAIN_SHADOW_WGSL = /* wgsl */`
struct Face {
  viewProj : mat4x4<f32>,
  eye : vec4<f32>,
};
@group(0) @binding(0) var<uniform> face : Face;

${TERRAIN_GROUP.replace(/camera\.position\.xyz/g, 'face.eye.xyz')}

@vertex
fn vs(@builtin(instance_index) ii : u32, @location(0) grid : vec3<f32>) -> @builtin(position) vec4<f32> {
  let p = patches[ii];
  let G = tp.info3.x;
  let xz = p.xy + grid.xy / G * p.z;
  var h = heightAt(xz);
  if (grid.z > 0.5) { h = h - (tp.info3.y + p.z * 0.02); }
  return face.viewProj * vec4<f32>(xz.x, h, xz.y, 1.0);
}
`;
