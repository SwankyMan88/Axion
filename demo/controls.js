/**
 * Camera controls for the demos. NOT part of the engine: Axion only renders,
 * and input is the job of the page using it. Copy, change or replace freely.
 */
/**
 * Orbit controls: drag to rotate, wheel to zoom, right-drag to pan.
 * Damped, framerate-independent, and it never allocates while running.
 */
export class OrbitControls {
  constructor(camera, element, {
    distance = 10, minDistance = 0.5, maxDistance = 500,
    azimuth = 0.7, polar = 1.1, damping = 12, autoRotate = 0,
  } = {}) {
    this.camera = camera;
    this.el = element;
    this.distance = distance;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.azimuth = azimuth;
    this.polar = polar;
    this.damping = damping;
    this.autoRotate = autoRotate;

    this._tAz = azimuth; this._tPolar = polar; this._tDist = distance;
    this._panX = 0; this._panY = 0; this._panZ = 0;
    this._dragging = 0;
    this._lastX = 0; this._lastY = 0;

    this._onDown = (e) => {
      this._dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      this._lastX = e.clientX; this._lastY = e.clientY;
      element.setPointerCapture?.(e.pointerId);
    };
    this._onUp = (e) => { this._dragging = 0; element.releasePointerCapture?.(e.pointerId); };
    this._onMove = (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      if (this._dragging === 1) {
        this._tAz -= dx * 0.005;
        this._tPolar = Math.min(Math.PI - 0.05, Math.max(0.05, this._tPolar - dy * 0.005));
      } else {
        const s = this._tDist * 0.0015;
        const sa = Math.sin(this._tAz), ca = Math.cos(this._tAz);
        this._panX -= (ca * dx - 0 * dy) * s;
        this._panZ -= (sa * dx) * s;
        this._panY += dy * s;
      }
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this._tDist = Math.min(this.maxDistance,
        Math.max(this.minDistance, this._tDist * Math.exp(e.deltaY * 0.001)));
    };
    this._onContext = (e) => e.preventDefault();

    element.addEventListener('pointerdown', this._onDown);
    element.addEventListener('pointerup', this._onUp);
    element.addEventListener('pointercancel', this._onUp);
    element.addEventListener('pointermove', this._onMove);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    element.addEventListener('contextmenu', this._onContext);
  }

  update(dt) {
    this._tAz += this.autoRotate * dt;
    const k = 1 - Math.exp(-this.damping * dt);
    this.azimuth += (this._tAz - this.azimuth) * k;
    this.polar += (this._tPolar - this.polar) * k;
    this.distance += (this._tDist - this.distance) * k;

    const c = this.camera;
    c.target[0] = this._panX; c.target[1] = this._panY; c.target[2] = this._panZ;
    const sp = Math.sin(this.polar);
    c.position[0] = c.target[0] + this.distance * sp * Math.cos(this.azimuth);
    c.position[1] = c.target[1] + this.distance * Math.cos(this.polar);
    c.position[2] = c.target[2] + this.distance * sp * Math.sin(this.azimuth);
    c.update();
  }

  dispose() {
    const el = this.el;
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointercancel', this._onUp);
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onContext);
  }
}

/**
 * Free-fly controls: WASD to move, mouse to look, space and shift for up and
 * down. Pointer lock on click, exactly as a first-person viewer should behave.
 *
 * Velocity is damped rather than snapped, and the look angles are integrated
 * from raw pointer deltas, so the camera stays smooth independent of frame
 * rate. Nothing here allocates while running.
 */
export class FlyControls {
  constructor(camera, element, {
    speed = 9, boost = 3, sensitivity = 0.0022, damping = 14,
    yaw = 0, pitch = -0.15, position = [0, 4, 18],
  } = {}) {
    this.camera = camera;
    this.el = element;
    this.speed = speed;
    this.boost = boost;
    this.sensitivity = sensitivity;
    this.damping = damping;

    this.yaw = yaw;
    this.pitch = pitch;
    this.enabled = false;
    this.locked = false;

    this.position = new Float32Array(position);
    this._velocity = new Float32Array(3);
    this._keys = new Set();

    // Pointer lock where the host allows it; sandboxed iframes (Khan Academy,
    // artifact viewers) often don't, so a held left button drags the view too.
    this._dragging = false;
    this._onDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this._dragging = true;
      try { element.requestPointerLock?.()?.catch?.(() => {}); } catch { /* refused */ }
    };
    this._onUp = () => { this._dragging = false; };
    this._onLockChange = () => { this.locked = document.pointerLockElement === element; };
    this._onMove = (e) => {
      if (!this.enabled || !(this.locked || (this._dragging && (e.buttons & 1)))) return;
      this.yaw -= e.movementX * this.sensitivity;
      // Stop just short of vertical: an exactly-vertical forward vector makes
      // the up vector ambiguous and the view rolls unpredictably.
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch - e.movementY * this.sensitivity));
    };
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this._keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this._keys.delete(e.code);

    element.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** Enter or leave fly mode. Leaving releases the pointer. */
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._keys.clear();
      this._velocity.fill(0);
      if (document.pointerLockElement === this.el) document.exitPointerLock?.();
    }
    return this;
  }

  /** Adopt wherever another controller left the camera, so toggling is seamless. */
  syncFromCamera() {
    const c = this.camera;
    this.position.set(c.position.subarray(0, 3));
    const dx = c.target[0] - c.position[0];
    const dy = c.target[1] - c.position[1];
    const dz = c.target[2] - c.position[2];
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return this;
  }

  update(dt) {
    if (!this.enabled) return;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);

    const fx = -sy * cp, fy = sp, fz = -cy * cp;   // forward
    const rx = cy, ry = 0, rz = -sy;               // right

    const k = this._keys;
    let mx = 0, my = 0, mz = 0;
    if (k.has('KeyW')) { mx += fx; my += fy; mz += fz; }
    if (k.has('KeyS')) { mx -= fx; my -= fy; mz -= fz; }
    if (k.has('KeyD')) { mx += rx; my += ry; mz += rz; }
    if (k.has('KeyA')) { mx -= rx; my -= ry; mz -= rz; }
    if (k.has('Space')) my += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) my -= 1;

    const len = Math.hypot(mx, my, mz);
    const speed = this.speed * (k.has('ControlLeft') ? this.boost : 1);
    if (len > 1e-5) { mx = mx / len * speed; my = my / len * speed; mz = mz / len * speed; }
    else { mx = 0; my = 0; mz = 0; }

    const damp = 1 - Math.exp(-this.damping * dt);
    this._velocity[0] += (mx - this._velocity[0]) * damp;
    this._velocity[1] += (my - this._velocity[1]) * damp;
    this._velocity[2] += (mz - this._velocity[2]) * damp;

    this.position[0] += this._velocity[0] * dt;
    this.position[1] += this._velocity[1] * dt;
    this.position[2] += this._velocity[2] * dt;

    const c = this.camera;
    c.position.set(this.position);
    c.target[0] = this.position[0] + fx;
    c.target[1] = this.position[1] + fy;
    c.target[2] = this.position[2] + fz;
    c.update();
  }

  dispose() {
    this.el.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
