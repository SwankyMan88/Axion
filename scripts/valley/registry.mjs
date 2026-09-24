/** Shared textures and materials while building a pack. */
import { webp } from './images.mjs';

export class Registry {
  constructor() {
    this.textures = [];      // { name, data }
    this.materials = [];
    this.cache = new Map();
    this._tex = new Map();
    this._src = [];
  }

  /** Encode an image file (optionally with an alpha image) once; returns its index. */
  async texture(key, path, { size = 512, quality = 82, alphaPath = null } = {}) {
    if (this._tex.has(key)) return this._tex.get(key);
    const data = await webp(path, { size, quality, alphaPath });
    this.textures.push({ name: key, data });
    const i = this.textures.length - 1;
    this._tex.set(key, i);
    this._src[i] = path;
    return i;
  }

  textureRaw(key, data) {
    if (this._tex.has(key)) return this._tex.get(key);
    this.textures.push({ name: key, data });
    const i = this.textures.length - 1;
    this._tex.set(key, i);
    return i;
  }

  sourceOf(i) { return this._src[i]; }

  material(desc) {
    this.materials.push(desc);
    return this.materials.length - 1;
  }

  bytes() { return this.textures.reduce((s, t) => s + t.data.length, 0); }
}
