/**
 * Axion ECS — archetype storage, typed-array columns.
 *
 * Entities are ids. Components are *schemas*, not objects: each component
 * declares a typed array kind and a stride, and every archetype allocates one
 * dense column per component it contains. A query hands your system the raw
 * columns and a row count, so the inner loop is a `for` over contiguous memory
 * with no per-entity object, no property lookup and no virtual dispatch.
 *
 * Entity ids carry a generation in the high bits, so a stale id is detected
 * rather than silently addressing a recycled slot.
 */

const INDEX_BITS = 22;                       // 4.19M live entities
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_MASK = 0x3ff;                      // 10 bits of generation

export const entityIndex = (e) => e & INDEX_MASK;
export const entityGen = (e) => (e >>> INDEX_BITS) & GEN_MASK;
const makeEntity = (i, g) => (((g & GEN_MASK) << INDEX_BITS) | (i & INDEX_MASK)) >>> 0;

export const NULL_ENTITY = 0xffffffff;

const ARRAY_KINDS = {
  f32: Float32Array, f64: Float64Array,
  i32: Int32Array, u32: Uint32Array,
  i16: Int16Array, u16: Uint16Array,
  i8: Int8Array, u8: Uint8Array,
};

let nextComponentId = 0;

/**
 * Declare a component type.
 *   const Transform = defineComponent('Transform', 'f32', 10);
 * `stride` is elements per entity. A stride-0 component is a pure tag.
 */
export function defineComponent(name, kind = 'f32', stride = 1) {
  const Ctor = ARRAY_KINDS[kind];
  if (!Ctor) throw new Error(`axion: unknown component kind "${kind}"`);
  if (nextComponentId >= 256) throw new Error('axion: component limit (256) reached');
  return { id: nextComponentId++, name, kind, Ctor, stride, tag: stride === 0 };
}

/* ----------------------------------------------------------- archetype   */

class Archetype {
  constructor(components, capacity) {
    this.components = components;                  // sorted by id
    this.ids = components.map((c) => c.id);
    this.key = this.ids.join(',');
    this.has = new Uint8Array(256);
    for (const c of components) this.has[c.id] = 1;

    this.capacity = capacity;
    this.count = 0;
    this.entities = new Uint32Array(capacity);
    this.columns = new Map();                      // componentId -> typed array
    for (const c of components) {
      if (!c.tag) this.columns.set(c.id, new c.Ctor(capacity * c.stride));
    }
    /** Bumped whenever rows move. Systems caching row pointers can check it. */
    this.version = 0;
  }

  grow() {
    const cap = this.capacity * 2;
    const ents = new Uint32Array(cap);
    ents.set(this.entities);
    this.entities = ents;
    for (const c of this.components) {
      if (c.tag) continue;
      const old = this.columns.get(c.id);
      const next = new c.Ctor(cap * c.stride);
      next.set(old);
      this.columns.set(c.id, next);
    }
    this.capacity = cap;
  }

  addRow(entity) {
    if (this.count === this.capacity) this.grow();
    const row = this.count++;
    this.entities[row] = entity;
    return row;
  }

  /** Swap-remove. Returns the entity that was moved into `row`, or NULL. */
  removeRow(row) {
    const last = --this.count;
    if (row !== last) {
      this.entities[row] = this.entities[last];
      for (const c of this.components) {
        if (c.tag) continue;
        const col = this.columns.get(c.id);
        col.copyWithin(row * c.stride, last * c.stride, (last + 1) * c.stride);
      }
      this.version++;
      return this.entities[row];
    }
    this.version++;
    return NULL_ENTITY;
  }
}

/* ---------------------------------------------------------------- world  */

export class World {
  constructor({ initialCapacity = 1024 } = {}) {
    this.initialCapacity = initialCapacity;
    this.archetypes = [];
    this.archetypeByKey = new Map();

    this.generations = new Uint16Array(initialCapacity);
    this.locArchetype = new Int32Array(initialCapacity).fill(-1);
    this.locRow = new Uint32Array(initialCapacity);
    this.alive = new Uint8Array(initialCapacity);
    this.freeList = [];
    this.nextIndex = 0;

    this.resources = new Map();
    this._systems = [];
    this._queryCache = new Map();
    this._structureVersion = 0;
  }

  /* -- entity lifecycle -- */

  _reserveIndex() {
    if (this.freeList.length) return this.freeList.pop();
    const i = this.nextIndex++;
    if (i >= this.generations.length) this._growEntityTables();
    return i;
  }

  _growEntityTables() {
    const n = this.generations.length * 2;
    const g = new Uint16Array(n); g.set(this.generations); this.generations = g;
    const a = new Int32Array(n).fill(-1); a.set(this.locArchetype); this.locArchetype = a;
    const r = new Uint32Array(n); r.set(this.locRow); this.locRow = r;
    const al = new Uint8Array(n); al.set(this.alive); this.alive = al;
  }

  /**
   * Create an entity.
   *   world.spawn([Transform, Renderable])
   *   world.spawn([Transform], (cols, row) => { ... })  // init in place
   */
  spawn(components, init) {
    const idx = this._reserveIndex();
    this.alive[idx] = 1;
    const e = makeEntity(idx, this.generations[idx]);
    const arch = this._archetypeFor(components);
    const row = arch.addRow(e);
    this.locArchetype[idx] = arch.index;
    this.locRow[idx] = row;
    if (init) init(arch.columns, row, e);
    return e;
  }

  /** Bulk spawn: one archetype, n contiguous rows. Returns the first row. */
  spawnMany(components, n, init) {
    const arch = this._archetypeFor(components);
    const archIndex = arch.index;
    const first = arch.count;
    while (arch.capacity < arch.count + n) arch.grow();
    for (let k = 0; k < n; k++) {
      const idx = this._reserveIndex();
      this.alive[idx] = 1;
      const e = makeEntity(idx, this.generations[idx]);
      const row = arch.addRow(e);
      this.locArchetype[idx] = archIndex;
      this.locRow[idx] = row;
    }
    if (init) init(arch.columns, first, n, arch.entities);
    return { archetype: arch, first, count: n };
  }

  isAlive(e) {
    const i = entityIndex(e);
    return this.alive[i] === 1 && this.generations[i] === entityGen(e);
  }

  destroy(e) {
    const i = entityIndex(e);
    if (!this.isAlive(e)) return false;
    const arch = this.archetypes[this.locArchetype[i]];
    const moved = arch.removeRow(this.locRow[i]);
    if (moved !== NULL_ENTITY) this.locRow[entityIndex(moved)] = this.locRow[i];
    this.alive[i] = 0;
    this.locArchetype[i] = -1;
    this.generations[i] = (this.generations[i] + 1) & GEN_MASK;
    this.freeList.push(i);
    return true;
  }

  /** Column view + row for a single entity. Convenience, not a hot path. */
  get(e, component) {
    const i = entityIndex(e);
    if (!this.isAlive(e)) return null;
    const arch = this.archetypes[this.locArchetype[i]];
    const col = arch.columns.get(component.id);
    if (!col) return null;
    return { array: col, offset: this.locRow[i] * component.stride, row: this.locRow[i] };
  }

  /* -- archetypes -- */

  _archetypeFor(components) {
    const sorted = [...components].sort((a, b) => a.id - b.id);
    const key = sorted.map((c) => c.id).join(',');
    let arch = this.archetypeByKey.get(key);
    if (!arch) {
      arch = new Archetype(sorted, this.initialCapacity);
      arch.index = this.archetypes.length;
      this.archetypeByKey.set(key, arch);
      this.archetypes.push(arch);
      this._structureVersion++;
      this._queryCache.clear();
    }
    return arch;
  }

  /* -- queries -- */

  /**
   * Match archetypes containing all of `all` and none of `none`.
   * Returns a cached array of archetypes; iterate them yourself for speed:
   *
   *   for (const a of world.query([Transform, Velocity])) {
   *     const t = a.columns.get(Transform.id);
   *     for (let r = 0; r < a.count; r++) { ... }
   *   }
   */
  query(all, none = []) {
    const key = all.map((c) => c.id).join(',') + '|' + none.map((c) => c.id).join(',');
    let list = this._queryCache.get(key);
    if (list) return list;
    list = this.archetypes.filter((a) =>
      all.every((c) => a.has[c.id]) && none.every((c) => !a.has[c.id]));
    this._queryCache.set(key, list);
    return list;
  }

  /* -- resources & systems -- */

  setResource(name, value) { this.resources.set(name, value); return value; }
  getResource(name) { return this.resources.get(name); }

  /**
   * Systems run in ascending `order`. A system is just a function
   * (world, dt) => void — no base class, no lifecycle to remember.
   */
  addSystem(fn, { order = 0, name = fn.name || 'system' } = {}) {
    this._systems.push({ fn, order, name, ms: 0 });
    this._systems.sort((a, b) => a.order - b.order);
    return fn;
  }

  removeSystem(fn) {
    const i = this._systems.findIndex((s) => s.fn === fn);
    if (i >= 0) this._systems.splice(i, 1);
  }

  /** Run one frame of simulation. `profile` records per-system ms. */
  step(dt, profile = false) {
    const sys = this._systems;
    if (!profile) {
      for (let i = 0; i < sys.length; i++) sys[i].fn(this, dt);
      return;
    }
    for (let i = 0; i < sys.length; i++) {
      const t0 = performance.now();
      sys[i].fn(this, dt);
      sys[i].ms = performance.now() - t0;
    }
  }

  get systemTimings() { return this._systems.map((s) => ({ name: s.name, ms: s.ms })); }

  get entityCount() {
    let n = 0;
    for (const a of this.archetypes) n += a.count;
    return n;
  }
}
