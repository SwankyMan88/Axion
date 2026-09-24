/**
 * Joins the Pine Valley packs into the two files the demo loads, each under
 * jsDelivr's 20 MB limit:
 *
 *   assets/pine-valley-1.js   the map and the forest
 *   assets/pine-valley-2.js   rocks and plants, the camp and fort, and the sound
 *
 * Run after build-valley.mjs:  node scripts/bundle-valley.mjs
 * (the separate valley-*.js packs it reads are build output, not committed)
 */
import { readFile, writeFile } from 'node:fs/promises';

const parts = {
  'pine-valley-1': ['valley-map.js', 'valley-trees.js'],
  'pine-valley-2': ['valley-nature.js', 'valley-props.js', '../scripts/valley/sound.js'],
};

for (const [out, files] of Object.entries(parts)) {
  let text = `/* Pine Valley for Axion, part ${out.slice(-1)} of 2. Poly Haven models and textures, CC0. See assets/NOTICE.md. */\n`;
  for (const f of files) {
    let part = await readFile(new URL(`../assets/${f}`, import.meta.url), 'utf8');
    // The sound script carries its recordings, kept separately as JSON
    if (f.endsWith('sound.js')) {
      const clips = await readFile(new URL('./valley/sound-clips.json', import.meta.url), 'utf8');
      part = part.replace('/*CLIPS*/null', clips);
    }
    text += part + '\n';
  }
  await writeFile(new URL(`../assets/${out}.js`, import.meta.url), text);
  console.log(`${out}.js ${(text.length / 1e6).toFixed(2)} MB`);
}
