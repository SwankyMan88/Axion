/**
 * glTF 2.0 loader — .gltf (with external or data: URI buffers) and .glb.
 *
 * Two halves. parseGLTF() is pure: it walks the node hierarchy, reads
 * accessors, and bakes each node's world transform into its vertices. It has
 * no GPU dependency, so it runs (and is tested) in Node. loadGLTF() fetches,
 * decodes images, uploads, and spawns entities.
 *
 * Transforms are baked because the scenes this is for — architecture, levels,
 * props — are static. Baking turns every primitive into geometry already in
 * world space: no per-node matrix at draw time, exact bounding spheres for
 * culling, and a node hierarchy that costs nothing after load. Node animation
 * and skinning are not supported.
 *
 * Supported: triangle primitives; POSITION, NORMAL, TEXCOORD_0; uint8/16/32
 * indices (or none); matrix or TRS nodes, mirrored transforms included;
 * pbrMetallicRoughness base colour and metallic-roughness textures and
 * factors; normal textures; alphaMode OPAQUE and MASK; doubleSided.
 * Extensions: KHR_mesh_quantization (integer attributes, dequantized through
 * the node transform), KHR_texture_transform (baked into the UVs, which is how
 * quantized texture coordinates are restored) and EXT_texture_webp.
 */

import { VERTEX_STRIDE_FLOATS } from '../geometry/primitives.js';
import { textureFromImage } from '../gpu/textures.js';
import { unpackAsset } from './packed.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/* ------------------------------------------------------------ container -- */

/** Split a .glb into its JSON chunk and binary chunk. */
export function parseGLB(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('glb: bad magic');
  if (view.getUint32(4, true) !== 2) throw new Error('glb: only version 2 is supported');
  let offset = 12, json = null, bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
    else if (type === 0x004e4942) bin = new Uint8Array(arrayBuffer, start, length);
    offset = start + length;
  }
  if (!json) throw new Error('glb: no JSON chunk');
  return { json, bin };
}

export const isGLB = (arrayBuffer) =>
  arrayBuffer.byteLength >= 4 && new DataView(arrayBuffer).getUint32(0, true) === 0x46546c67;

/* ---------------------------------------------------------- accessors ---- */

function bufferViewBytes(json, buffers, index) {
  const bv = json.bufferViews[index];
  const buf = buffers[bv.buffer];
  return new Uint8Array(buf.buffer, buf.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
}

/**
 * Read an accessor into a dense array of plain numbers-per-element. Handles
 * interleaved views (byteStride), normalized integers, and accessors without a
 * bufferView (all zeros, per spec).
 */
export function readAccessor(json, buffers, index) {
  const acc = json.accessors[index];
  const n = COMPONENTS[acc.type];
  const Typed = TYPED[acc.componentType];
  const count = acc.count;
  const out = acc.componentType === 5126 || acc.normalized ? new Float32Array(count * n)
    : new (Typed === Uint32Array ? Uint32Array : Float32Array)(count * n);
  if (acc.bufferView === undefined) return { data: out, n, count };

  const bv = json.bufferViews[acc.bufferView];
  const base = bufferViewBytes(json, buffers, acc.bufferView);
  const elemBytes = Typed.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || elemBytes * n;
  const start = acc.byteOffset ?? 0;
  const dv = new DataView(base.buffer, base.byteOffset, base.byteLength);
  const scale = acc.normalized ? 1 / NORMALIZE[acc.componentType] : 1;

  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
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

/* ------------------------------------------------------------ matrices --- */

function composeTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
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
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** Inverse-transpose of the upper 3x3, for normals. Also returns the determinant. */
function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / (det || 1);
  // columns of inverse-transpose
  return {
    det,
    n: [
      A * k, B * k, C * k,
      -(b * i - c * h) * k, (a * i - c * g) * k, -(a * h - b * g) * k,
      (b * f - c * e) * k, -(a * f - c * d) * k, (a * e - b * d) * k,
    ],
  };
}

/* --------------------------------------------------------------- parse --- */

/**
 * Walk the default scene and produce world-space primitives.
 *
 * Returns { primitives: [{ vertices, indices, material, name }], materials,
 *           bounds: { min, max }, triangles }.
 * `buffers` holds one Uint8Array per json.buffers entry.
 */
/**
 * The UV transform a material's textures declare (KHR_texture_transform), as a
 * 2x3 affine: u' = a*u + b*v + c, v' = d*u + e*v + f. Per the spec the order is
 * translate * rotate * scale. Baked into the vertices, so the shader never
 * needs to know it existed — and quantized UVs come back to their real range.
 */
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

export function parseGLTF(json, buffers) {
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

    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      const { n: nm, det } = normalMatrix(world);
      mesh.primitives.forEach((prim, pi) => {
        if ((prim.mode ?? 4) !== 4) return;               // triangles only
        const pos = readAccessor(json, buffers, prim.attributes.POSITION);
        const count = pos.count;
        const nor = prim.attributes.NORMAL !== undefined ? readAccessor(json, buffers, prim.attributes.NORMAL) : null;
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, buffers, prim.attributes.TEXCOORD_0) : null;
        const uvT = uvTransforms[prim.material] ?? null;
        let idx = prim.indices !== undefined ? readAccessor(json, buffers, prim.indices).data : null;
        if (!idx) { idx = new Uint32Array(count); for (let i = 0; i < count; i++) idx[i] = i; }
        const indices = new Uint32Array(idx);

        // A mirrored transform (negative determinant) reverses winding; swap
        // two corners of every triangle so front faces stay front faces.
        if (det < 0) {
          for (let t = 0; t < indices.length; t += 3) {
            const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
          }
        }

        const F = VERTEX_STRIDE_FLOATS;
        const v = new Float32Array(count * F);
        for (let i = 0; i < count; i++) {
          const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
          const wx = world[0] * x + world[4] * y + world[8] * z + world[12];
          const wy = world[1] * x + world[5] * y + world[9] * z + world[13];
          const wz = world[2] * x + world[6] * y + world[10] * z + world[14];
          v[i * F] = wx; v[i * F + 1] = wy; v[i * F + 2] = wz;
          if (wx < min[0]) min[0] = wx; if (wy < min[1]) min[1] = wy; if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx; if (wy > max[1]) max[1] = wy; if (wz > max[2]) max[2] = wz;
          if (uv) {
            const u0 = uv.data[i * 2], v0 = uv.data[i * 2 + 1];
            if (uvT) {
              v[i * F + 6] = uvT[0] * u0 + uvT[1] * v0 + uvT[2];
              v[i * F + 7] = uvT[3] * u0 + uvT[4] * v0 + uvT[5];
            } else { v[i * F + 6] = u0; v[i * F + 7] = v0; }
          }
        }

        if (nor) {
          for (let i = 0; i < count; i++) {
            const x = nor.data[i * 3], y = nor.data[i * 3 + 1], z = nor.data[i * 3 + 2];
            let nx = nm[0] * x + nm[3] * y + nm[6] * z;
            let ny = nm[1] * x + nm[4] * y + nm[7] * z;
            let nz = nm[2] * x + nm[5] * y + nm[8] * z;
            const l = Math.hypot(nx, ny, nz) || 1;
            v[i * F + 3] = nx / l; v[i * F + 4] = ny / l; v[i * F + 5] = nz / l;
          }
        } else {
          // No normals in the file: area-weighted smooth normals from faces.
          for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * F, b = indices[t + 1] * F, c = indices[t + 2] * F;
            const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
            const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
            const fx = e1[1] * e2[2] - e1[2] * e2[1];
            const fy = e1[2] * e2[0] - e1[0] * e2[2];
            const fz = e1[0] * e2[1] - e1[1] * e2[0];
            for (const k of [a, b, c]) { v[k + 3] += fx; v[k + 4] += fy; v[k + 5] += fz; }
          }
          for (let i = 0; i < count; i++) {
            const o = i * F, l = Math.hypot(v[o + 3], v[o + 4], v[o + 5]) || 1;
            v[o + 3] /= l; v[o + 4] /= l; v[o + 5] /= l;
          }
        }

        // Bounding sphere for culling, from the baked positions.
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < count; i++) { cx += v[i * F]; cy += v[i * F + 1]; cz += v[i * F + 2]; }
        cx /= count; cy /= count; cz /= count;
        let r2 = 0;
        for (let i = 0; i < count; i++) {
          const dx = v[i * F] - cx, dy = v[i * F + 1] - cy, dz = v[i * F + 2] - cz;
          r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
        }

        triangles += indices.length / 3;
        primitives.push({
          name: `${mesh.name ?? `mesh${node.mesh}`}/${pi}`,
          material: prim.material ?? -1,
          geometry: {
            vertices: v, indices, vertexCount: count,
            bounds: new Float32Array([cx, cy, cz, Math.sqrt(r2)]),
          },
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
      color: [f[0], f[1], f[2]], alpha: f[3],
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      baseColorTexture: pbr.baseColorTexture?.index,
      metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index,
      normalTexture: m.normalTexture?.index,
      normalScale: m.normalTexture?.scale ?? 1,
      alphaMode: m.alphaMode ?? 'OPAQUE',
      alphaCutoff: m.alphaCutoff ?? 0.5,
      doubleSided: !!m.doubleSided,
    };
  });

  return { primitives, materials, bounds: { min, max }, triangles };
}

/* ---------------------------------------------------------------- load --- */

function resolve(uri, base) {
  if (uri.startsWith('data:')) return uri;
  return new URL(uri, base).href;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gltf: ${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Load a .gltf or .glb into an app. Resolves to
 *   { entities, bounds, triangles, primitives, materials, textures }.
 *
 * onProgress(stage, done, total) reports 'geometry' and 'textures'.
 */
export async function loadGLTF(app, source, { onProgress = () => {} } = {}) {
  // A URL, raw bytes, or a packed asset from a script tag (see packed.js).
  // Only a URL touches the network; the other two load entirely from memory,
  // which is what lets a model ride inside a .js file past a CSP that blocks
  // fetch but allows scripts.
  let raw, base;
  if (typeof source === 'string') {
    base = new URL(source, globalThis.location?.href ?? 'http://localhost/').href;
    raw = await fetchBytes(base);
  } else if (source?.format && source?.data !== undefined) {
    onProgress('unpacking', 0, 1);
    raw = new Uint8Array(await unpackAsset(source));
    onProgress('unpacking', 1, 1);
    base = globalThis.location?.href ?? 'http://localhost/';
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    raw = source instanceof ArrayBuffer ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    base = globalThis.location?.href ?? 'http://localhost/';
  } else {
    throw new Error('loadGLTF: expected a URL, an ArrayBuffer, or a packed asset');
  }

  let json, buffers;
  if (isGLB(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))) {
    const glb = parseGLB(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    json = glb.json;
    buffers = await Promise.all((json.buffers ?? []).map((b, i) =>
      (i === 0 && b.uri === undefined) ? glb.bin : fetchBytes(resolve(b.uri, base))));
  } else {
    json = JSON.parse(new TextDecoder().decode(raw));
    buffers = await Promise.all((json.buffers ?? []).map((b) => fetchBytes(resolve(b.uri, base))));
  }
  onProgress('geometry', 0, 1);

  const parsed = parseGLTF(json, buffers);
  onProgress('geometry', 1, 1);

  // Which images are colour (sRGB) and which are data (linear). A texture used
  // as base colour must be decoded, everything else must not be.
  const srgbTextures = new Set();
  for (const m of parsed.materials) if (m.baseColorTexture !== undefined) srgbTextures.add(m.baseColorTexture);

  const device = app.device;
  const textureCount = (json.textures ?? []).length;
  let done = 0;
  const gpuTextures = await pool(json.textures ?? [], 6, async (tex, ti) => {
    // EXT_texture_webp puts the WebP image in the extension; `source`, if
    // present at all, is only a fallback for viewers without WebP.
    const img = json.images[tex.extensions?.EXT_texture_webp?.source ?? tex.source];
    let blob;
    if (img.bufferView !== undefined) {
      blob = new Blob([bufferViewBytes(json, buffers, img.bufferView)], { type: img.mimeType });
    } else {
      blob = await (await fetch(resolve(img.uri, base))).blob();
    }
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const texture = textureFromImage(device, bitmap, {
      srgb: srgbTextures.has(ti), label: img.name ?? img.uri ?? `texture${ti}`,
    });
    bitmap.close?.();
    onProgress('textures', ++done, textureCount);
    return texture;
  });

  const materialIds = parsed.materials.map((m) => app.material({
    name: m.name,
    color: m.color, alpha: m.alpha,
    metallic: m.metallic, roughness: m.roughness,
    baseColorTexture: gpuTextures[m.baseColorTexture] ?? null,
    metallicRoughnessTexture: gpuTextures[m.metallicRoughnessTexture] ?? null,
    normalTexture: gpuTextures[m.normalTexture] ?? null,
    normalScale: m.normalScale,
    alphaMode: m.alphaMode, alphaCutoff: m.alphaCutoff,
    doubleSided: m.doubleSided,
  }));
  const fallback = materialIds.length ? null : app.material({ name: 'gltf-default' });

  const entities = parsed.primitives.map((p) => {
    const mesh = app.renderer.createMesh(p.geometry, p.name);
    const material = p.material >= 0 ? materialIds[p.material] : (fallback ?? app.renderer.defaultMaterial);
    return app.add({ mesh, material });     // transforms are baked into the vertices
  });

  return {
    entities, bounds: parsed.bounds, triangles: parsed.triangles,
    primitives: parsed.primitives.length, materials: materialIds.length,
    textures: gpuTextures.length,
  };
}
