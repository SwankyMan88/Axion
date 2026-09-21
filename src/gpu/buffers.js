/**
 * Buffer arenas.
 *
 * Meshes do not get their own GPU buffers. They are suballocated out of two
 * growable arenas — one for vertices, one for indices — so the whole scene
 * binds a single vertex buffer and a single index buffer, and every draw is
 * just a different (firstIndex, baseVertex) pair. That is what makes batching
 * and, later, indirect multi-draw possible at all.
 */

const align = (n, a) => Math.ceil(n / a) * a;

export class Arena {
  constructor(device, usage, initialBytes = 1 << 20, label = 'arena') {
    this.device = device;
    this.usage = usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.label = label;
    this.capacity = align(initialBytes, 256);
    this.offset = 0;
    this.buffer = device.createBuffer({ size: this.capacity, usage: this.usage, label });
  }

  /** Reserve `bytes`, returning the byte offset. Grows (and copies) if needed. */
  alloc(bytes, alignment = 4) {
    const start = align(this.offset, alignment);
    const end = start + bytes;
    if (end > this.capacity) this._grow(end);
    this.offset = end;
    return start;
  }

  write(byteOffset, data) {
    this.device.queue.writeBuffer(
      this.buffer, byteOffset, data.buffer, data.byteOffset, data.byteLength);
  }

  /** Alloc + write in one step. */
  upload(data, alignment = 4) {
    const off = this.alloc(data.byteLength, alignment);
    this.write(off, data);
    return off;
  }

  _grow(needed) {
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    const next = this.device.createBuffer({ size: cap, usage: this.usage, label: this.label });
    const enc = this.device.createCommandEncoder({ label: `${this.label}-grow` });
    enc.copyBufferToBuffer(this.buffer, 0, next, 0, this.offset);
    this.device.queue.submit([enc.finish()]);
    this.buffer.destroy();
    this.buffer = next;
    this.capacity = cap;
  }

  destroy() { this.buffer.destroy(); }
}

/**
 * A CPU-side staging array that is rewritten every frame and uploaded once.
 * Avoids both per-object writeBuffer calls and reallocation churn.
 */
export class DynamicBuffer {
  constructor(device, usage, floatCapacity, label = 'dynamic') {
    this.device = device;
    this.usage = usage | GPUBufferUsage.COPY_DST;
    this.label = label;
    this.cpu = new Float32Array(floatCapacity);
    this.buffer = device.createBuffer({
      size: align(this.cpu.byteLength, 256), usage: this.usage, label,
    });
  }

  ensure(floats) {
    if (floats <= this.cpu.length) return;
    let n = this.cpu.length;
    while (n < floats) n *= 2;
    this.cpu = new Float32Array(n);
    this.buffer.destroy();
    this.buffer = this.device.createBuffer({
      size: align(this.cpu.byteLength, 256), usage: this.usage, label: this.label,
    });
  }

  /** Upload only the first `floats` elements actually written this frame. */
  flush(floats) {
    if (floats === 0) return;
    this.device.queue.writeBuffer(
      this.buffer, 0, this.cpu.buffer, this.cpu.byteOffset, floats * 4);
  }

  destroy() { this.buffer.destroy(); }
}
