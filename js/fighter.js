import * as THREE from 'three';
import { CONFIG, MOVES, LIGHT_CHAIN, FIGHTER } from './config.js?v=2';
import { clamp, damp, dampAngle, angleDiff } from './utils.js?v=2';

const ATTACK_ACTIONS = ['light', 'kick', 'heavy', 'special'];

/* Shared fighter: state machine, movement, stamina, combo chain.
   Controllers (Player / Enemy) only fill `this.intent` and call queue(). */
export class Fighter {
  constructor(game, name, model, isPlayer) {
    this.game = game; this.name = name; this.isPlayer = isPlayer; this.side = isPlayer ? 'player' : 'enemy'; this.model = model;
    this.root = new THREE.Group(); this.root.add(model.root); game.scene.add(this.root);
    this.vel = new THREE.Vector3(); this.vy = 0; this.yaw = 0; this.onGround = true;
    this.intent = { mx: 0, mz: 0, run: false, block: false };
    this.buffer = { action: null, t: 0, dir: null };
    this.reset();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.stepT = 0;
  }
  reset() {
    this.hp = CONFIG.maxHP; this.stamina = CONFIG.maxStamina; this.special = 0;
    this.state = 'idle'; this.stateTime = 0; this.move = null; this.moveId = null; this.moveT = 0; this.hitDone = false; this.chained = false;
    this.comboIdx = 0; this.comboTimer = 0; this.invuln = 0; this.stun = 0; this.blockTime = 0; this.staminaT = 0;
    this.dead = false; this.dashDir = new THREE.Vector3(); this.hitsTaken = 0; this.lastAction = null;
    this.vel.set(0, 0, 0); this.vy = 0; this.onGround = true; this.buffer.action = null; this.root.position.y = 0;
    this.model.setAnim && this.model.setAnim('idle', { fade: 0 });
  }
  get forward() { return this._f || (this._f = new THREE.Vector3()), this._f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get pos() { return this.root.position; }
  get canAct() { return !this.game.frozen && (this.state === 'idle' || this.state === 'walk' || this.state === 'run' || this.state === 'block'); }
  get attackActive() { return this.state === 'attack' && this.moveT >= this.move.startup && this.moveT <= this.move.startup + this.move.active; }
  get inStartup() { return this.state === 'attack' && this.moveT < this.move.startup; }
  get isDown() { return this.state === 'knockdown' || this.state === 'getup' || this.state === 'dead'; }
  get blocking() { return this.state === 'block'; }

  queue(action, dir) { this.buffer.action = action; this.buffer.t = FIGHTER.bufferTime; this.buffer.dir = dir || null; }
  spend(n) { this.stamina = Math.max(0, this.stamina - n); this.staminaT = FIGHTER.staminaDelay; }
  enter(state, anim, opts) { this.state = state; this.stateTime = 0; this.model.setAnim(anim || state, opts); }

  tryAction(a, dir) {
    if (a === 'jump') { if (this.onGround && this.canAct) { this.vy = CONFIG.jumpSpeed; this.onGround = false; this.enter('jump'); this.game.audio.jump(); return true; } return false; }
    if (a === 'dash') {
      if (this.stamina < 6) return false;
      this.spend(FIGHTER.dashCost);
      const d = dir && dir.lengthSq() > 0.01 ? dir.clone().normalize() : this.forward.clone().multiplyScalar(-1);
      this.dashDir.copy(d); this.invuln = FIGHTER.dashIFrames; this.moveId = null;
      this.enter('dash', 'dash', { fade: 0.05 });
      this.game.audio.dash(); this.game.fx.dustPuff(this.pos, 8, 2.5); this.game.cam.kickFov(4);
      this.game.onDash && this.game.onDash(this);
      return true;
    }
    if (!this.onGround) return false;
    let id;
    if (a === 'special') {
      if (this.special < CONFIG.specialMax) { this.game.ui.flashSpecial(this); return false; }
      id = 'special'; this.special = 0;
    } else if (a === 'heavy') { id = 'heavy'; this.comboIdx = 0; }
    else {
      const idx = this.comboTimer > 0 || this.state === 'attack' ? this.comboIdx : 0;
      if (a === 'kick') id = idx >= 2 ? 'spinKick' : 'kick'; else id = LIGHT_CHAIN[Math.min(idx, 4)];
      this.comboIdx = id === 'spinKick' ? 0 : idx + 1;
      if (this.comboIdx >= 5) this.comboIdx = 0;
    }
    const mv = MOVES[id];
    if (this.stamina < Math.min(mv.stam, 6)) { this.game.ui.flashStamina(this); return false; }
    this.spend(mv.stam);
    this.move = mv; this.moveId = id; this.moveT = 0; this.hitDone = false; this.chained = false;
    this.lastAction = a;
    this.enter('attack', id, { fade: 0.05, dur: mv.dur });
    if (mv.invuln) this.invuln = mv.invuln;
    if (this.onSwing) this.onSwing(this, id);
    this.game.audio.swing(id);
    this.vel.set(0, 0, 0);
    if (id === 'special') { this.game.audio.special(); this.game.fx.burst(this._v.set(this.pos.x, 1, this.pos.z)); }
    return true;
  }

  hurtSpheres(out) {
    const h = FIGHTER.hurt, m = this.model;
    const set = (i, n, r) => { const o = out[i] || (out[i] = { p: new THREE.Vector3(), r: 0 }); m.point(n, o.p); o.r = r; };
    set(0, 'chest', h.chest); set(1, 'head', h.head); set(2, 'hips', h.hips);
    if (m.constructor.name === 'ProceduralModel') { out[1].p.y += 0.14; out[0].p.y += 0.08; }
    return out;
  }
  hitSphere(out) {
    this.model.point(this.move.limb, out.p); out.r = this.move.hitR || (this.move.limb.startsWith('hand') ? 0.24 : 0.27); return out;
  }

  takeHit(info) { // info: {stun, knockdown, kb, from(vec dir to push)}
    this.hitsTaken++;
    this.moveId = null; this.move = null; this.comboTimer = 0; this.comboIdx = 0; this.buffer.action = null;
    this.vel.copy(info.dir).multiplyScalar(info.kb);
    if (this.hp <= 0) { this.dead = true; this.enter('knockdown', 'death'); this.vel.multiplyScalar(1.2); this.onGround = true; return; }
    if (info.knockdown) { this.enter('knockdown', 'knockdown'); this.stun = 0; }
    else { this.stun = info.stun; this.enter('hit', 'hit', { fade: 0.04 }); }
  }

  update(dt, opp) {
    const I = this.intent, c = CONFIG;
    this.stateTime += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.staminaT > 0) this.staminaT -= dt;
    else if (this.state !== 'block' && this.state !== 'attack') this.stamina = Math.min(c.maxStamina, this.stamina + FIGHTER.staminaRegen * dt * (this.state === 'idle' ? 1.3 : 1));
    if (this.comboTimer > 0 && this.state !== 'attack') { this.comboTimer -= dt; if (this.comboTimer <= 0) this.comboIdx = 0; }
    if (this.buffer.action) { this.buffer.t -= dt; if (this.buffer.t <= 0) this.buffer.action = null; }
    const spd = (this.isPlayer ? c.playerSpeed : 1) * (this.speedMul || 1);

    // ---- buffered actions ----
    const b = this.buffer.action;
    if (b && !this.game.frozen) {
      if (this.canAct) { if (this.tryAction(b, this.buffer.dir)) this.buffer.action = null; }
      else if (this.state === 'attack') {
        if (ATTACK_ACTIONS.includes(b) && b !== 'special' && this.moveT >= this.move.cancel && !this.chained) {
          if (this.tryAction(b)) { this.buffer.action = null; }
        } else if (b === 'dash' && this.moveT >= this.move.startup + this.move.active) { if (this.tryAction('dash', this.buffer.dir)) this.buffer.action = null; }
      }
    }

    // ---- facing ----
    let desiredYaw = null; const toOpp = this._v.copy(opp.pos).sub(this.pos); toOpp.y = 0; const dist = toOpp.length();
    if (this.faceOpp !== false && dist > 0.01) desiredYaw = Math.atan2(toOpp.x, toOpp.z);
    if (this.moveFacing) desiredYaw = this.moveFacing;
    const canTurn = this.state !== 'dash' && !this.isDown && this.state !== 'hit' && !(this.state === 'attack' && this.moveT > this.move.startup);
    if (desiredYaw !== null && canTurn) this.yaw = dampAngle(this.yaw, desiredYaw, this.state === 'attack' ? 20 : 11, dt);

    // ---- state logic ----
    let wantVel = null, grounded = true; let animSpeed = 0, fwd = 1;
    switch (this.state) {
      case 'idle': case 'walk': case 'run': case 'block': {
        const mag = Math.hypot(I.mx, I.mz);
        if (I.block && this.stamina > 3 && this.onGround) { if (this.state !== 'block') { this.enter('block', 'block', { fade: 0.08 }); this.blockTime = 0; } }
        else if (this.state === 'block') this.enter('idle', 'idle', { fade: 0.1 });
        if (this.state === 'block') this.blockTime += dt;
        const speed = this.state === 'block' ? FIGHTER.blockSpeed : (I.run ? FIGHTER.runSpeed : FIGHTER.walkSpeed) * spd;
        if (mag > 0.05) {
          wantVel = this._v2.set(I.mx, 0, I.mz).normalize().multiplyScalar(speed * Math.min(1, mag));
          if (this.state !== 'block') { const s = I.run ? 'run' : 'walk'; if (this.state !== s) this.enter(s, s, { fade: 0.15 }); }
          if (this.state === 'run' && I.run) this.spend(0);
          fwd = clamp(this.forward.dot(wantVel) / speed, -1, 1);
          if (Math.abs(fwd) < 0.5) fwd = 0;
        } else { wantVel = this._v2.set(0, 0, 0); if (this.state === 'walk' || this.state === 'run') this.enter('idle', 'idle', { fade: 0.15 }); }
        animSpeed = this.vel.length();
        break;
      }
      case 'jump': {
        grounded = false; const mag = Math.hypot(I.mx, I.mz);
        wantVel = this._v2.set(I.mx, 0, I.mz).normalize().multiplyScalar(mag > 0.05 ? FIGHTER.walkSpeed * 1.1 * spd : 0);
        break;
      }
      case 'attack': {
        this.moveT += dt;
        const m = this.move, lt = m.startup + m.active;
        if (this.moveT < lt) { const k = 1 - this.moveT / lt; this.vel.copy(this.forward).multiplyScalar(m.lunge * k * spd); if (dist < 1.1 && this.moveId !== 'spinKick') this.vel.multiplyScalar(0.2); }
        else this.vel.multiplyScalar(Math.exp(-10 * dt));
        if (this.moveT >= m.dur) { this.comboTimer = FIGHTER.comboWindow; this.move = null; this.enter('idle', 'idle', { fade: 0.12 }); }
        break;
      }
      case 'dash': {
        const k = 1 - this.stateTime / FIGHTER.dashTime;
        this.vel.copy(this.dashDir).multiplyScalar(FIGHTER.dashSpeed * Math.max(0.15, k));
        if (this.stateTime % 0.06 < dt) this.game.fx.dustPuff(this.pos, 1, 0.8);
        if (this.stateTime >= FIGHTER.dashTime) this.enter('idle', 'idle', { fade: 0.1 });
        break;
      }
      case 'hit':
        this.vel.multiplyScalar(Math.exp(-6 * dt));
        if (this.stateTime >= this.stun) this.enter('idle', 'idle', { fade: 0.1 });
        break;
      case 'knockdown': {
        this.vel.multiplyScalar(Math.exp(-4 * dt));
        if (!this.dead && this.stateTime >= 1.5) { this.enter('getup', 'getup', { dur: 0.9, fade: 0.1 }); this.model.ctx && (this.model.ctx.dur = 0.9); }
        break;
      }
      case 'getup':
        this.vel.multiplyScalar(Math.exp(-6 * dt));
        if (this.stateTime >= 0.9) { this.enter('idle', 'idle', { fade: 0.1 }); }
        break;
      case 'victory': this.vel.multiplyScalar(Math.exp(-6 * dt)); break;
    }
    if (this.dead && this.state !== 'knockdown') this.enter('knockdown', 'death');
    if (wantVel && (this.state === 'idle' || this.state === 'walk' || this.state === 'run' || this.state === 'block' || this.state === 'jump')) {
      const k = this.state === 'jump' ? 4 : 14;
      this.vel.x = damp(this.vel.x, wantVel.x, k, dt); this.vel.z = damp(this.vel.z, wantVel.z, k, dt);
    }

    // ---- integrate ----
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (!this.onGround) {
      this.vy -= c.gravity * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; this.game.audio.land(); this.game.fx.dustPuff(this.pos, 6); if (this.state === 'jump') this.enter(Math.hypot(I.mx, I.mz) > 0.05 ? 'run' : 'idle'); }
    }
    this.root.rotation.y = this.yaw;
    // footsteps
    if ((this.state === 'run' || this.state === 'walk') && this.onGround) { this.stepT -= dt * animSpeed; if (this.stepT <= 0) { this.stepT = 1.3; this.game.audio.step(); if (this.state === 'run') this.game.fx.dustPuff(this.pos, 1, 0.6); } }
    this.model.update(dt, { speed: animSpeed, fwd, grounded: this.onGround && this.state !== 'jump' });
  }
}
