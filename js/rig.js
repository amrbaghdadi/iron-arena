import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MOVES, POWERS } from './config.js?v=4';
import * as TX from './textures.js?v=4';
import { clamp, lerp, smooth, easeOut } from './utils.js?v=4';

/* ------------------------------------------------------------------
   Pose system. A pose = rotations (x,y,z in radians) for each joint.
   Animations are functions that return a pose; switching animation
   crossfades from the last pose. Joint/axis notes:
   the character faces +Z. Arm: shoulder.x negative = arm forward.
   Chest/hips y positive = right side forward (right-hand strikes).
------------------------------------------------------------------- */
const JOINTS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hpL', 'knL', 'hpR', 'knR'];
const mk = (base, o) => { const p = JSON.parse(JSON.stringify(base)); for (const k in o) p[k] = o[k]; return p; };
const GUARD = {
  body: [0, -0.04, 0], tilt: [0, 0, 0],
  hips: [0, -0.4, 0], spine: [0.12, 0.15, 0], chest: [0.05, 0.15, 0], head: [-0.1, 0.25, 0],
  shL: [-1.15, 0, 0.3], elL: [-2.0, 0, 0], shR: [-0.95, 0, -0.3], elR: [-2.25, 0, 0],
  hpL: [-0.35, 0, 0.1], knL: [0.5, 0, 0], hpR: [0.35, 0, -0.12], knR: [0.45, 0, 0]
};
function blend(a, b, t, out) {
  out = out || {};
  for (const k of ['body', 'tilt', ...JOINTS]) {
    const A = a[k], B = b[k]; const o = out[k] || (out[k] = [0, 0, 0]);
    o[0] = A[0] + (B[0] - A[0]) * t; o[1] = A[1] + (B[1] - A[1]) * t; o[2] = A[2] + (B[2] - A[2]) * t;
  }
  return out;
}
const clonePose = (p) => blend(p, p, 0, {});

// attack poses: W = wind-up, S = strike (overrides on GUARD)
const ATK = {
  jab: { W: mk(GUARD, { chest: [0.05, -0.15, 0], shR: [-1.0, 0, -0.5], elR: [-2.4, 0, 0] }),
         S: mk(GUARD, { body: [0, -0.04, 0.25], chest: [0.08, 0.5, 0], spine: [0.15, 0.4, 0], hips: [0, 0.0, 0], shR: [-1.57, 0, -0.05], elR: [-0.05, 0, 0] }) },
  cross: { W: mk(GUARD, { chest: [0.05, 0.35, 0], shL: [-1.1, 0, 0.45], elL: [-2.4, 0, 0] }),
           S: mk(GUARD, { body: [0, -0.04, 0.3], chest: [0.08, -0.6, 0], spine: [0.15, -0.4, 0], hips: [0, -0.7, 0], shL: [-1.57, 0, 0.05], elL: [-0.05, 0, 0] }) },
  hook: { W: mk(GUARD, { chest: [0.05, -0.5, 0], spine: [0.1, -0.3, 0], shR: [-1.3, 0, -1.2], elR: [-1.5, 0, 0] }),
          S: mk(GUARD, { body: [0, -0.06, 0.2], chest: [0.1, 0.9, 0], spine: [0.15, 0.5, 0], hips: [0, 0.2, 0], shR: [-1.45, 0, -0.9], elR: [-1.5, 0, 0] }) },
  uppercut: { W: mk(GUARD, { body: [0, -0.3, 0], chest: [0.15, 0.3, 0], shL: [-0.3, 0, 0.2], elL: [-1.3, 0, 0] }),
              S: mk(GUARD, { body: [0, 0.02, 0.25], chest: [-0.15, -0.45, 0], spine: [0, -0.3, 0], hips: [0, -0.5, 0], shL: [-2.2, 0, 0.1], elL: [-0.6, 0, 0], knL: [0.2, 0, 0] }) },
  kick: { W: mk(GUARD, { chest: [-0.1, 0.1, 0], hpR: [-0.3, 0, -0.05], knR: [1.4, 0, 0] }),
          S: mk(GUARD, { body: [0, -0.04, 0.1], spine: [-0.3, 0.1, 0], chest: [-0.1, 0, 0], hpR: [-1.55, 0, -0.05], knR: [0.02, 0, 0], hpL: [-0.05, 0, 0.05], knL: [0.2, 0, 0] }) },
  spinKick: { W: mk(GUARD, { chest: [0.1, -0.7, 0], spine: [0.2, -0.5, 0], hips: [0, -0.9, 0], hpR: [-0.3, 0, -0.1], knR: [1.2, 0, 0], shL: [-0.9, 0, 0.7], shR: [-0.9, 0, -0.7] }),
              S: mk(GUARD, { body: [0, -0.02, 0], spine: [-0.25, 0, 0], chest: [0, 0, 0], hips: [0, 0, 0], hpR: [-1.45, 0, -0.25], knR: [0.05, 0, 0], shL: [-0.5, 0, 1.2], shR: [-0.5, 0, -1.2], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0] }) },
  heavy: { W: mk(GUARD, { body: [0, -0.2, -0.1], chest: [-0.2, -0.6, 0], spine: [-0.05, -0.4, 0], shR: [0.9, 0, -0.5], elR: [-1.0, 0, 0] }),
           S: mk(GUARD, { body: [0, -0.1, 0.45], chest: [0.5, 0.8, 0], spine: [0.35, 0.5, 0], hips: [0, 0.3, 0], shR: [-1.5, 0, -0.2], elR: [-0.1, 0, 0], hpL: [-0.8, 0, 0.1], knL: [0.7, 0, 0] }) },
  special: { W: mk(GUARD, { body: [0, -0.42, -0.1], spine: [0.35, 0, 0], chest: [0.1, 0, 0], hips: [0, 0, 0], shL: [0.6, 0, 0.5], shR: [0.6, 0, -0.5], elL: [-1.4, 0, 0], elR: [-1.4, 0, 0], hpL: [-0.7, 0, 0.2], knL: [1.1, 0, 0], hpR: [0.5, 0, -0.2], knR: [0.9, 0, 0] }),
             S: mk(GUARD, { body: [0, -0.2, 0.6], tilt: [0.18, 0, 0], spine: [0.45, 0, 0], chest: [0.1, 0, 0], hips: [0, 0, 0], head: [-0.3, 0, 0], shL: [-1.6, 0, 0.12], shR: [-1.6, 0, -0.12], elL: [-0.05, 0, 0], elR: [-0.05, 0, 0], hpL: [-1.0, 0, 0.1], knL: [0.4, 0, 0], hpR: [0.8, 0, -0.1], knR: [0.5, 0, 0] }) }
};
ATK.fire = { W: mk(GUARD, { body: [0, -0.1, -0.1], chest: [0.05, -0.45, 0], spine: [0.1, -0.3, 0], shR: [0.7, 0, -0.5], elR: [-1.3, 0, 0], shL: [-1.2, 0, 0.3] }),
              S: mk(GUARD, { body: [0, -0.1, 0.25], chest: [0.1, 0.55, 0], spine: [0.2, 0.4, 0], hips: [0, 0.2, 0], shR: [-1.57, 0, -0.1], elR: [-0.05, 0, 0], shL: [0.5, 0, 0.7], elL: [-0.6, 0, 0], hpL: [-0.8, 0, 0.1], knL: [0.7, 0, 0] }) };
ATK.freeze = { W: mk(GUARD, { body: [0, -0.15, 0], spine: [0.25, 0, 0], hips: [0, 0, 0], chest: [0.1, 0, 0], shL: [-1.0, 0, -0.3], elL: [-2.3, 0, 0], shR: [-1.0, 0, 0.3], elR: [-2.3, 0, 0] }),
               S: mk(GUARD, { body: [0, -0.1, 0.2], spine: [-0.1, 0, 0], hips: [0, 0, 0], chest: [-0.05, 0, 0], head: [-0.25, 0, 0], shL: [-1.45, 0, 0.9], elL: [-0.15, 0, 0], shR: [-1.45, 0, -0.9], elR: [-0.15, 0, 0] }) };
ATK.shock = { W: mk(GUARD, { body: [0, 0.05, 0], spine: [-0.15, 0, 0], hips: [0, 0, 0], shL: [-2.8, 0, 0.3], shR: [-2.8, 0, -0.3], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0], hpL: [-0.1, 0, 0.1], knL: [0.2, 0, 0], hpR: [-0.1, 0, -0.1], knR: [0.2, 0, 0] }),
              S: mk(GUARD, { body: [0, -0.5, 0.1], spine: [0.6, 0, 0], hips: [0, 0, 0], chest: [0.2, 0, 0], head: [-0.2, 0, 0], shL: [-0.9, 0, 0.4], elL: [-0.2, 0, 0], shR: [-0.9, 0, -0.4], elR: [-0.2, 0, 0], hpL: [-1.1, 0, 0.3], knL: [1.7, 0, 0], hpR: [-1.1, 0, -0.3], knR: [1.7, 0, 0] }) };
ATK.lightning = { W: mk(GUARD, { body: [0, -0.3, 0], spine: [0.25, 0, 0], hips: [0, 0, 0], chest: [0.1, 0, 0], shL: [0.3, 0, 0.5], elL: [-1.2, 0, 0], shR: [0.3, 0, -0.5], elR: [-1.2, 0, 0], hpL: [-0.7, 0, 0.3], knL: [1.2, 0, 0], hpR: [-0.7, 0, -0.3], knR: [1.2, 0, 0] }),
                  S: mk(GUARD, { body: [0, 0.08, 0], spine: [-0.25, 0, 0], hips: [0, 0, 0], chest: [-0.15, 0, 0], head: [-0.7, 0, 0], shL: [-3.0, 0, 0.35], elL: [-0.1, 0, 0], shR: [-3.0, 0, -0.35], elR: [-0.1, 0, 0], hpL: [-0.1, 0, 0.25], knL: [0.1, 0, 0], hpR: [-0.1, 0, -0.25], knR: [0.1, 0, 0] }) };
const BLOCK = mk(GUARD, { body: [0, -0.16, 0], spine: [0.3, 0.05, 0], chest: [0.1, 0, 0], head: [-0.25, 0.1, 0], hips: [0, -0.3, 0],
  shL: [-1.4, 0, -0.35], elL: [-2.4, 0, 0], shR: [-1.45, 0, 0.3], elR: [-2.45, 0, 0], hpL: [-0.55, 0, 0.1], knL: [1.0, 0, 0], hpR: [0.3, 0, -0.1], knR: [0.8, 0, 0] });
const DASH = mk(GUARD, { body: [0, -0.2, 0.1], spine: [0.55, 0, 0], chest: [0.1, 0, 0], head: [-0.4, 0, 0], hips: [0, 0, 0], shL: [0.5, 0, 0.3], shR: [0.5, 0, -0.3], elL: [-0.5, 0, 0], elR: [-0.5, 0, 0], hpL: [-1.0, 0, 0.1], knL: [0.7, 0, 0], hpR: [0.6, 0, -0.1], knR: [0.9, 0, 0] });
const JUMP = mk(GUARD, { body: [0, 0, 0], spine: [0.1, 0, 0], hips: [0, 0, 0], shL: [-0.7, 0, 0.9], shR: [-0.7, 0, -0.9], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], hpL: [-0.9, 0, 0.1], knL: [1.3, 0, 0], hpR: [0.1, 0, -0.1], knR: [1.0, 0, 0] });
const LYING = mk(GUARD, { body: [0, -0.7, 0], tilt: [-1.5, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [0.2, 0, 0], shL: [0.2, 0, 0.8], shR: [0.2, 0, -0.8], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0], hpL: [0, 0, 0.2], knL: [0.2, 0, 0], hpR: [0, 0, -0.2], knR: [0.1, 0, 0] });
const CROUCH = mk(GUARD, { body: [0, -0.5, 0.1], spine: [0.5, 0, 0], hips: [0, 0, 0], hpL: [-1.2, 0, 0.1], knL: [1.8, 0, 0], hpR: [-0.9, 0, -0.1], knR: [1.7, 0, 0], shL: [-0.5, 0, 0.5], shR: [-0.5, 0, -0.5] });

const P = new Map(); // scratch pose
function attackPose(id, t) {
  const m = MOVES[id] || POWERS[id], a = ATK[id], out = P.get('atk') || (P.set('atk', {}), P.get('atk'));
  const s = m.startup, e = m.startup + m.active, hold = e + (m.dur - e) * 0.2;
  if (t < s * 0.6) blend(GUARD, a.W, smooth(t / (s * 0.6)), out);
  else if (t < s) blend(a.W, a.S, easeOut((t - s * 0.6) / (s * 0.4)), out);
  else if (t < hold) blend(a.S, a.S, 0, out);
  else blend(a.S, GUARD, smooth((t - hold) / (m.dur - hold)), out);
  if (m.spin) { // full body spin during the strike
    const k = clamp((t - s * 0.5) / (e - s * 0.5 + 0.1), 0, 1);
    out.tilt[1] = Math.PI * 2 * smooth(k);
  }
  return out;
}

function evalAnim(name, t, ctx) {
  const o = P.get('o') || (P.set('o', {}), P.get('o'));
  if (ATK[name]) return attackPose(name, t);
  switch (name) {
    case 'idle': {
      const s = Math.sin(t * 2.6);
      blend(GUARD, GUARD, 0, o); o.body[1] += s * 0.015; o.chest[0] += s * 0.02; o.shL[0] += s * 0.04; o.shR[0] -= s * 0.03; return o;
    }
    case 'walk': case 'run': {
      const run = name === 'run', sw = Math.sin(ctx.phase), sw2 = Math.sin(ctx.phase + Math.PI), amp = run ? 0.95 : 0.55;
      const base = run ? mk(GUARD, { spine: [0.35, 0, 0], chest: [0.05, 0, 0], head: [-0.25, 0, 0], hips: [0, 0, 0], shL: [-0.8, 0, 0.15], shR: [-0.8, 0, -0.15], elL: [-1.6, 0, 0], elR: [-1.6, 0, 0] }) : GUARD;
      blend(base, base, 0, o);
      const f = ctx.fwd; // +1 forward, -1 backward, 0 strafe
      o.hpL[0] = -0.2 - sw * amp * (f || 0.4); o.hpR[0] = -0.2 - sw2 * amp * (f || 0.4);
      o.hpL[2] += (1 - Math.abs(f)) * sw * 0.3; o.hpR[2] -= (1 - Math.abs(f)) * sw2 * 0.3;
      o.knL[0] = 0.35 + Math.max(0, sw) * amp * 1.2; o.knR[0] = 0.35 + Math.max(0, sw2) * amp * 1.2;
      if (run) { o.shL[0] += sw2 * 0.7; o.shR[0] += sw * 0.7; }
      o.body[1] += Math.abs(Math.cos(ctx.phase)) * 0.04 - 0.02; return o;
    }
    case 'jump': return JUMP;
    case 'block': { blend(BLOCK, BLOCK, 0, o); o.body[1] += Math.sin(t * 3) * 0.01; return o; }
    case 'dash': return DASH;
    case 'hit': {
      const k = Math.max(0, 1 - t / 0.32);
      blend(GUARD, mk(GUARD, { tilt: [-0.4, 0, 0], spine: [-0.35, 0, 0], head: [-0.7, 0, 0], shL: [-0.2, 0, 0.9], shR: [-0.2, 0, -0.9], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], body: [0, -0.1, -0.15] }), smooth(k) * 0.9, o); return o;
    }
    case 'knockdown': case 'death': {
      const k = easeOut(t / 0.45), bounce = t > 0.4 && t < 0.6 ? Math.sin((t - 0.4) / 0.2 * Math.PI) * 0.06 : 0;
      blend(mk(GUARD, { tilt: [-0.5, 0, 0], body: [0, -0.15, -0.3], spine: [-0.3, 0, 0], head: [-0.6, 0, 0], shL: [-0.1, 0, 1.0], shR: [-0.1, 0, -1.0] }), LYING, k, o);
      o.body[1] += bounce; if (name === 'knockdown' && t > 0.6) o.chest[0] += Math.sin(t * 5) * 0.015; return o;
    }
    case 'getup': {
      const k = clamp(t / ctx.dur, 0, 1);
      if (k < 0.45) blend(LYING, CROUCH, smooth(k / 0.45), o); else blend(CROUCH, GUARD, smooth((k - 0.45) / 0.55), o); return o;
    }
    case 'victory': {
      const b = Math.abs(Math.sin(t * 4)) * 0.1;
      blend(GUARD, mk(GUARD, { body: [0, -0.04 + b, 0], spine: [-0.1, 0, 0], chest: [-0.1, 0, 0], head: [-0.3, 0, 0], hips: [0, 0, 0], shL: [-2.7, 0, 0.35], shR: [-2.7, 0, -0.35], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0], hpL: [-0.1, 0, 0.15], knL: [0.2, 0, 0], hpR: [-0.1, 0, -0.15], knR: [0.2, 0, 0] }), smooth(t / 0.4), o); return o;
    }
  }
  return GUARD;
}

/* ------------------------------------------------------------------
   Procedural fighter built from capsules on a joint hierarchy
------------------------------------------------------------------- */
export class ProceduralModel {
  constructor(theme) {
    this.root = new THREE.Group();
    this.anim = 'idle'; this.t = 0; this.phase = 0; this.fade = 0.12; this.fadeT = 1;
    this.last = clonePose(GUARD); this.from = clonePose(GUARD); this.cur = clonePose(GUARD);
    this.ctx = { phase: 0, fwd: 1, dur: 1 };
    this.mats = [];
    const T = getCharTex(theme);
    const reg = (m) => { this.mats.push(m); return m; };
    const std = (o) => reg(new THREE.MeshStandardMaterial(o));
    const phys = (o) => reg(new THREE.MeshPhysicalMaterial(o));
    const skin = std({ map: T.skin.map, normalMap: T.skin.normalMap, roughnessMap: T.skin.roughnessMap, roughness: 1, color: 0xffffff });
    const cloth = std({ map: T.cloth.map, normalMap: T.cloth.normalMap, roughnessMap: T.cloth.roughnessMap, roughness: 1, color: 0xffffff });
    const pants = std({ map: T.pants.map, normalMap: T.pants.normalMap, roughnessMap: T.pants.roughnessMap, roughness: 1, color: 0xffffff });
    const leatherM = std({ map: T.leather.map, normalMap: T.leather.normalMap, roughnessMap: T.leather.roughnessMap, roughness: 1, color: 0xffffff });
    const armor = phys({ map: T.metal.map, normalMap: T.metal.normalMap, roughnessMap: T.metal.roughnessMap, roughness: 1, metalness: 0.92, clearcoat: 0.35, clearcoatRoughness: 0.35, color: theme.armor });
    const trim = phys({ roughness: 0.28, metalness: 1, color: theme.trim, clearcoat: 0.5 });
    const glove = std({ map: T.leather.map, normalMap: T.leather.normalMap, roughness: 0.6, color: theme.glove });
    const capeM = std({ map: T.cape.map, normalMap: T.cape.normalMap, roughnessMap: T.cape.roughnessMap, roughness: 1, side: THREE.DoubleSide, color: 0xffffff });
    const hairM = std({ color: theme.hair, roughness: 0.9 });
    const mesh = (geo, m) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; x.receiveShadow = true; return x; };
    const cap = (r, len, m, y) => { const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14); g.translate(0, y, 0); return mesh(g, m); };
    const J = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const add = (parent, m, x, y, z, sx = 1, sy = 1, sz = 1) => { m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
    const body = this.body = J(this.root, 0, 0.88, 0);
    const j = this.j = {};
    j.hips = J(body, 0, 0, 0);
    add(j.hips, mesh(new THREE.SphereGeometry(0.16, 16, 12), pants), 0, 0, 0, 1.05, 0.7, 0.8);
    add(j.hips, mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20), leatherM), 0, 0.1, 0, 1, 1, 0.8);
    add(j.hips, mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), trim), 0, 0.1, 0.14);          // buckle
    for (const x of [-0.11, 0, 0.11]) { const p = add(j.hips, mesh(new THREE.BoxGeometry(0.09, 0.2, 0.015), armor), x, -0.1, 0.14); p.rotation.x = -0.12; } // tassets
    j.spine = J(j.hips, 0, 0.08, 0);
    const abd = cap(0.15, 0.3, cloth, 0.12); abd.scale.z = 0.8; j.spine.add(abd);
    j.chest = J(j.spine, 0, 0.26, 0);
    const ch = cap(0.19, 0.34, cloth, 0.1); ch.scale.set(1.1, 1, 0.78); j.chest.add(ch);
    // chest plate + gorget (armor)
    const plate = mesh(new THREE.SphereGeometry(0.205, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), armor); add(j.chest, plate, 0, 0.1, 0.03, 1.12, 1.0, 0.72);
    const ridge = mesh(new THREE.TorusGeometry(0.17, 0.014, 8, 28, Math.PI), trim); add(j.chest, ridge, 0, 0.22, 0.1, 1, 1, 0.6); ridge.rotation.z = Math.PI;
    add(j.chest, mesh(new THREE.TorusGeometry(0.13, 0.025, 10, 24), trim), 0, 0.34, 0, 1, 1, 0.8).rotation.x = Math.PI / 2;
    // emblem rune glows (emissive accent)
    const rune = new THREE.Mesh(new THREE.CircleGeometry(0.035, 6), new THREE.MeshBasicMaterial({ color: theme.rune, toneMapped: false })); rune.position.set(0, 0.12, 0.172); rune.scale.set(1, 1.2, 1); j.chest.add(rune); this.rune = rune;
    j.head = J(j.chest, 0, 0.36, 0);
    j.head.add(cap(0.05, 0.12, skin, 0.03));
    const hd = mesh(new THREE.SphereGeometry(0.125, 24, 18), skin); add(j.head, hd, 0, 0.14, 0, 0.95, 1.08, 1);
    const eyeM = theme.eyeGlow ? new THREE.MeshBasicMaterial({ color: theme.eyeGlow, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const s of [-1, 1]) add(j.head, new THREE.Mesh(new THREE.SphereGeometry(theme.eyeGlow ? 0.019 : 0.014, 8, 8), eyeM), s * 0.045, 0.15, 0.113);
    // helmet
    const helm = mesh(new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), armor); add(j.head, helm, 0, 0.158, -0.005, 1, 1.05, 1.02);
    add(j.head, mesh(new THREE.TorusGeometry(0.136, 0.012, 8, 28), trim), 0, 0.166, -0.005, 1, 1, 1).rotation.x = Math.PI / 2;
    add(j.head, mesh(new THREE.BoxGeometry(0.02, 0.1, 0.012), armor), 0, 0.15, 0.135);    // nose guard
    for (const s of [-1, 1]) { const ch2 = add(j.head, mesh(new THREE.BoxGeometry(0.014, 0.1, 0.075), armor), s * 0.12, 0.1, 0.03); ch2.rotation.y = s * 0.15; }
    if (theme.helm === 'knight') {
      const crest = mesh(new THREE.BoxGeometry(0.018, 0.075, 0.24), mat2(theme.plume)); crest.position.set(0, 0.3, -0.03); j.head.add(crest);
      const crest2 = mesh(new THREE.ConeGeometry(0.03, 0.12, 8), mat2(theme.plume)); crest2.position.set(0, 0.28, -0.17); crest2.rotation.x = -1.6; j.head.add(crest2);
    } else {
      for (const s of [-1, 1]) { const horn = mesh(new THREE.ConeGeometry(0.03, 0.22, 10), mat2(0xe8dcc0)); horn.position.set(s * 0.12, 0.27, 0); horn.rotation.z = -s * 0.7; horn.rotation.x = -0.15; j.head.add(horn); }
      add(j.head, mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), mat2(0x101014)), 0, 0.075, 0.115); // face mask
    }
    function mat2(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2 }); }
    const arm = (side) => {
      const S = side === 'L' ? 1 : -1;
      const sh = j['sh' + side] = J(j.chest, S * 0.25, 0.27, 0);
      sh.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), cloth));
      const pauld = mesh(new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), armor); add(sh, pauld, S * 0.02, 0.025, 0, 1.15, 0.8, 1.15); pauld.rotation.z = -S * 0.35;
      add(sh, mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 20), trim), S * 0.02, 0.0, 0, 1, 1, 1).rotation.x = Math.PI / 2;
      if (theme.helm !== 'knight') { const spike = mesh(new THREE.ConeGeometry(0.025, 0.12, 8), armor); add(sh, spike, S * 0.07, 0.11, 0); spike.rotation.z = -S * 0.5; }
      sh.add(cap(0.055, 0.3, cloth, -0.14));
      const el = j['el' + side] = J(sh, 0, -0.29, 0);
      el.add(cap(0.048, 0.28, skin, -0.13));
      add(el, mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.17, 14), armor), 0, -0.17, 0);       // bracer
      add(el, mesh(new THREE.TorusGeometry(0.06, 0.01, 8, 18), trim), 0, -0.09, 0, 1, 1, 1).rotation.x = Math.PI / 2;
      const wrist = J(el, 0, -0.27, 0);
      const gl = mesh(new THREE.SphereGeometry(0.075, 16, 12), glove); add(wrist, gl, 0, 0, 0, 1, 1.1, 1.1);
      add(wrist, mesh(new THREE.BoxGeometry(0.1, 0.03, 0.09), trim), 0, 0.02, 0.01);              // knuckle plate
      j['hand' + side] = J(wrist, 0, -0.04, 0);
    };
    arm('L'); arm('R');
    const leg = (side) => {
      const S = side === 'L' ? 1 : -1;
      const hp = j['hp' + side] = J(j.hips, S * 0.1, -0.03, 0);
      hp.add(cap(0.09, 0.44, pants, -0.21));
      const kn = j['kn' + side] = J(hp, 0, -0.43, 0);
      add(kn, mesh(new THREE.SphereGeometry(0.082, 14, 10), armor), 0, 0, 0.04, 1, 1, 0.9);       // knee guard
      kn.add(cap(0.07, 0.44, pants, -0.21));
      add(kn, mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.26, 14), armor), 0, -0.22, 0.005);   // greave
      const boot = mesh(new THREE.BoxGeometry(0.115, 0.09, 0.27), leatherM); add(kn, boot, 0, -0.43, 0.05);
      j['foot' + side] = J(kn, 0, -0.42, 0.09);
    };
    leg('L'); leg('R');
    // weapon on the back (separate meshes attached to the chest bone)
    const wp = J(j.chest, 0, 0.12, -0.2); wp.rotation.z = theme.helm === 'knight' ? 0.7 : -0.7; wp.rotation.y = 0;
    if (theme.helm === 'knight') {
      add(wp, mesh(new THREE.BoxGeometry(0.055, 0.95, 0.014), armor), 0, 0.2, 0);                 // blade
      add(wp, mesh(new THREE.BoxGeometry(0.22, 0.03, 0.03), trim), 0, -0.28, 0);                  // guard
      add(wp, mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10), leatherM), 0, -0.4, 0);     // grip
      add(wp, mesh(new THREE.SphereGeometry(0.03, 10, 8), trim), 0, -0.52, 0);                    // pommel
    } else {
      add(wp, mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 10), leatherM), 0, 0.1, 0);      // shaft
      for (const s of [-1, 1]) { const b = mesh(new THREE.CylinderGeometry(0.0, 0.17, 0.05, 3, 1), armor); b.position.set(s * 0.12, 0.55, 0); b.rotation.z = -s * Math.PI / 2; b.scale.set(1, 1, 1.0); wp.add(b); }
      add(wp, mesh(new THREE.ConeGeometry(0.03, 0.14, 8), trim), 0, 0.68, 0);
    }
    // cape: chain of 5 hanging segments with spring motion
    this.cape = []; this.capeA = [0.12, 0.12, 0.12, 0.12, 0.12];
    let parent = J(j.chest, 0, 0.3, -0.17);
    for (let i = 0; i < 5; i++) {
      const w = 0.36 + i * 0.04, seg = mesh(new THREE.BoxGeometry(w, 0.17, 0.012, 4, 1, 1), capeM); seg.position.y = -0.085; parent.add(seg);
      const next = J(parent, 0, -0.17, 0); this.cape.push(parent); parent = next;
    }
    this.hurt = { chest: j.chest, head: j.head, hips: j.hips };
    this._v = new THREE.Vector3(); this.glowK = 0; this.baseRune = new THREE.Color(theme.rune);
  }
  setAnim(name, o = {}) {
    if (name === this.anim && !o.restart) return;
    this.from = clonePose(this.last); this.anim = name; this.t = 0; this.fade = o.fade ?? 0.12; this.fadeT = 0; this.ctx.dur = o.dur || 1;
  }
  update(dt, c) {
    this.t += dt; this.fadeT += dt;
    this.ctx.fwd = c.fwd; this.phase += dt * c.speed * (this.anim === 'run' ? 2.1 : 3.4); this.ctx.phase = this.phase;
    const target = evalAnim(this.anim, this.t, this.ctx);
    const k = this.fade <= 0 ? 1 : smooth(this.fadeT / this.fade);
    blend(this.from, target, k, this.cur);
    this.last = clonePose(this.cur);
    this.apply(this.cur);
    this.updateCape(dt, c);
    if (c.grounded) { // keep the lowest body part on the floor
      this.root.updateMatrixWorld(true);
      let min = 99; const v = this._v;
      const test = (o, off, dy = 0) => { o.getWorldPosition(v); min = Math.min(min, v.y - off + dy); };
      test(this.j.footL, 0.06, -0.05); test(this.j.footR, 0.06, -0.05); test(this.j.hips, 0.12); test(this.j.head, 0.0, 0.0);
      test(this.j.handL, 0.08); test(this.j.handR, 0.08); test(this.j.chest, 0.18);
      const ry = this.root.position.y;
      this.body.position.y -= (min - ry);
    }
  }
  updateCape(dt, c) {
    const sp = Math.min(1, (c.vspeed ?? c.speed) / 6.5), lying = this.anim === 'knockdown' || this.anim === 'death' || this.anim === 'getup';
    let prev = 0;
    for (let i = 0; i < this.cape.length; i++) {
      const tgt = lying ? 0.05 : 0.1 + i * 0.06 + sp * (0.45 + i * 0.28) + Math.sin(this.t * 5 + i * 0.9) * 0.04 * (0.4 + sp);
      this.capeA[i] += (tgt - this.capeA[i]) * (1 - Math.exp(-(10 - i * 1.4) * dt));
      this.cape[i].rotation.x = this.capeA[i] - prev; prev = this.capeA[i];
      this.cape[i].rotation.z = Math.sin(this.t * 3.1 + i) * 0.03 * sp;
    }
  }
  apply(p) {
    this.body.position.set(p.body[0], 0.88 + p.body[1], p.body[2]);
    this.body.rotation.set(p.tilt[0], p.tilt[1], p.tilt[2]);
    for (const n of JOINTS) this.j[n].rotation.set(p[n][0], p[n][1], p[n][2]);
  }
  point(name, out) { return this.pointObj(name).getWorldPosition(out); }
  pointObj(name) {
    const j = this.j;
    return { handR: j.handR, handL: j.handL, footR: j.footR, footL: j.footL, chest: j.chest, head: j.head, hips: j.hips }[name];
  }
  chestPoint(out) { this.j.chest.getWorldPosition(out); out.y += 0.1; return out; }
  setGlow(color, k) {
    if (k === this.glowK && k === 0) return; this.glowK = k;
    for (const m of this.mats) { m.emissive.set(color); m.emissiveIntensity = k; }
    this.rune.material.color.copy(this.baseRune).multiplyScalar(1 + k * 3);
  }
  tint() { }
}

/* ------------------------------------------------------------------
   Optional GLB model (assets/characterRIGGED.glb). Uses embedded
   animation clips matched by name; falls back to idle for the rest.
------------------------------------------------------------------- */
const CLIP_MATCH = {
  idle: /idle|stand|breath/i, walk: /walk/i, run: /run|sprint/i, jump: /jump|fall/i, block: /block|guard|defen/i, dash: /dash|dodge|roll|slide/i,
  hit: /hit|react|damage|impact/i, knockdown: /knock|fall|down|lie/i, death: /death|die|dead/i, getup: /get.?up|stand.?up|rise/i, victory: /victory|win|cheer|celebrat/i,
  jab: /punch|jab/i, cross: /cross|punch/i, hook: /hook|punch/i, uppercut: /upper|punch/i, kick: /kick/i, spinKick: /spin|round|kick/i, heavy: /heavy|power|punch/i, special: /special|ultimate|super|combo/i
};
export class GLBModel {
  constructor(gltf, tintColor, height) {
    this.root = new THREE.Group();
    const model = SkeletonUtils.clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(model); const size = box.getSize(new THREE.Vector3());
    const s = height / (size.y || 1); model.scale.setScalar(s);
    box.setFromObject(model); model.position.y = -box.min.y;
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.material = o.material.clone(); if (tintColor) { o.material.color.lerp(new THREE.Color(tintColor), 0.45); } } });
    this.root.add(model); this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = gltf.animations || []; this.actions = {}; this.cur = null; this.anim = 'idle';
    this.bones = {}; model.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.body = this.root; this.tiltRoot = model;
    this.t = 0;
  }
  clipFor(name) {
    if (this.actions[name] !== undefined) return this.actions[name];
    const re = CLIP_MATCH[name]; const c = re && this.clips.find(c => re.test(c.name));
    return (this.actions[name] = c ? this.mixer.clipAction(c) : null);
  }
  setAnim(name, o = {}) {
    if (name === this.anim && !o.restart) return;
    this.anim = name; this.t = 0;
    let a = this.clipFor(name) || this.clipFor('idle'); if (!a) return;
    const loopers = ['idle', 'walk', 'run', 'block'];
    a.reset(); a.setLoop(loopers.includes(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true;
    if (o.dur && !loopers.includes(name)) a.setEffectiveTimeScale(Math.max(0.4, a.getClip().duration / o.dur));
    else a.setEffectiveTimeScale(1);
    if (this.cur && this.cur !== a) a.crossFadeFrom(this.cur, o.fade ?? 0.15, false);
    a.play(); this.cur = a;
  }
  update(dt, c) {
    this.t += dt; this.mixer.update(dt);
    const lying = this.anim === 'knockdown' || this.anim === 'death';
    if (!this.clipFor(this.anim)) { this.model.rotation.x = lying ? -1.4 : 0; this.model.position.y = lying ? 0.2 : this.model.position.y; }
  }
  setGlow(color, k) { this.model.traverse(o => { if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.set(color); o.material.emissiveIntensity = k; } }); }
  find(re) { return Object.values(this.bones).find(b => re.test(b.name)); }
  pointObj(name) {
    const map = { handR: /right.*hand$|hand.?r$|hand_r|righthand$/i, handL: /left.*hand$|hand.?l$|hand_l|lefthand$/i, footR: /right.*foot$|foot.?r$|righttoe|rightfoot/i, footL: /left.*foot$|foot.?l$|lefttoe|leftfoot/i, chest: /spine2|chest|spine1/i, head: /head$/i, hips: /hips|pelvis/i };
    return this.find(map[name]) || this.root;
  }
  point(name, out) { return this.pointObj(name).getWorldPosition(out); }
  chestPoint(out) { this.pointObj('chest').getWorldPosition(out); return out; }
}

export async function loadCharacterAsset(url, onProgress) {
  return new Promise((resolve) => {
    new GLTFLoader().load(url, (g) => resolve({ gltf: g }), (e) => { if (e.total) onProgress && onProgress(e.loaded / e.total); },
      (err) => resolve({ error: err }));
  });
}

const CHAR_TEX = {};
function getCharTex(theme) {
  if (CHAR_TEX[theme.id]) return CHAR_TEX[theme.id];
  return (CHAR_TEX[theme.id] = {
    skin: TX.skinTex(theme.skinHex), cloth: TX.clothWeave(theme.clothHex, 256, [3, 3]), pants: TX.clothWeave(theme.pantsHex, 256, [3, 3]),
    leather: TX.leather(theme.leatherHex, 256, [2, 2]), metal: TX.brushedMetal(theme.metalHex, 256, [2, 2]), cape: TX.clothWeave(theme.capeHex, 256, [2, 2])
  });
}
export function createModel(asset, who, height) {
  const themes = {
    player: { id: 'p1', skinHex: '#c58c64', clothHex: '#1f4c94', pantsHex: '#1a1d29', leatherHex: '#4a3220', metalHex: '#b9bec6', capeHex: '#a31f2a', armor: 0xdfe3ea, trim: 0xe0b341, glove: 0x8a2a22, hair: 0x15110e, rune: 0x66ccff, helm: 'knight', plume: 0xb02030 },
    enemy:  { id: 'p2', skinHex: '#9d6a48', clothHex: '#6a1616', pantsHex: '#1b1417', leatherHex: '#2a2018', metalHex: '#5d6068', capeHex: '#241a2a', armor: 0x6f737c, trim: 0x31d6c9, glove: 0x1a1a1a, hair: 0x2b1b12, rune: 0xff6a3a, helm: 'horned', eyeGlow: 0x38ffe6 }
  };
  if (asset && asset.gltf) return new GLBModel(asset.gltf, who === 'player' ? 0x3a78d0 : 0xd04040, height);
  return new ProceduralModel(themes[who]);
}
