/**
 * Build the distributable bundles.
 *
 *   dist/axion.esm.js   — ES module, for bundlers and <script type="module">
 *   dist/axion.js       — IIFE exposing a global `Axion`, for environments
 *                         that cannot use modules (Khan Academy, CodePen, a
 *                         plain <script> tag)
 *   dist/axion.min.js   — the same, minified
 *
 * The IIFE build is the one that matters for a CDN: jsDelivr can serve any
 * file from a GitHub tag, but a page that cannot use `import` needs a global.
 */
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const banner = {
  js: `/*! Axion ${pkg.version} — WebGPU, data-oriented 3D engine. MIT. */`,
};

mkdirSync('dist', { recursive: true });

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  target: 'es2022',
  banner,
  legalComments: 'inline',
};

await build({ ...common, format: 'esm', outfile: 'dist/axion.esm.js' });
await build({ ...common, format: 'iife', globalName: 'Axion', outfile: 'dist/axion.js' });
await build({
  ...common, format: 'iife', globalName: 'Axion',
  outfile: 'dist/axion.min.js', minify: true,
});

const { statSync } = await import('node:fs');
for (const f of ['dist/axion.esm.js', 'dist/axion.js', 'dist/axion.min.js']) {
  console.log(`${f.padEnd(20)} ${(statSync(f).size / 1024).toFixed(1)} KB`);
}
