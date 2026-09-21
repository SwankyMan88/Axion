// Headless WGSL + pipeline validation against Chromium's Dawn (software adapter).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/demo/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8099, r));

// Let Playwright resolve its own Chromium. AXION_CHROMIUM overrides that for
// environments that ship a browser at a fixed path instead of downloading one.
const executablePath = process.env.AXION_CHROMIUM && fs.existsSync(process.env.AXION_CHROMIUM)
  ? process.env.AXION_CHROMIUM : undefined;

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Force the software adapter: this has to produce the same answer on a CI
  // runner with no GPU as it does on a workstation with one.
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
         '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 460, height: 320 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

await page.goto('http://localhost:8099/' + (process.env.PAGE || 'test/gpu-validate.html'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__result && window.__result.done, null, { timeout: 150000 });
const result = await page.evaluate(() => window.__result);
console.log(JSON.stringify(result, null, 2));

// An output, not a fixture: the frame this run actually rendered, written
// next to the harness so CI can upload it and you can look at what the
// software adapter produced.
await page.locator('#c').screenshot({ path: path.join(ROOT, 'test', 'frame.png') });
await browser.close();
server.close();
process.exit(result && result.ok ? 0 : 1);
