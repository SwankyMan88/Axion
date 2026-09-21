/**
 * Geometry builders.
 *
 * Every primitive returns the same shape: one interleaved vertex buffer
 * (position3, normal3, uv2 = 32 bytes) plus a Uint32 index buffer and a
 * bounding sphere. Single interleaved stream means one vertex buffer binding
 * and one cache line per vertex, rather than three separate attribute streams.
 */

export const VERTEX_STRIDE_FLOATS = 8;
export const VERTEX_STRIDE_BYTES = 32;

function mesh(positions, normals, uvs, indices) {
  const n = positions.length / 3;
  const v = new Float32Array(n * VERTEX_STRIDE_FLOATS);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    v[o] = positions[i * 3]; v[o + 1] = positions[i * 3 + 1]; v[o + 2] = positions[i * 3 + 2];
    v[o + 3] = normals[i * 3]; v[o + 4] = normals[i * 3 + 1]; v[o + 5] = normals[i * 3 + 2];
    v[o + 6] = uvs[i * 2]; v[o + 7] = uvs[i * 2 + 1];
    cx += v[o]; cy += v[o + 1]; cz += v[o + 2];
  }
  cx /= n; cy /= n; cz /= n;
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const dx = v[o] - cx, dy = v[o + 1] - cy, dz = v[o + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return {
    vertices: v,
    indices: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
    vertexCount: n,
    bounds: new Float32Array([cx, cy, cz, Math.sqrt(r2)]),
  };
}

export function box(w = 1, h = 1, d = 1) {
  const half = [w / 2, h / 2, d / 2];
  const p = [], nm = [], uv = [], idx = [];

  // Build each face from a tangent basis (u, v, n) rather than a hand-written
  // corner list, so winding is consistent by construction on all six faces.
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];

  faces.forEach((f, fi) => {
    for (const [su, sv, tu, tv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      p.push(
        (f.n[0] + f.u[0] * su + f.v[0] * sv) * half[0],
        (f.n[1] + f.u[1] * su + f.v[1] * sv) * half[1],
        (f.n[2] + f.u[2] * su + f.v[2] * sv) * half[2],
      );
      nm.push(f.n[0], f.n[1], f.n[2]);
      uv.push(tu, tv);
    }
    const b = fi * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return mesh(p, nm, uv, idx);
}

/**
 * Box with rounded edges and corners.
 *
 * Each face is a grid; every grid point is clamped into the inner box and then
 * pushed back out by the corner radius. Adjacent faces derive the shared edge
 * from the same formula, so positions and normals agree exactly across the
 * seam without any welding pass.
 *
 * Beveled edges are the single cheapest thing you can do for realism: a
 * perfectly sharp edge catches no light, and real objects do not have them.
 */
export function roundedBox(w = 1, h = 1, d = 1, radius = 0.08, segments = 6) {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.min(radius, Math.min(half[0], Math.min(half[1], half[2])) * 0.999);
  const inner = [
    Math.max(half[0] - r, 0), Math.max(half[1] - r, 0), Math.max(half[2] - r, 0),
  ];

  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];

  const p = [], nm = [], uv = [], idx = [];
  const row = segments + 1;
  const clampAbs = (x, lim) => Math.max(-lim, Math.min(lim, x));

  faces.forEach((f, fi) => {
    const base = fi * row * row;
    for (let j = 0; j <= segments; j++) {
      const sv = (j / segments) * 2 - 1;
      for (let i = 0; i <= segments; i++) {
        const su = (i / segments) * 2 - 1;
        const s = [
          (f.n[0] + f.u[0] * su + f.v[0] * sv) * half[0],
          (f.n[1] + f.u[1] * su + f.v[1] * sv) * half[1],
          (f.n[2] + f.u[2] * su + f.v[2] * sv) * half[2],
        ];
        const c = [clampAbs(s[0], inner[0]), clampAbs(s[1], inner[1]), clampAbs(s[2], inner[2])];
        let nx = s[0] - c[0], ny = s[1] - c[1], nz = s[2] - c[2];
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) { nx = f.n[0]; ny = f.n[1]; nz = f.n[2]; }
        else { nx /= len; ny /= len; nz /= len; }

        p.push(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r);
        nm.push(nx, ny, nz);
        uv.push(i / segments, j / segments);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * row + i, b = a + row;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  });
  return mesh(p, nm, uv, idx);
}

export function sphere(radius = 0.5, segments = 24, rings = 16) {
  const p = [], nm = [], uv = [], idx = [];
  for (let y = 0; y <= rings; y++) {
    const vt = y / rings, phi = vt * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments, theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      p.push(nx * radius, ny * radius, nz * radius);
      nm.push(nx, ny, nz);
      uv.push(u, 1 - vt);
    }
  }
  const row = segments + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * row + x, b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh(p, nm, uv, idx);
}

export function plane(w = 1, d = 1, sx = 1, sz = 1) {
  const p = [], nm = [], uv = [], idx = [];
  for (let z = 0; z <= sz; z++) {
    for (let x = 0; x <= sx; x++) {
      p.push((x / sx - 0.5) * w, 0, (z / sz - 0.5) * d);
      nm.push(0, 1, 0);
      uv.push(x / sx, z / sz);
    }
  }
  const row = sx + 1;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const a = z * row + x, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(p, nm, uv, idx);
}

export function torus(radius = 0.5, tube = 0.2, radial = 24, tubular = 16) {
  const p = [], nm = [], uv = [], idx = [];
  for (let j = 0; j <= radial; j++) {
    const u = (j / radial) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let i = 0; i <= tubular; i++) {
      const v = (i / tubular) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const x = (radius + tube * cv) * cu;
      const y = tube * sv;
      const z = (radius + tube * cv) * su;
      p.push(x, y, z);
      nm.push(cv * cu, sv, cv * su);
      uv.push(j / radial, i / tubular);
    }
  }
  const row = tubular + 1;
  for (let j = 0; j < radial; j++) {
    for (let i = 0; i < tubular; i++) {
      const a = j * row + i, b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh(p, nm, uv, idx);
}

/** Icosahedron subdivided n times — even triangle distribution, no poles. */
export function icosphere(radius = 0.5, subdivisions = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = cache.get(key);
      if (m !== undefined) return m;
      const va = verts[a], vb = verts[b];
      const v = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
      const l = Math.hypot(...v);
      verts.push([v[0] / l, v[1] / l, v[2] / l]);
      m = verts.length - 1;
      cache.set(key, m);
      return m;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const p = [], nm = [], uv = [], idx = [];
  for (const v of verts) {
    p.push(v[0] * radius, v[1] * radius, v[2] * radius);
    nm.push(v[0], v[1], v[2]);
    uv.push(Math.atan2(v[2], v[0]) / (Math.PI * 2) + 0.5, Math.asin(v[1]) / Math.PI + 0.5);
  }
  for (const f of faces) idx.push(f[0], f[1], f[2]);
  return mesh(p, nm, uv, idx);
}
