/**
 * Dev server. The demo page lives in demo/ but imports './src/index.js',
 * because that is how it is laid out when published. This maps both onto one
 * origin so the same file works locally and deployed.
 *
 *   node test/serve.mjs   →  http://localhost:8080             (light study)
 *                            http://localhost:8080/sponza.html (Sponza)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/demo/index.html';
  let file = path.join(ROOT, rel);
  // Demo pages are published with their files beside them (./src, ./assets),
  // so anything not found at the repository root is looked up under demo/.
  // That makes /sponza.html and /assets/... resolve exactly as they do live.
  if (!fs.existsSync(file)) file = path.join(ROOT, 'demo', rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`axion demo → http://localhost:${PORT}`));
