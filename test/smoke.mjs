// Headless checks for the parts that don't need a GPU.
import assert from 'node:assert/strict';
import { World, defineComponent } from '../src/core/ecs.js';
import { Transform, LocalToWorld, Dynamic, Motion, MeshRef, Bounds } from '../src/core/components.js';
import { motionSystem, transformSystem } from '../src/systems/transform.js';
import * as m from '../src/core/math.js';
import { box, roundedBox, sphere, icosphere, torus, plane } from '../src/geometry/primitives.js';
import { parseGLTF, parseGLB } from '../src/loaders/gltf.js';
import { unpackAsset, base64ToBytes } from '../src/loaders/packed.js';
import { gzipSync } from 'node:zlib';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ok', name); };

console.log('math');
ok('m4 identity * v = v', () => {
  const M = m.f32(16); m.m4identity(M, 0);
  const v = m.f32([1, 2, 3]); const o = m.f32(3);
  m.m4transformPoint(o, 0, M, 0, v, 0);
  assert.deepEqual([...o], [1, 2, 3]);
});

ok('m4invert(compose) round-trips a point', () => {
  const p = m.f32([3, -2, 7]), q = m.f32(4), s = m.f32([2, 2, 2]);
  m.qFromEulerYXZ(q, 0, 0.4, -0.9, 0.2);
  const M = m.f32(16), Mi = m.f32(16);
  m.m4compose(M, 0, p, 0, q, 0, s, 0);
  m.m4invert(Mi, 0, M, 0);
  const pt = m.f32([1, 5, -3]), a = m.f32(3), b = m.f32(3);
  m.m4transformPoint(a, 0, M, 0, pt, 0);
  m.m4transformPoint(b, 0, Mi, 0, a, 0);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(b[i] - pt[i]) < 1e-3, `${b[i]} vs ${pt[i]}`);
});

ok('quat rotation matches matrix rotation', () => {
  const q = m.f32(4); m.qFromAxisAngle(q, 0, m.f32([0, 1, 0]), 0, Math.PI / 2);
  const v = m.f32([1, 0, 0]), o = m.f32(3);
  m.qrotateV3(o, 0, q, 0, v, 0);
  assert.ok(Math.abs(o[0]) < 1e-5 && Math.abs(o[2] + 1) < 1e-5, [...o].join(','));
});

ok('reverse-Z projection maps near->1, far->0', () => {
  const P = m.f32(16); m.m4perspectiveReverseZ(P, 0, 1.0, 1.5, 0.1);
  const clip = (z) => {
    const zc = P[10] * z + P[14];
    const wc = P[11] * z;
    return zc / wc;
  };
  assert.ok(Math.abs(clip(-0.1) - 1) < 1e-5, `near=${clip(-0.1)}`);
  assert.ok(clip(-10000) < 1e-3, `far=${clip(-10000)}`);
});

ok('frustum culls what is behind the camera', () => {
  const cam = m.f32(16), P = m.f32(16), V = m.f32(16);
  m.m4perspectiveReverseZ(P, 0, 1.0, 1, 0.1);
  m.m4lookAt(V, 0, m.f32([0, 0, 10]), 0, m.f32([0, 0, 0]), 0, m.f32([0, 1, 0]), 0);
  m.m4mul(cam, 0, P, 0, V, 0);
  const planes = m.f32(24); m.frustumFromMatrix(planes, 0, cam, 0);
  assert.equal(m.sphereInFrustum(planes, 0, 0, 0, 0, 1), true);
  assert.equal(m.sphereInFrustum(planes, 0, 0, 0, 100, 1), false);
  assert.equal(m.sphereInFrustum(planes, 0, 500, 0, 0, 1), false);
});

console.log('ecs');
ok('spawn / query / destroy with swap-remove', () => {
  const w = new World({ initialCapacity: 4 });
  const ids = [];
  for (let i = 0; i < 10; i++) {
    ids.push(w.spawn([Transform, LocalToWorld], (c, r) => { c.get(Transform.id)[r * 10] = i; }));
  }
  assert.equal(w.entityCount, 10);
  w.destroy(ids[0]);
  w.destroy(ids[5]);
  assert.equal(w.entityCount, 8);
  // every surviving entity must still resolve to its own row
  for (let i = 0; i < 10; i++) {
    if (i === 0 || i === 5) { assert.equal(w.isAlive(ids[i]), false); continue; }
    const v = w.get(ids[i], Transform);
    assert.equal(v.array[v.offset], i, `entity ${i} moved to a wrong row`);
  }
});

ok('generation invalidates recycled ids', () => {
  const w = new World({ initialCapacity: 4 });
  const a = w.spawn([Transform]);
  w.destroy(a);
  const b = w.spawn([Transform]);
  assert.equal(w.isAlive(a), false);
  assert.equal(w.isAlive(b), true);
  assert.notEqual(a, b);
});

ok('tag component changes archetype but costs no column', () => {
  const w = new World({ initialCapacity: 4 });
  w.spawn([Transform, LocalToWorld]);
  w.spawn([Transform, LocalToWorld, Dynamic]);
  assert.equal(w.query([Transform]).length, 2);
  assert.equal(w.query([Transform, Dynamic]).length, 1);
  assert.equal(w.query([Transform], [Dynamic]).length, 1);
  const dyn = w.query([Dynamic])[0];
  assert.equal(dyn.columns.has(Dynamic.id), false);
});

ok('systems integrate motion and compose matrices', () => {
  const w = new World({ initialCapacity: 8 });
  const e = w.spawn([Transform, LocalToWorld, Motion, Dynamic], (c, r) => {
    const T = c.get(Transform.id);
    T[r * 10 + 7] = 1; T[r * 10 + 8] = 1; T[r * 10 + 9] = 1; T[r * 10 + 6] = 1;
    c.get(Motion.id)[r * 6] = 2;  // +2 m/s on x
  });
  w.addSystem(motionSystem, { order: 10 });
  w.addSystem(transformSystem, { order: 20 });
  w.step(0.5);
  const t = w.get(e, Transform);
  assert.ok(Math.abs(t.array[t.offset] - 1) < 1e-6);
  const l = w.get(e, LocalToWorld);
  assert.ok(Math.abs(l.array[l.offset + 12] - 1) < 1e-6, 'matrix translation not written');
});

ok('bulk spawn lays out contiguous rows', () => {
  const w = new World({ initialCapacity: 2 });
  const { archetype, first, count } = w.spawnMany([Transform, MeshRef, Bounds], 5000, (c, f, n) => {
    const T = c.get(Transform.id);
    for (let i = 0; i < n; i++) T[(f + i) * 10] = i;
  });
  assert.equal(first, 0);
  assert.equal(count, 5000);
  assert.equal(archetype.count, 5000);
  assert.equal(archetype.columns.get(Transform.id)[4999 * 10], 4999);
});

ok('custom components register independently', () => {
  const Health = defineComponent('Health', 'u16', 2);
  const w = new World({ initialCapacity: 2 });
  w.spawn([Health], (c, r) => { c.get(Health.id)[r * 2] = 70; });
  const a = w.query([Health])[0];
  assert.equal(a.columns.get(Health.id)[0], 70);
  assert.equal(a.columns.get(Health.id).constructor, Uint16Array);
});

console.log('geometry');
for (const [name, geo] of Object.entries({
  box: box(), roundedBox: roundedBox(1, 1, 1, 0.12, 5), sphere: sphere(), icosphere: icosphere(0.5, 2), torus: torus(), plane: plane(4, 4, 8, 8),
})) {
  ok(`${name}: interleaved, indexed, bounded`, () => {
    assert.equal(geo.vertices.length % 8, 0);
    assert.equal(geo.vertices.length / 8, geo.vertexCount);
    assert.equal(geo.indices.length % 3, 0);
    assert.ok(geo.indices.every((i) => i < geo.vertexCount), 'index out of range');
    assert.ok(geo.bounds[3] > 0, 'zero bounding radius');
    // every normal must be unit length
    for (let i = 0; i < geo.vertexCount; i++) {
      const o = i * 8;
      const l = Math.hypot(geo.vertices[o + 3], geo.vertices[o + 4], geo.vertices[o + 5]);
      assert.ok(Math.abs(l - 1) < 1e-3, `${name} normal ${i} length ${l}`);
    }
  });

  ok(`${name}: consistent front-face winding`, () => {
    // With cullMode 'back' and frontFace 'ccw', the geometric normal of every
    // triangle must agree with its vertex normals — otherwise the mesh renders
    // inside-out and the outward faces are culled.
    const V = geo.vertices;
    let wrong = 0;
    for (let i = 0; i < geo.indices.length; i += 3) {
      const a = geo.indices[i] * 8, b = geo.indices[i + 1] * 8, c = geo.indices[i + 2] * 8;
      const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]];
      const e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
      const gn = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const vn = [
        V[a + 3] + V[b + 3] + V[c + 3],
        V[a + 4] + V[b + 4] + V[c + 4],
        V[a + 5] + V[b + 5] + V[c + 5],
      ];
      // Pole fans contain degenerate triangles (two coincident corners); they
      // have no orientation to check and rasterize to nothing.
      if (Math.hypot(gn[0], gn[1], gn[2]) < 1e-9) continue;
      if (gn[0] * vn[0] + gn[1] * vn[1] + gn[2] * vn[2] <= 0) wrong++;
    }
    assert.equal(wrong, 0, `${name}: ${wrong} inverted triangles`);
  });
}

console.log('gltf');

// A one-triangle glTF built in memory: positions, normals, uvs, uint16 indices.
function triangleGLTF(nodes) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0]);           // padded to 4-byte alignment
  const bin = new Uint8Array(pos.byteLength + nor.byteLength + uv.byteLength + idx.byteLength);
  let o = 0;
  for (const a of [pos, nor, uv, idx]) { bin.set(new Uint8Array(a.buffer), o); o += a.byteLength; }
  const json = {
    asset: { version: '2.0' },
    scene: 0, scenes: [{ nodes: nodes.roots }], nodes: nodes.list,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 1], metallicFactor: 0 },
                  alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  return { json, bin };
}
const vtx = (g, i) => Array.from(g.vertices.slice(i * 8, i * 8 + 8), (v) => +v.toFixed(5) || 0);

ok('parses a triangle and reads every attribute', () => {
  const { json, bin } = triangleGLTF({ roots: [0], list: [{ mesh: 0 }] });
  const r = parseGLTF(json, [bin]);
  assert.equal(r.primitives.length, 1);
  assert.equal(r.triangles, 1);
  assert.deepEqual(Array.from(r.primitives[0].geometry.indices), [0, 1, 2]);
  assert.deepEqual(vtx(r.primitives[0].geometry, 1), [1, 0, 0, 0, 0, 1, 1, 0]);
  const m = r.materials[0];
  assert.deepEqual(m.color, [1, 0.5, 0.25]);
  assert.equal(m.alphaMode, 'MASK'); assert.equal(m.alphaCutoff, 0.3); assert.equal(m.doubleSided, true);
  assert.equal(m.roughness, 1, 'glTF default roughness is 1');
});

ok('bakes the node hierarchy into world space', () => {
  // parent translates by (10,0,0); child scales x2 and rotates 90 deg about y.
  const s = Math.SQRT1_2;
  const { json, bin } = triangleGLTF({ roots: [0], list: [
    { translation: [10, 0, 0], children: [1] },
    { mesh: 0, scale: [2, 2, 2], rotation: [0, s, 0, s] },
  ] });
  const g = parseGLTF(json, [bin]).primitives[0].geometry;
  // vertex (1,0,0) -> scale -> (2,0,0) -> rotY 90 -> (0,0,-2) -> +10x -> (10,0,-2)
  const v = vtx(g, 1);
  assert.deepEqual(v.slice(0, 3), [10, 0, -2]);
  // normal (0,0,1) -> rotY 90 -> (1,0,0), still unit length despite the scale
  assert.deepEqual(v.slice(3, 6), [1, 0, 0]);
});

ok('non-uniform scale transforms normals by the inverse transpose', () => {
  // A 45-degree normal under scale (1, 2, 1) must tilt toward x, not y.
  const { json, bin } = triangleGLTF({ roots: [0], list: [{ mesh: 0, scale: [1, 2, 1] }] });
  const nor = new Float32Array(bin.buffer, 36, 9);
  nor.set([Math.SQRT1_2, Math.SQRT1_2, 0, Math.SQRT1_2, Math.SQRT1_2, 0, Math.SQRT1_2, Math.SQRT1_2, 0]);
  const n = vtx(parseGLTF(json, [bin]).primitives[0].geometry, 0).slice(3, 6);
  assert.ok(n[0] > n[1], `expected x > y, got ${n}`);
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-4);
});

ok('a mirrored node flips winding so front faces stay front', () => {
  const { json, bin } = triangleGLTF({ roots: [0], list: [{ mesh: 0, scale: [-1, 1, 1] }] });
  const g = parseGLTF(json, [bin]).primitives[0].geometry;
  assert.deepEqual(Array.from(g.indices), [0, 2, 1]);
  const V = g.vertices, [a, b, c] = g.indices;
  const e1 = [V[b*8] - V[a*8], V[b*8+1] - V[a*8+1], V[b*8+2] - V[a*8+2]];
  const e2 = [V[c*8] - V[a*8], V[c*8+1] - V[a*8+1], V[c*8+2] - V[a*8+2]];
  const gz = e1[0] * e2[1] - e1[1] * e2[0];
  assert.ok(gz * V[a*8+5] > 0, 'geometric normal must agree with the baked vertex normal');
});

ok('reads a .glb container', () => {
  const { json, bin } = triangleGLTF({ roots: [0], list: [{ mesh: 0 }] });
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4, bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jpad + 8 + bin.length + bpad;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jpad);
  const bo = 20 + jsonBytes.length + jpad;
  dv.setUint32(bo, bin.length + bpad, true); dv.setUint32(bo + 4, 0x004e4942, true);
  out.set(bin, bo + 8);
  const glb = parseGLB(out.buffer);
  const r = parseGLTF(glb.json, [glb.bin]);
  assert.equal(r.triangles, 1);
  assert.deepEqual(vtx(r.primitives[0].geometry, 2).slice(0, 3), [0, 1, 0]);
});

ok('gltf: quantized positions/UVs + KHR_texture_transform decode', () => {
  const pos = new Uint16Array([0, 0, 0, 0, 65535, 0, 0, 0, 0, 0, 65535, 0]);
  const uv = new Uint16Array([0, 0, 65535, 0, 0, 65535]);
  const bin = new Uint8Array(pos.byteLength + uv.byteLength);
  bin.set(new Uint8Array(pos.buffer)); bin.set(new Uint8Array(uv.buffer), pos.byteLength);
  const json = {
    nodes: [{ mesh: 0, translation: [1, 0, 0], scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0,
      extensions: { KHR_texture_transform: { offset: [-1, 3], scale: [4, 2] } } } } }],
    accessors: [{ bufferView: 0, componentType: 5123, type: 'VEC3', count: 3 },
                { bufferView: 1, componentType: 5123, type: 'VEC2', count: 3, normalized: true }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, byteStride: 8 },
                  { buffer: 0, byteOffset: pos.byteLength, byteLength: uv.byteLength }],
  };
  const g = parseGLTF(json, [bin]).primitives[0].geometry;
  assert.deepEqual(vtx(g, 0).slice(0, 3), [1, 0, 0]);
  assert.deepEqual(vtx(g, 1).slice(0, 3), [131071, 0, 0]);
  assert.deepEqual(vtx(g, 1).slice(6, 8), [3, 3]);
  assert.deepEqual(vtx(g, 2).slice(6, 8), [-1, 5]);
});

ok('base64ToBytes decodes padding variants', () => {
  for (const n of [0, 1, 2, 3, 255, 1000]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual(base64ToBytes(Buffer.from(b).toString('base64')), b);
  }
});

const packedBytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
const packedEntry = { format: 'glb.gz.b64', bytes: packedBytes.length,
  data: gzipSync(packedBytes).toString('base64') };
const unpacked = new Uint8Array(await unpackAsset(packedEntry));
ok('unpackAsset round-trips gzip+base64', () => assert.deepEqual(unpacked, packedBytes));

console.log(`\n${pass} checks passed`);
