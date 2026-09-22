/**
 * Textures: upload, mipmaps, and the 1x1 defaults every material falls back to.
 *
 * Every material binds the same set of texture slots, textured or not. An
 * untextured material gets white base colour, white metallic-roughness and a
 * flat normal, which multiply its factors by exactly one — so the shader has a
 * single code path, and no permutation per texture combination.
 */

const MIP_WGSL = /* wgsl */`
@group(0) @binding(0) var srcSampler : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct Out { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> Out {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o : Out;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@fragment
fn fs(i : Out) -> @location(0) vec4<f32> {
  return textureSampleLevel(src, srcSampler, i.uv, 0.0);
}
`;

const mipState = new WeakMap();   // device -> { module, sampler, pipelines: Map<format, pipeline> }

function mipPipeline(device, format) {
  let st = mipState.get(device);
  if (!st) {
    st = {
      module: device.createShaderModule({ code: MIP_WGSL, label: 'axion-mip' }),
      sampler: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
      pipelines: new Map(),
    };
    mipState.set(device, st);
  }
  let p = st.pipelines.get(format);
  if (!p) {
    p = device.createRenderPipeline({
      label: `axion-mip-${format}`,
      layout: 'auto',
      vertex: { module: st.module, entryPoint: 'vs' },
      fragment: { module: st.module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    st.pipelines.set(format, p);
  }
  return { pipeline: p, sampler: st.sampler };
}

export const mipLevelsFor = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

/**
 * Fill every mip level from level 0, each from the one above it.
 *
 * On an sRGB texture both the sampled view and the attachment are sRGB, so
 * the averaging happens in linear light — downsampling gamma-encoded values
 * directly would darken every mip and make distant surfaces look dirtier than
 * near ones.
 */
export function generateMips(device, texture) {
  const { pipeline, sampler } = mipPipeline(device, texture.format);
  const enc = device.createCommandEncoder({ label: 'axion-mips' });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
      ],
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}

/**
 * Upload a decoded image (ImageBitmap, canvas, video frame) with a full mip
 * chain. `srgb` is true for colour data — base colour, emissive — and false for
 * data textures such as normals and metallic-roughness, which must not be
 * gamma-decoded on sampling.
 */
export function textureFromImage(device, image, { srgb = true, mips = true, label = 'axion-texture' } = {}) {
  const format = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
  const w = image.width, h = image.height;
  const texture = device.createTexture({
    label, format,
    size: [w, h],
    mipLevelCount: mips ? mipLevelsFor(w, h) : 1,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: image }, { texture }, [w, h]);
  if (mips && texture.mipLevelCount > 1) generateMips(device, texture);
  return texture;
}

/** A 1x1 texture of one colour, for the defaults. */
export function solidTexture(device, rgba, { srgb = false, label = 'axion-solid' } = {}) {
  const texture = device.createTexture({
    label, size: [1, 1],
    format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}
