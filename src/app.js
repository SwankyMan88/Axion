import { createDevice, resizeCanvas } from './gpu/device.js';
import { Renderer } from './render/renderer.js';
import { Camera, OrbitControls, FlyControls } from './render/camera.js';
import { World } from './core/ecs.js';
import {
  Bounds, Dynamic, Hidden, InstanceColor, LocalToWorld, MeshRef, Motion,
  PointLight, Transform, M_MESH, M_MATERIAL, T_POS, T_ROT, T_SCALE,
} from './core/components.js';
import { motionSystem, transformSystem, composeRange } from './systems/transform.js';
import { m4compose, qFromEulerYXZ, qidentity } from './core/math.js';
import * as primitives from './geometry/primitives.js';

/**
 * The ergonomic layer.
 *
 * Everything underneath is data-oriented and explicit. This class exists so
 * that "put a red sphere at the origin and spin it" is one line, without the
 * one-line path secretly becoming the only path: `app.world` is the same ECS
 * a high-performance system would drive directly.
 */
export class App {
  static async create(canvas, options = {}) {
    // Tear down earlier apps first, so their GPU memory is free before the
    // new device asks for its own.
    App.disposeStale(canvas);
    const gpu = await createDevice(canvas, options);
    return new App(canvas, gpu, options);
  }

  /**
   * Dispose every live app whose canvas is gone from the page or is the one
   * about to be reused. Live editors (Khan Academy, CodePen) re-run the page
   * on every edit or reload without always giving the GPU a clean slate; the
   * previous app's loop, device and render targets would otherwise pile up
   * and each run would be slower than the last.
   */
  static disposeStale(canvas) {
    for (const app of [...liveApps()]) {
      if (app.canvas === canvas || !app.canvas.isConnected) app.dispose();
    }
  }

  constructor(canvas, gpu, options = {}) {
    this.canvas = canvas;
    this.device = gpu.device;
    this.info = gpu.info;
    this.renderer = new Renderer({ ...gpu, canvas }, options);
    this.world = new World({ initialCapacity: options.initialCapacity ?? 4096 });
    this.camera = new Camera({ fov: options.fov ?? 60, near: options.near ?? 0.1 });
    this.controls = options.controls === false
      ? null : new OrbitControls(this.camera, canvas, options.controls ?? {});
    this.fly = options.controls === false
      ? null : new FlyControls(this.camera, canvas, options.fly ?? {});
    this.cameraMode = 'orbit';

    this.time = 0;
    this.frame = 0;
    this.running = false;
    this.maxDpr = options.maxDpr ?? 2;
    this.fixedStep = options.fixedStep ?? 0;   // 0 = variable timestep
    this._accumulator = 0;
    this._onFrame = null;

    this.world.setResource('app', this);
    this.world.addSystem(motionSystem, { order: 10, name: 'motion' });
    this.world.addSystem(transformSystem, { order: 20, name: 'transform' });

    this._resize();

    liveApps().add(this);
    this._onPageHide = () => this.dispose();
    addEventListener('pagehide', this._onPageHide);
    addEventListener('beforeunload', this._onPageHide);
  }

  /* --------------------------------------------------------- resources */

  /** app.mesh(Axion.box(1,1,1)) or app.mesh('sphere', { radius: 0.4 }) */
  mesh(geometryOrName, args = {}) {
    let geo = geometryOrName;
    if (typeof geometryOrName === 'string') {
      const fn = primitives[geometryOrName];
      if (!fn) throw new Error(`axion: unknown primitive "${geometryOrName}"`);
      geo = fn(...(Array.isArray(args) ? args : Object.values(args)));
    }
    return this.renderer.createMesh(geo);
  }

  material(desc) { return this.renderer.createMaterial(desc); }

  /* ------------------------------------------------------------ scene  */

  /**
   * Add one object.
   *   app.add({ mesh, material, position: [0,1,0], rotation: [0,0,0],
   *             scale: 1, color: [1,0,0], velocity: [0,0,0], spin: [0,1,0],
   *             dynamic: true })
   */
  add(desc = {}) {
    const dynamic = desc.dynamic ?? !!(desc.velocity || desc.spin);
    const comps = [Transform, LocalToWorld, Bounds, MeshRef];
    if (desc.color) comps.push(InstanceColor);
    if (dynamic) comps.push(Dynamic);
    if (desc.velocity || desc.spin) comps.push(Motion);
    if (desc.light) comps.push(PointLight);
    if (desc.hidden) comps.push(Hidden);

    const meshId = desc.mesh ?? 0;
    const meshBounds = this.renderer.meshes[meshId]?.bounds ?? new Float32Array([0, 0, 0, 1]);

    return this.world.spawn(comps, (cols, row) => {
      const T = cols.get(Transform.id);
      const t = row * 10;
      const p = desc.position ?? [0, 0, 0];
      T[t] = p[0]; T[t + 1] = p[1]; T[t + 2] = p[2];
      if (desc.rotation) {
        qFromEulerYXZ(T, t + T_ROT, desc.rotation[1] ?? 0, desc.rotation[0] ?? 0, desc.rotation[2] ?? 0);
      } else qidentity(T, t + T_ROT);
      const s = desc.scale ?? 1;
      if (typeof s === 'number') { T[t + T_SCALE] = s; T[t + T_SCALE + 1] = s; T[t + T_SCALE + 2] = s; }
      else { T[t + T_SCALE] = s[0]; T[t + T_SCALE + 1] = s[1]; T[t + T_SCALE + 2] = s[2]; }

      cols.get(Bounds.id).set(meshBounds, row * 4);

      const R = cols.get(MeshRef.id);
      R[row * 2 + M_MESH] = meshId;
      R[row * 2 + M_MATERIAL] = desc.material ?? this.renderer.defaultMaterial;

      if (desc.color) {
        const C = cols.get(InstanceColor.id);
        C[row * 4] = desc.color[0]; C[row * 4 + 1] = desc.color[1];
        C[row * 4 + 2] = desc.color[2]; C[row * 4 + 3] = desc.emissive ?? 0;
      }
      if (desc.velocity || desc.spin) {
        const M = cols.get(Motion.id);
        const v = desc.velocity ?? [0, 0, 0], w = desc.spin ?? [0, 0, 0];
        M[row * 6] = v[0]; M[row * 6 + 1] = v[1]; M[row * 6 + 2] = v[2];
        M[row * 6 + 3] = w[0]; M[row * 6 + 4] = w[1]; M[row * 6 + 5] = w[2];
      }
      if (desc.light) {
        const L = cols.get(PointLight.id);
        const l = desc.light;
        L[row * 5] = l.color?.[0] ?? 1; L[row * 5 + 1] = l.color?.[1] ?? 1;
        L[row * 5 + 2] = l.color?.[2] ?? 1;
        L[row * 5 + 3] = l.intensity ?? 10;
        L[row * 5 + 4] = l.range ?? 20;
      }

      // Static entities compose their matrix exactly once, right here, and are
      // then never visited by the transform system again.
      if (!dynamic) {
        m4compose(cols.get(LocalToWorld.id), row * 16, T, t + T_POS, T, t + T_ROT, T, t + T_SCALE);
      }
    });
  }

  /**
   * Add `count` objects in one archetype-contiguous block.
   * `fill(i, out)` writes into a reusable descriptor — no per-object garbage.
   */
  addMany(count, mesh, material, fill, { dynamic = false, color = true } = {}) {
    const comps = [Transform, LocalToWorld, Bounds, MeshRef];
    if (color) comps.push(InstanceColor);
    if (dynamic) comps.push(Dynamic, Motion);
    const meshBounds = this.renderer.meshes[mesh]?.bounds ?? new Float32Array([0, 0, 0, 1]);

    const out = {
      position: [0, 0, 0], scale: 1, color: [1, 1, 1], emissive: 0,
      velocity: [0, 0, 0], spin: [0, 0, 0], rotation: [0, 0, 0],
    };

    return this.world.spawnMany(comps, count, (cols, first) => {
      const T = cols.get(Transform.id);
      const W = cols.get(LocalToWorld.id);
      const B = cols.get(Bounds.id);
      const R = cols.get(MeshRef.id);
      const C = color ? cols.get(InstanceColor.id) : null;
      const M = dynamic ? cols.get(Motion.id) : null;

      for (let i = 0; i < count; i++) {
        const row = first + i, t = row * 10;
        out.scale = 1; out.emissive = 0;
        fill(i, out);

        T[t] = out.position[0]; T[t + 1] = out.position[1]; T[t + 2] = out.position[2];
        qFromEulerYXZ(T, t + T_ROT, out.rotation[1], out.rotation[0], out.rotation[2]);
        const s = out.scale;
        if (typeof s === 'number') { T[t + 7] = s; T[t + 8] = s; T[t + 9] = s; }
        else { T[t + 7] = s[0]; T[t + 8] = s[1]; T[t + 9] = s[2]; }

        B.set(meshBounds, row * 4);
        R[row * 2 + M_MESH] = mesh;
        R[row * 2 + M_MATERIAL] = material;

        if (C) {
          C[row * 4] = out.color[0]; C[row * 4 + 1] = out.color[1];
          C[row * 4 + 2] = out.color[2]; C[row * 4 + 3] = out.emissive;
        }
        if (M) {
          M[row * 6] = out.velocity[0]; M[row * 6 + 1] = out.velocity[1]; M[row * 6 + 2] = out.velocity[2];
          M[row * 6 + 3] = out.spin[0]; M[row * 6 + 4] = out.spin[1]; M[row * 6 + 5] = out.spin[2];
        }
        if (!dynamic) m4compose(W, row * 16, T, t, T, t + T_ROT, T, t + T_SCALE);
      }
    });
  }

  light(position, { color = [1, 1, 1], intensity = 20, range = 30 } = {}) {
    return this.world.spawn([Transform, PointLight], (cols, row) => {
      const T = cols.get(Transform.id);
      T[row * 10] = position[0]; T[row * 10 + 1] = position[1]; T[row * 10 + 2] = position[2];
      qidentity(T, row * 10 + T_ROT);
      T[row * 10 + 7] = 1; T[row * 10 + 8] = 1; T[row * 10 + 9] = 1;
      const L = cols.get(PointLight.id);
      L[row * 5] = color[0]; L[row * 5 + 1] = color[1]; L[row * 5 + 2] = color[2];
      L[row * 5 + 3] = intensity; L[row * 5 + 4] = range;
    });
  }

  /* ------------------------------------------------------------ loop   */

  onFrame(fn) { this._onFrame = fn; return this; }

  /** Runs after each frame is rendered, before it is presented. */
  onAfterRender(fn) { this._afterRender = fn; return this; }

  _resize() {
    if (resizeCanvas(this.canvas, this.maxDpr) || this.camera.aspect === 1) {
      this.camera.aspect = this.canvas.width / this.canvas.height;
      this.camera.update();
    }
  }

  start() {
    if (this.running) return this;
    this.running = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      if (!this.canvas.isConnected) { this.dispose(); return; }   // page was replaced
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.time += dt;
      this.frame++;

      this._resize();
      if (this.cameraMode === 'fly') this.fly?.update(dt);
      else this.controls?.update(dt);

      if (this.fixedStep > 0) {
        this._accumulator += dt;
        let guard = 8;
        while (this._accumulator >= this.fixedStep && guard-- > 0) {
          this.world.step(this.fixedStep, this.profile);
          this._accumulator -= this.fixedStep;
        }
      } else {
        this.world.step(dt, this.profile);
      }

      this._onFrame?.(dt, this);
      this.renderer.render(this.world, this.camera, this.time);
      // Same task as the render: getCurrentTexture() still returns the frame
      // that was just drawn, so a hook here can copy it before it is shown.
      this._afterRender?.(this);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    return this;
  }

  /**
   * Switch between orbit and free-fly. The incoming controller adopts the
   * camera's current placement, so the view never jumps on a toggle.
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return this;
    this.cameraMode = mode;
    if (mode === 'fly') this.fly?.syncFromCamera().setEnabled(true);
    else this.fly?.setEnabled(false);
    return this;
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); return this; }

  get stats() { return this.renderer.stats; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    liveApps().delete(this);
    removeEventListener('pagehide', this._onPageHide);
    removeEventListener('beforeunload', this._onPageHide);
    this.controls?.dispose();
    this.fly?.dispose();
    try { this.renderer.destroy(); } catch { /* already lost */ }
    try { this.renderer.context?.unconfigure?.(); } catch { /* ignore */ }
    // Destroying the device frees every buffer and texture at once, even ones
    // user code created and forgot about.
    try { this.device.destroy(); } catch { /* ignore */ }
  }
}

/** Shared across bundle copies: a re-run page may load the script again. */
function liveApps() {
  return (globalThis.__axionLiveApps ??= new Set());
}

export { composeRange };
