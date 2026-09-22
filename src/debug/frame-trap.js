/**
 * Frame trap: catches a transient black region and says which stage made it.
 *
 * Some rendering bugs last one frame and never reproduce on demand. This
 * copies the centre of every presented frame, and of the HDR resolve target,
 * back to the CPU, and fires on the first frame whose centre suddenly contains
 * pure black. Three readback slots are used so a frame is not skipped while an
 * earlier one is still being mapped.
 *
 * The report says where the black came from:
 *   stage 'hdr'  — already black in the HDR resolve: geometry, reflections,
 *                  occlusion or the resolve pass produced it.
 *   stage 'post' — the HDR target was fine; bloom, tonemapping or FXAA made it.
 *
 * And the most useful answer is the one it cannot give directly: if a black
 * box is visible on screen and the trap never fires, the box is not in any
 * frame the engine rendered. It is being introduced after presentation, by the
 * browser's compositor or the display driver.
 *
 * The swapchain must be copyable: create the app with
 *   { canvasUsage: GPUTextureUsage.COPY_SRC }
 * and call capture() from app.onAfterRender().
 */

// The same curve the final pass applies, so HDR values can be judged on the
// scale the eye actually sees: "would this HDR value already display as black?"
const aces = (x) => Math.min(1, Math.max(0,
  (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const displayed = (x) => Math.pow(aces(x), 1 / 2.2) * 255;

const half = (h) => {
  const e = (h >> 10) & 31, f = h & 1023;
  if (e === 31) return NaN;
  return (h & 0x8000 ? -1 : 1) *
    (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * (f / 1024));
};

export function createFrameTrap(app, {
  size = 192,              // centre region, in pixels; size*4 and size*8 must be 256-aligned
  warmup = 30,             // frames to learn the baseline before arming
  minFraction = 0.02,      // black share of the region that counts as a region
  onCatch = () => {},
} = {}) {
  if ((size * 4) % 256 !== 0) throw new Error('frame trap: size * 4 must be a multiple of 256');
  const device = app.device;
  const bgra = navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm';
  const slots = [0, 1, 2].map(() => ({
    busy: false,
    final: device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    hdr: device.createBuffer({ size: size * size * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
  }));

  let enabled = false, baseline = 0, seen = 0;
  const pending = new Set();

  function capture() {
    if (!enabled) return;
    const slot = slots.find((s) => !s.busy);
    if (!slot) return;
    const tex = app.renderer.context.getCurrentTexture();
    const hdr = app.renderer._targets?.hdr;
    if (!hdr || hdr.width !== tex.width || hdr.height !== tex.height) return;

    const w = Math.min(size, tex.width), h = Math.min(size, tex.height);
    const origin = [((tex.width - w) / 2) | 0, ((tex.height - h) / 2) | 0];
    const enc = device.createCommandEncoder({ label: 'frame-trap' });
    enc.copyTextureToBuffer({ texture: tex, origin }, { buffer: slot.final, bytesPerRow: size * 4 }, [w, h]);
    enc.copyTextureToBuffer({ texture: hdr, origin }, { buffer: slot.hdr, bytesPerRow: size * 8 }, [w, h]);
    device.queue.submit([enc.finish()]);
    slot.busy = true;

    const meta = {
      frame: app.frame, time: app.time, w, h,
      camera: Array.from(app.camera.position),
      target: Array.from(app.camera.target),
    };
    const job = Promise.all([
      slot.final.mapAsync(GPUMapMode.READ), slot.hdr.mapAsync(GPUMapMode.READ),
    ]).then(() => {
      const px = new Uint8Array(slot.final.getMappedRange()).slice();
      const hx = new Uint16Array(slot.hdr.getMappedRange()).slice();
      slot.final.unmap(); slot.hdr.unmap(); slot.busy = false;
      if (enabled) analyse(px, hx, meta);
    }).catch(() => { slot.busy = false; });
    pending.add(job);
    job.finally(() => pending.delete(job));
  }

  /*
   * Attribution compares like with like. A final pixel is "black" at <= 2/255
   * after tonemapping and gamma; an HDR pixel is judged by running it through
   * that same curve at reference exposure 1. Exposure itself belongs to the
   * post stage, so a frame blacked out by exposure is correctly blamed on post.
   *
   *   explained   — black on screen, and the HDR value would display black too
   *   unexplained — black on screen, but the HDR value would display visibly
   */
  function analyse(px, hx, meta) {
    let finalBlack = 0, hdrBlack = 0, unexplained = 0;
    for (let y = 0; y < meta.h; y++) {
      for (let x = 0; x < meta.w; x++) {
        const o = y * size + x;
        const isBlack = px[o * 4] <= 2 && px[o * 4 + 1] <= 2 && px[o * 4 + 2] <= 2;
        const r = half(hx[o * 4]), g = half(hx[o * 4 + 1]), b = half(hx[o * 4 + 2]);
        const peak = Math.max(r, g, b);
        const hdrShowsBlack = !(displayed(peak) > 3);   // NaN counts as black
        if (hdrShowsBlack) hdrBlack++;
        if (isBlack) {
          finalBlack++;
          if (!hdrShowsBlack && displayed(peak) > 6) unexplained++;
        }
      }
    }
    seen++;
    const area = meta.w * meta.h;
    const tripped = seen > warmup &&
      finalBlack > area * minFraction && finalBlack > baseline * 4 + 50;
    if (!tripped) { baseline = baseline * 0.95 + finalBlack * 0.05; return; }

    enabled = false;
    app.stop();

    // Normalise to RGBA for whoever displays it.
    const rgba = new Uint8ClampedArray(area * 4);
    for (let y = 0; y < meta.h; y++) {
      for (let x = 0; x < meta.w; x++) {
        const s = (y * size + x) * 4, d = (y * meta.w + x) * 4;
        rgba[d] = px[s + (bgra ? 2 : 0)];
        rgba[d + 1] = px[s + 1];
        rgba[d + 2] = px[s + (bgra ? 0 : 2)];
        rgba[d + 3] = 255;
      }
    }
    onCatch({
      ...meta, area, finalBlack, hdrBlack, unexplained, rgba,
      // Mostly explained by the HDR target means the black was already there.
      stage: unexplained * 2 < finalBlack ? 'hdr' : 'post',
    });
  }

  return {
    capture,
    /** Resolves once every in-flight readback has been analysed. */
    settle: () => Promise.all([...pending]),
    get enabled() { return enabled; },
    set enabled(on) { enabled = on; baseline = 0; seen = 0; },
    destroy() { for (const s of slots) { s.final.destroy(); s.hdr.destroy(); } },
  };
}
