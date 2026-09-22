import { f32, m4invert, m4lookAt, m4mul, m4perspectiveReverseZ, m4ortho } from '../core/math.js';

/**
 * Camera. Holds its own matrices as flat Float32Arrays so they can be handed
 * straight to writeBuffer with no conversion step.
 */
export class Camera {
  constructor({ fov = 60, near = 0.1, aspect = 1 } = {}) {
    this.fov = fov * Math.PI / 180;
    this.near = near;            // no far plane: infinite reverse-Z projection
    this.aspect = aspect;

    this.position = f32(3);
    this.target = f32(3);
    this.up = f32([0, 1, 0]);

    this.view = f32(16);
    this.invView = f32(16);       // camera-to-world; the resolve pass needs it
    this.projection = f32(16);
    this.viewProj = f32(16);
    this.update();
  }

  setAspect(a) { if (a !== this.aspect) { this.aspect = a; } return this; }

  setOrthographic(size) {
    this._ortho = size;
    return this;
  }

  update() {
    if (this._ortho) {
      const h = this._ortho, w = h * this.aspect;
      m4ortho(this.projection, 0, -w, w, -h, h, this.near, this.near + 4000);
    } else {
      m4perspectiveReverseZ(this.projection, 0, this.fov, this.aspect, this.near);
    }
    m4lookAt(this.view, 0, this.position, 0, this.target, 0, this.up, 0);
    m4mul(this.viewProj, 0, this.projection, 0, this.view, 0);
    m4invert(this.invView, 0, this.view, 0);
    return this;
  }
}
