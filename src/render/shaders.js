/**
 * Axion shaders (WGSL).
 *
 * The frame is a pass stack, and each program here is one stage of it:
 *
 *   SHADOW     — depth-only render of the casters from one cube face of one
 *                point light. Six faces per shadowed light, into one depth
 *                array texture.
 *   STANDARD   — forward geometry with three render targets: HDR direct light
 *                and emissive, a packed surface buffer (octahedral view normal,
 *                roughness, metallic), and albedo. Ambient is deliberately NOT
 *                added here — it is deferred so ambient occlusion can modulate
 *                it, which is the only way AO looks right rather than like a
 *                dirt layer smeared over direct light.
 *   AO         — horizon-based occlusion from depth and normals, half res.
 *   AO_BLUR    — depth-aware separable blur that keeps AO off silhouettes.
 *   RESOLVE    — screen-space reflections, deferred ambient × AO, fog. HDR out.
 *   BLOOM_*    — threshold, progressive downsample, tent upsample.
 *   FINAL      — bloom composite, ACES, gamma, FXAA to the swapchain.
 */

/* ------------------------------------------------------------- shared ---- */

export const COMMON = /* wgsl */`
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
 * Per-pixel white noise cannot be removed by a small blur — that is what
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
 * hemisphere had that axis erased — and a floor seen by a camera tilted
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
// screen — the difference between "reflective" and "black".
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
 * instead — an easy slip — shifts the lookup by up to a whole pixel, worst in
 * the middle of the screen, so a depth test and the colour fetched for the
 * same "hit" can come from two different pixels.
 */
fn pixelOf(uv : vec2<f32>) -> vec2<i32> {
  let size = vec2<i32>(camera.screen.xy);
  return clamp(vec2<i32>(floor(uv * camera.screen.xy)), vec2<i32>(0), size - vec2<i32>(1));
}

/** Fullscreen triangle from the vertex index alone — no vertex buffer. */
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
`;

/* ---------------------------------------------------------- cube faces --- */

/**
 * Cube face basis, shared verbatim by the shadow render and the shadow lookup.
 * Both sides derive everything from this one table, so the two can never fall
 * out of agreement — which is the classic way cube shadows go subtly wrong.
 */
export const CUBE_FACES = [
  { f: [1, 0, 0], u: [0, -1, 0] },
  { f: [-1, 0, 0], u: [0, -1, 0] },
  { f: [0, 1, 0], u: [0, 0, 1] },
  { f: [0, -1, 0], u: [0, 0, -1] },
  { f: [0, 0, 1], u: [0, -1, 0] },
  { f: [0, 0, -1], u: [0, -1, 0] },
];

export const CUBE_WGSL = /* wgsl */`
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
`;

export const MATERIAL_WGSL = /* wgsl */`
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
`;

/* ------------------------------------------------------------- shadow ---- */

export const SHADOW_WGSL = /* wgsl */`
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
`;

/* ------------------------------------------------------------- noise ---- */

export const NOISE_WGSL = /* wgsl */`
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

/** Trilinear value noise with a smootherstep fade — no visible lattice. */
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
`;

/* ------------------------------------------------------ scene bindings -- */

/**
 * Group 0 for every pass that draws surfaces into the G-buffer: objects,
 * terrain, water and grass share one layout and one bind group, so switching
 * between them never rebinds the frame.
 */
export const SCENE_WGSL = /* wgsl */`
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
`;

/* ------------------------------------------------------------ lighting -- */

export const LIGHTING_WGSL = /* wgsl */`
/**
 * Point-light shadow lookup.
 *
 * The stored value is the cube-face projected depth, so the reference depth
 * reduces to a single reciprocal of the major-axis distance — no per-pixel
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
 * of the chosen cascade — acne goes away without the bias that would float
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
 * light. Ambient is not here — the resolve pass adds it, under AO.
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
`;

/* ------------------------------------------------------------ geometry -- */

export const STANDARD_WGSL = /* wgsl */`
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

  // A double-sided surface seen from behind must be lit from behind — except
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
`;

/* ----------------------------------------------------------------- AO --- */

export const AO_WGSL = /* wgsl */`
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
  //   Distance — the world-space radius projects to under a pixel, so
  //   neighbouring pixels sample unrelated geometry and the result is salt and
  //   pepper rather than occlusion.
  //
  //   Grazing angles — a surface nearly edge-on to the view has almost no
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
    // along the same slice direction but over its own, wider radius — bounce
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
`;

export const AO_BLUR_WGSL = /* wgsl */`
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
  // one whole set of sample directions — a 5x5 would double-count some and
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
`;

/* ---------------------------------------------------------- volumetric -- */

export const VOLUME_WGSL = /* wgsl */`
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
 * offsets, then the shared depth-aware blur — the same budget trick as AO.
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
`;

/* -------------------------------------------------------- auto exposure -- */

/**
 * Average scene luminance (log2, centre-weighted) and ease the stored value
 * toward it. One 16x16 workgroup reads a 32x32 grid of the HDR target; the
 * result lives in a tiny storage buffer the final pass reads, so exposure
 * never makes a round trip to the CPU.
 */
export const EXPOSURE_WGSL = /* wgsl */`
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
`;

/* ------------------------------------------------------- depth of field -- */

export const DOF_WGSL = /* wgsl */`
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
`;

/* ---------------------------------------------------------------- sky --- */

/**
 * The sky lives in a small latitude-longitude texture, rebuilt only when the
 * sun moves. Elevation is stored with a square-root mapping, so the band just
 * above the horizon — where the colour changes fastest — gets most of the rows.
 */
const SKY_LOOKUP_WGSL = /* wgsl */`
fn skyUV(dir : vec3<f32>) -> vec2<f32> {
  let az = atan2(dir.z, dir.x);
  let el = asin(clamp(dir.y, -1.0, 1.0));
  let x = sign(el) * sqrt(abs(el) / (PI * 0.5));
  return vec2<f32>(az / (2.0 * PI) + 0.5, 0.5 - 0.5 * x);
}

fn skyRadiance(dir : vec3<f32>) -> vec3<f32> {
  return textureSampleLevel(skyLut, skySampler, skyUV(dir), 0.0).rgb * camera.sky2.x;
}
`;

/**
 * Single-scattering atmosphere (Rayleigh + Mie), marched per texel of the sky
 * table. The same model runs in JavaScript to colour the sunlight and the
 * ambient, so the light on the ground always matches the sky above it.
 */
export const SKY_WGSL = /* wgsl */`
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
`;

/* ------------------------------------------------------------ resolve --- */

/* ------------------------------------------------ screen-space reflection */

/**
 * Screen-space reflections in a pass of their own, so the result can be
 * denoised before the resolve uses it. Each pixel marches with one of sixteen
 * step phases from a 4x4 tile; the depth-aware 4x4 blur that follows (the
 * same one the occlusion uses) averages exactly one full set of phases, which
 * turns the hit-or-miss stipple of thin, distant geometry into a smooth partial
 * reflection. Output: colour x certainty in rgb, certainty in alpha.
 */
export const SSR_WGSL = /* wgsl */`
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
 * than the depth buffer can justify — that rejection is what keeps thin
 * geometry from smearing a false reflection across the floor.
 */
/**
 * Screen-space reflection, marched in screen space.
 *
 * The ray is projected to the screen once, then walked at roughly one pixel
 * per step while 1/z is interpolated linearly along that line — 1/z being the
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
 *      precision — a guaranteed false hit.
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
  // neighbour is the dark floor — which is exactly what drew a black seam.
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
`;

export const RESOLVE_WGSL = /* wgsl */`
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

  // Loaded, not filtered: the water flag and its packed reflection must not
  // blend with a neighbouring pixel
  let surf = textureLoad(surfaceTex, pixelOf(in.uv), 0);
  let alb4 = textureLoad(albedoTex, pixelOf(in.uv), 0);
  let aoGi = textureSampleLevel(aoTex, texSampler, in.uv, 0.0);
  let ao = aoGi.a;

  // Water (metallic 2) keeps a reflection of the land in its albedo slot
  let water = surf.w > 1.5;
  var albedo = alb4.rgb;
  var metallic = surf.w;
  if (water) {
    albedo = vec3<f32>(0.0);
    metallic = 0.0;
  }

  let N = octDecode(surf.xy);
  let roughness = surf.z;

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
  // Metals tint their reflection with their own albedo — f0 is the albedo, not
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
  if (water && alb4.a > 0.01) {
    // The land the water saw by marching the heightmap, hazed by the air
    // along the reflected ray like everything else at that distance
    let dist = -800.0 * log(max(1.0 - (alb4.a - 0.02) / 0.98, 1e-4));
    var land = alb4.rgb * alb4.rgb * 8.0;
    var haze = camera.fog.rgb;
    if (camera.sky.x > 0.5) {
      haze = skyRadiance(normalize(vec3<f32>(Rworld.x, max(Rworld.y, 0.0) * 0.5 + 0.03, Rworld.z)));
    }
    land = mix(land, haze, fogAmount(Rworld, dist));
    reflected = land;
  }
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
    // direction, sun glow included — golden toward the sun, blue away from it.
    aerial = skyRadiance(normalize(vec3<f32>(viewDirWorld.x, max(viewDirWorld.y, 0.0) * 0.5 + 0.03, viewDirWorld.z)));
  }
  let fogTarget = mix(camera.fog.rgb, aerial, camera.fog.a);
  hdr = mix(hdr, fogTarget, fog);
  hdr = applyVolume(hdr, in.uv);

  return vec4<f32>(sanitize(hdr), 1.0);
}
`;

/* -------------------------------------------------------------- bloom --- */

const BLOOM_COMMON = /* wgsl */`
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
`;

export const BLOOM_PREFILTER_WGSL = /* wgsl */`
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
`;

export const BLOOM_DOWN_WGSL = /* wgsl */`
${BLOOM_COMMON}

@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src, 0));
  return vec4<f32>(downsample13(in.uv, texel), 1.0);
}
`;

export const BLOOM_UP_WGSL = /* wgsl */`
${BLOOM_COMMON}

/**
 * Tent upsample, blended additively onto the larger mip. Walking the pyramid
 * back up with a small filter produces a wide, smooth glow from cheap passes —
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
`;

/* -------------------------------------------------------------- final --- */

export const FINAL_WGSL = /* wgsl */`
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
`;

/** Kept for compatibility with earlier imports. */
export const COMPOSITE_WGSL = RESOLVE_WGSL;
