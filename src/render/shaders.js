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

const COMMON = /* wgsl */`
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

const CUBE_WGSL = /* wgsl */`
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

const MATERIAL_WGSL = /* wgsl */`
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

@group(0) @binding(0) var<uniform> face : Face;
@group(0) @binding(1) var<storage, read> models : array<mat4x4<f32>>;

@vertex
fn vs(@builtin(instance_index) ii : u32,
      @location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
  return face.viewProj * (models[ii] * vec4<f32>(position, 1.0));
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
  o.pos = face.viewProj * (models[ii] * vec4<f32>(position, 1.0));
  o.uv = uv;
  return o;
}

@fragment
fn fsMask(in : MaskOut) {
  if (textureSample(baseColorTex, matSampler, in.uv).a < material.alphaCutoff) { discard; }
}
`;

/* ------------------------------------------------------------ geometry -- */

export const STANDARD_WGSL = /* wgsl */`
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
${MATERIAL_WGSL}
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) normal     : vec3<f32>,
  @location(2) uv         : vec2<f32>,
  @location(3) color      : vec4<f32>,
  @location(4) pbr        : vec4<f32>,
  @location(5) surf       : vec4<f32>,
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
  let inst = instances[ii];
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

/* ----------------------------------------------------------- noise ----- */

fn hash31(p : vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.1, 0.1));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
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
`;

/* ----------------------------------------------------------------- AO --- */

export const AO_WGSL = /* wgsl */`
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var depthTex : texture_depth_2d;
@group(0) @binding(3) var surfaceTex : texture_2d<f32>;

fn loadDepth(uv : vec2<f32>) -> f32 {
  return textureLoad(depthTex, pixelOf(uv), 0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

/**
 * Horizon-based ambient occlusion.
 *
 * For each of six directions the march finds the steepest horizon the
 * neighbourhood raises against the surface, and integrates the cosine-weighted
 * visibility left over. Six slices at quarter resolution is cheap; the
 * interleaved rotation plus the depth-aware blur that follows is what turns
 * that sparse sampling into a smooth term.
 */
@fragment
fn fs(in : FSOut) -> @location(0) f32 {
  let d = loadDepth(in.uv);
  if (d <= 1e-7) { return 1.0; }

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
  if (distanceFade <= 0.001) { return 1.0; }
  let grazeFade = smoothstep(0.12, 0.38, abs(dot(N, normalize(-P))));
  if (grazeFade <= 0.001) { return 1.0; }

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
    occlusion = occlusion + max(best, 0.0);
  }

  let strength = camera.ao.x * distanceFade * grazeFade;
  let ao = clamp(1.0 - occlusion / f32(SLICES) * strength, 0.0, 1.0);
  return pow(ao, camera.ao.z);
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
 * Depth-aware box blur. Weighting each tap by how close its depth is to the
 * centre's is what stops AO from bleeding across a silhouette and drawing a
 * dark halo around every object.
 */
@fragment
fn fs(in : FSOut) -> @location(0) f32 {
  let dims = vec2<f32>(textureDimensions(aoTex, 0));
  let texel = 1.0 / dims;
  let centerZ = linearDepth(loadDepth(in.uv), camera.proj.z);

  var sum = 0.0;
  var weight = 0.0;
  // Exactly four pixels on each axis, matching the 4x4 rotation tile. Any four
  // consecutive pixels contain one of every rotation, so this kernel averages
  // one whole set of sample directions — a 5x5 would double-count some and
  // leave a residual pattern behind.
  for (var y = -1; y <= 2; y = y + 1) {
    for (var x = -1; x <= 2; x = x + 1) {
      let uv = in.uv + vec2<f32>(f32(x), f32(y)) * texel;
      let z = linearDepth(loadDepth(uv), camera.proj.z);
      let w = exp(-abs(z - centerZ) * 2.0);
      sum = sum + textureSampleLevel(aoTex, texSampler, uv, 0.0).r * w;
      weight = weight + w;
    }
  }
  return sum / max(weight, 1e-4);
}
`;

/* ------------------------------------------------------------ resolve --- */

export const RESOLVE_WGSL = /* wgsl */`
${COMMON}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var sceneColor : texture_2d<f32>;
@group(0) @binding(3) var surfaceTex : texture_2d<f32>;
@group(0) @binding(4) var albedoTex : texture_2d<f32>;
@group(0) @binding(5) var depthTex : texture_depth_2d;
@group(0) @binding(6) var aoTex : texture_2d<f32>;

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
  let edge = min(min(hitUV.x, 1.0 - hitUV.x), min(hitUV.y, 1.0 - hitUV.y));
  let edgeFade = smoothstep(0.0, 0.1, edge);
  let endFade = 1.0 - smoothstep(0.8, 1.0, hi);

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
  var hdr = textureSampleLevel(sceneColor, texSampler, in.uv, 0.0).rgb;

  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let dirView = normalize(vec3<f32>(ndc.x / camera.proj.x, ndc.y / camera.proj.y, -1.0));
  let viewDirWorld = normalize((camera.invView * vec4<f32>(dirView, 0.0)).xyz);

  if (d <= 1e-7) {
    return vec4<f32>(sampleEnvironment(viewDirWorld, 0.0, camera.ambient.rgb) * 0.8, 1.0);
  }

  let surf = textureSampleLevel(surfaceTex, texSampler, in.uv, 0.0);
  let albedo = textureSampleLevel(albedoTex, texSampler, in.uv, 0.0).rgb;
  let ao = textureSampleLevel(aoTex, texSampler, in.uv, 0.0).r;

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

  // Same 4x4 tile as the occlusion pass: sixteen fixed step phases rather than
  // per-pixel white noise, so what undersampling remains is a faint regular
  // pattern instead of stipple.
  let jitter = f32(interleavedIndex(in.clip.xy)) / 16.0;

  let nDotV = max(dot(N, V), 1e-4);
  // Metals tint their reflection with their own albedo — f0 is the albedo, not
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

/** Soft-knee threshold: a hard cut makes bloom flicker on moving highlights. */
@fragment
fn fs(in : FSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src, 0));
  let c = downsample13(in.uv, texel);

  let brightness = max(c.r, max(c.g, c.b));
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

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut { return fullscreen(vi); }

fn tonemapACES(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn luma(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

/** Graded pixel: HDR + bloom, tonemapped and gamma-encoded. FXAA runs on this. */
fn gradeAt(uv : vec2<f32>) -> vec3<f32> {
  let hdr = sanitize(textureSampleLevel(hdrTex, texSampler, uv, 0.0).rgb);
  let bloom = sanitize(textureSampleLevel(bloomTex, texSampler, uv, 0.0).rgb);
  return pow(tonemapACES((hdr + bloom * camera.bloom.z) * camera.params.y), vec3<f32>(1.0 / 2.2));
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
