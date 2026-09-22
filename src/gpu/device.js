/**
 * WebGPU device acquisition and canvas configuration.
 *
 * Axion is WebGPU-only by design. There is no WebGL fallback path, and that
 * is the point: every abstraction that has to satisfy both APIs gives up
 * storage buffers, compute, and explicit bind-group layout — which is exactly
 * where the performance lives.
 */

export class UnsupportedError extends Error {}

export async function createDevice(canvas, {
  powerPreference = 'high-performance',
  requiredFeatures = [],
  alphaMode = 'opaque',
  canvasUsage = 0,       // extra GPUTextureUsage bits for the swapchain, e.g. COPY_SRC
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new UnsupportedError(
      'WebGPU is not available in this browser. Axion requires WebGPU ' +
      '(Chrome/Edge 113+, Safari 18+, or Firefox with dom.webgpu.enabled).');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference });
  if (!adapter) throw new UnsupportedError('No suitable GPU adapter found.');

  const features = requiredFeatures.filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(
        adapter.limits.maxStorageBufferBindingSize, 512 * 1024 * 1024),
    },
  });

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device, format, alphaMode,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | canvasUsage,
  });

  const info = {
    vendor: adapter.info?.vendor ?? 'unknown',
    architecture: adapter.info?.architecture ?? 'unknown',
    features: [...device.features],
    limits: adapter.limits,
  };

  device.lost.then((reason) => {
    console.error('[axion] GPU device lost:', reason.message);
  });

  // Validation errors are asynchronous in WebGPU and otherwise vanish into the
  // console with no context. Surfacing them here is the difference between "the
  // screen is black" and knowing which resource was wrong.
  device.addEventListener?.('uncapturederror', (e) => {
    console.error('[axion] GPU error:', e.error?.message ?? e.error);
  });

  return { device, context, format, adapter, info };
}

/** Sized-to-DPR canvas backing store. Returns true when the size changed. */
export function resizeCanvas(canvas, maxDpr = 2) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
