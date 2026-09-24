/**
 * Mesh processing for the valley assets: simplification into levels of
 * detail, and turning photoscanned foliage into cards.
 *
 * A mesh here is { pos, nor, uv, idx }: flat Float32Arrays of xyz / xyz / uv
 * per vertex and a Uint32Array of triangle indices.
 */
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;

export function triCount(m) { return m.idx.length / 3; }

/** Keep only the vertices the index buffer uses, in first-use order. */
export function compact(m, idx = m.idx) {
  const map = new Int32Array(m.pos.length / 3).fill(-1);
  let n = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (map[v] < 0) map[v] = n++;
    out[i] = map[v];
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let v = 0; v < map.length; v++) {
    const k = map[v];
    if (k < 0) continue;
    pos.set(m.pos.subarray(v * 3, v * 3 + 3), k * 3);
    nor.set(m.nor.subarray(v * 3, v * 3 + 3), k * 3);
    uv.set(m.uv.subarray(v * 2, v * 2 + 2), k * 2);
  }
  return { pos, nor, uv, idx: out };
}

/** Concatenate meshes. */
export function merge(list) {
  list = list.filter((m) => m && m.idx.length);
  let nv = 0, ni = 0;
  for (const m of list) { nv += m.pos.length / 3; ni += m.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of list) {
    pos.set(m.pos, vo * 3); nor.set(m.nor, vo * 3); uv.set(m.uv, vo * 2);
    for (let i = 0; i < m.idx.length; i++) idx[io + i] = m.idx[i] + vo;
    vo += m.pos.length / 3; io += m.idx.length;
  }
  return { pos, nor, uv, idx };
}

/** Move and scale in place: p' = (p - origin) * s. */
export function transform(m, origin, s = 1, yaw = 0) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = (m.pos[i] - origin[0]) * s, y = (m.pos[i + 1] - origin[1]) * s, z = (m.pos[i + 2] - origin[2]) * s;
    m.pos[i] = x * c - z * sn; m.pos[i + 1] = y; m.pos[i + 2] = x * sn + z * c;
    const nx = m.nor[i], nz = m.nor[i + 2];
    m.nor[i] = nx * c - nz * sn; m.nor[i + 2] = nx * sn + nz * c;
  }
  return m;
}

export function bounds(m) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.pos[i + k]); max[k] = Math.max(max[k], m.pos[i + k]); }
  }
  return { min, max };
}

/**
 * Simplify to about `target` triangles. Attribute-aware first (normals and
 * UVs keep their seams); if that stalls well above the target, the sloppy
 * simplifier finishes the job, which is fine for far levels.
 */
export function simplify(m, target, { error = 0.05, lockBorder = false } = {}) {
  if (triCount(m) <= target) return m;
  const n = m.pos.length / 3;
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attrs.set(m.nor.subarray(i * 3, i * 3 + 3), i * 5);
    attrs[i * 5 + 3] = m.uv[i * 2]; attrs[i * 5 + 4] = m.uv[i * 2 + 1];
  }
  const flags = lockBorder ? ['LockBorder'] : [];
  let [idx] = MeshoptSimplifier.simplifyWithAttributes(
    m.idx, m.pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, target * 3, error, flags);
  if (idx.length / 3 > target * 1.6) {
    [idx] = MeshoptSimplifier.simplifySloppy(m.idx, m.pos, 3, null, target * 3, error * 4);
  }
  return compact(m, idx);
}

/** Connected pieces of a mesh (by shared vertices): list of vertex-index arrays and triangle-index arrays. */
export function components(m) {
  const n = m.pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const idx = m.idx;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const root = new Int32Array(n);
  const id = new Map();
  const comps = [];
  for (let v = 0; v < n; v++) {
    const r = find(v);
    let k = id.get(r);
    if (k === undefined) { k = comps.length; id.set(r, k); comps.push({ verts: [], tris: [] }); }
    root[v] = k;
    comps[k].verts.push(v);
  }
  for (let t = 0; t < idx.length; t += 3) comps[root[idx[t]]].tris.push(t);
  return comps;
}

/**
 * Foliage to cards: every connected twig or leaf cut-out becomes one quad.
 *
 * Each piece is a small, nearly flat mesh mapped onto a region of the atlas.
 * A least-squares affine fit P(u, v) = A + B u + C v over its vertices gives
 * the plane and the mapping; the quad spans the piece's UV rectangle, so the
 * alpha-tested texture reproduces its silhouette. Thousands of triangles per
 * twig become two.
 */
export function cardsFrom(m) {
  const cards = [];
  for (const c of components(m)) {
    if (c.verts.length < 3) continue;
    let s1 = 0, su = 0, sv = 0, suu = 0, suv = 0, svv = 0;
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    const nAvg = [0, 0, 0];
    for (const v of c.verts) {
      const u = m.uv[v * 2], w = m.uv[v * 2 + 1];
      s1 += 1; su += u; sv += w; suu += u * u; suv += u * w; svv += w * w;
      for (let k = 0; k < 3; k++) {
        const p = m.pos[v * 3 + k];
        r[0][k] += p; r[1][k] += p * u; r[2][k] += p * w;
        nAvg[k] += m.nor[v * 3 + k];
      }
      u0 = Math.min(u0, u); v0 = Math.min(v0, w); u1 = Math.max(u1, u); v1 = Math.max(v1, w);
    }
    // Solve [s1 su sv; su suu suv; sv suv svv] x = r for A, B, C (per axis).
    const M = [[s1, su, sv], [su, suu, suv], [sv, suv, svv]];
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
      - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
      + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (Math.abs(det) < 1e-18 || u1 - u0 < 1e-5 || v1 - v0 < 1e-5) continue;
    const inv = [
      [(M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det, (M[0][2] * M[2][1] - M[0][1] * M[2][2]) / det, (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det],
      [(M[1][2] * M[2][0] - M[1][0] * M[2][2]) / det, (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det, (M[0][2] * M[1][0] - M[0][0] * M[1][2]) / det],
      [(M[1][0] * M[2][1] - M[1][1] * M[2][0]) / det, (M[0][1] * M[2][0] - M[0][0] * M[2][1]) / det, (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / det],
    ];
    const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      A[k] = inv[0][0] * r[0][k] + inv[0][1] * r[1][k] + inv[0][2] * r[2][k];
      B[k] = inv[1][0] * r[0][k] + inv[1][1] * r[1][k] + inv[1][2] * r[2][k];
      C[k] = inv[2][0] * r[0][k] + inv[2][1] * r[1][k] + inv[2][2] * r[2][k];
    }
    const P = (u, w) => [A[0] + B[0] * u + C[0] * w, A[1] + B[1] * u + C[1] * w, A[2] + B[2] * u + C[2] * w];
    const corners = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    const size = Math.hypot(corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]);
    // A bad fit (a curled piece, or a piece using the whole atlas) is kept as is.
    if (!(size > 0) || size > 3) continue;
    const nl = Math.hypot(...nAvg) || 1;
    const center = [0, 1, 2].map((k) => (corners[0][k] + corners[2][k]) * 0.5);
    cards.push({ corners, uv: [u0, v0, u1, v1], normal: nAvg.map((x) => x / nl), center, size });
  }
  return cards;
}

/** Deterministic hash in [0, 1). */
export function hash(i, s = 0) {
  let x = (i * 374761393 + s * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177 | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Keep `count` of the cards, spread evenly, each grown so the canopy keeps
 * its density: area goes up by roughly what was removed, a little less so far
 * levels do not turn into flat plates.
 */
export function thinCards(cards, count, { grow = 0.45, cap = 9, seed = 1 } = {}) {
  if (count >= cards.length) return cards.map((c) => ({ ...c, scale: 1 }));
  const p = count / cards.length;
  const order = cards.map((c, i) => [hash(i, seed), i]).sort((a, b) => a[0] - b[0]);
  const s = Math.min(Math.pow(p, -grow), cap);
  return order.slice(0, count).map(([, i]) => ({ ...cards[i], scale: s }));
}

/** Cards back to a mesh, two-sided by the material (one quad each). */
export function cardMesh(cards) {
  const n = cards.length;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8);
  const idx = new Uint32Array(n * 6);
  cards.forEach((c, i) => {
    const s = c.scale ?? 1;
    // Normals lean outward from the tree's axis: canopies read as volumes, not as flat cards.
    const out = [c.center[0], 0, c.center[2]];
    const ol = Math.hypot(out[0], out[2]) || 1;
    const nn = [c.normal[0] * 0.4 + out[0] / ol * 0.6, c.normal[1] * 0.4 + 0.35, c.normal[2] * 0.4 + out[2] / ol * 0.6];
    const nl = Math.hypot(...nn) || 1;
    for (let k = 0; k < 4; k++) {
      for (let a = 0; a < 3; a++) {
        pos[i * 12 + k * 3 + a] = c.center[a] + (c.corners[k][a] - c.center[a]) * s;
        nor[i * 12 + k * 3 + a] = nn[a] / nl;
      }
    }
    const [u0, v0, u1, v1] = c.uv;
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { pos, nor, uv, idx };
}
