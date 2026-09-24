/**
 * Axion — a WebGPU, data-oriented 3D engine.
 *
 *   import * as AX from './src/index.js';
 *   const app = await AX.App.create(canvas);
 *   const mesh = app.mesh(AX.box());
 *   app.add({ mesh, position: [0, 0, 0], spin: [0, 1, 0] });
 *   app.light([4, 6, 4]);
 *   app.start();
 */

export const VERSION = '0.9.0';

export { App } from './app.js';
export { World, defineComponent, entityIndex, entityGen, NULL_ENTITY } from './core/ecs.js';
export * from './core/components.js';
export * as math from './core/math.js';
export { Camera } from './render/camera.js';
export { Renderer } from './render/renderer.js';
export {
  STANDARD_WGSL, SHADOW_WGSL, AO_WGSL, AO_BLUR_WGSL, SSR_WGSL, RESOLVE_WGSL, VOLUME_WGSL, EXPOSURE_WGSL, DOF_WGSL,
  BLOOM_PREFILTER_WGSL, BLOOM_DOWN_WGSL, BLOOM_UP_WGSL, FINAL_WGSL, SKY_WGSL, CUBE_FACES,
} from './render/shaders.js';
export { TERRAIN_WGSL, TERRAIN_SHADOW_WGSL } from './render/terrain-shaders.js';
export { Terrain } from './render/terrain.js';
export { skyRadiance, sunTransmittance, skyAmbient, sunDirection } from './render/sky.js';
export { createDevice, resizeCanvas, UnsupportedError } from './gpu/device.js';
export { Arena, DynamicBuffer } from './gpu/buffers.js';
export { box, roundedBox, sphere, icosphere, plane, torus, VERTEX_STRIDE_BYTES } from './geometry/primitives.js';
export { motionSystem, transformSystem, composeRange } from './systems/transform.js';
export { createFrameTrap } from './debug/frame-trap.js';
export { loadGLTF, loadModels, parseGLTF, parseGLB, readAccessor } from './loaders/gltf.js';
export { unpackAsset, base64ToBytes } from './loaders/packed.js';
export { textureFromImage, generateMips, solidTexture, textureArrayFromImages } from './gpu/textures.js';
