// Model assembly: runs the part builders for one LOD, packs the paint atlas,
// converts to the plane-local frame (origin at CG), bakes vertex AO and turns
// the builders into BufferGeometries.
import * as THREE from 'three';
import { CG_MODEL } from './dims.js';
import { GeoBuilder, packAtlas, applyAtlas, computeVoxelAO, rng } from './geom.js';
import { buildFuselage } from './fuselage.js';
import { buildWing } from './wing.js';
import { buildTail } from './tail.js';
import { buildFloats } from './floats.js';
import { buildStruts } from './struts.js';
import { buildPowerplant } from './powerplant.js';
import { buildProp } from './prop.js';
import { buildCargo } from './cargo.js';
import { buildCockpit } from './cockpit.js';

// Generic islands: atlas regions painted with a uniform material (no 3D paint).
export const GENERIC = { dark: [1.7, 3.2], interior: [1.6, 1.6], fitting: [0.5, 0.5], black: [0.5, 0.5] };

export function createContext(lod, seed) {
  const ctx = {
    lod,
    seed,
    rand: rng(seed * 7919 + lod * 104729 + 13),
    paint: new GeoBuilder('paint'),
    hard: new GeoBuilder('hard'),
    glass: new GeoBuilder('glass'),
    bakeOnly: new GeoBuilder('paint'),
    extra: [],
    islands: [],
    islandByName: {},
    island(name, u0, v0, w, h, density = 1, generic = false) {
      if (this.islandByName[name] !== undefined) return this.islandByName[name];
      const id = this.islands.length;
      this.islands.push({ name, u0, v0, w, h, density, generic });
      this.islandByName[name] = id;
      return id;
    },
    genericIsland(name) { const s = GENERIC[name]; return this.island('g_' + name, 0, 0, s[0], s[1], 0.6, true); },
    newBuilder(layout) { const b = new GeoBuilder(layout); this.extra.push(b); return b; },
  };
  for (const g in GENERIC) ctx.genericIsland(g);
  return ctx;
}

export function buildAirframe(lod, seed) {
  const ctx = createContext(lod, seed);
  const out = { ctx, parts: {}, lights: {}, anchors: {} };
  const fus = buildFuselage(ctx);
  out.doors = fus.doors;
  const wing = buildWing(ctx);
  Object.assign(out.parts, wing.parts);
  Object.assign(out.lights, wing.lights);
  const tail = buildTail(ctx);
  Object.assign(out.parts, tail.parts);
  Object.assign(out.lights, tail.lights);
  const floats = buildFloats(ctx);
  Object.assign(out.parts, floats.parts);
  Object.assign(out.anchors, floats.anchors);
  const struts = buildStruts(ctx);
  Object.assign(out.anchors, struts.anchors);
  const pp = buildPowerplant(ctx);
  Object.assign(out.anchors, pp.anchors);
  out.prop = buildProp(ctx);
  const cargo = buildCargo(ctx);
  Object.assign(out.anchors, cargo.anchors);
  if (lod === 0) out.interior = buildCockpit(ctx);
  return out;
}

// Pack (or reuse) the atlas and remap all paint builders.
export function layoutAtlas(ctx, atlasPx, reuse) {
  let rects;
  if (reuse) {
    rects = ctx.islands.map((is) => {
      const r = reuse.byName[is.name];
      if (!r) throw new Error('missing atlas island ' + is.name);
      return r;
    });
  } else {
    const packed = packAtlas(ctx.islands, atlasPx, 8);
    rects = packed.rects;
    reuse = { byName: {}, scale: packed.scale, islands: ctx.islands };
    ctx.islands.forEach((is, i) => { reuse.byName[is.name] = rects[i]; });
  }
  const paints = [ctx.paint, ctx.bakeOnly, ...ctx.extra.filter((b) => b.layoutName === 'paint')];
  for (const b of paints) applyAtlas(b, ctx.islands, rects);
  // generic islands: wrap uvs inside the island rect
  for (const b of paints) {
    const uv = b.attrs.uv;
    for (let v = 0; v < b.island.length; v++) {
      const id = b.island[v];
      if (id < 0 || !ctx.islands[id].generic) continue;
      // applyAtlas clamped; replace with a wrapped coordinate for variety
    }
    void uv;
  }
  return reuse;
}

// Translate every builder into the plane-local frame (origin at nominal CG).
export function toLocalFrame(model) {
  const { ctx } = model;
  const all = [ctx.paint, ctx.hard, ctx.glass, ctx.bakeOnly, ...ctx.extra];
  for (const b of all) if (!b.localSpace) b.translateAll(-CG_MODEL.x, -CG_MODEL.y, -CG_MODEL.z);
  const shift = (v) => v && v.isVector3 && v.sub(CG_MODEL);
  for (const k in model.parts) {
    shift(model.parts[k].hinge && model.parts[k].hinge.origin);
    shift(model.parts[k].retract && model.parts[k].retract.origin);
  }
  for (const k in model.doors || {}) shift(model.doors[k].hinge.origin);
  for (const k in model.lights) if (model.lights[k].isVector3 && !k.endsWith('Dir')) shift(model.lights[k]);
  for (const k in model.anchors) {
    const a = model.anchors[k];
    if (a && a.isVector3) shift(a);
    else if (Array.isArray(a)) a.forEach(shift);
    else if (a && typeof a === 'object') for (const kk in a) if (a[kk] && a[kk].isVector3 && !kk.toLowerCase().includes('dir') && !kk.includes('axis')) shift(a[kk]);
  }
  if (model.prop) shift(model.prop.hub);
  const it = model.interior;
  if (it) {
    for (const b of [it.st, it.dyn, it.gauge, it.gglass, it.horizon]) b.translateAll(-CG_MODEL.x, -CG_MODEL.y, -CG_MODEL.z);
    for (const p of it.parts) shift(p.pivot);
    for (const k in it.anchors) {
      const a = it.anchors[k];
      if (a && a.isVector3) shift(a);
      else if (Array.isArray(a)) a.forEach((v) => v && v.isVector3 && shift(v));
    }
  }
}

export function bakeAO(model) {
  const { ctx } = model;
  const entries = [];
  const paintApply = (b, vi, ao) => { b.attrs.aBake[vi * 4 + 3] = ao; };
  const hardApply = (b, vi, ao) => {
    const c = b.attrs.color;
    const k = 0.25 + 0.75 * ao;
    c[vi * 3] *= k; c[vi * 3 + 1] *= k; c[vi * 3 + 2] *= k;
  };
  entries.push({ b: ctx.paint, occlude: true, receive: true, apply: paintApply });
  entries.push({ b: ctx.bakeOnly, occlude: false, receive: true, apply: paintApply });
  entries.push({ b: ctx.hard, occlude: true, receive: true, apply: hardApply });
  for (const b of ctx.extra) {
    if (b.localSpace) continue;
    if (b.layoutName === 'paint') entries.push({ b, occlude: true, receive: true, apply: paintApply });
    else if (b.layoutName === 'hard') entries.push({ b, occlude: true, receive: true, apply: hardApply });
  }
  computeVoxelAO(entries, { cell: ctx.lod === 0 ? 0.075 : 0.15, dirs: ctx.lod === 0 ? 14 : 8, maxDist: 1.3 });
  // interior: short-range cavity occlusion only (the cabin is an enclosed box)
  const it = model.interior;
  if (it) {
    const ie = [
      { b: it.st, occlude: true, receive: true, apply: hardApply },
      { b: it.dyn, occlude: true, receive: true, apply: hardApply },
    ];
    computeVoxelAO(ie, { cell: 0.03, dirs: 12, maxDist: 0.3 });
  }
}
