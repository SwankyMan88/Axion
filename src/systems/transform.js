import { Transform, LocalToWorld, Dynamic, Motion, T_POS, T_ROT, T_SCALE } from '../core/components.js';
import { m4compose, qFromAxisAngle, qmul, qnormalize, scratch } from '../core/math.js';

/**
 * Integrate motion. Straight loops over three columns of the same archetype —
 * no per-entity objects are touched, so this vectorizes well in the JIT.
 */
export function motionSystem(world, dt) {
  const q = scratch.q[0];
  for (const a of world.query([Transform, Motion, Dynamic])) {
    const T = a.columns.get(Transform.id);
    const M = a.columns.get(Motion.id);
    const n = a.count;
    for (let r = 0; r < n; r++) {
      const t = r * 10, m = r * 6;
      T[t + T_POS]     += M[m] * dt;
      T[t + T_POS + 1] += M[m + 1] * dt;
      T[t + T_POS + 2] += M[m + 2] * dt;

      const ax = M[m + 3], ay = M[m + 4], az = M[m + 5];
      const speed = Math.hypot(ax, ay, az);
      if (speed > 1e-6) {
        const inv = 1 / speed;
        q[0] = ax * inv; q[1] = ay * inv; q[2] = az * inv;
        qFromAxisAngle(q, 0, q, 0, speed * dt);
        qmul(T, t + T_ROT, q, 0, T, t + T_ROT);
        qnormalize(T, t + T_ROT, T, t + T_ROT);
      }
    }
  }
}

/**
 * Compose world matrices — but only for entities tagged Dynamic.
 *
 * This is the archetype payoff: static geometry simply lives in a different
 * archetype, so it is never visited. There is no "is it dirty?" branch per
 * object because the question was answered at spawn time by which archetype
 * the entity landed in.
 */
export function transformSystem(world) {
  for (const a of world.query([Transform, LocalToWorld, Dynamic])) {
    const T = a.columns.get(Transform.id);
    const W = a.columns.get(LocalToWorld.id);
    const n = a.count;
    for (let r = 0; r < n; r++) {
      const t = r * 10;
      m4compose(W, r * 16, T, t + T_POS, T, t + T_ROT, T, t + T_SCALE);
    }
  }
}

/** One-shot compose for freshly spawned static entities. */
export function composeRange(archetype, first, count) {
  const T = archetype.columns.get(Transform.id);
  const W = archetype.columns.get(LocalToWorld.id);
  for (let r = first; r < first + count; r++) {
    m4compose(W, r * 16, T, r * 10 + T_POS, T, r * 10 + T_ROT, T, r * 10 + T_SCALE);
  }
}
