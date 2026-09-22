/**
 * Pack Sponza into one self-decoding script: assets/sponza.js.
 *
 *   node scripts/fetch-sponza.mjs   # originals -> demo/assets/sponza/
 *   node scripts/pack-sponza.mjs [--size 1024] [--quality 80]
 *
 * Geometry: transforms baked, then quantized (KHR_mesh_quantization) —
 * uint16 positions under one root node's scale/translation, int8 normals,
 * uint16 UVs restored per material by KHR_texture_transform.
 * Textures: WebP (EXT_texture_webp). Then GLB -> gzip -9 -> base64 -> JS.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseGLTF } from '../src/loaders/gltf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'demo/assets/sponza/Sponza.gltf');
const OUT = join(ROOT, 'assets/sponza.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SIZE = arg('--size', 1024), QUALITY = arg('--quality', 80);
const LIMIT = 19 * 1024 * 1024;

const json = JSON.parse(await readFile(SRC, 'utf8'));
const dir = dirname(SRC);
const buffers = await Promise.all(json.buffers.map(b => readFile(join(dir, decodeURIComponent(b.uri)))));
const scene = parseGLTF(json, buffers.map(b => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
const F = 8;

/* --- binary builder --- */
const chunks = []; let offset = 0;
const views = [], accessors = [];
function addView(bytes, target) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
  chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); offset += bytes.byteLength;
  return views.length - 1;
}
function addAccessor(view, componentType, type, count, extra = {}) {
  accessors.push({ bufferView: view, componentType, type, count, ...extra });
  return accessors.length - 1;
}

/* --- quantization frames --- */
const { min, max } = scene.bounds;
const ext = [0, 1, 2].map(k => Math.max(max[k] - min[k], 1e-6));
const pScale = Math.max(...ext) / 65535;          // uniform: keeps normals exact under the node transform

const uvRange = new Map();                        // material -> [umin, vmin, umax, vmax]
for (const p of scene.primitives) {
  const r = uvRange.get(p.material) ?? [Infinity, Infinity, -Infinity, -Infinity];
  const v = p.geometry.vertices;
  for (let i = 0; i < p.geometry.vertexCount; i++) {
    const u = v[i * F + 6], w = v[i * F + 7];
    r[0] = Math.min(r[0], u); r[1] = Math.min(r[1], w); r[2] = Math.max(r[2], u); r[3] = Math.max(r[3], w);
  }
  uvRange.set(p.material, r);
}

/* --- meshes --- */
const meshes = [];
for (const p of scene.primitives) {
  const { vertices: v, indices, vertexCount: n } = p.geometry;
  const pos = new Uint16Array(n * 4), nor = new Int8Array(n * 4), uv = new Uint16Array(n * 2);
  const r = uvRange.get(p.material);
  const us = Math.max(r[2] - r[0], 1e-9), vs = Math.max(r[3] - r[1], 1e-9);
  const qmin = [65535, 65535, 65535], qmax = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const q = Math.round((v[i * F + k] - min[k]) / pScale);
      pos[i * 4 + k] = q; qmin[k] = Math.min(qmin[k], q); qmax[k] = Math.max(qmax[k], q);
      nor[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, v[i * F + 3 + k])) * 127);
    }
    uv[i * 2] = Math.round((v[i * F + 6] - r[0]) / us * 65535);
    uv[i * 2 + 1] = Math.round((v[i * F + 7] - r[1]) / vs * 65535);
  }
  const big = n > 65535;
  const idx = big ? new Uint32Array(indices) : new Uint16Array(indices);
  const aPos = addAccessor(addView(pos, 34962), 5123, 'VEC3', n, { min: qmin, max: qmax });

  const aNor = addAccessor(addView(nor, 34962), 5120, 'VEC3', n, { normalized: true });
  views[accessors[aNor].bufferView].byteStride = 4;
  const aUV = addAccessor(addView(uv, 34962), 5123, 'VEC2', n, { normalized: true });
  const aIdx = addAccessor(addView(idx, 34963), big ? 5125 : 5123, 'SCALAR', idx.length);
  meshes.push({ name: p.name, primitives: [{
    attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUV }, indices: aIdx,
    ...(p.material >= 0 ? { material: p.material } : {}),
  }] });
}
for (const a of accessors) if (a.type === 'VEC3' && a.componentType === 5123) views[a.bufferView].byteStride = 8;

/* --- materials: original, with UV transforms on every texture ref --- */
const materials = json.materials.map((m, i) => {
  const out = structuredClone(m);
  const r = uvRange.get(i);
  if (!r) return out;
  const t = { KHR_texture_transform: { offset: [r[0], r[1]], scale: [Math.max(r[2] - r[0], 1e-9), Math.max(r[3] - r[1], 1e-9)] } };
  for (const ref of [out.pbrMetallicRoughness?.baseColorTexture, out.pbrMetallicRoughness?.metallicRoughnessTexture, out.normalTexture, out.occlusionTexture, out.emissiveTexture]) {
    if (ref) { delete ref.texCoord; ref.extensions = { ...(ref.extensions ?? {}), ...t }; }
  }
  return out;
});

/* --- textures -> webp --- */
const images = [];
let texBytes = 0;
for (let i = 0; i < json.images.length; i++) {
  const img = json.images[i];
  const src = await readFile(join(dir, decodeURIComponent(img.uri)));
  const webp = await sharp(src).resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 6, alphaQuality: 90 }).toBuffer();
  texBytes += webp.length;
  images.push({ mimeType: 'image/webp', bufferView: addView(new Uint8Array(webp)) });
}
const textures = json.textures.map(t => ({
  sampler: t.sampler, extensions: { EXT_texture_webp: { source: t.source } },
}));

const bin = new Uint8Array(offset); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; } }
const gltf = {
  asset: { version: '2.0', generator: 'axion pack-sponza', copyright: 'Crytek Sponza; see assets/NOTICE.md' },
  extensionsUsed: ['KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp'],
  extensionsRequired: ['KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp'],
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'sponza', translation: min, scale: [pScale, pScale, pScale], children: meshes.map((_, i) => i + 1) },
    ...meshes.map((m, i) => ({ mesh: i, name: m.name }))],
  meshes, materials, textures, images, samplers: json.samplers,
  accessors, bufferViews: views, buffers: [{ byteLength: bin.byteLength }],
};

/* --- GLB --- */
const enc = new TextEncoder().encode(JSON.stringify(gltf));
const jsonLen = (enc.length + 3) & ~3, binLen = (bin.length + 3) & ~3;
const glb = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
const dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
glb.fill(0x20, 20, 20 + jsonLen); glb.set(enc, 20);
dv.setUint32(20 + jsonLen, binLen, true); dv.setUint32(24 + jsonLen, 0x004e4942, true);
glb.set(bin, 28 + jsonLen);

const gz = gzipSync(glb, { level: 9 });
const b64 = gz.toString('base64');
const js = `/* Sponza for Axion — packed glTF (GLB, gzip, base64). Decode with Axion.loadGLTF(app, AxionAssets.sponza).
 * Model: Crytek Sponza (Frank Meinl), original by Marko Dabrovic; fixes by Morgan McGuire;
 * PBR textures by Alexandre Pestana; glTF conversion by the Khronos Group. See assets/NOTICE.md. */
(globalThis.AxionAssets ??= {}).sponza = { format: 'glb.gz.b64', bytes: ${glb.length}, data: "${b64}" };
`;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, js);
const mb = x => (x / 1048576).toFixed(2) + ' MB';
console.log(`geometry ${mb(offset - texBytes)}, textures ${mb(texBytes)} (${images.length} @ ${SIZE}px q${QUALITY}), glb ${mb(glb.length)}, gz ${mb(gz.length)}, js ${mb(js.length)}`);
if (js.length > LIMIT) { console.error('too large for jsDelivr (20 MB) — lower --size or --quality'); process.exit(1); }
