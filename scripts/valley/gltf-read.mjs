/**
 * Fast glTF reading for the asset build: typed-array views straight onto the
 * binary buffer wherever the layout allows, so million-triangle source files
 * load in seconds.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export async function readGLTF(path) {
  const json = JSON.parse(await readFile(path, 'utf8'));
  const dir = dirname(path);
  const buffers = await Promise.all(json.buffers.map((b) => readFile(join(dir, decodeURIComponent(b.uri)))));
  return { json, buffers, dir };
}

/** Accessor as a Float32Array (or Uint32Array for integer indices), n components per element. */
export function accessor(g, index) {
  const { json, buffers } = g;
  const acc = json.accessors[index];
  const n = COMPONENTS[acc.type];
  const T = TYPED[acc.componentType];
  const bv = json.bufferViews[acc.bufferView];
  const buf = buffers[bv.buffer];
  const start = buf.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const elem = T.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || elem * n;
  const isIndex = acc.type === 'SCALAR' && (T === Uint32Array || T === Uint16Array || T === Uint8Array) && !acc.normalized;
  const out = isIndex ? new Uint32Array(acc.count) : new Float32Array(acc.count * n);
  if (stride === elem * n && start % elem === 0) {
    const src = new T(buf.buffer, start, acc.count * n);
    if (acc.normalized) { const k = 1 / NORM[acc.componentType]; for (let i = 0; i < src.length; i++) out[i] = Math.max(src[i] * k, -1); }
    else out.set(src);
    return { data: out, n, count: acc.count, min: acc.min, max: acc.max };
  }
  const dv = new DataView(buf.buffer, 0);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      let v = dv[get](start + i * stride + c * elem, true);
      if (acc.normalized) v = Math.max(v / NORM[acc.componentType], -1);
      out[i * n + c] = v;
    }
  }
  return { data: out, n, count: acc.count };
}

function trs(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

/**
 * Every triangle primitive under the given root nodes, in world space:
 * { material, pos (xyz), nor (xyz), uv (uv), idx }.
 */
export function primitives(g, roots) {
  const { json } = g;
  const out = [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const world = mul(parent, node.matrix ?? trs(node.translation, node.rotation, node.scale));
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        const P = accessor(g, p.attributes.POSITION);
        const N = p.attributes.NORMAL !== undefined ? accessor(g, p.attributes.NORMAL) : null;
        const U = p.attributes.TEXCOORD_0 !== undefined ? accessor(g, p.attributes.TEXCOORD_0) : null;
        const idx = p.indices !== undefined ? accessor(g, p.indices).data : Uint32Array.from({ length: P.count }, (_, i) => i);
        const pos = new Float32Array(P.count * 3), nor = new Float32Array(P.count * 3);
        const m = world;
        for (let i = 0; i < P.count; i++) {
          const x = P.data[i * 3], y = P.data[i * 3 + 1], z = P.data[i * 3 + 2];
          pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (N) {
            const a = N.data[i * 3], b = N.data[i * 3 + 1], c = N.data[i * 3 + 2];
            let nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
          }
        }
        out.push({ material: p.material ?? -1, pos, nor, uv: U ? U.data : new Float32Array(P.count * 2), idx: new Uint32Array(idx), hasNormals: !!N });
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const r of roots) visit(r, identity);
  return out;
}
