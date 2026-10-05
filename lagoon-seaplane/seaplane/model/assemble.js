// Turns built models (per LOD) into the three.js scene graph: static meshes per
// material, hinged pivots for control surfaces / doors / water rudders and the
// propeller. Geometry is already in the plane-local frame (origin at CG).
import * as THREE from 'three';
import { CG_MODEL, DIM } from './dims.js';
import { partitionTriangles } from './geom.js';

// Pre-split crash pieces, tested on triangle centroids in the plane-local frame:
// the float hulls (below the strut roots) and the outer wing panels (outboard of
// the flaps, with the ailerons). Their triangles sit at the end of every static
// index buffer, so a piece that breaks off is hidden by trimming the index range
// - no extra draw calls while the airframe is intact.
const FLOAT_TOP = 0.95 - CG_MODEL.y;
const TIP_X = DIM.wing.aileron.x0;
export const PIECES = [
  { id: 'floatL', hinge: 'waterRudderL', test: (x, y) => x < -0.85 && y < FLOAT_TOP },
  { id: 'floatR', hinge: 'waterRudderR', test: (x, y) => x > 0.85 && y < FLOAT_TOP },
  { id: 'wingTipL', hinge: 'aileronL', test: (x, y) => x < -TIP_X && y > 0.3 },
  { id: 'wingTipR', hinge: 'aileronR', test: (x, y) => x > TIP_X && y > 0.3 },
];
const PIECE_TESTS = PIECES.map((p) => p.test);

// Static mesh with breakable runs: { mesh, rest, runs, tail } where tail is a
// pristine copy of the index data after the rest (used to rebuild the buffer).
function breakable(builder, mat, opts) {
  const part = partitionTriangles(builder, PIECE_TESTS);
  const m = mesh(builder.toGeometry(), mat, opts);
  const arr = m.geometry.index.array;
  return { mesh: m, rest: part.rest, runs: part.runs, tail: arr.slice(part.rest) };
}

// A hinge pivot: rotate(angle) about a fixed local axis, allocation free.
export class Hinge {
  constructor(name, origin, axis, parentOrigin = null) {
    this.name = name;
    this.object = new THREE.Group();
    this.object.name = name;
    this.object.position.copy(origin);
    if (parentOrigin) this.object.position.sub(parentOrigin);
    this.origin = origin.clone();
    this.axis = axis.clone().normalize();
    this.angle = 0;
  }
  set(angle) {
    if (angle === this.angle) return;
    this.angle = angle;
    this.object.quaternion.setFromAxisAngle(this.axis, angle);
  }
  // add a mesh whose geometry is in plane-local coordinates
  attach(mesh) {
    mesh.position.sub(this.origin);
    this.object.add(mesh);
    return mesh;
  }
}

function mesh(geo, mat, { cast = true, receive = true, name = '' } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = true;
  return m;
}

// Build the LOD0 graph (full detail with moving parts).
export function assembleLod0(model, mats) {
  const group = new THREE.Group();
  group.name = 'seaplane.lod0';
  const { ctx } = model;
  const breakables = [
    breakable(ctx.paint, mats.paint, { name: 'paint' }),
    breakable(ctx.hard, mats.hard, { name: 'hard' }),
    breakable(ctx.glass, mats.glass, { cast: false, name: 'glass' }),
  ];
  const statics = { paint: breakables[0].mesh, hard: breakables[1].mesh, glass: breakables[2].mesh };
  statics.glass.renderOrder = 2;
  for (const k in statics) group.add(statics[k]);
  const hinges = {};
  // control surfaces (paint builders)
  for (const key of ['aileronL', 'aileronR', 'flapL', 'flapR', 'elevator', 'rudder']) {
    const p = model.parts[key];
    if (!p) continue;
    const h = new Hinge(key, p.hinge.origin, p.hinge.axis);
    h.attach(mesh(p.paint.toGeometry(), mats.paint, { name: key }));
    group.add(h.object);
    hinges[key] = h;
  }
  if (model.parts.trimTab && hinges.elevator) {
    const p = model.parts.trimTab;
    const h = new Hinge('trimTab', p.hinge.origin, p.hinge.axis, hinges.elevator.origin);
    const m = mesh(p.paint.toGeometry(), mats.paint, { cast: false, name: 'trimTab' });
    m.position.sub(p.hinge.origin);
    h.object.add(m);
    hinges.elevator.object.add(h.object);
    hinges.trimTab = h;
  }
  // water rudders: retract pivot -> steer pivot -> mesh
  for (const key of ['waterRudderL', 'waterRudderR']) {
    const p = model.parts[key];
    if (!p) continue;
    const retract = new Hinge(key + '.retract', p.retract.origin, p.retract.axis);
    // steering pivot sits on the rudder post, carried by the retract pivot
    const steer = new THREE.Group();
    steer.position.copy(p.hinge.origin).sub(p.retract.origin);
    retract.object.add(steer);
    const m = mesh(p.hard.toGeometry(), mats.hard, { cast: false, name: key });
    m.position.copy(p.hinge.origin).negate();
    steer.add(m);
    group.add(retract.object);
    hinges[key] = { retract, steer, axis: p.hinge.axis.clone(), set(steerAngle, retractAngle) {
      retract.set(retractAngle);
      steer.quaternion.setFromAxisAngle(this.axis, steerAngle);
    } };
  }
  // doors
  const doors = {};
  for (const key in model.doors) {
    const d = model.doors[key];
    const h = new Hinge(key, d.hinge.origin, d.hinge.axis);
    h.attach(mesh(d.paint.toGeometry(), mats.paint, { name: key + '.paint' }));
    const g = h.attach(mesh(d.glass.toGeometry(), mats.glass, { cast: false, name: key + '.glass' }));
    g.renderOrder = 2;
    h.attach(mesh(d.hard.toGeometry(), mats.hard, { cast: false, name: key + '.hard' }));
    group.add(h.object);
    doors[key] = { hinge: h, openAngle: d.openAngle, side: d.side, isCargo: d.isCargo, def: d };
  }
  // propeller
  const propPivot = new THREE.Group();
  propPivot.name = 'prop';
  propPivot.position.copy(model.prop.hub);
  const spinner = mesh(model.prop.builder.toGeometry(), mats.hard, { name: 'prop.spinner' });
  const propMesh = mesh(model.prop.blades.toGeometry(), mats.hard, { name: 'prop.blades' });
  propPivot.add(spinner, propMesh);
  group.add(propPivot);
  return { group, statics, breakables, hinges, doors, propPivot, propMesh, spinner };
}

// LOD1 / LOD2: static meshes only (control surfaces folded into the statics,
// propeller kept separate so it can spin / be replaced by the disc).
export function assembleLodN(model, mats, lod) {
  const group = new THREE.Group();
  group.name = 'seaplane.lod' + lod;
  const { ctx } = model;
  // merge moving parts into the static builders (rest pose)
  for (const key in model.parts) {
    const p = model.parts[key];
    if (p.paint) mergeInto(ctx.paint, p.paint);
    if (p.hard) mergeInto(ctx.hard, p.hard);
  }
  // doors are merged in their default pose (cargo door open, pilot doors shut)
  const _rot = new THREE.Matrix4(), _t1 = new THREE.Matrix4(), _t2 = new THREE.Matrix4();
  for (const key in model.doors || {}) {
    const d = model.doors[key];
    const angle = d.isCargo ? d.openAngle : 0;
    if (angle) {
      const o = d.hinge.origin;
      _rot.makeRotationAxis(d.hinge.axis, angle);
      _t1.makeTranslation(o.x, o.y, o.z).multiply(_rot).multiply(_t2.makeTranslation(-o.x, -o.y, -o.z));
      for (const b of [d.paint, d.glass, d.hard]) if (b && b.vertexCount) b.transform(0, _t1);
    }
    mergeInto(ctx.paint, d.paint); mergeInto(ctx.glass, d.glass); mergeInto(ctx.hard, d.hard);
  }
  // LOD2: the spinner joins the static mesh (its spin is invisible from > 150 m)
  if (lod === 2) {
    const sp = model.prop.builder;
    const s0 = ctx.hard.vertexCount;
    mergeInto(ctx.hard, sp);
    ctx.hard.transform(s0, new THREE.Matrix4().makeTranslation(model.prop.hub.x, model.prop.hub.y, model.prop.hub.z));
  }
  const breakables = [
    breakable(ctx.paint, mats.paintLod, { name: 'paint' }),
    breakable(ctx.hard, mats.hardLod, { name: 'hard', cast: lod === 1 }),
  ];
  const statics = { paint: breakables[0].mesh, hard: breakables[1].mesh };
  if (lod === 1 && ctx.glass.vertexCount) {
    breakables.push(breakable(ctx.glass, mats.glassLod, { cast: false, name: 'glass' }));
    statics.glass = breakables[2].mesh;
    statics.glass.renderOrder = 2;
  }
  for (const k in statics) group.add(statics[k]);
  const propPivot = new THREE.Group();
  propPivot.position.copy(model.prop.hub);
  const propMesh = mesh(model.prop.blades.toGeometry(), mats.hardLod, { name: 'prop.blades', cast: false });
  propPivot.add(propMesh);
  let spinner = null;
  if (lod < 2) { spinner = mesh(model.prop.builder.toGeometry(), mats.hardLod, { name: 'prop.spinner', cast: false }); propPivot.add(spinner); }
  group.add(propPivot);
  return { group, statics, breakables, propPivot, propMesh, spinner };
}

// A world-space copy of one piece for the debris simulation: views of the LOD0
// static geometries that share their vertex buffers and draw only the piece's run.
export function createPieceViews(lod0, k, center) {
  const out = [];
  for (const br of lod0.breakables) {
    const r = br.runs[k];
    if (!r.count) continue;
    const src = br.mesh.geometry;
    const g = new THREE.BufferGeometry();
    for (const name in src.attributes) g.setAttribute(name, src.attributes[name]);
    g.setIndex(new THREE.BufferAttribute(br.tail.slice(r.start - br.rest, r.start - br.rest + r.count), 1));
    g.boundingBox = r.box.clone();
    g.boundingSphere = r.box.getBoundingSphere(new THREE.Sphere());
    const m = mesh(g, br.mesh.material, { cast: br.mesh.castShadow, receive: br.mesh.receiveShadow, name: br.mesh.name + '.piece' });
    m.renderOrder = br.mesh.renderOrder;
    m.position.copy(center).negate();
    out.push(m);
  }
  return out;
}

// Append builder b into target (same layout).
export function mergeInto(target, b) {
  if (!b || !b.vertexCount) return;
  const base = target.vertexCount;
  for (let i = 0; i < b.position.length; i++) { target.position.push(b.position[i]); target.normal.push(b.normal[i]); }
  for (const k in target.attrs) {
    const src = b.attrs[k];
    if (src) for (let i = 0; i < src.length; i++) target.attrs[k].push(src[i]);
  }
  for (let i = 0; i < b.island.length; i++) { target.island.push(b.island[i]); target.noAO.push(b.noAO[i]); }
  for (let i = 0; i < b.index.length; i++) target.index.push(b.index[i] + base);
  for (let i = 0; i < b.occluder.length; i++) target.occluder.push(b.occluder[i]);
}

// Interior group: static shell, rigged controls/needles, gauge faces, horizon card, gauge glass.
export function assembleInterior(model, mats) {
  const it = model.interior;
  const group = new THREE.Group();
  group.name = 'seaplane.interior';
  const st = mesh(it.st.toGeometry(), mats.hard, { cast: false, name: 'interior.static' });
  const dyn = mesh(it.dyn.toGeometry(), mats.hard, { cast: false, name: 'interior.controls' });
  const gauges = mesh(it.gauge.toGeometry(), mats.gauges, { cast: false, name: 'interior.gauges' });
  const horizon = mesh(it.horizon.toGeometry(), mats.horizon, { cast: false, name: 'interior.horizon' });
  const glass = mesh(it.gglass.toGeometry(), mats.glass, { cast: false, name: 'interior.gaugeGlass' });
  glass.renderOrder = 2;
  for (const m of [dyn, gauges]) m.frustumCulled = false; // rigged vertices move
  group.add(st, dyn, gauges, horizon, glass);
  return { group, st, dyn, gauges, horizon, glass };
}
