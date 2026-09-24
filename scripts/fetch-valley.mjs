/**
 * Download the Poly Haven originals (CC0) that the Pine Valley packs are
 * built from. About 3 GB; nothing here is needed to use the packs.
 *
 *   node scripts/fetch-valley.mjs            # into ./ph, or $PH_DIR
 *   node scripts/build-valley.mjs all        # then build the packs
 *
 * Layout written:
 *   <dir>/<asset>/...                  each model's 1k glTF with its textures
 *   <dir>/alpha/<asset>__<map>.png     separate cut-out masks for foliage
 *   <dir>/terrain/<id>__Diffuse.jpg    ground textures, colour and normal
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DIR = process.env.PH_DIR ?? 'ph';
const API = 'https://api.polyhaven.com/files/';
const HEADERS = { 'User-Agent': 'axion-valley-fetch' };

const MODELS = [
  'pine_tree_01', 'fir_tree_01', 'pine_sapling_medium', 'fir_sapling_medium', 'pine_sapling_small',
  'fir_sapling', 'island_tree_01', 'island_tree_02',
  'rock_moss_set_01', 'rock_moss_set_02', 'boulder_01', 'stone_01', 'rock_07', 'rock_face_01',
  'rock_face_02', 'mountainside', 'dead_tree_trunk', 'dead_tree_trunk_02', 'tree_stump_01',
  'tree_stump_02', 'root_cluster_01', 'dry_branches_medium_01', 'fern_02', 'shrub_04', 'shrub_02', 'dandelion_01',
  'stone_fire_pit', 'wooden_lantern_01', 'wooden_picnic_table', 'painted_wooden_bench',
  'wooden_barrels_01', 'wooden_crate_01', 'wooden_crate_02', 'wooden_bucket_01',
  'modular_wooden_pier', 'modular_fort_01',
];
const GROUND = ['leafy_grass', 'forest_leaves_04', 'rocky_trail', 'river_small_rocks', 'lichen_rock'];

const exists = (p) => access(p).then(() => true, () => false);

async function json(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

async function save(url, path) {
  if (await exists(path)) return;
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`${r.status} for ${url}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (tries >= 2) throw e;
    }
  }
}

// A few downloads at a time
async function pool(jobs, size = 6) {
  let next = 0;
  const run = async () => { while (next < jobs.length) await jobs[next++](); };
  await Promise.all(Array.from({ length: size }, run));
}

for (const asset of MODELS) {
  const files = await json(API + asset);
  const g = files.gltf['1k'].gltf;
  const jobs = [() => save(g.url, join(DIR, asset, g.url.split('/').pop()))];
  for (const [rel, info] of Object.entries(g.include)) jobs.push(() => save(info.url, join(DIR, asset, rel)));
  // Foliage keeps its cut-out in a separate mask
  for (const key of Object.keys(files)) {
    if (/alpha/i.test(key) && files[key]['1k']?.png) {
      jobs.push(() => save(files[key]['1k'].png.url, join(DIR, 'alpha', `${asset}__${key}.png`)));
    }
  }
  await pool(jobs);
  console.log(asset);
}

for (const id of GROUND) {
  const files = await json(API + id);
  await save(files.Diffuse['2k'].jpg.url, join(DIR, 'terrain', `${id}__Diffuse.jpg`));
  await save(files.nor_gl['2k'].jpg.url, join(DIR, 'terrain', `${id}__nor_gl.jpg`));
  console.log(id);
}
