/**
 * Pine Valley: the map.
 *
 * A mountain valley 1.5 km across: a lake in the middle, pine forest to the
 * west and north, a flowering meadow with oaks to the east, an old wooden
 * fort on a hill, a camp with a fire and a pier on the south shore, and trails
 * joining them. Heights are eroded by simulated rain so slopes carry gullies
 * and fans like real ones.
 *
 * Everything here is deterministic: the same seed builds the same valley.
 */

export const SIZE = 1536;          // metres across
export const N = 1025;             // height samples per side
export const HALF = SIZE / 2;
export const WATER = 0;            // lake surface height
const SPACING = SIZE / (N - 1);

/* --------------------------------------------------------------- noise -- */

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const perm = new Uint8Array(512);
{
  const r = makeRng(1234);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** 2D gradient noise, about -1..1. */
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => { const h = G2[perm[(perm[ix & 255] + iy) & 511] & 7]; return h[0] * dx + h[1] * dy; };
  const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf);
  const c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}

export function fbm(x, y, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; norm += a; a *= gain; f *= lac; }
  return s / norm;
}

function ridged(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise(x * f, y * f));
    n *= n;
    s += n * a * prev;
    prev = n;
    a *= 0.5; f *= 2.1;
  }
  return s;
}

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* -------------------------------------------------------------- layout -- */

export const LAKE = { x: 30, z: 40, rx: 250, rz: 165, angle: 0.35 };
export const CAMP = { x: -30, z: 262, r: 28 };
export const FORT = { x: 360, z: -150, r: 60, height: 38 };
export const PIER = { x: 8, z: 216, dir: -Math.PI / 2 - 0.12, sections: 8 };
export const SPAWN = { x: 9, z: 228 };
export const ISLAND = { x: 75, z: 5, r: 44 };

/** 1 on the island, 0 away from it. */
export function islandAmount(x, z) {
  const d = Math.hypot((x - ISLAND.x) * 0.8, z - ISLAND.z) + 7 * noise(x * 0.04 + 2, z * 0.04 - 6);
  return 1 - smooth(ISLAND.r * 0.35, ISLAND.r, d);
}

/** Distance-like value: < 1 inside the lake ellipse. */
function lakeShape(x, z) {
  const c = Math.cos(LAKE.angle), s = Math.sin(LAKE.angle);
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const u = (dx * c + dz * s) / LAKE.rx, v = (-dx * s + dz * c) / LAKE.rz;
  // A wobbly shoreline, not an ellipse.
  const wobble = 0.12 * noise(x * 0.008 + 3.1, z * 0.008 - 7.3) + 0.06 * noise(x * 0.03, z * 0.03);
  return Math.hypot(u, v) + wobble;
}

/** Trails as polylines of [x, z]: camp to the forest loop, the fort, and the lakeshore. */
export const TRAILS = [
  [[-30, 262], [-90, 250], [-160, 220], [-240, 170], [-300, 110], [-330, 30], [-310, -60], [-250, -140], [-160, -190], [-60, -210], [40, -205]],
  [[40, -205], [130, -190], [220, -170], [290, -160], [330, -152]],
  [[-30, 262], [60, 262], [150, 240], [240, 190], [300, 110], [330, 20], [350, -60], [360, -110]],
  [[-30, 262], [-10, 245], [8, 222]],
];

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0), 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function trailDistance(x, z) {
  let best = Infinity;
  for (const t of TRAILS) {
    for (let i = 0; i + 1 < t.length; i++) {
      best = Math.min(best, distToSegment(x, z, t[i][0], t[i][1], t[i + 1][0], t[i + 1][1]));
    }
  }
  // Trails meander a little around their straight segments.
  return best + noise(x * 0.05, z * 0.05) * 1.2;
}

/** 0 = open meadow, 1 = deep forest. */
export function forestAmount(x, z) {
  const west = smooth(120, -260, x + z * 0.35);         // forest thickens to the west and north
  const north = smooth(-40, -380, z);
  const patches = fbm(x * 0.0045 + 11, z * 0.0045 - 4, 4);
  let f = Math.max(west, north * 0.9) * 0.85 + patches * 0.55 + 0.1;
  const shore = smooth(1.02, 1.3, lakeShape(x, z));
  f *= shore;
  const d = Math.hypot(x, z);
  f = Math.max(f, smooth(420, 560, d) * 0.95);           // the mountains are wooded low down
  f = Math.max(f, islandAmount(x, z) * 0.95);
  return Math.min(Math.max(f, 0), 1);
}

/* ------------------------------------------------------------- heights -- */

export function buildHeights() {
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
      // Domain warp for natural, non-grid shapes.
      const wx = x + 90 * fbm(x * 0.0021 + 5, z * 0.0021 + 9, 3);
      const wz = z + 90 * fbm(x * 0.0021 - 7, z * 0.0021 + 2, 3);
      const d = Math.hypot(wx * 1.05, wz);
      // Valley floor: gentle hills.
      let y = 6 + 9 * fbm(wx * 0.004, wz * 0.004, 5) + 3 * fbm(wx * 0.02, wz * 0.02, 3);
      // Foothills: broad and rounded, wooded all over.
      const foot = smooth(420, 640, d);
      y += foot * (30 + 50 * (fbm(wx * 0.005 + 3, wz * 0.005 - 5, 4) * 0.5 + 0.5));
      // Peaks behind them, higher to the north. Few octaves: big faces, not fins.
      const ring = smooth(540, 880, d);
      const northBias = 1 + 0.55 * smooth(200, -600, wz);
      const peaks = ridged(wx * 0.0027 + 20, wz * 0.0027 + 40, 4);
      y += ring * ring * (130 + 250 * peaks) * northBias;
      // Spurs and side valleys on the flanks, so they are not one smooth cone.
      const spurs = ridged(wx * 0.0085 + 7, wz * 0.0085 - 3, 3);
      y += smooth(460, 760, d) * (70 * spurs - 25) * northBias;
      y += ring * 18 * fbm(wx * 0.011, wz * 0.011, 3);
      // Lake basin.
      const L = lakeShape(x, z);
      const basin = 1 - smooth(0.55, 1.08, L);
      y = lerp(y, -7 - 3 * fbm(x * 0.01, z * 0.01, 2), basin);
      h[j * N + i] = y;
    }
  }
  // Rain carves the valley and the foothills; the high flanks keep their
  // shape, where uniform slopes would only grow rows of identical rills.
  const hardness = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
      hardness[j * N + i] = 1 - 0.85 * smooth(480, 680, Math.hypot(x, z));
    }
  }
  erode(h, 320000, hardness);

  // Soften the finest rills on the mountains: seen from the valley, a face
  // full of metre-wide grooves reads as fur, not rock.
  const soft = new Float32Array(h);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
        const k = smooth(400, 620, Math.hypot(x, z));
        if (k <= 0) continue;
        const o = j * N + i;
        const avg = (h[o - 1] + h[o + 1] + h[o - N] + h[o + N]
          + h[o - N - 1] + h[o - N + 1] + h[o + N - 1] + h[o + N + 1] + h[o] * 2) / 10;
        soft[o] = lerp(h[o], avg, k * 0.85);
      }
    }
    h.set(soft);
  }

  // Re-cut the lake after erosion: rain fills basins with sediment, and a lake
  // bed full of islands is not the look. The shore keeps its eroded detail.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
      const L = lakeShape(x, z);
      if (L > 1.25) continue;
      const o = j * N + i;
      const bed = -1.2 - 7 * smooth(0.98, 0.45, L) + 0.6 * noise(x * 0.05, z * 0.05);
      const shoreRise = smooth(0.92, 1.25, L);
      h[o] = lerp(bed, Math.max(h[o], 0.8), shoreRise);
      const isl = islandAmount(x, z);
      if (isl > 0) h[o] = Math.max(h[o], lerp(-3, 3.2 + 2.2 * fbm(x * 0.05, z * 0.05, 3), Math.sqrt(isl)));
    }
  }

  // Level the camp and the fort hill, and cut the trails into the slopes.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
      const o = j * N + i;
      let y = h[o];
      const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
      y = lerp(y, 2.6 + 0.4 * noise(x * 0.1, z * 0.1), 1 - smooth(CAMP.r * 0.7, CAMP.r * 1.6, dc));
      const df = Math.hypot(x - FORT.x, z - FORT.z);
      const hill = FORT.height * (1 - smooth(FORT.r, FORT.r * 2.6, df));
      if (hill > 0.01) y = Math.max(y, hill + 0.5 * noise(x * 0.08, z * 0.08) * Math.min(hill, 1));
      y = lerp(y, FORT.height, 1 - smooth(FORT.r * 0.75, FORT.r * 1.05, df));
      h[o] = y;
    }
  }
  const smoothTrails = new Float32Array(h);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const x = -HALF + i * SPACING, z = -HALF + j * SPACING;
        const t = trailDistance(x, z);
        if (t > 6) continue;
        const o = j * N + i;
        const avg = (h[o - 1] + h[o + 1] + h[o - N] + h[o + N] + h[o] * 2) / 6;
        smoothTrails[o] = lerp(h[o], avg - 0.12, 1 - smooth(1.5, 6, t));
      }
    }
    h.set(smoothTrails);
  }
  return h;
}

/**
 * Hydraulic erosion: raindrops that pick up sediment where they speed up and
 * drop it where they slow down (after Hans Theobald Beyer's method).
 */
function erode(h, drops, hardness) {
  const rng = makeRng(77);
  const inertia = 0.05, capacityK = 4, minCap = 0.01, depositK = 0.3, erodeK = 0.3, evap = 0.01, gravity = 4;
  const radius = 3;
  // Erosion brush weights.
  const brush = [];
  let wsum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= radius) { const w = 1 - d / radius; brush.push([dx, dy, w]); wsum += w; }
    }
  }
  for (const b of brush) b[2] /= wsum;

  const heightGrad = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const o = iy * N + ix;
    const a = h[o], b = h[o + 1], c = h[o + N], d = h[o + N + 1];
    return {
      gx: (b - a) * (1 - fy) + (d - c) * fy,
      gy: (c - a) * (1 - fx) + (d - b) * fx,
      h: a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy,
    };
  };

  for (let k = 0; k < drops; k++) {
    let x = 2 + rng() * (N - 5), y = 2 + rng() * (N - 5);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < 40; step++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const g = heightGrad(x, y);
      dx = dx * inertia - g.gx * (1 - inertia);
      dy = dy * inertia - g.gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) break;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < 2 || y < 2 || x > N - 3 || y > N - 3) break;
      const nh = heightGrad(x, y).h;
      const dh = nh - g.h;
      const cap = Math.max(-dh * speed * water * capacityK, minCap);
      const o = iy * N + ix;
      if (sediment > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositK;
        sediment -= amount;
        h[o] += amount * (1 - fx) * (1 - fy);
        h[o + 1] += amount * fx * (1 - fy);
        h[o + N] += amount * (1 - fx) * fy;
        h[o + N + 1] += amount * fx * fy;
      } else {
        const amount = Math.min((cap - sediment) * erodeK, -dh) * hardness[o];
        for (const [bx, by, w] of brush) {
          const px = ix + bx, py = iy + by;
          if (px < 0 || py < 0 || px >= N || py >= N) continue;
          const q = py * N + px;
          const take = Math.min(amount * w, h[q] - nh + 0.5);
          if (take > 0) { h[q] -= take; sediment += take; }
        }
      }
      speed = Math.sqrt(Math.max(speed * speed + dh * -gravity, 0));
      water *= 1 - evap;
    }
  }
}

export function sampleHeight(h, x, z) {
  let gx = (x + HALF) / SIZE * (N - 1), gz = (z + HALF) / SIZE * (N - 1);
  gx = Math.min(Math.max(gx, 0), N - 1.0001); gz = Math.min(Math.max(gz, 0), N - 1.0001);
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const o = iz * N + ix;
  const a = h[o] + (h[o + 1] - h[o]) * fx;
  const b = h[o + N] + (h[o + N + 1] - h[o + N]) * fx;
  return a + (b - a) * fz;
}

export function slopeAt(h, x, z) {
  const e = SPACING;
  const dx = sampleHeight(h, x + e, z) - sampleHeight(h, x - e, z);
  const dz = sampleHeight(h, x, z + e) - sampleHeight(h, x, z - e);
  const nx = -dx, ny = 2 * e, nz = -dz;
  return 1 - ny / Math.hypot(nx, ny, nz);      // 0 flat, 1 vertical
}

/* --------------------------------------------------------------- splat -- */

/** RGBA per texel: forest floor, trail, gravel, rock. The meadow takes the rest. */
export function buildSplat(h, size = 512) {
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -HALF + (i + 0.5) / size * SIZE, z = -HALF + (j + 0.5) / size * SIZE;
      const y = sampleHeight(h, x, z);
      const f = forestAmount(x, z);
      const t = trailDistance(x, z);
      const slope = slopeAt(h, x, z);
      let forest = smooth(0.35, 0.65, f + 0.15 * noise(x * 0.07, z * 0.07));
      let trail = 1 - smooth(1.2, 2.8, t);
      const camp = 1 - smooth(CAMP.r * 0.5, CAMP.r * 0.9, Math.hypot(x - CAMP.x, z - CAMP.z));
      const fort = 1 - smooth(FORT.r * 0.6, FORT.r * 0.95, Math.hypot(x - FORT.x, z - FORT.z));
      trail = Math.max(trail, camp * 0.75, fort * 0.55 * (0.6 + 0.4 * noise(x * 0.2, z * 0.2)));
      // Gravel: stream-like fans below slopes and patches at the waterline.
      const gravel = smooth(0.6, 0.85, fbm(x * 0.02 + 40, z * 0.02, 3) * 0.5 + 0.5) * smooth(12, 4, y) * 0.8;
      // Scree and bare rock high up and on the steep flanks.
      const rock = smooth(175, 250, y + 25 * noise(x * 0.02, z * 0.02)) * (0.7 + 0.3 * noise(x * 0.05, z * 0.05));
      // Up the mountains the ground between the trees turns to rock and scree.
      const high = smooth(45, 120, y + 20 * noise(x * 0.03 + 5, z * 0.03));
      const bare = high * (0.75 + 0.25 * noise(x * 0.06, z * 0.06));
      forest *= 1 - bare;
      const rock2 = Math.max(rock, bare * 0.85);
      forest *= 1 - trail;
      const sum = forest + trail + gravel + rock2;
      const k = sum > 1 ? 1 / sum : 1;
      const o = (j * size + i) * 4;
      out[o] = Math.round(forest * k * 255);
      out[o + 1] = Math.round(trail * k * 255);
      out[o + 2] = Math.round(gravel * k * 255);
      out[o + 3] = Math.round(rock2 * k * 255);
    }
  }
  return out;
}

/* ---------------------------------------------------------- placements -- */

/**
 * Where every object goes: { model: Float32Array of x, y, z, yaw, scale }.
 * Jittered grids with rejection keep things natural without piling up.
 */
export function buildPlacements(h) {
  const rng = makeRng(2024);
  const out = {};
  const put = (model, x, z, yaw, scale, lift = 0) => {
    (out[model] ??= []).push(x, sampleHeight(h, x, z) + lift, z, yaw, scale);
  };
  const free = (x, z, pad = 0) => {
    if (Math.abs(x) > HALF - 20 || Math.abs(z) > HALF - 20) return false;
    if (sampleHeight(h, x, z) < WATER + 0.6) return false;
    if (trailDistance(x, z) < 3 + pad) return false;
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.r + pad) return false;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 10 + pad) return false;
    if (Math.hypot(x - FORT.x, z - FORT.z) < FORT.r * 1.05 + pad) return false;
    return true;
  };
  const occupied = new Map();
  const cell = 3;
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const clear = (x, z, r) => {
    for (let dz = -r; dz <= r; dz += cell) for (let dx = -r; dx <= r; dx += cell) {
      const v = occupied.get(key(x + dx, z + dz));
      if (v && Math.hypot(v[0] - x, v[1] - z) < r + v[2]) return false;
    }
    return true;
  };
  const mark = (x, z, r) => occupied.set(key(x, z), [x, z, r]);
  const pick = (list) => list[Math.floor(rng() * list.length)];

  // --- Trees ---
  const big = ['pine_a', 'pine_b', 'pine_c', 'fir_a', 'fir_b', 'fir_c'];
  const med = ['pinemed_a', 'pinemed_b', 'pinemed_c', 'firmed_a', 'firmed_b', 'firmed_c'];
  const small = ['pinesmall_a', 'pinesmall_b', 'pinesmall_c', 'firsmall_a', 'firsmall_b', 'firsmall_c'];
  const step = 4.7;
  for (let z = -HALF + 20; z < HALF - 20; z += step) {
    for (let x = -HALF + 20; x < HALF - 20; x += step) {
      const px = x + (rng() - 0.5) * step * 0.9, pz = z + (rng() - 0.5) * step * 0.9;
      // Past the crest nobody in the valley can see them.
      if (Math.hypot(px, pz) > 790) continue;
      if (!free(px, pz, 2)) continue;
      const y = sampleHeight(h, px, pz);
      const slope = slopeAt(h, px, pz);
      if (slope > 0.5 || y > 280) continue;
      const f = forestAmount(px, pz);
      const alt = smooth(185, 265, y);                   // treeline
      const p = f * f * 0.97 * (1 - alt) * (1 - smooth(0.38, 0.5, slope) * 0.7);
      if (rng() > p) continue;
      const r = rng();
      if (r < 0.5) { if (!clear(px, pz, 2.9)) continue; put(pick(big), px, pz, rng() * 6.28, 0.8 + rng() * 0.45, -0.15); mark(px, pz, 2.9); }
      else if (r < 0.88) { if (!clear(px, pz, 2.2)) continue; put(pick(med), px, pz, rng() * 6.28, 0.75 + rng() * 0.5, -0.1); mark(px, pz, 2.2); }
      else { put(pick(small), px, pz, rng() * 6.28, 0.9 + rng() * 1.6); }
    }
  }
  // Oaks and lone pines in the meadow; saplings along forest edges.
  for (let i = 0; i < 1400; i++) {
    const px = (rng() - 0.5) * SIZE * 0.8, pz = (rng() - 0.5) * SIZE * 0.8;
    if (!free(px, pz, 4)) continue;
    const f = forestAmount(px, pz);
    const y = sampleHeight(h, px, pz);
    if (slopeAt(h, px, pz) > 0.3 || y > 120) continue;
    if (f < 0.3 && rng() < 0.35) {
      if (!clear(px, pz, 5)) continue;
      put(rng() < 0.6 ? 'oak_a' : 'oakb_a', px, pz, rng() * 6.28, 1.3 + rng() * 0.9, -0.2); mark(px, pz, 5);
    } else if (f > 0.25 && f < 0.6) {
      put(pick(small), px, pz, rng() * 6.28, 1 + rng() * 2.2);
      if (rng() < 0.3 && clear(px, pz, 2.4)) { put(pick(med), px + 2, pz + 1, rng() * 6.28, 0.6 + rng() * 0.4, -0.1); }
    }
  }

  // --- Rocks and cliffs ---
  const mossRocks = ['mossrock_rock01', 'mossrock_rock02', 'mossrock_rock03', 'mossrock_rock04', 'mossrock_rock05', 'mossrock_rock06',
    'mossrock2_rock07', 'mossrock2_rock08', 'mossrock2_rock09', 'mossrock2_rock10', 'mossrock2_rock11', 'mossrock2_rock12', 'mossrock2_rock13'];
  for (let i = 0; i < 9000; i++) {
    const px = (rng() - 0.5) * SIZE * 0.92, pz = (rng() - 0.5) * SIZE * 0.92;
    if (!free(px, pz, 1)) continue;
    const y = sampleHeight(h, px, pz);
    const slope = slopeAt(h, px, pz);
    const f = forestAmount(px, pz);
    const r = rng();
    if (slope > 0.38 && r < 0.45 && y < 95) {
      // Scanned cliffs are brown sandstone: they sit on the wooded foothills,
      // not on the grey peaks where they would look pasted on.
      // Cliff faces on steep ground, big and half buried.
      const m = pick(['rockface1', 'rockface2', 'cliff', 'cliff']);
      const s = m === 'cliff' ? 1.4 + rng() * 2.2 : 2.5 + rng() * 4;
      if (!clear(px, pz, 6 * s)) continue;
      put(m, px, pz, rng() * 6.28, s, -1.5 * s); mark(px, pz, 3 * s);
    } else if (f > 0.4 && r < 0.3) {
      put(pick(mossRocks), px, pz, rng() * 6.28, 0.5 + rng() * rng() * 2.4, -0.25);
    } else if (r < 0.36) {
      put(rng() < 0.5 ? 'boulder' : pick(mossRocks), px, pz, rng() * 6.28, 0.6 + rng() * 2.2, -0.3);
    } else if (y < 8 && r < 0.5) {
      put(pick(['stone', 'rock7']), px, pz, rng() * 6.28, 3 + rng() * 9, -0.05);
    }
  }

  // Boulders along the shore, half in the water
  for (let i = 0; i < 3000; i++) {
    const px = LAKE.x + (rng() - 0.5) * 620, pz = LAKE.z + (rng() - 0.5) * 520;
    const L = lakeShape(px, pz);
    if (L < 0.9 || L > 1.12) continue;
    if (trailDistance(px, pz) < 4 || Math.hypot(px - PIER.x, pz - PIER.z) < 22) continue;
    if (Math.hypot(px - CAMP.x, pz - CAMP.z) < CAMP.r + 6) continue;
    if (rng() > 0.35) continue;
    put(rng() < 0.4 ? 'boulder' : pick(mossRocks), px, pz, rng() * 6.28, 0.7 + rng() * 1.8, -0.35);
  }

  // --- Forest floor ---
  for (let i = 0; i < 36000; i++) {
    const px = (rng() - 0.5) * SIZE * 0.9, pz = (rng() - 0.5) * SIZE * 0.9;
    if (!free(px, pz, 0)) continue;
    const f = forestAmount(px, pz);
    const y = sampleHeight(h, px, pz);
    if (slopeAt(h, px, pz) > 0.45 || y > 240) continue;
    const r = rng();
    if (f > 0.45) {
      if (r < 0.55) put(pick(['fern_a', 'fern_b', 'fern_c', 'fern_d']), px, pz, rng() * 6.28, 1 + rng() * 1.4);
      else if (r < 0.68) put(pick(['branches_a', 'branches_b', 'branches_c']), px, pz, rng() * 6.28, 1 + rng());
      else if (r < 0.72 && clear(px, pz, 2)) { put(rng() < 0.5 ? 'stump' : 'stump2', px, pz, rng() * 6.28, 0.7 + rng() * 0.5, -0.1); mark(px, pz, 1); }
      else if (r < 0.76) put('log', px, pz, rng() * 6.28, 1.4 + rng() * 1.6, -0.08);
      else if (r < 0.77) put('deadtree', px, pz, rng() * 6.28, 1 + rng() * 0.8, -0.15);
      else if (r < 0.78) put('roots', px, pz, rng() * 6.28, 0.8 + rng() * 0.6, -0.2);
      else if (r < 0.88) put('shrub', px, pz, rng() * 6.28, 2.5 + rng() * 2.5);
    } else if (f < 0.35 && y < 60) {
      if (r < 0.4) put(rng() < 0.5 ? 'dandelion_a' : 'dandelion_b', px, pz, rng() * 6.28, 1.2 + rng() * 1.2);
      else if (r < 0.46) put('shrub', px, pz, rng() * 6.28, 2.5 + rng() * 3);
      else if (r < 0.47) put('log', px, pz, rng() * 6.28, 1.2 + rng(), -0.08);
    }
  }

  // --- Camp ---
  const cx = CAMP.x, cz = CAMP.z;
  put('firepit', cx, cz, 0.3, 1, -0.05);
  // Logs to sit on around the fire, and a stump
  put('log', cx - 3.2, cz + 0.2, Math.PI / 2 + 0.15, 1.35, -0.05);
  put('log', cx + 3.1, cz - 0.6, Math.PI / 2 - 0.2, 1.35, -0.05);
  put('log', cx + 0.3, cz + 3.4, 0.1, 1.2, -0.05);
  put('table', cx - 7.5, cz + 6.5, 0.4, 1);
  put('barrel_a', cx + 7.5, cz + 5, 0.3, 1);
  put('barrel_b', cx + 8.5, cz + 5.8, 1.3, 1);
  put('crate', cx + 7.2, cz + 7, 0.2, 1.2);
  put('crate2', cx + 9.2, cz + 3.6, 1.1, 1);
  put('bucket', cx + 6.4, cz + 4.1, 0.6, 1);
  put('lantern', cx - 7.2, cz + 6.2, 0.4, 1.1, 0.72);
  put('stump', cx - 2.2, cz - 3, 0.7, 0.5, -0.05);

  // --- Pier: sections end to end, starting where the shore meets the water ---
  const pier = [];
  const dxp = Math.cos(PIER.dir), dzp = Math.sin(PIER.dir);
  let startD = 0;
  for (let d = 0; d < 80; d += 0.25) {
    if (sampleHeight(h, PIER.x + dxp * d, PIER.z + dzp * d) < WATER + 0.35) { startD = d; break; }
  }
  const pierYaw = -PIER.dir + Math.PI / 2;
  // The sections repeat every 2.89 m in the original layout, overlapping a
  // little. Each model's pivot sits at its own lowest point, so the height is
  // set per model to put every deck at the same level.
  const deckY = WATER + 0.9;
  const sectionLow = { pier_section_02: -0.94, pier_section_03: -0.67 };
  for (let i = 0; i < PIER.sections; i++) {
    const d = startD - 1.2 + i * 2.89;
    const x = PIER.x + dxp * d, z = PIER.z + dzp * d;
    const name = i === PIER.sections - 1 ? 'pier_section_03' : 'pier_section_02';
    (out[name] ??= []).push(x, deckY - 2.67 + sectionLow[name], z, pierYaw, 1);
    pier.push([x, z]);
  }
  PIER.start = [PIER.x + dxp * startD, PIER.z + dzp * startD];
  // The walk starts on the pier, looking out over the lake.
  SPAWN.x = PIER.start[0] + dxp * 2.5;
  SPAWN.z = PIER.start[1] + dzp * 2.5;
  SPAWN.look = [32, 60];
  const end = pier[pier.length - 1];
  (out.lantern ??= []).push(end[0] + dxp * 1.2 + dzp * 0.8, WATER + 0.9, end[1] + dzp * 1.2 - dxp * 0.8, 0, 1.1);

  // --- Fort: a ring of wall pieces on the hill ---
  // Six round towers on the corners of a hexagon, straight walls between
  // them; the gate side faces the trail to the south.
  const R = 27.6;
  const wallY = FORT.height - 0.4;
  const corner = (k) => {
    const a = (k * 60 + 30) * Math.PI / 180;
    return [FORT.x + Math.cos(a) * R, FORT.z + Math.sin(a) * R];
  };
  for (let k = 0; k < 6; k++) {
    const [ax, az] = corner(k), [bx, bz] = corner(k + 1);
    (out.fort_tower_round ??= []).push(ax, wallY, az, k * 1.1, 1);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const yaw = Math.atan2(dx, dz);
    if (k === 1) {
      (out.fort_wall_thin_gate_01 ??= []).push(mx, wallY, mz, yaw, 1);
      for (const s of [-1, 1]) {
        (out.fort_wall_thick_end_02 ??= []).push(mx + dx * s * 6.1, wallY, mz + dz * s * 6.1, yaw + (s < 0 ? Math.PI : 0), 1);
      }
    } else {
      const piece = k % 2 === 0 ? 'fort_wall_thick_straight_01' : 'fort_wall_thin_straight_02';
      (out[piece] ??= []).push(mx, wallY, mz, yaw, 1);
    }
  }
  put('barrel_a', FORT.x + 6, FORT.z - 4, 0.3, 1);
  put('crate', FORT.x + 4, FORT.z - 6, 1.2, 1.3);
  put('crate2', FORT.x - 8, FORT.z + 3, 0.2, 1);
  put('firepit', FORT.x - 2, FORT.z + 2, 0, 0.9);

  const result = {};
  for (const [k, v] of Object.entries(out)) result[k] = new Float32Array(v);
  return result;
}

/** Lights: the camp fire, lanterns, the fort's fire. */
export function buildLights(h) {
  return [
    { pos: [CAMP.x, sampleHeight(h, CAMP.x, CAMP.z) + 0.8, CAMP.z], color: [1, 0.55, 0.22], intensity: 70, range: 22, fire: true },
    { pos: [CAMP.x - 7.2, sampleHeight(h, CAMP.x - 7.2, CAMP.z + 6.2) + 1.1, CAMP.z + 6.2], color: [1, 0.7, 0.4], intensity: 12, range: 10 },
    { pos: [FORT.x - 2, FORT.height + 0.8, FORT.z + 2], color: [1, 0.55, 0.22], intensity: 60, range: 20, fire: true },
  ];
}
