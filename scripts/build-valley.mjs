/**
 * Build the Pine Valley asset packs from Poly Haven originals (CC0).
 *
 *   node scripts/fetch-valley.mjs          # downloads originals into ./ph (about 3 GB)
 *   node scripts/build-valley.mjs [pack]   # trees | nature | props | map | all
 *
 * Output: assets/valley-<pack>.js, each a gzipped, base64'd GLB model
 * library that Axion.loadModels reads straight from a script tag.
 */
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from './valley/registry.mjs';
import { buildTrees } from './valley/trees.mjs';
import { buildProps } from './valley/props.mjs';
import { writeGLB } from './valley/glb.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv[2] ?? 'all';
const LIMIT = 19 * 1024 * 1024;

async function pack(name, build) {
  const reg = new Registry();
  const t0 = Date.now();
  console.log(`== ${name}`);
  const models = await build(reg);
  const glb = writeGLB({ models, materials: reg.materials, textures: reg.textures });
  const gz = gzipSync(glb, { level: 9 });
  const b64 = gz.toString('base64');
  const js = `/* Pine Valley for Axion: ${name}. Poly Haven models and textures, CC0 (polyhaven.com). See assets/NOTICE.md. */\n` +
    `(globalThis.AxionAssets ??= {})['valley-${name}'] = { format: 'glb.gz.b64', bytes: ${glb.length}, data: "${b64}" };\n`;
  const out = join(ROOT, 'assets', `valley-${name}.js`);
  await writeFile(out, js);
  console.log(`   ${models.length} models, glb ${(glb.length / 1e6).toFixed(2)} MB (textures ${(reg.bytes() / 1e6).toFixed(2)} MB), js ${(js.length / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (js.length > LIMIT) console.log('   WARNING: over the jsDelivr file limit');
}

const T = (asset, name, o) => ({ asset, name, variants: [0, 1, 2], ...o });

if (which === 'trees' || which === 'all') {
  await pack('trees', async (reg) => {
    const big = { cards: [7000, 2200, 800], bark: [2600, 700, 140], distances: [0, 40, 100, 210], drawDistance: 2000, twigSize: 1024, barkSize: 512, wind: 0.3 };
    const med = { cards: [4200, 1300, 450], bark: [1300, 350, 70], distances: [0, 32, 85, 180], drawDistance: 2000, twigSize: 1024, barkSize: 512, wind: 0.35 };
    const small = { cards: [1400, 350], bark: [300, 60], distances: [0, 18], drawDistance: 90, twigSize: 512, barkSize: 256, wind: 0.6 };
    const leafy = { cards: [5000, 1500, 500], bark: [2500, 600, 120], distances: [0, 35, 90, 190], drawDistance: 2000, twigSize: 1024, barkSize: 512, wind: 0.35, variants: [0] };
    return [
      ...await buildTrees(reg, T('pine_tree_01', 'pine', big)),
      ...await buildTrees(reg, T('fir_tree_01', 'fir', big)),
      ...await buildTrees(reg, T('pine_sapling_medium', 'pinemed', med)),
      ...await buildTrees(reg, T('fir_sapling_medium', 'firmed', med)),
      ...await buildTrees(reg, T('pine_sapling_small', 'pinesmall', small)),
      ...await buildTrees(reg, T('fir_sapling', 'firsmall', small)),
      ...await buildTrees(reg, T('island_tree_01', 'oak', { ...leafy, name: 'oak' })),
      ...await buildTrees(reg, T('island_tree_02', 'oakb', { ...leafy, name: 'oakb' })),
    ];
  });
}

if (which === 'nature' || which === 'all') {
  await pack('nature', async (reg) => {
    const rock = { lods: [2400, 700, 160], distances: [0, 30, 90], drawDistance: 450, texSize: 512, collider: 160, kind: 'rock' };
    const cliff = { lods: [6000, 1800, 450], distances: [0, 60, 160], drawDistance: 2000, texSize: 1024, collider: 400, kind: 'cliff' };
    return [
      ...await buildProps(reg, { asset: 'rock_moss_set_01', name: 'mossrock', split: 'each', ...rock }),
      ...await buildProps(reg, { asset: 'rock_moss_set_02', name: 'mossrock2', split: 'each', ...rock }),
      ...await buildProps(reg, { asset: 'boulder_01', name: 'boulder', split: 'all', ...rock, lods: [3000, 900, 200] }),
      ...await buildProps(reg, { asset: 'stone_01', name: 'stone', split: 'all', ...rock, lods: [900, 250, 60], drawDistance: 120 }),
      ...await buildProps(reg, { asset: 'rock_07', name: 'rock7', split: 'all', ...rock, lods: [900, 250, 60], drawDistance: 150 }),
      ...await buildProps(reg, { asset: 'rock_face_01', name: 'rockface1', split: 'all', ...cliff }),
      ...await buildProps(reg, { asset: 'rock_face_02', name: 'rockface2', split: 'all', ...cliff }),
      ...await buildProps(reg, { asset: 'mountainside', name: 'cliff', split: 'all', ...cliff, lods: [9000, 2500, 600] }),
      ...await buildProps(reg, { asset: 'dead_tree_trunk', name: 'log', split: 'all', lods: [2500, 700, 150], distances: [0, 30, 80], drawDistance: 300, texSize: 512, collider: 120, kind: 'log' }),
      ...await buildProps(reg, { asset: 'dead_tree_trunk_02', name: 'deadtree', split: 'all', lods: [3000, 800, 180], distances: [0, 35, 90], drawDistance: 500, texSize: 512, collider: 150, kind: 'log' }),
      ...await buildProps(reg, { asset: 'tree_stump_01', name: 'stump', split: 'all', lods: [1800, 500, 100], distances: [0, 25, 70], drawDistance: 200, texSize: 512, collider: 80, kind: 'stump' }),
      ...await buildProps(reg, { asset: 'tree_stump_02', name: 'stump2', split: 'all', lods: [1800, 500, 100], distances: [0, 25, 70], drawDistance: 200, texSize: 512, collider: 80, kind: 'stump' }),
      ...await buildProps(reg, { asset: 'root_cluster_01', name: 'roots', split: 'all', lods: [2500, 700, 150], distances: [0, 30, 80], drawDistance: 200, texSize: 512, collider: 100, kind: 'rock' }),
      ...await buildProps(reg, { asset: 'dry_branches_medium_01', name: 'branches', split: 'each', lods: [600, 150], distances: [0, 20], drawDistance: 60, texSize: 256, kind: 'debris' }),
      ...await buildProps(reg, { asset: 'fern_02', name: 'fern', split: 'each', lods: [1600, 500], distances: [0, 22], drawDistance: 75, texSize: 512, masked: true, kind: 'plant', materialExtras: { wind: 0.9, flutter: 0.6, translucency: 0.6 } }),
      ...await buildProps(reg, { asset: 'shrub_04', name: 'shrub', split: 'all', lods: [3500, 900], distances: [0, 25], drawDistance: 90, texSize: 512, masked: true, kind: 'plant', materialExtras: { wind: 0.8, flutter: 0.8, translucency: 0.6 } }),
      ...await buildProps(reg, { asset: 'dandelion_01', name: 'dandelion', split: ['a', 'b'].map((k) => ({ name: `dandelion_${k}`, nodes: [`dandelion_01_${k}_LOD0`] })), lods: [2200, 500], distances: [0, 14], drawDistance: 40, texSize: 512, masked: true, kind: 'plant', materialExtras: { wind: 1, flutter: 0.6, translucency: 0.5 } }),
    ];
  });
}

if (which === 'props' || which === 'all') {
  await pack('props', async (reg) => {
    const small = { lods: [2000, 500], distances: [0, 20], drawDistance: 120, texSize: 512, collider: 60, kind: 'prop' };
    return [
      ...await buildProps(reg, { asset: 'stone_fire_pit', name: 'firepit', split: 'all', ...small, lods: [2500, 600], collider: 80 }),
      ...await buildProps(reg, { asset: 'wooden_lantern_01', name: 'lantern', split: 'all', ...small, lods: [3000, 600], collider: 12 }),
      ...await buildProps(reg, { asset: 'wooden_picnic_table', name: 'table', split: 'all', ...small, lods: [4000, 800], collider: 60 }),
      ...await buildProps(reg, { asset: 'painted_wooden_bench', name: 'bench', split: 'all', ...small, lods: [630, 200], collider: 40 }),
      ...await buildProps(reg, { asset: 'wooden_barrels_01', name: 'barrel', split: [{ name: 'barrel_a', nodes: ['wooden_barrels_01_barrel01'] }, { name: 'barrel_b', nodes: ['wooden_barrels_01_barrel02'] }], ...small, lods: [2500, 500], collider: 40 }),
      ...await buildProps(reg, { asset: 'wooden_crate_01', name: 'crate', split: 'all', ...small, lods: [2500, 500], collider: 12 }),
      ...await buildProps(reg, { asset: 'wooden_crate_02', name: 'crate2', split: 'all', ...small, lods: [2500, 500], collider: 12 }),
      ...await buildProps(reg, { asset: 'wooden_bucket_01', name: 'bucket', split: 'all', ...small, lods: [1500, 300], collider: 24 }),
      ...await buildProps(reg, { asset: 'modular_wooden_pier', name: 'pier', split: 'each', lods: [9000, 2500, 600], distances: [0, 40, 120], drawDistance: 900, texSize: 1024, collider: 300, kind: 'structure' }),
      ...await buildProps(reg, { asset: 'modular_fort_01', name: 'fort', split: 'each', lods: [5000, 1500, 400], distances: [0, 50, 140], drawDistance: 2000, texSize: 1024, collider: 250, kind: 'structure' }),
    ];
  });
}

if (which === 'map' || which === 'all') {
  const { buildHeights, buildSplat, buildPlacements, buildLights, SIZE, N, WATER, SPAWN, CAMP, FORT } = await import('./valley/map.mjs');
  const { webp } = await import('./valley/images.mjs');
  const t0 = Date.now();
  console.log('== map');
  const heights = buildHeights();
  console.log(`   heights ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let lo = Infinity, hi = -Infinity;
  for (const v of heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const q = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) q[i] = Math.round((heights[i] - lo) / (hi - lo) * 65535);
  // Keep the exact quantized values, so the page, the GPU and collision agree.
  for (let i = 0; i < heights.length; i++) heights[i] = lo + q[i] / 65535 * (hi - lo);
  const splatSize = 512;
  const splat = buildSplat(heights, splatSize);
  const placements = buildPlacements(heights);
  const lights = buildLights(heights);
  let count = 0;
  for (const v of Object.values(placements)) count += v.length / 5;
  console.log(`   ${count} objects in ${Object.keys(placements).length} kinds, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const T = join(process.env.PH_DIR ?? 'ph', 'terrain');
  const layerSpec = [
    ['leafy_grass', 3, 0.95], ['forest_leaves_04', 3, 0.9], ['rocky_trail', 3.5, 0.9],
    ['river_small_rocks', 2.5, 0.8], ['lichen_rock', 9, 0.8],
  ];
  const images = [];
  for (const [name] of layerSpec) {
    images.push(await webp(`${T}/${name}__Diffuse.jpg`, { size: 1024, quality: 82 }));
    images.push(await webp(`${T}/${name}__nor_gl.jpg`, { size: 512, quality: 85 }));
  }

  // Container: magic, JSON length, JSON, then 4-byte aligned binary sections.
  const sections = [];
  let off = 0;
  const add = (bytes) => { const pad = (4 - (off % 4)) % 4; off += pad; sections.push([off, bytes, pad]); const at = off; off += bytes.byteLength; return [at, bytes.byteLength]; };
  const meta = {
    size: SIZE, n: N, heightMin: lo, heightMax: hi, water: WATER, splatSize,
    spawn: SPAWN, camp: CAMP, fort: FORT, lights,
    heights: add(new Uint8Array(q.buffer)),
    splat: add(splat),
    layers: layerSpec.map(([name, scale, roughness], i) => ({
      name, scale, roughness, albedo: add(images[i * 2]), normal: add(images[i * 2 + 1]),
    })),
    placements: Object.fromEntries(Object.entries(placements).map(([k, v]) => [k, add(new Uint8Array(v.buffer))])),
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(meta));
  const head = 8 + jsonBytes.length;
  const headPad = (4 - (head % 4)) % 4;
  const total = head + headPad + off;
  const bin = new Uint8Array(total);
  const dv = new DataView(bin.buffer);
  dv.setUint32(0, 0x504d5841, true);            // 'AXMP'
  dv.setUint32(4, jsonBytes.length, true);
  bin.set(jsonBytes, 8);
  for (const [at, bytes] of sections) bin.set(new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength), head + headPad + at);
  const gz = gzipSync(bin, { level: 9 });
  const js = `/* Pine Valley for Axion: the map (terrain, layers, placements). Textures from Poly Haven, CC0. */\n` +
    `(globalThis.AxionAssets ??= {})['valley-map'] = { format: 'bin.gz.b64', bytes: ${bin.length}, data: "${gz.toString('base64')}" };\n`;
  await writeFile(join(ROOT, 'assets', 'valley-map.js'), js);
  console.log(`   map ${(bin.length / 1e6).toFixed(2)} MB, js ${(js.length / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
