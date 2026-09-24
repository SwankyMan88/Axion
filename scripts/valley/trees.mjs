/**
 * Trees: photoscanned Poly Haven trees rebuilt for real time.
 *
 * Bark is simplified per level. Foliage becomes cards (see process.mjs):
 * a few thousand near the camera, a few hundred further out, and at the far
 * end a baked impostor of three crossed quads. Each tree variant is one model.
 */
import { readGLTF, primitives } from './gltf-read.mjs';
import { cardsFrom, thinCards, cardMesh, simplify, merge, transform, bounds, compact } from './process.mjs';
import { rgba, bakeSide, webpFromRaw } from './images.mjs';

const PH = process.env.PH_DIR ?? 'ph';

function isFoliage(name) { return /twig|leaves/.test(name); }

function crossedQuads(halfW, bottom, top, count = 3) {
  const quads = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI;
    const cx = Math.cos(a), cz = Math.sin(a);
    quads.push({
      pos: [-halfW * cx, bottom, -halfW * cz, halfW * cx, bottom, halfW * cz, halfW * cx, top, halfW * cz, -halfW * cx, top, -halfW * cz],
      // Leaning the normals up and out makes the crossed cards light like a crown.
      nor: [-cz * 0.5 - cx * 0.3, 0.8, cx * 0.5 - cz * 0.3, -cz * 0.5 + cx * 0.3, 0.8, cx * 0.5 + cz * 0.3,
        -cz * 0.5 + cx * 0.3, 0.8, cx * 0.5 + cz * 0.3, -cz * 0.5 - cx * 0.3, 0.8, cx * 0.5 - cz * 0.3],
    });
  }
  const n = quads.length;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
  quads.forEach((q, i) => {
    pos.set(q.pos, i * 12);
    for (let k = 0; k < 4; k++) {
      const x = q.nor[k * 3], y = q.nor[k * 3 + 1], z = q.nor[k * 3 + 2], l = Math.hypot(x, y, z);
      nor.set([x / l, y / l, z / l], i * 12 + k * 3);
    }
    uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { pos, nor, uv, idx };
}

/**
 * spec: { asset, name, variants, cards: [l0, l1, l2], bark: [l0, l1, l2],
 *         distances: [0, d1, d2, d3], drawDistance, twigSize, barkSize, wind }
 */
export async function buildTrees(reg, spec) {
  const g = await readGLTF(`${PH}/${spec.asset}/${spec.asset}_1k.gltf`);
  const { json } = g;
  const roots = json.scenes[json.scene ?? 0].nodes;
  const mats = json.materials;
  const texDir = `${PH}/${spec.asset}/textures`;
  const alphaFile = (await import('node:fs')).readdirSync(`${PH}/alpha`).find((f) => f.startsWith(spec.asset + '__'));
  const alphaPath = alphaFile ? `${PH}/alpha/${alphaFile}` : null;
  const uri = (ti) => `${PH}/${spec.asset}/` + json.images[json.textures[ti].source].uri;

  // Materials: one foliage material (cards) and one per bark texture.
  const matIndex = new Map();
  const matFor = async (mi) => {
    const m = mats[mi];
    const pbr = m.pbrMetallicRoughness;
    const base = uri(pbr.baseColorTexture.index);
    if (isFoliage(m.name)) {
      const key = `${spec.asset}:foliage`;
      if (!matIndex.has(key)) {
        const t = await reg.texture(`${key}:color`, base, { size: spec.twigSize ?? 1024, alphaPath, quality: 80 });
        matIndex.set(key, reg.material({
          name: `${spec.name}_foliage`, baseColor: t, roughness: 0.82, color: spec.foliageTint ?? [1, 1, 1],
          alphaMode: 'MASK', alphaCutoff: 0.42, doubleSided: true,
          extras: { wind: spec.wind ?? 0.35, flutter: 0.7, translucency: 0.55 },
        }));
      }
      return matIndex.get(key);
    }
    // Bark: dead branches share the bark texture, so they share the material.
    const key = `${spec.asset}:${base}`;
    if (!matIndex.has(key)) {
      const size = spec.barkSize ?? 512;
      const color = await reg.texture(`${key}:color`, base, { size, quality: 80 });
      const normal = await reg.texture(`${key}:normal`, uri(m.normalTexture.index), { size: size / 2, quality: 85 });
      const mr = await reg.texture(`${key}:mr`, uri(pbr.metallicRoughnessTexture.index), { size: size / 4, quality: 80 });
      matIndex.set(key, reg.material({
        name: `${spec.name}_bark_${matIndex.size}`, baseColor: color, normal, mr, roughness: 1,
        extras: { wind: spec.wind ?? 0.35 },
      }));
    }
    return matIndex.get(key);
  };

  const models = [];
  const letters = 'abcdefgh';
  for (const vi of spec.variants) {
    const root = roots[vi];
    const prims = primitives(g, [root]);
    // Base of the trunk: lowest bark point; axis from the bark near the ground.
    let minY = Infinity;
    for (const p of prims) if (!isFoliage(mats[p.material].name)) for (let i = 1; i < p.pos.length; i += 3) minY = Math.min(minY, p.pos[i]);
    let ax = 0, az = 0, an = 0;
    for (const p of prims) {
      if (isFoliage(mats[p.material].name)) continue;
      for (let i = 0; i < p.pos.length; i += 3) {
        if (p.pos[i + 1] < minY + 0.6) { ax += p.pos[i]; az += p.pos[i + 2]; an++; }
      }
    }
    const origin = [ax / an, minY, az / an];

    const foliage = [], bark = new Map();
    for (const p of prims) {
      const m = transform({ pos: p.pos, nor: p.nor, uv: p.uv, idx: p.idx }, origin, 1, spec.yaw ?? 0);
      const mi = await matFor(p.material);
      if (isFoliage(mats[p.material].name)) foliage.push(m);
      else { if (!bark.has(mi)) bark.set(mi, []); bark.get(mi).push(m); }
    }
    const foliageMesh = merge(foliage);
    const foliageMat = await matFor(prims.find((p) => isFoliage(mats[p.material].name)).material);
    let cards = cardsFrom(foliageMesh);
    // Drop cards that map onto solid or empty parts of the atlas (bark strips,
    // stems, padding): a real twig covers only part of its rectangle.
    if (alphaPath) {
      if (!reg.cache.has(alphaPath)) reg.cache.set(alphaPath, await rgba(alphaPath, { size: 256 }));
      const A = reg.cache.get(alphaPath);
      const cover = (c) => {
        let sum = 0;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
          const u = c.uv[0] + (c.uv[2] - c.uv[0]) * (i + 0.5) / 8, v = c.uv[1] + (c.uv[3] - c.uv[1]) * (j + 0.5) / 8;
          const x = Math.min(255, Math.max(0, Math.floor((u - Math.floor(u)) * 256)));
          const y = Math.min(255, Math.max(0, Math.floor((v - Math.floor(v)) * 256)));
          sum += A.data[(y * 256 + x) * 4];
        }
        return sum / (64 * 255);
      };
      const before = cards.length;
      cards = cards.filter((c) => { const k = cover(c); return k > 0.06 && k < 0.8; });
      if (before - cards.length > before * 0.02) console.log(`    dropped ${before - cards.length} of ${before} cards (solid or empty)`);
    }
    const barkMeshes = [...bark.entries()].map(([mi, list]) => [mi, merge(list)]);

    // Trunk radius for collision: bark points between knee and head height, near the axis.
    const rs = [];
    // The trunk material if the tree has one, otherwise all bark.
    const trunkOnly = prims.some((p) => /trunk/.test(mats[p.material].name));
    const trunkMeshes = trunkOnly
      ? prims.filter((p) => /trunk/.test(mats[p.material].name)).map((p) => p)
      : barkMeshes.map(([, m]) => m);
    for (const m of trunkMeshes) {
      for (let i = 0; i < m.pos.length; i += 3) {
        const y = m.pos[i + 1];
        if (y > 0.4 && y < 1.6) {
          const r = Math.hypot(m.pos[i], m.pos[i + 2]);
          if (r < 1.2) rs.push(r);
        }
      }
    }
    rs.sort((a, b) => a - b);
    const trunk = rs.length ? rs[Math.floor(rs.length * 0.5)] : 0.2;
    const b = bounds(foliageMesh);

    const levels = [];
    for (let l = 0; l < spec.cards.length; l++) {
      const parts = [];
      for (const [mi, m] of barkMeshes) {
        const target = spec.bark[l];
        if (target <= 0) continue;
        parts.push({ mesh: simplify(m, target, { error: 0.08 }), material: mi });
      }
      const thin = thinCards(cards, spec.cards[l], { seed: vi + 1, grow: spec.grow ?? 0.42 });
      parts.push({ mesh: cardMesh(thin), material: foliageMat });
      levels.push({ distance: spec.distances[l], parts });
    }

    const withImpostor = spec.distances.length > spec.cards.length;
    // Impostor from the middle level, seen from the side.
    const texCache = reg.cache;
    if (withImpostor) {
    const texKey = `${spec.asset}:bake`;
    if (!texCache.has(texKey)) texCache.set(texKey, new Map());
    const pix = texCache.get(texKey);
    for (const [mi] of barkMeshes) {
      if (!pix.has(mi)) pix.set(mi, await rgba(reg.sourceOf(reg.materials[mi].baseColor), { size: 256 }));
    }
    if (!pix.has(foliageMat)) pix.set(foliageMat, await rgba(reg.sourceOf(reg.materials[foliageMat].baseColor), { size: 512, alphaPath }));
    const bake = bakeSide(levels[Math.min(1, levels.length - 1)].parts.map((p) => ({
      mesh: p.mesh, tex: pix.get(p.material), cutoff: p.material === foliageMat ? 0.42 : 0,
    })), { width: 256, height: 512 });
    if (process.env.DUMP_BAKE) { const sharp = (await import('sharp')).default; await sharp(Buffer.from(bake.data), { raw: { width: bake.width, height: bake.height, channels: 4 } }).png().toFile(`${process.env.DUMP_BAKE}/${spec.name}_${letters[vi]}.png`); }
    const impTex = reg.textureRaw(`${spec.name}_${letters[vi]}:impostor`, await webpFromRaw(bake));
    const impMat = reg.material({
      name: `${spec.name}_${letters[vi]}_impostor`, baseColor: impTex, roughness: 0.9,
      alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true,
      extras: { wind: (spec.wind ?? 0.35) * 0.5, translucency: 0.45, castShadow: false },
    });
    levels.push({ distance: spec.distances[spec.cards.length], parts: [{ mesh: crossedQuads(bake.halfW, bake.bottom, bake.top), material: impMat }] });
    }

    models.push({
      name: `${spec.name}_${letters[vi]}`,
      levels,
      drawDistance: spec.drawDistance ?? 0,
      extras: { kind: 'tree', trunk, height: b.max[1], crown: Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2 },
    });
    console.log(`  ${spec.name}_${letters[vi]}: height ${b.max[1].toFixed(1)} m, trunk r ${trunk.toFixed(2)}, cards ${cards.length}, levels ${levels.map((l) => l.parts.reduce((s, p) => s + p.mesh.idx.length / 3, 0)).join('/')} tris`);
  }
  return models;
}
