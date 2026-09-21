/**
 * Axion math — allocation-free, offset-addressed.
 *
 * Unlike class-per-vector engines, every function here writes into a caller
 * supplied Float32Array at a caller supplied element offset. That means the
 * same code operates on a standalone vec3 and on column N of a packed
 * 100k-entity transform buffer, with zero garbage and zero pointer chasing.
 *
 * Convention: `out` is always first, offsets follow their array.
 * Matrices are column-major (WebGPU / WGSL native), 16 floats.
 */

export const EPSILON = 1e-6;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const f32 = (n) => new Float32Array(n);

/* ------------------------------------------------------------------ vec3 */

export function v3set(o, oi, x, y, z) { o[oi] = x; o[oi + 1] = y; o[oi + 2] = z; return o; }
export function v3copy(o, oi, a, ai) { o[oi] = a[ai]; o[oi + 1] = a[ai + 1]; o[oi + 2] = a[ai + 2]; return o; }

export function v3add(o, oi, a, ai, b, bi) {
  o[oi] = a[ai] + b[bi]; o[oi + 1] = a[ai + 1] + b[bi + 1]; o[oi + 2] = a[ai + 2] + b[bi + 2]; return o;
}
export function v3sub(o, oi, a, ai, b, bi) {
  o[oi] = a[ai] - b[bi]; o[oi + 1] = a[ai + 1] - b[bi + 1]; o[oi + 2] = a[ai + 2] - b[bi + 2]; return o;
}
export function v3scale(o, oi, a, ai, s) {
  o[oi] = a[ai] * s; o[oi + 1] = a[ai + 1] * s; o[oi + 2] = a[ai + 2] * s; return o;
}
export function v3addScaled(o, oi, a, ai, b, bi, s) {
  o[oi] = a[ai] + b[bi] * s; o[oi + 1] = a[ai + 1] + b[bi + 1] * s; o[oi + 2] = a[ai + 2] + b[bi + 2] * s; return o;
}
export function v3dot(a, ai, b, bi) {
  return a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2];
}
export function v3cross(o, oi, a, ai, b, bi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2];
  o[oi] = ay * bz - az * by;
  o[oi + 1] = az * bx - ax * bz;
  o[oi + 2] = ax * by - ay * bx;
  return o;
}
export function v3len(a, ai) { return Math.hypot(a[ai], a[ai + 1], a[ai + 2]); }
export function v3lenSq(a, ai) { return a[ai] * a[ai] + a[ai + 1] * a[ai + 1] + a[ai + 2] * a[ai + 2]; }
export function v3normalize(o, oi, a, ai) {
  const l = v3len(a, ai);
  const s = l > EPSILON ? 1 / l : 0;
  return v3scale(o, oi, a, ai, s);
}
export function v3lerp(o, oi, a, ai, b, bi, t) {
  o[oi] = a[ai] + (b[bi] - a[ai]) * t;
  o[oi + 1] = a[ai + 1] + (b[bi + 1] - a[ai + 1]) * t;
  o[oi + 2] = a[ai + 2] + (b[bi + 2] - a[ai + 2]) * t;
  return o;
}

/* ------------------------------------------------------------------ quat */
/* Stored xyzw. */

export function qidentity(o, oi) { o[oi] = 0; o[oi + 1] = 0; o[oi + 2] = 0; o[oi + 3] = 1; return o; }

export function qFromAxisAngle(o, oi, a, ai, angle) {
  const h = angle * 0.5, s = Math.sin(h);
  o[oi] = a[ai] * s; o[oi + 1] = a[ai + 1] * s; o[oi + 2] = a[ai + 2] * s; o[oi + 3] = Math.cos(h);
  return o;
}

/** Intrinsic Y-X-Z ("yaw, pitch, roll") — the ordering cameras actually want. */
export function qFromEulerYXZ(o, oi, yaw, pitch, roll) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cx = Math.cos(pitch * 0.5), sx = Math.sin(pitch * 0.5);
  const cz = Math.cos(roll * 0.5), sz = Math.sin(roll * 0.5);
  o[oi]     = sx * cy * cz + cx * sy * sz;
  o[oi + 1] = cx * sy * cz - sx * cy * sz;
  o[oi + 2] = cx * cy * sz - sx * sy * cz;
  o[oi + 3] = cx * cy * cz + sx * sy * sz;
  return o;
}

export function qmul(o, oi, a, ai, b, bi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi]     = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}

export function qnormalize(o, oi, a, ai) {
  const x = a[ai], y = a[ai + 1], z = a[ai + 2], w = a[ai + 3];
  const l = Math.hypot(x, y, z, w) || 1;
  const s = 1 / l;
  o[oi] = x * s; o[oi + 1] = y * s; o[oi + 2] = z * s; o[oi + 3] = w * s;
  return o;
}

export function qrotateV3(o, oi, q, qi, v, vi) {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const vx = v[vi], vy = v[vi + 1], vz = v[vi + 2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  o[oi]     = vx + qw * tx + (qy * tz - qz * ty);
  o[oi + 1] = vy + qw * ty + (qz * tx - qx * tz);
  o[oi + 2] = vz + qw * tz + (qx * ty - qy * tx);
  return o;
}

export function qslerp(o, oi, a, ai, b, bi, t) {
  let ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0, s1;
  if (1 - cos > EPSILON) {
    const omega = Math.acos(cos), sin = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sin;
    s1 = Math.sin(t * omega) / sin;
  } else { s0 = 1 - t; s1 = t; }
  o[oi] = s0 * ax + s1 * bx;
  o[oi + 1] = s0 * ay + s1 * by;
  o[oi + 2] = s0 * az + s1 * bz;
  o[oi + 3] = s0 * aw + s1 * bw;
  return o;
}

/* ------------------------------------------------------------------ mat4 */
/* Column-major: m[col*4 + row]. */

export function m4identity(o, oi) {
  o.fill(0, oi, oi + 16);
  o[oi] = 1; o[oi + 5] = 1; o[oi + 10] = 1; o[oi + 15] = 1;
  return o;
}

export function m4copy(o, oi, a, ai) {
  for (let i = 0; i < 16; i++) o[oi + i] = a[ai + i];
  return o;
}

/** Compose translation/rotation/uniform-or-nonuniform scale into a mat4. */
export function m4compose(o, oi, p, pi, q, qi, s, si) {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[si], sy = s[si + 1], sz = s[si + 2];

  o[oi]      = (1 - (yy + zz)) * sx;
  o[oi + 1]  = (xy + wz) * sx;
  o[oi + 2]  = (xz - wy) * sx;
  o[oi + 3]  = 0;

  o[oi + 4]  = (xy - wz) * sy;
  o[oi + 5]  = (1 - (xx + zz)) * sy;
  o[oi + 6]  = (yz + wx) * sy;
  o[oi + 7]  = 0;

  o[oi + 8]  = (xz + wy) * sz;
  o[oi + 9]  = (yz - wx) * sz;
  o[oi + 10] = (1 - (xx + yy)) * sz;
  o[oi + 11] = 0;

  o[oi + 12] = p[pi];
  o[oi + 13] = p[pi + 1];
  o[oi + 14] = p[pi + 2];
  o[oi + 15] = 1;
  return o;
}

export function m4mul(o, oi, a, ai, b, bi) {
  const a00 = a[ai], a01 = a[ai + 1], a02 = a[ai + 2], a03 = a[ai + 3];
  const a10 = a[ai + 4], a11 = a[ai + 5], a12 = a[ai + 6], a13 = a[ai + 7];
  const a20 = a[ai + 8], a21 = a[ai + 9], a22 = a[ai + 10], a23 = a[ai + 11];
  const a30 = a[ai + 12], a31 = a[ai + 13], a32 = a[ai + 14], a33 = a[ai + 15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[bi + c * 4], b1 = b[bi + c * 4 + 1], b2 = b[bi + c * 4 + 2], b3 = b[bi + c * 4 + 3];
    o[oi + c * 4]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    o[oi + c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    o[oi + c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    o[oi + c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return o;
}

export function m4invert(o, oi, a, ai) {
  const m = a, i = ai;
  const a00 = m[i], a01 = m[i+1], a02 = m[i+2], a03 = m[i+3];
  const a10 = m[i+4], a11 = m[i+5], a12 = m[i+6], a13 = m[i+7];
  const a20 = m[i+8], a21 = m[i+9], a22 = m[i+10], a23 = m[i+11];
  const a30 = m[i+12], a31 = m[i+13], a32 = m[i+14], a33 = m[i+15];

  const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10, b02 = a00*a13 - a03*a10;
  const b03 = a01*a12 - a02*a11, b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
  const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30, b08 = a20*a33 - a23*a30;
  const b09 = a21*a32 - a22*a31, b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;

  let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
  if (Math.abs(det) < 1e-12) return m4identity(o, oi);
  det = 1 / det;

  o[oi]    = (a11*b11 - a12*b10 + a13*b09) * det;
  o[oi+1]  = (a02*b10 - a01*b11 - a03*b09) * det;
  o[oi+2]  = (a31*b05 - a32*b04 + a33*b03) * det;
  o[oi+3]  = (a22*b04 - a21*b05 - a23*b03) * det;
  o[oi+4]  = (a12*b08 - a10*b11 - a13*b07) * det;
  o[oi+5]  = (a00*b11 - a02*b08 + a03*b07) * det;
  o[oi+6]  = (a32*b02 - a30*b05 - a33*b01) * det;
  o[oi+7]  = (a20*b05 - a22*b02 + a23*b01) * det;
  o[oi+8]  = (a10*b10 - a11*b08 + a13*b06) * det;
  o[oi+9]  = (a01*b08 - a00*b10 - a03*b06) * det;
  o[oi+10] = (a30*b04 - a31*b02 + a33*b00) * det;
  o[oi+11] = (a21*b02 - a20*b04 - a23*b00) * det;
  o[oi+12] = (a11*b07 - a10*b09 - a12*b06) * det;
  o[oi+13] = (a00*b09 - a01*b07 + a02*b06) * det;
  o[oi+14] = (a31*b01 - a30*b03 - a32*b00) * det;
  o[oi+15] = (a20*b03 - a21*b01 + a22*b00) * det;
  return o;
}

/**
 * Reverse-Z infinite perspective, WebGPU clip space (z in [0,1]).
 * Reverse-Z is the default here, not an option: it costs nothing and buys
 * roughly a thousandfold improvement in depth precision at distance.
 */
export function m4perspectiveReverseZ(o, oi, fovY, aspect, near) {
  const f = 1 / Math.tan(fovY * 0.5);
  o.fill(0, oi, oi + 16);
  o[oi] = f / aspect;
  o[oi + 5] = f;
  o[oi + 10] = 0;
  o[oi + 11] = -1;
  o[oi + 14] = near;
  return o;
}

export function m4ortho(o, oi, l, r, b, t, near, far) {
  o.fill(0, oi, oi + 16);
  o[oi] = 2 / (r - l);
  o[oi + 5] = 2 / (t - b);
  o[oi + 10] = 1 / (near - far);
  o[oi + 12] = (r + l) / (l - r);
  o[oi + 13] = (t + b) / (b - t);
  o[oi + 14] = near / (near - far);
  o[oi + 15] = 1;
  return o;
}

export function m4lookAt(o, oi, eye, ei, target, ti, up, ui) {
  const zx = eye[ei] - target[ti], zy = eye[ei + 1] - target[ti + 1], zz = eye[ei + 2] - target[ti + 2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl, z1 = zy / zl, z2 = zz / zl;

  let x0 = up[ui + 1] * z2 - up[ui + 2] * z1;
  let x1 = up[ui + 2] * z0 - up[ui] * z2;
  let x2 = up[ui] * z1 - up[ui + 1] * z0;
  const xl = Math.hypot(x0, x1, x2) || 1;
  x0 /= xl; x1 /= xl; x2 /= xl;

  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;

  o[oi] = x0; o[oi+1] = y0; o[oi+2] = z0; o[oi+3] = 0;
  o[oi+4] = x1; o[oi+5] = y1; o[oi+6] = z1; o[oi+7] = 0;
  o[oi+8] = x2; o[oi+9] = y2; o[oi+10] = z2; o[oi+11] = 0;
  o[oi+12] = -(x0 * eye[ei] + x1 * eye[ei+1] + x2 * eye[ei+2]);
  o[oi+13] = -(y0 * eye[ei] + y1 * eye[ei+1] + y2 * eye[ei+2]);
  o[oi+14] = -(z0 * eye[ei] + z1 * eye[ei+1] + z2 * eye[ei+2]);
  o[oi+15] = 1;
  return o;
}

export function m4transformPoint(o, oi, m, mi, v, vi) {
  const x = v[vi], y = v[vi + 1], z = v[vi + 2];
  const w = m[mi+3] * x + m[mi+7] * y + m[mi+11] * z + m[mi+15] || 1;
  o[oi]     = (m[mi]   * x + m[mi+4] * y + m[mi+8]  * z + m[mi+12]) / w;
  o[oi + 1] = (m[mi+1] * x + m[mi+5] * y + m[mi+9]  * z + m[mi+13]) / w;
  o[oi + 2] = (m[mi+2] * x + m[mi+6] * y + m[mi+10] * z + m[mi+14]) / w;
  return o;
}

/* ------------------------------------------------- frustum (6 planes x4) */

/**
 * Extract world-space frustum planes (Gribb/Hartmann) from a view-projection
 * matrix. Planes are packed nx,ny,nz,d — normalized, pointing inward.
 */
export function frustumFromMatrix(out, oi, m, mi) {
  const rows = [
    [m[mi+3], m[mi+7], m[mi+11], m[mi+15]],
    [m[mi],   m[mi+4], m[mi+8],  m[mi+12]],
    [m[mi+1], m[mi+5], m[mi+9],  m[mi+13]],
    [m[mi+2], m[mi+6], m[mi+10], m[mi+14]],
  ];
  const put = (i, a, b, s) => {
    let x = rows[a][0] + s * rows[b][0];
    let y = rows[a][1] + s * rows[b][1];
    let z = rows[a][2] + s * rows[b][2];
    let w = rows[a][3] + s * rows[b][3];
    const l = Math.hypot(x, y, z) || 1;
    out[oi + i*4] = x/l; out[oi + i*4+1] = y/l; out[oi + i*4+2] = z/l; out[oi + i*4+3] = w/l;
  };
  put(0, 0, 1, 1);   // left
  put(1, 0, 1, -1);  // right
  put(2, 0, 2, 1);   // bottom
  put(3, 0, 2, -1);  // top
  put(4, 0, 3, 1);   // near
  put(5, 0, 3, -1);  // far
  return out;
}

export function sphereInFrustum(planes, pi, cx, cy, cz, r) {
  for (let i = 0; i < 6; i++) {
    const o = pi + i * 4;
    if (planes[o] * cx + planes[o+1] * cy + planes[o+2] * cz + planes[o+3] < -r) return false;
  }
  return true;
}

/* -------------------------------------------------------------- scratch  */

/** Shared scratch registers. Use within a single synchronous block only. */
export const scratch = {
  v3: [f32(3), f32(3), f32(3), f32(3)],
  q: [f32(4), f32(4)],
  m4: [f32(16), f32(16), f32(16)],
};
