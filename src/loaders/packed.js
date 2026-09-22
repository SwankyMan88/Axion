/**
 * Packed assets: binary data carried inside a .js file.
 *
 * Why a script and not a .glb: some hosts (Khan Academy is the motivating one)
 * run a Content Security Policy that lets pages load scripts from a CDN but not
 * fetch() arbitrary files from it. A model encoded into a script tag arrives
 * through the one door that is open; everything after that happens in memory,
 * with no network request that a CSP could refuse.
 *
 * A packed script registers itself on a global:
 *
 *   globalThis.AxionAssets.sponza = { format: 'glb.gz.b64', bytes, data }
 *
 * `format` names the layers from the inside out: a GLB, gzipped, base64'd.
 * Gzip is decoded with the browser's own DecompressionStream, so the engine
 * ships no decompressor.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let lookup = null;

/** Base64 to bytes without atob's intermediate binary string: half the memory. */
export function base64ToBytes(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  if (!lookup) { lookup = new Uint8Array(128); for (let i = 0; i < 64; i++) lookup[B64.charCodeAt(i)] = i; }
  let len = b64.length;
  while (len && b64.charCodeAt(len - 1) === 61) len--;          // strip '='
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0, i = 0;
  for (; i + 4 <= len; i += 4) {
    const n = (lookup[b64.charCodeAt(i)] << 18) | (lookup[b64.charCodeAt(i + 1)] << 12)
            | (lookup[b64.charCodeAt(i + 2)] << 6) | lookup[b64.charCodeAt(i + 3)];
    out[o++] = n >> 16; out[o++] = (n >> 8) & 255; out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest >= 2) {
    const n = (lookup[b64.charCodeAt(i)] << 18) | (lookup[b64.charCodeAt(i + 1)] << 12)
            | (rest === 3 ? lookup[b64.charCodeAt(i + 2)] << 6 : 0);
    out[o++] = n >> 16;
    if (rest === 3) out[o++] = (n >> 8) & 255;
  }
  return out;
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('packed asset: this browser has no DecompressionStream');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Decode a packed asset entry back to the bytes it carries. */
export async function unpackAsset(entry) {
  if (typeof entry === 'string') {
    entry = globalThis.AxionAssets?.[entry];
    if (!entry) throw new Error('packed asset not found — is its <script> tag on the page?');
  }
  const layers = entry.format.split('.');       // e.g. ['glb', 'gz', 'b64']
  let data = entry.data;
  for (let i = layers.length - 1; i > 0; i--) {
    const layer = layers[i];
    if (layer === 'b64') data = base64ToBytes(data);
    else if (layer === 'gz') data = await gunzip(data);
    else throw new Error(`packed asset: unknown layer "${layer}"`);
  }
  const buffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (entry.bytes && buffer.byteLength !== entry.bytes) {
    throw new Error(`packed asset: expected ${entry.bytes} bytes, got ${buffer.byteLength}`);
  }
  return buffer;
}
