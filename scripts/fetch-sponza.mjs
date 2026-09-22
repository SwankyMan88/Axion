/**
 * Download the full-resolution Khronos Sponza into demo/assets/sponza/.
 *
 *   npm run fetch:sponza
 *
 * The demo page prefers these originals (1024px textures) when present and
 * falls back to the packed 512px build otherwise. They are not committed:
 * 51 MB of third-party assets do not belong in the engine's history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Sponza/glTF/';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'assets', 'sponza');
fs.mkdirSync(OUT, { recursive: true });

async function get(name) {
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${res.status} for ${name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf;
}

const gltf = JSON.parse((await get('Sponza.gltf')).toString('utf8'));
const files = [...gltf.buffers.map((b) => b.uri), ...gltf.images.map((i) => i.uri)];
let done = 0;
const queue = [...files];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    await get(f);
    process.stdout.write(`\r${++done}/${files.length} ${f.padEnd(32)}`);
  }
}));
console.log(`\nSponza is in ${path.relative(process.cwd(), OUT)} — run npm run dev and open /sponza.html`);
