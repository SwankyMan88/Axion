/**
 * Rocks, logs, plants and props: simplified into levels of detail, with a
 * low-poly collision mesh for anything you can walk into.
 */
import { readGLTF, primitives } from './gltf-read.mjs';
import { simplify, merge, transform, bounds } from './process.mjs';
import { readdirSync, existsSync } from 'node:fs';

const PH = process.env.PH_DIR ?? 'ph';

/**
 * spec: { asset, name, split: 'each' | 'all' | [node names],
 *         lods: [tris per level], distances, drawDistance, texSize,
 *         collider: triangle budget or 0, keepLayout, masked, extras, rename }
 */
export async function buildProps(reg, spec) {
  const g = await readGLTF(`${PH}/${spec.asset}/${spec.asset}_1k.gltf`);
  const { json } = g;
  const roots = json.scenes[json.scene ?? 0].nodes;
  const mats = json.materials;
  const uri = (ti) => `${PH}/${spec.asset}/` + json.images[json.textures[ti].source].uri;
  const alphaDir = `${PH}/alpha`;
  const alphaFile = existsSync(alphaDir) ? readdirSync(alphaDir).find((f) => f.startsWith(spec.asset + '__')) : null;

  const matIndex = new Map();
  const matFor = async (mi) => {
    if (matIndex.has(mi)) return matIndex.get(mi);
    const m = mats[mi];
    const pbr = m.pbrMetallicRoughness ?? {};
    const size = spec.texSize ?? 512;
    const masked = spec.masked || m.alphaMode === 'MASK';
    const desc = {
      name: `${spec.name}_${m.name}`, roughness: 1, metallic: pbr.metallicFactor ?? 0,
      color: spec.tint ?? [1, 1, 1],
      extras: { ...(spec.materialExtras ?? {}) },
    };
    if (pbr.baseColorTexture) {
      desc.baseColor = await reg.texture(`${spec.asset}:${m.name}:color`, uri(pbr.baseColorTexture.index), {
        size, quality: 82, alphaPath: masked && alphaFile ? `${alphaDir}/${alphaFile}` : null,
      });
    }
    if (m.normalTexture) desc.normal = await reg.texture(`${spec.asset}:${m.name}:normal`, uri(m.normalTexture.index), { size: Math.max(size / 2, 256), quality: 85 });
    if (pbr.metallicRoughnessTexture) desc.mr = await reg.texture(`${spec.asset}:${m.name}:mr`, uri(pbr.metallicRoughnessTexture.index), { size: Math.max(size / 4, 128), quality: 80 });
    if (masked) { desc.alphaMode = 'MASK'; desc.alphaCutoff = 0.5; desc.doubleSided = true; }
    const idx = reg.material(desc);
    matIndex.set(mi, idx);
    return idx;
  };

  // Which root nodes make which model.
  let groups;
  if (spec.split === 'all') groups = [{ name: spec.name, nodes: roots }];
  else if (Array.isArray(spec.split)) {
    groups = spec.split.map((s) => ({
      name: s.name, nodes: roots.filter((r) => s.nodes.includes(json.nodes[r].name)),
    }));
  } else {
    groups = roots.map((r) => ({ name: `${spec.name}_${json.nodes[r].name.replace(spec.asset + '_', '').replace(/_LOD0$/, '')}`, nodes: [r] }));
  }

  const models = [];
  for (const grp of groups) {
    if (!grp.nodes.length) continue;
    const prims = primitives(g, grp.nodes);
    const all = merge(prims.map((p) => ({ pos: p.pos, nor: p.nor, uv: p.uv, idx: p.idx })));
    const b = bounds(all);
    // Pivot: centre of the footprint at the lowest point, unless the layout matters.
    const origin = spec.keepLayout ? [0, 0, 0] : [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
    const byMat = new Map();
    for (const p of prims) {
      const mi = await matFor(p.material);
      const m = transform({ pos: p.pos, nor: p.nor, uv: p.uv, idx: p.idx }, origin, spec.scale ?? 1);
      if (!byMat.has(mi)) byMat.set(mi, []);
      byMat.get(mi).push(m);
    }
    const meshes = [...byMat.entries()].map(([mi, list]) => [mi, merge(list)]);
    const total = meshes.reduce((s, [, m]) => s + m.idx.length / 3, 0);

    const levels = spec.lods.map((target, l) => ({
      distance: spec.distances[l],
      parts: meshes.map(([mi, m]) => ({
        mesh: simplify(m, Math.max(12, Math.round(target * (m.idx.length / 3) / total)), { error: 0.1 }),
        material: mi,
      })),
    }));
    let collider = null;
    if (spec.collider) {
      collider = simplify(merge(meshes.map(([, m]) => m)), spec.collider, { error: 0.3 });
      // Small props simplify to nothing: give them their bounding box instead.
      if (collider.idx.length / 3 < 12) collider = boxMesh(bounds(merge(meshes.map(([, m]) => m))));
    }
    const size = transform(merge(meshes.map(([, m]) => ({ ...m, pos: m.pos.slice(), nor: m.nor.slice() }))), [0, 0, 0]);
    const bb = bounds(size);
    models.push({
      name: grp.name, levels, collider, drawDistance: spec.drawDistance ?? 0,
      extras: { kind: spec.kind ?? 'prop', size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], ...(spec.extras ?? {}) },
    });
    console.log(`  ${grp.name}: ${total} -> ${levels.map((l) => l.parts.reduce((s, p) => s + p.mesh.idx.length / 3, 0)).join('/')} tris${collider ? `, collider ${collider.idx.length / 3}` : ''}, size ${models.at(-1).extras.size.map((v) => v.toFixed(1)).join('x')}`);
  }
  return models;
}

function boxMesh({ min, max }) {
  const p = [];
  for (let i = 0; i < 8; i++) p.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
  const idx = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return { pos: new Float32Array(p), nor: new Float32Array(24), uv: new Float32Array(16), idx: new Uint32Array(idx) };
}
