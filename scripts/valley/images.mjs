/**
 * Texture encoding for the valley packs, and a tiny software rasterizer that
 * bakes far-distance tree impostors from the near geometry.
 */
import sharp from 'sharp';

/** Colour and (optional) alpha as one interleaved RGBA buffer at size x size. */
async function load(colorPath, size, alphaPath) {
  const rgb = await sharp(colorPath).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(size * size * 4);
  const alpha = alphaPath ? await sharp(alphaPath).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer() : null;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = alpha ? alpha[i * (alpha.length / (size * size))] : 255;
  }
  return out;
}

/** WebP from a colour image, optionally with a separate alpha image. */
export async function webp(colorPath, { size = 512, quality = 82, alphaPath = null, alphaQuality = 90 } = {}) {
  if (!alphaPath) {
    return sharp(colorPath).resize(size, size, { fit: 'fill' }).removeAlpha().webp({ quality }).toBuffer();
  }
  const data = await load(colorPath, size, alphaPath);
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).webp({ quality, alphaQuality }).toBuffer();
}

/** Raw RGBA pixels, for baking. */
export async function rgba(colorPath, { size = 512, alphaPath = null } = {}) {
  return { data: await load(colorPath, size, alphaPath), size };
}

function sample(tex, u, v) {
  const s = tex.size;
  let x = Math.floor((u - Math.floor(u)) * s), y = Math.floor((v - Math.floor(v)) * s);
  x = Math.min(Math.max(x, 0), s - 1); y = Math.min(Math.max(y, 0), s - 1);
  const o = (y * s + x) * 4;
  return [tex.data[o], tex.data[o + 1], tex.data[o + 2], tex.data[o + 3]];
}

/**
 * Orthographic side view of a set of textured triangles into an RGBA image:
 * x across, y up, depth along z. `parts` is [{ mesh, tex, tint, cutoff }].
 * Pixels are darkened with depth and toward the trunk so the flat card still
 * reads as a round crown.
 */
export function bakeSide(parts, { width = 256, height = 512, yaw = 0 } = {}) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rot = (p, i) => [p[i] * c - p[i + 2] * s, p[i + 1], p[i] * s + p[i + 2] * c];
  for (const { mesh } of parts) {
    for (let i = 0; i < mesh.pos.length; i += 3) {
      const [x, y, z] = rot(mesh.pos, i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  const halfW = Math.max(Math.abs(minX), Math.abs(maxX)) * 1.02;
  const top = maxY * 1.01;
  const bottom = Math.min(minY, 0);
  const color = new Float32Array(width * height * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  const toPx = (x, y) => [(x + halfW) / (2 * halfW) * width, (top - y) / (top - bottom) * height];

  for (const { mesh, tex, tint = [1, 1, 1], cutoff = 0.4 } of parts) {
    const { pos, uv, idx } = mesh;
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      const P = v.map((k) => rot(pos, k * 3));
      const S = P.map((p) => toPx(p[0], p[1]));
      const U = v.map((k) => [uv[k * 2], uv[k * 2 + 1]]);
      const x0 = Math.max(Math.floor(Math.min(S[0][0], S[1][0], S[2][0])), 0);
      const x1 = Math.min(Math.ceil(Math.max(S[0][0], S[1][0], S[2][0])), width - 1);
      const y0 = Math.max(Math.floor(Math.min(S[0][1], S[1][1], S[2][1])), 0);
      const y1 = Math.min(Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])), height - 1);
      const area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((S[1][0] - px) * (S[2][1] - py) - (S[2][0] - px) * (S[1][1] - py)) / area;
          const w1 = ((S[2][0] - px) * (S[0][1] - py) - (S[0][0] - px) * (S[2][1] - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
          const o = y * width + x;
          if (z >= depth[o]) continue;
          const u = w0 * U[0][0] + w1 * U[1][0] + w2 * U[2][0];
          const w = w0 * U[0][1] + w1 * U[1][1] + w2 * U[2][1];
          const texel = sample(tex, u, w);
          if (texel[3] < cutoff * 255) continue;
          depth[o] = z;
          const xn = (x / width) * 2 - 1;
          // Deeper in the crown and nearer the trunk is darker.
          const back = (z - minZ) / Math.max(maxZ - minZ, 1e-6);
          // Shade in linear light: the texels are sRGB-encoded.
          const shade = (0.72 + 0.28 * (1 - back)) * (0.88 + 0.12 * Math.min(Math.abs(xn) * 1.6, 1));
          const lin = (c) => Math.pow(c / 255, 2.2);
          const enc = (c) => Math.pow(Math.min(c, 1), 1 / 2.2) * 255;
          color[o * 4] = enc(lin(texel[0]) * tint[0] * shade);
          color[o * 4 + 1] = enc(lin(texel[1]) * tint[1] * shade);
          color[o * 4 + 2] = enc(lin(texel[2]) * tint[2] * shade);
          color[o * 4 + 3] = 255;
        }
      }
    }
  }
  // Bleed colour into transparent pixels so mip-mapped edges do not go dark.
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = color[i * 4]; out[i * 4 + 1] = color[i * 4 + 1]; out[i * 4 + 2] = color[i * 4 + 2]; out[i * 4 + 3] = color[i * 4 + 3];
  }
  for (let pass = 0; pass < 8; pass++) {
    const src = out.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (src[o + 3] > 0 || (src[o] | src[o + 1] | src[o + 2])) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const q = (yy * width + xx) * 4;
          if (src[q] | src[q + 1] | src[q + 2]) { r += src[q]; g += src[q + 1]; b += src[q + 2]; n++; }
        }
        if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; }
      }
    }
  }
  return { data: out, width, height, halfW, top, bottom };
}

export async function webpFromRaw({ data, width, height }, quality = 85) {
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).webp({ quality, alphaQuality: 95 }).toBuffer();
}
