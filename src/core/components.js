import { defineComponent } from './ecs.js';

/** position(3) rotation quat(4) scale(3) — one cache-friendly 40-byte row. */
export const Transform = defineComponent('Transform', 'f32', 10);
export const T_POS = 0, T_ROT = 3, T_SCALE = 7;

/** Object-to-world matrix, column-major. */
export const LocalToWorld = defineComponent('LocalToWorld', 'f32', 16);

/** Bounding sphere in local space: cx, cy, cz, radius. */
export const Bounds = defineComponent('Bounds', 'f32', 4);

/** meshId, materialId — indices into the renderer's registries. */
export const MeshRef = defineComponent('MeshRef', 'u32', 2);
export const M_MESH = 0, M_MATERIAL = 1;

/** Linear + angular velocity: vx,vy,vz, ax,ay,az (axis*speed, radians/s). */
export const Motion = defineComponent('Motion', 'f32', 6);

/** Per-instance tint/emissive override: r,g,b,emissive. */
export const InstanceColor = defineComponent('InstanceColor', 'f32', 4);

/** Tags. Stride 0 — costs no memory, only archetype membership. */
export const Dynamic = defineComponent('Dynamic', 'u8', 0);
export const Hidden = defineComponent('Hidden', 'u8', 0);

/** Point light: r,g,b, intensity, range (position comes from Transform). */
export const PointLight = defineComponent('PointLight', 'f32', 5);
