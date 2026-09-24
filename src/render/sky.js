/**
 * The atmosphere, on the CPU.
 *
 * The sky texture is marched on the GPU (SKY_WGSL). This is the same model in
 * JavaScript, used for the two numbers the rest of the frame needs from it:
 * the colour of sunlight after it crossed the air, and the ambient light the
 * whole sky dome sends down. Both follow the sun: white at noon, gold and then
 * red near sunset, with a sky that goes from blue to deep dusk.
 */

const RG = 6360000;
const RT = 6420000;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BM = 3.996e-6;
const HR = 8000;
const HM = 1200;

function toSphere(oy, dy, r) {
  const b = oy * dy;
  const c = (oy - r) * (oy + r);
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}

function hitsGround(oy, dy) {
  if (dy >= 0) return -1;
  const b = oy * dy;
  const c = (oy - RG) * (oy + RG);
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

/** Optical depth [rayleigh, mie] from p toward the sun. */
function towardSun(px, py, pz, L, out) {
  const r = Math.hypot(px, py, pz);
  const mu = (px * L[0] + py * L[1] + pz * L[2]) / r;
  if (hitsGround(r, mu) > 0) { out[0] = 1e9; out[1] = 1e9; return out; }
  const len = toSphere(r, mu, RT);
  const steps = 6;
  const ds = len / steps;
  let a = 0, b = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const h = Math.hypot(px + L[0] * t, py + L[1] * t, pz + L[2] * t) - RG;
    a += Math.exp(-h / HR) * ds;
    b += Math.exp(-h / HM) * ds;
  }
  out[0] = a; out[1] = b;
  return out;
}

const tmp = [0, 0];

/** Sky radiance in direction d for a sun of irradiance 1. Matches SKY_WGSL. */
export function skyRadiance(d, L, haze = 1, altitude = 0) {
  const oy = RG + Math.min(Math.max(altitude, 0), 4000) + 50;
  let len = toSphere(oy, d[1], RT);
  const ground = hitsGround(oy, d[1]);
  if (ground > 0) len = ground;

  const steps = 16;
  const ds = len / steps;
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const px = d[0] * t, py = oy + d[1] * t, pz = d[2] * t;
    const h = Math.hypot(px, py, pz) - RG;
    const dR = Math.exp(-h / HR) * ds;
    const dM = Math.exp(-h / HM) * ds;
    odR += dR; odM += dM;
    towardSun(px, py, pz, L, tmp);
    for (let c = 0; c < 3; c++) {
      const tau = BR[c] * (odR + tmp[0]) + BM * haze * 1.11 * (odM + tmp[1]);
      const att = Math.exp(-tau);
      sumR[c] += att * dR;
      sumM[c] += att * dM;
    }
  }
  const mu = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
  const phaseR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g = 0.76;
  const phaseM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) /
    ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));
  return [0, 1, 2].map((c) => sumR[c] * BR[c] * phaseR + sumM[c] * BM * haze * phaseM);
}

/** Fraction of sunlight (per channel) that reaches the ground. */
export function sunTransmittance(L, haze = 1, altitude = 0) {
  const oy = RG + Math.max(altitude, 0) + 50;
  towardSun(0, oy, 0, L, tmp);
  if (tmp[0] >= 1e9) return [0, 0, 0];
  return BR.map((b) => Math.exp(-(b * tmp[0] + BM * haze * 1.11 * tmp[1])));
}

/**
 * The light the sky dome sends to an upward-facing surface, as the radiance
 * of a uniform sky that would give the same irradiance (so it can be used
 * directly as the ambient colour), for a sun of irradiance 1.
 */
export function skyAmbient(L, haze = 1, altitude = 0) {
  const sum = [0, 0, 0];
  let wsum = 0;
  // A small fixed set of directions over the upper hemisphere, cosine weighted.
  for (let i = 0; i < 6; i++) {
    const el = (i + 0.5) / 6 * Math.PI * 0.5;
    for (let j = 0; j < 8; j++) {
      const az = (j + 0.5) / 8 * Math.PI * 2;
      const d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      const w = Math.sin(el) * Math.cos(el);    // cos(theta) * solid angle of the band
      const r = skyRadiance(d, L, haze, altitude);
      sum[0] += r[0] * w; sum[1] += r[1] * w; sum[2] += r[2] * w;
      wsum += w;
    }
  }
  return sum.map((v) => v / wsum);
}

/** Direction toward the sun from elevation and azimuth in degrees (azimuth 0 = +x, 90 = +z). */
export function sunDirection(elevationDeg, azimuthDeg) {
  const el = elevationDeg * Math.PI / 180;
  const az = azimuthDeg * Math.PI / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}
