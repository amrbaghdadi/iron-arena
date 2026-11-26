import * as THREE from 'three';
import { CONFIG, POWERS, POWER_IDS } from './config.js?v=4';
import { clamp, rand } from './utils.js?v=4';

/* Special powers: lightning (ultimate), fire, freeze, shockwave.
   To change strength / cost / cooldown edit POWERS and MANA in js/config.js (no code needed).
   A fixed pool of 3 point lights is used on purpose: changing the light count makes the GPU recompile shaders (a stutter). */
const C = { lightning: new THREE.Color('#9bd0ff'), fire: new THREE.Color('#ff7a2a'), freeze: new THREE.Color('#7ad8ff'), shock: new THREE.Color('#e8c56a') };

export class Powers {
  constructor(game) {
    this.game = game; this.fx_ = []; this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 14, 2); l.position.set(0, -50, 0); game.scene.add(l); this.lights.push({ l, busy: false, base: 0, color: new THREE.Color() }); }
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.mat = {
      core: (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
      glow: (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    };
  }
  grabLight(color, intensity) { const L = this.lights.find(x => !x.busy); if (!L) return null; L.busy = true; L.color.set(color); L.l.color.copy(L.color); L.l.intensity = L.base = intensity; return L; }
  freeLight(L) { if (!L) return; L.busy = false; L.l.intensity = 0; L.l.position.y = -50; }
  reset() {
    for (const e of this.fx_) e.kill && e.kill(); this.fx_.length = 0;
    for (const L of this.lights) this.freeLight(L);
    for (const f of [this.game.player, this.game.ai, this.game.p2]) { this.clearStatus(f); }
    if (this.game.arena.mood) this.game.arena.mood(0);
  }
  clearStatus(f) { if (!f) return; f.burnT = 0; f.slowT = 0; f.frozenT = 0; f.castId = null; this.removeIce(f); f.model.setGlow && f.model.setGlow(0xffffff, 0); }
  removeIce(f) { if (f.iceMesh) { f.root.remove(f.iceMesh); f.iceMesh.geometry.dispose(); f.iceMesh = null; } }

  /* ---------- casting ---------- */
  cast(f, id) {
    const def = POWERS[id], g = this.game;
    if (!f.canAct || !f.onGround) return false;
    if (id === 'lightning') { if (f.special < CONFIG.specialMax) { g.ui.flashAbility(f, id, 'Lightning needs a FULL gold bar'); return false; } f.special = 0; }
    else {
      if (f.cd[id] > 0) { g.ui.flashAbility(f, id, def.label + ' cooldown ' + Math.ceil(f.cd[id]) + 's'); return false; }
      if (f.mana < def.cost) { g.ui.flashMana(f); g.ui.flashAbility(f, id, 'Not enough mana (' + def.cost + ')'); return false; }
      f.mana -= def.cost; f.cd[id] = def.cooldown; f.cdMax[id] = def.cooldown;
    }
    f.castId = id; f.castDef = def; f.castT = 0; f.castRel = false; f.move = null; f.moveId = null; f.vel.set(0, 0, 0); f.comboIdx = 0;
    f.enter('cast', id, { fade: 0.08, dur: def.dur });
    g.audio.cast(id);
    if (id === 'lightning') { f.lockPos = f.lockPos || new THREE.Vector3(); f.lockFixed = false; this.startCharge(f); }
    if (g.onSwing) g.onSwing(f, id);
    return true;
  }
  /* called from the fighter each frame while casting */
  castTick(f, dt, opp) {
    f.castT += dt; const d = f.castDef;
    if (!f.castRel && f.castT >= d.startup) { f.castRel = true; this.release(f, f.castId, opp); }
  }
  castEnd(f) { if (f.castId === 'lightning') { f.model.setGlow && f.model.setGlow(0xffffff, 0); } f.castId = null; f.castDef = null; }

  release(f, id, opp) {
    const g = this.game, def = POWERS[id], from = f.model.point('handR', new THREE.Vector3());
    const aim = opp.model.chestPoint(new THREE.Vector3());
    if (id === 'lightning') return this.strike(f, opp);
    const dir = aim.clone().sub(from); dir.y *= 0.0; dir.normalize(); if (dir.lengthSq() < 0.1) dir.copy(f.forward);
    const start = from.clone(); start.y = Math.max(start.y, 1.15); start.addScaledVector(dir, 0.4);
    g.cam.shake(0.08); g.rumble(f, 0.3, 0.6, 140);
    if (id === 'shock') return this.shockwave(f, opp, def);
    this.projectile(f, id, def, start, dir);
  }

  projectile(f, id, def, pos, dir) {
    const g = this.game, col = C[id], grp = new THREE.Group();
    const core = new THREE.Mesh(id === 'fire' ? new THREE.SphereGeometry(def.radius * 0.6, 14, 10) : new THREE.OctahedronGeometry(def.radius * 0.7, 0), this.mat.core(id === 'fire' ? 0xffd27a : 0xe8fbff));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 1.4, 14, 10), this.mat.glow(col, 0.45));
    grp.add(core, halo); grp.position.copy(pos); g.scene.add(grp);
    const L = this.grabLight(col, id === 'fire' ? 26 : 18);
    const e = { type: id, owner: f, pos: grp.position, dir: dir.clone(), t: 0, grp, L, def, dead: false,
      update: (dt) => {
        e.t += dt; grp.position.addScaledVector(e.dir, def.speed * dt); const s = 1 + Math.sin(e.t * 30) * 0.12; halo.scale.setScalar(s); core.rotation.x += dt * 8; core.rotation.y += dt * 6;
        if (L) L.l.position.copy(grp.position);
        if (id === 'fire') { g.fx.flame(grp.position); g.fx.flame(grp.position); g.fx.add.emit([grp.position.x, grp.position.y, grp.position.z], [rand(-1, 1), rand(-1, 1), rand(-1, 1)], g.fx.cHot, rand(0.12, 0.25), 0.3, 0, 0.9); }
        else g.fx.add.emit([grp.position.x + rand(-.1, .1), grp.position.y + rand(-.1, .1), grp.position.z], [rand(-1, 1), rand(-1, 1), rand(-1, 1)], g.fx.cBlock, rand(0.1, 0.2), 0.35, 0, 0.9);
        const tgt = e.owner === g.player ? g.enemy : (e.owner === g.enemy ? g.player : g.player);
        const c = tgt.model.chestPoint(this._b);
        if (g.state === 'fight' && c.distanceTo(grp.position) < def.radius + 0.42) { if (this.onProjectileHit(e, tgt)) e.dead = true; else if (tgt.invuln <= 0) { } }
        if (e.t > def.life || Math.abs(grp.position.x) > 40 || Math.abs(grp.position.z) > 40) e.dead = true;
        return !e.dead;
      },
      kill: () => { g.scene.remove(grp); grp.traverse(o => o.geometry && o.geometry.dispose()); this.freeLight(L); }
    };
    this.fx_.push(e);
  }
  onProjectileHit(e, def_) {
    const g = this.game, f = e.owner, d = e.def, id = e.type, pos = e.pos;
    const res = this.resolve(f, def_, { dir: e.dir, kind: id });
    if (res.miss) return false;
    const guarded = res.guarded;
    if (id === 'fire') {
      let dmg = def_.hp * d.currentFraction; if (guarded) dmg /= d.blockDivisor;
      this.damage(f, def_, dmg, { dir: e.dir, kb: d.kb, knock: !guarded, hop: 3.5, guarded, text: guarded ? 'BLOCKED' : 'FIREBALL -' + Math.round(dmg), color: '#ff8a3a' });
      if (!guarded && !def_.dead) { def_.burnT = d.burnTime; def_.burnDps = d.burnDps; def_.burnSrc = f; }
      g.fx.burst(pos, g.fx.cFlame, 50); g.fx.sparks(pos, e.dir, 30, 1.6, g.fx.cFlame); g.audio.boom(0.7); g.cam.shake(guarded ? 0.15 : 0.35); g.post.flash = Math.max(g.post.flash, 0.15); g.post.ca = 0.7;
      const L = this.grabLight('#ff7a2a', 40); if (L) { L.l.position.copy(pos); this.fx_.push(this.lightFade(L, 0.35)); }
    } else {
      this.damage(f, def_, d.dmg, { dir: e.dir, kb: 1, stun: 0.3, guarded, noReact: !guarded, text: guarded ? 'BLOCKED' : 'FROZEN', color: '#8fe' });
      if (!guarded && !def_.dead) { def_.frozenT = d.freezeTime; def_.slowT = d.slowTime; def_.enter('hit', 'hit', { fade: 0.03 }); def_.vel.set(0, 0, 0); def_.stun = 99; this.makeIce(def_); g.audio.freeze(); }
      g.fx.sparks(pos, e.dir, 30, 1.2, g.fx.cBlock); g.cam.shake(0.18);
    }
    return true;
  }
  lightFade(L, t) { const e = { t: 0, update: (dt) => { e.t += dt; L.l.intensity = L.base * Math.max(0, 1 - e.t / t); return e.t < t; }, kill: () => this.freeLight(L) }; return e; }
  makeIce(f) {
    this.removeIce(f);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshStandardMaterial({ color: 0x9fe6ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, emissive: 0x2288cc, emissiveIntensity: 0.6, flatShading: true }));
    m.position.y = 0.9; m.scale.set(1, 1.35, 1); f.root.add(m); f.iceMesh = m;
  }

  shockwave(f, opp, def) {
    const g = this.game, col = C.shock, org = f.pos.clone(); org.y = 0.05;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), this.mat.glow(col, 0.9)); ring.rotation.x = -Math.PI / 2; ring.position.copy(org); g.scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 64), this.mat.glow(0xffffff, 0.35)); ring2.rotation.x = -Math.PI / 2; ring2.position.copy(org); g.scene.add(ring2);
    const L = this.grabLight(col, 22); if (L) L.l.position.set(org.x, 0.6, org.z);
    g.audio.boom(1); g.cam.shake(0.35); g.post.ca = 0.6; g.fx.burst(org, g.fx.cDust, 40); g.fx.dustPuff(org, 20, 4);
    const e = { type: 'shock', owner: f, r: 0.5, org, hit: false, def, dead: false,
      update: (dt) => {
        e.r += def.speed * dt; ring.scale.setScalar(e.r); ring2.scale.setScalar(e.r * 0.85);
        ring.material.opacity = 0.9 * (1 - e.r / def.maxRadius); ring2.material.opacity = 0.35 * (1 - e.r / def.maxRadius);
        if (L) L.l.intensity = L.base * (1 - e.r / def.maxRadius);
        for (let i = 0; i < 4; i++) { const a = Math.random() * 6.283; g.fx.dustPuff({ x: org.x + Math.cos(a) * e.r, z: org.z + Math.sin(a) * e.r }, 1, 1.2); }
        const tgt = opp;
        if (!e.hit && g.state === 'fight') {
          const dx = tgt.pos.x - org.x, dz = tgt.pos.z - org.z, dist = Math.hypot(dx, dz);
          if (dist < e.r + 0.4 && tgt.pos.y < 0.55) {
            e.hit = true; const dir = new THREE.Vector3(dx, 0, dz).normalize();
            const res = this.resolve(f, tgt, { dir, kind: 'shock' });
            if (!res.miss) { this.damage(f, tgt, def.dmg * (res.guarded ? def.blockMult : 1), { dir, kb: def.kb * (res.guarded ? 0.5 : 1), knock: !res.guarded, hop: 4.5, guarded: res.guarded, text: res.guarded ? 'BLOCKED' : 'SHOCKWAVE', color: '#ecc' }); g.fx.sparks(tgt.pos.clone().setY(0.6), dir, 24, 1.4); }
          }
        }
        if (e.r > def.maxRadius) e.dead = true; return !e.dead;
      },
      kill: () => { g.scene.remove(ring); g.scene.remove(ring2); ring.geometry.dispose(); ring2.geometry.dispose(); this.freeLight(L); }
    };
    this.fx_.push(e);
  }

  /* ---------- lightning ultimate ---------- */
  startCharge(f) {
    const L = this.grabLight('#9bd0ff', 6); const g = this.game;
    const mk = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.2, 48), this.mat.glow(0xaad4ff, 0.7)); mk.rotation.x = -Math.PI / 2; mk.visible = false; g.scene.add(mk);
    const mk2 = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), this.mat.glow(0x6aa8ff, 0.18)); mk2.rotation.x = -Math.PI / 2; mk2.visible = false; g.scene.add(mk2);
    const e = { type: 'charge', owner: f, L, dead: false, t: 0,
      update: (dt) => {
        e.t += dt;
        if (!f.castId || f.castId !== 'lightning' || f.castRel || f.dead) { e.dead = true; return false; }
        const opp = f === g.player ? g.enemy : g.player; const k = clamp(f.castT / f.castDef.startup, 0, 1);
        f.model.setGlow && f.model.setGlow(0x66b0ff, 0.3 + 0.9 * k + Math.random() * 0.4);
        if (L) { f.model.chestPoint(L.l.position); L.l.position.y += 0.3; L.l.intensity = L.base * (1 + 6 * k) * (0.5 + Math.random() * 0.9); }
        const c = f.model.chestPoint(this._a);
        for (let i = 0; i < 3; i++) g.fx.add.emit([c.x + rand(-.4, .4), c.y + rand(-.8, .6), c.z + rand(-.4, .4)], [rand(-2, 2), rand(1, 5), rand(-2, 2)], Math.random() < 0.5 ? g.fx.cBlock : g.fx.cHot, rand(0.06, 0.14), 0.3, 0, 0.9);
        if (Math.random() < 0.5 + k * 0.5) this.arc(c, 0.9 + k, k);
        if (g.arena.mood) g.arena.mood(k);
        if (f.castT >= f.castDef.lockAt && !f.lockFixed) { f.lockFixed = true; f.lockPos.copy(opp.pos); f.lockPos.y = 0; g.audio.thunder(0.3); }
        if (!f.lockFixed) { f.lockPos.copy(opp.pos); f.lockPos.y = 0; }
        mk.visible = mk2.visible = k > 0.25; mk.position.copy(f.lockPos); mk.position.y = 0.06; mk2.position.copy(mk.position); mk2.position.y = 0.05;
        const pulse = f.lockFixed ? 0.6 + 0.4 * Math.sin(e.t * 40) : 0.5; mk.material.opacity = 0.35 + pulse * 0.5; mk.scale.setScalar(f.lockFixed ? 1 - (f.castT - f.castDef.lockAt) / (f.castDef.startup - f.castDef.lockAt) * 0.25 : 1.15);
        return true;
      },
      kill: () => { g.scene.remove(mk); g.scene.remove(mk2); mk.geometry.dispose(); mk2.geometry.dispose(); this.freeLight(L); g.arena.mood && g.arena.mood(0); if (f.model.setGlow) f.model.setGlow(0xffffff, 0); }
    };
    this.fx_.push(e); f.chargeFx = e;
  }
  arc(c, len, k) { // short electric arcs around the caster
    const g = this.game; const pts = []; let p = c.clone(); const a = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize();
    for (let i = 0; i < 6; i++) { pts.push(p.clone()); p.addScaledVector(a, len / 6).add(new THREE.Vector3(rand(-.18, .18), rand(-.18, .18), rand(-.18, .18))); }
    this.lineEffect(pts, 0xcfe6ff, 0.12);
  }
  lineEffect(pts, color, life) {
    const g = this.game, geo = new THREE.BufferGeometry().setFromPoints(pts), m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }), line = new THREE.Line(geo, m); g.scene.add(line);
    const e = { t: 0, update: (dt) => { e.t += dt; m.opacity = Math.max(0, 1 - e.t / life); return e.t < life; }, kill: () => { g.scene.remove(line); geo.dispose(); m.dispose(); } }; this.fx_.push(e);
  }
  bolt(top, bottom, radius, segs, jitter) {
    const pts = []; for (let i = 0; i <= segs; i++) { const k = i / segs, p = top.clone().lerp(bottom, k); if (i > 0 && i < segs) { p.x += rand(-jitter, jitter) * (1 - k * 0.4); p.z += rand(-jitter, jitter) * (1 - k * 0.4); } pts.push(p); }
    return { pts, mesh: new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), segs * 3, radius, 6, false), this.mat.core(0xffffff)),
      glow: new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), segs * 3, radius * 3.5, 6, false), this.mat.glow(0x7fb6ff, 0.5)) };
  }
  strike(f, opp) {
    const g = this.game, def = POWERS.lightning, pos = f.lockPos.clone(); pos.y = 0;
    const top = pos.clone(); top.y = 45; top.x += 2; top.z -= 1;
    const b = this.bolt(top, pos, 0.16, 18, 1.1); g.scene.add(b.mesh, b.glow);
    // ground branches: jagged lines spreading from the impact point
    const branches = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2); let p = pos.clone(); p.y = 0.08; const pts = [p.clone()]; let ang = a; const n = 7 + Math.floor(Math.random() * 5);
      for (let s = 0; s < n; s++) { ang += rand(-0.5, 0.5); p.x += Math.cos(ang) * rand(0.5, 1.0); p.z += Math.sin(ang) * rand(0.5, 1.0); pts.push(p.clone()); if (s > 2 && Math.random() < 0.25) { const q = p.clone(); const sp = [q.clone()]; let a2 = ang + rand(0.6, 1.2) * (Math.random() < 0.5 ? 1 : -1); for (let t = 0; t < 3; t++) { q.x += Math.cos(a2) * 0.6; q.z += Math.sin(a2) * 0.6; sp.push(q.clone()); } this.lineEffect(sp, 0xbfdfff, 0.7); } }
      this.lineEffect(pts, 0xffffff, 0.8);
      const gb = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.045, 4), this.mat.glow(0x7fb6ff, 0.7)); g.scene.add(gb); branches.push(gb);
    }
    const L = this.grabLight('#cfe6ff', 160); if (L) L.l.position.set(pos.x, 4, pos.z);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: 0x050507, transparent: true, opacity: 0.55, depthWrite: false })); scorch.rotation.x = -Math.PI / 2; scorch.position.set(pos.x, 0.03, pos.z); g.scene.add(scorch);
    const e = { t: 0, update: (dt) => { e.t += dt; const k = Math.max(0, 1 - e.t / 0.55); b.mesh.visible = e.t < 0.3 && (Math.random() < 0.85); b.glow.material.opacity = 0.5 * k; if (L) L.l.intensity = L.base * k * k * (0.7 + Math.random() * 0.3); for (const x of branches) x.material.opacity = 0.7 * k; scorch.material.opacity = 0.55 * Math.max(0, 1 - Math.max(0, e.t - 2) / 2); return e.t < 4; },
      kill: () => { g.scene.remove(b.mesh, b.glow, scorch); b.mesh.geometry.dispose(); b.glow.geometry.dispose(); for (const x of branches) { g.scene.remove(x); x.geometry.dispose(); } scorch.geometry.dispose(); this.freeLight(L); } };
    this.fx_.push(e);
    g.post.flash = 1; g.post.ca = 1; g.cam.shake(0.6); g.cam.kickFov(8); g.slowmo(0.22, 1.1); g.hitStop(0.08); g.audio.thunder(1);
    g.fx.burst(pos.clone().setY(0.3), g.fx.cBlock, 80); g.fx.sparks(pos.clone().setY(0.4), new THREE.Vector3(0, 1, 0), 60, 2.2, g.fx.cBlock); g.fx.dustPuff(pos, 30, 5);
    g.rumble(f, 0.5, 1, 400); g.rumble(opp, 1, 1, 600);
    const dist = Math.hypot(opp.pos.x - pos.x, opp.pos.z - pos.z);
    if (dist < def.radius && g.state === 'fight') {
      const res = this.resolve(f, opp, { dir: new THREE.Vector3(opp.pos.x - f.pos.x, 0, opp.pos.z - f.pos.z).normalize(), kind: 'lightning', sky: true });
      if (!res.miss) {
        let dmg = def.dmg; let text = 'LIGHTNING -';
        if (res.guarded) dmg *= def.blockMult; else if (opp.hp - dmg <= def.executeBelow || opp.hp <= def.executeBelow) { dmg = opp.hp; text = 'EXECUTED -'; }
        const dir = new THREE.Vector3(opp.pos.x - pos.x, 0, opp.pos.z - pos.z); if (dir.lengthSq() < 0.01) dir.copy(f.forward); dir.normalize();
        this.damage(f, opp, dmg, { dir, kb: def.kb, knock: true, hop: 6, guarded: false, forceKnock: true, text: text + Math.round(dmg), color: '#bdf' });
        if (!opp.dead) opp.zapT = 1.2;
      }
    }
  }

  /* ---------- hit resolution ---------- */
  resolve(att, def, o) { // dodge / invulnerability / block checks
    const g = this.game;
    if (def.invuln > 0 || def.isDown || def.state === 'victory') {
      if (def.state === 'dash' && !def._dodged) { def._dodged = true; g.ui.popText(def, 'DODGE', '#8df'); g.slowmo(0.4, 0.3); setTimeout(() => (def._dodged = false), 600); }
      return { miss: true };
    }
    const faceAngle = def.forward.dot(o.dir.clone().negate());
    return { miss: false, guarded: def.blocking && (faceAngle > 0.2 || o.sky || o.kind === 'shock') };
  }
  damage(att, def, dmg, o) {
    const g = this.game; dmg = Math.max(0, dmg);
    def.hp = Math.max(0, def.hp - dmg); const ko = def.hp <= 0;
    g.ui.popText(def, o.text, o.color);
    if (o.guarded) { def.spend(dmg * 1.2); def.vel.copy(o.dir).multiplyScalar(2.5); g.audio.block(); g.rumble(def, 0.3, 0.7, 150); }
    else { g.audio.hit(1.3); g.rumble(def, 0.9, 0.6, 300); }
    if (ko) { def.takeHit({ dir: o.dir, kb: o.kb || 6, stun: 0, knockdown: true }); g.onKO(def, att); }
    else if (!o.guarded && !o.noReact) {
      def.takeHit({ dir: o.dir, kb: o.kb || 2, stun: o.stun || 0.5, knockdown: !!o.knock });
      if (o.hop) { def.vy = o.hop; def.onGround = false; }
    } else if (o.noReact && !o.guarded) def.takeHit({ dir: o.dir, kb: 0.5, stun: 0.3, knockdown: false });
    if (g.combat) g.combat.afterHit(att, def, dmg * 0.6);
  }

  /* ---------- per-frame ---------- */
  update(dt) {
    const g = this.game;
    for (let i = this.fx_.length - 1; i >= 0; i--) { const e = this.fx_[i]; if (!e.update(dt)) { e.kill && e.kill(); this.fx_.splice(i, 1); } }
    for (const f of [g.player, g.enemy]) {
      if (!f) continue;
      if (f.iceMesh && f.frozenT <= 0) { // ice broke or melted
        const p = f.pos.clone(); p.y = 1; g.fx.sparks(p, new THREE.Vector3(0, 1, 0), 28, 1.5, g.fx.cBlock); g.audio.shatter(); this.removeIce(f);
      }
      if (f.burnT > 0.01 && Math.random() < 0.8) { const c = f.model.point('hips', this._a); g.fx.flame(c); g.fx.flame(this._a.set(c.x, c.y + 0.5, c.z)); }
      if (f.model.setGlow && f.castId !== 'lightning') { const k = f.burnT > 0.01 ? 0.7 + Math.random() * 0.4 : (f.zapT > 0 ? 1.5 : 0); f.model.setGlow(f.zapT > 0 ? 0x88bbff : 0xff5a1a, k); }
      if (f.zapT > 0) f.zapT -= dt;
    }
  }

  /* ---------- for the AI ---------- */
  threatsFor(f) {
    const out = [];
    for (const e of this.fx_) {
      if (e.type === 'fire' || e.type === 'freeze') { if (e.owner !== f) out.push({ id: e.type, pos: e.pos, dir: e.dir, speed: e.def.speed, born: e.t }); }
      else if (e.type === 'shock') { if (e.owner !== f && !e.hit) out.push({ id: 'shock', r: e.r, org: e.org, max: e.def.maxRadius, born: 0 }); }
    }
    for (const o of [this.game.player, this.game.enemy]) {
      if (o && o !== f && o.castId === 'lightning' && !o.castRel) out.push({ id: 'lightning', pos: o.lockPos, fixed: o.lockFixed, t: o.castT, born: o.castT });
    }
    return out;
  }
}
