/**
 * Write a model library as a compact GLB that Axion.loadModels reads.
 *
 * Geometry is quantized (KHR_mesh_quantization): uint16 positions under a
 * per-mesh node scale and offset, int8 normals, uint16 UVs mapped back to
 * their real range by a per-material KHR_texture_transform. Textures are
 * WebP (EXT_texture_webp). Levels of detail and colliders are listed in
 * extras.axion.models.
 */

const F32 = 5126, U16 = 5123, U32 = 5125, I8 = 5120;

export function writeGLB({ models, materials, textures }) {
  const chunks = [];
  let offset = 0;
  const views = [], accessors = [], nodes = [], meshes = [];
  const addView = (bytes, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    offset += bytes.byteLength;
    return views.length - 1;
  };
  const addAccessor = (view, componentType, type, count, extra = {}) => {
    accessors.push({ bufferView: view, componentType, type, count, ...extra });
    return accessors.length - 1;
  };

  // One UV range per material, so its texture transform restores every mesh that uses it.
  const uvRange = new Map();
  const everyPart = [];
  for (const m of models) {
    for (const l of m.levels) for (const p of l.parts) everyPart.push(p);
  }
  for (const p of everyPart) {
    const r = uvRange.get(p.material) ?? [Infinity, Infinity, -Infinity, -Infinity];
    const uv = p.mesh.uv;
    for (let i = 0; i < uv.length; i += 2) {
      r[0] = Math.min(r[0], uv[i]); r[1] = Math.min(r[1], uv[i + 1]);
      r[2] = Math.max(r[2], uv[i]); r[3] = Math.max(r[3], uv[i + 1]);
    }
    uvRange.set(p.material, r);
  }

  const addMesh = (parts, name) => {
    const prims = [];
    // One quantization frame for the whole node, so its parts share the transform.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
      const pos = p.mesh.pos;
      for (let i = 0; i < pos.length; i += 3) {
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      }
    }
    const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
    const scale = ext / 65535;
    for (const p of parts) {
      const { pos, nor, uv, idx } = p.mesh;
      const n = pos.length / 3;
      const qp = new Uint16Array(n * 4), qn = new Int8Array(n * 4), qu = new Uint16Array(n * 2);
      const qmin = [65535, 65535, 65535], qmax = [0, 0, 0];
      const r = p.material >= 0 ? uvRange.get(p.material) : [0, 0, 1, 1];
      const us = Math.max(r[2] - r[0], 1e-9), vs = Math.max(r[3] - r[1], 1e-9);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          const q = Math.round((pos[i * 3 + k] - min[k]) / scale);
          qp[i * 4 + k] = q; qmin[k] = Math.min(qmin[k], q); qmax[k] = Math.max(qmax[k], q);
          qn[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, nor[i * 3 + k])) * 127);
        }
        qu[i * 2] = Math.round((uv[i * 2] - r[0]) / us * 65535);
        qu[i * 2 + 1] = Math.round((uv[i * 2 + 1] - r[1]) / vs * 65535);
      }
      const big = n > 65535;
      const qi = big ? new Uint32Array(idx) : new Uint16Array(idx);
      const attributes = {
        POSITION: addAccessor(addView(qp, 34962), U16, 'VEC3', n, { min: qmin, max: qmax }),
        NORMAL: addAccessor(addView(qn, 34962), I8, 'VEC3', n, { normalized: true }),
        TEXCOORD_0: addAccessor(addView(qu, 34962), U16, 'VEC2', n, { normalized: true }),
      };
      // Byte strides: positions padded to 8 bytes, normals to 4.
      views[json_view(attributes.POSITION)].byteStride = 8;
      views[json_view(attributes.NORMAL)].byteStride = 4;
      const indices = addAccessor(addView(qi, 34963), big ? U32 : U16, 'SCALAR', qi.length);
      prims.push({ attributes, indices, ...(p.material >= 0 ? { material: p.material } : {}) });
    }
    meshes.push({ name, primitives: prims });
    nodes.push({ name, mesh: meshes.length - 1, translation: min, scale: [scale, scale, scale] });
    return nodes.length - 1;
  };
  const json_view = (acc) => accessors[acc].bufferView;

  const modelMeta = [];
  const roots = [];
  for (const m of models) {
    const levels = m.levels.map((l, i) => {
      const node = addMesh(l.parts, `${m.name}_LOD${i}`);
      roots.push(node);
      return { node, distance: l.distance };
    });
    let collider = null;
    if (m.collider) {
      collider = addMesh([{ mesh: m.collider, material: -1 }], `${m.name}_COL`);
      roots.push(collider);
    }
    modelMeta.push({ name: m.name, levels, drawDistance: m.drawDistance ?? 0, collider, extras: m.extras ?? {} });
  }

  const images = [], texs = [];
  for (const t of textures) {
    images.push({ bufferView: addView(t.data), mimeType: 'image/webp', name: t.name });
    texs.push({ extensions: { EXT_texture_webp: { source: images.length - 1 } } });
  }

  const mats = materials.map((m, i) => {
    const r = uvRange.get(i) ?? [0, 0, 1, 1];
    const tt = { KHR_texture_transform: { offset: [r[0], r[1]], scale: [r[2] - r[0], r[3] - r[1]] } };
    const tex = (index) => (index === undefined || index === null ? undefined : { index, extensions: tt });
    const pbr = {
      baseColorFactor: [...(m.color ?? [1, 1, 1]), 1],
      metallicFactor: m.metallic ?? 0,
      roughnessFactor: m.roughness ?? 1,
    };
    if (m.baseColor !== undefined) pbr.baseColorTexture = tex(m.baseColor);
    if (m.mr !== undefined) pbr.metallicRoughnessTexture = tex(m.mr);
    const out = { name: m.name, pbrMetallicRoughness: pbr, extras: m.extras ?? {} };
    if (m.normal !== undefined) out.normalTexture = { ...tex(m.normal), scale: m.normalScale ?? 1 };
    if (m.alphaMode) { out.alphaMode = m.alphaMode; out.alphaCutoff = m.alphaCutoff ?? 0.5; }
    if (m.doubleSided) out.doubleSided = true;
    return out;
  });

  const json = {
    asset: { version: '2.0', generator: 'axion valley build' },
    extensionsUsed: ['KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp'],
    extensionsRequired: ['KHR_mesh_quantization', 'EXT_texture_webp'],
    scene: 0, scenes: [{ nodes: roots }], nodes, meshes, accessors, bufferViews: views,
    materials: mats, textures: texs, images,
    buffers: [{ byteLength: offset }],
    extras: { axion: { models: modelMeta } },
  };

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const b0 = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(b0, bin.length + binPad, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  out.set(bin, b0 + 8);
  return out;
}
