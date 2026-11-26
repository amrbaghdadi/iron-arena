import * as THREE from 'three';
import { Fighter } from './fighter.js?v=3';
import { CONFIG, POWERS } from './config.js?v=3';
import { rand, clamp } from './utils.js?v=3';

/* Enemy AI: approach, circle, attack combos, block, dodge, retreat.
   It is imperfect (reaction delay + random mistakes) and adapts to
   what the player repeats (see observePlayer / adapt). */
export class Enemy extends Fighter {
  constructor(game, model) {
    super(game, 'Rival', model, false);
    this.setDifficulty(CONFIG.difficulty);
    this.history = []; this.mode = 'approach'; this.modeT = 0; this.decideT = 0.5; this.circleDir = 1; this.plan = []; this.react = null; this.blockHold = 0; this.threatSeen = new Map(); this.powerT = 2.5; this.dodgeT = 0;
    this._to = new THREE.Vector3(); this._side = new THREE.Vector3();
    this.seen = 0;
  }
  setDifficulty(k) { this.diff = CONFIG.difficulties[k] || CONFIG.difficulties.medium; this.speedMul = this.diff.speed; this.dmgMul = this.diff.damage; }
  resetAI() { this.mode = 'approach'; this.modeT = 0; this.decideT = 0.8; this.plan = []; this.react = null; this.blockHold = 0; this.history = []; this.threatSeen = new Map(); this.powerT = 2 + Math.random() * 2; this.dodgeT = 0; }
  observePlayer(id) { this.history.push(id); if (this.history.length > 10) this.history.shift(); this.seen++; this.react = null; this.reactFor = id; this.reactT = this.diff.reaction * rand(0.7, 1.4); this.reactArmed = true; }
  count(f) { return this.history.filter(f).length; }
  adapt() { // 0..1 bonuses based on the player's recent habits
    const a = this.diff.adapt, h = this.history;
    const heavy = this.count(m => m === 'heavy' || m === 'special' || m === 'spinKick'), light = this.count(m => ['jab', 'cross', 'hook', 'uppercut', 'kick'].includes(m));
    const blocks = this.game.player.blocking ? 1 : 0;
    return { dodgeHeavy: clamp(heavy / 3, 0, 1) * a, blockLight: clamp(light / 6, 0, 1) * a, breakGuard: clamp((blocks + (this.game.player.blockTime > 1 ? 1 : 0)) / 1, 0, 1) * a };
  }
  think(dt, opp) {
    const I = this.intent, d = this.diff, G = this.game;
    I.mx = I.mz = 0; I.block = false; I.run = false; this.moveFacing = null; this.faceOpp = true;
    if (G.state !== 'fight' || this.isDown || this.dead) return;
    if (this.state === 'cast') return;
    this.modeT += dt; this.powerT -= dt; if (this.dodgeT > 0) this.dodgeT -= dt;
    if (this.dodgePowers(dt, opp)) return; this.decideT -= dt;
    const to = this._to.copy(opp.pos).sub(this.pos); to.y = 0; const dist = to.length(); to.normalize();
    const side = this._side.set(to.z, 0, -to.x).multiplyScalar(this.circleDir);
    const ad = this.adapt();

    // --- reaction to a player attack in progress (delayed = imperfect) ---
    if (this.reactArmed) {
      this.reactT -= dt;
      if (this.reactT <= 0) {
        this.reactArmed = false;
        const inRange = dist < 3.2 && opp.state === 'attack';
        if (inRange && Math.random() > d.mistake) {
          const heavy = ['heavy', 'special', 'spinKick'].includes(this.reactFor);
          const pDodge = d.dodge + (heavy ? ad.dodgeHeavy * 0.5 : 0), pBlock = d.block + (!heavy ? ad.blockLight * 0.3 : 0);
          const r = Math.random();
          if (r < pDodge) { const sd = side.clone().multiplyScalar(Math.random() < 0.5 ? 1 : -1).add(to.clone().multiplyScalar(-0.6)); this.queue('dash', sd); this.plan = []; if (heavy && Math.random() < 0.7 * d.aggression + 0.2) this.punishT = 0.45; }
          else if (r < pDodge + pBlock) { this.blockHold = rand(0.5, 0.9); this.plan = []; }
        }
      }
    }
    if (this.punishT > 0) { this.punishT -= dt; if (this.punishT <= 0 && dist < 3.5) { this.plan = ['light', 'light']; this.mode = 'attack'; } }

    // --- holding a block ---
    if (this.blockHold > 0) { this.blockHold -= dt; I.block = true; if (this.state === 'block' && this.blockHold < 0.3 && opp.state !== 'attack' && this.stamina > 20 && Math.random() < 0.02) this.blockHold = 0; if (opp.attackActive === false && opp.state !== 'attack') this.blockHold -= dt * 1.5; return; }

    // --- executing a combo plan ---
    if (this.plan.length) {
      if (dist > 2.4 && this.state !== 'attack') { I.mx = to.x; I.mz = to.z; I.run = dist > 3.5; }
      if (this.state !== 'attack' && this.canAct) { this.queue(this.plan.shift()); }
      else if (this.state === 'attack' && this.moveT >= this.move.cancel - 0.04 && !this.buffer.action) { this.queue(this.plan.shift()); }
      if (this.hitsTaken > this.lastHits) { this.plan = []; }
      this.lastHits = this.hitsTaken; return;
    }
    this.lastHits = this.hitsTaken;
    if (this.state === 'attack') return;

    // --- decisions ---
    const range = 1.9;
    if (this.decideT <= 0) {
      this.decideT = d.decide * rand(0.6, 1.3);
      const r = Math.random();
      const aggr = d.aggression * (this.hp < opp.hp ? 1.15 : 0.95);
      if (dist > 7) { this.mode = 'approach'; }
      else if (dist > range + 0.6) { this.mode = r < aggr ? 'approach' : (r < aggr + 0.25 ? 'circle' : 'wait'); if (Math.random() < 0.15) this.circleDir *= -1; }
      else {
        if (opp.isDown) { this.plan = ['light', 'light']; }
        else if (r < aggr) this.startAttack(opp, ad);
        else if (r < aggr + 0.15 && this.stamina > 30) { this.mode = 'retreat'; }
        else if (r < aggr + 0.3) { this.blockHold = rand(0.4, 0.8); }
        else { this.mode = 'circle'; if (Math.random() < 0.4) this.circleDir *= -1; }
      }
      this.usePowers(opp, dist);
      // low stamina: back off and recover
      if (this.stamina < 18) this.mode = 'retreat';
    }
    switch (this.mode) {
      case 'approach': if (dist > range) { I.mx = to.x; I.mz = to.z; I.run = dist > 5; } break;
      case 'circle': I.mx = side.x * 0.8 + to.x * (dist > 3 ? 0.4 : -0.1); I.mz = side.z * 0.8 + to.z * (dist > 3 ? 0.4 : -0.1); break;
      case 'retreat': I.mx = -to.x * 0.9 + side.x * 0.3; I.mz = -to.z * 0.9 + side.z * 0.3; if (this.modeT > 1.0 && dist > 3.5) this.mode = 'wait'; break;
      default: break;
    }
  }
  /* choose a power. How often / how smart is scaled by difficulty.power */
  usePowers(opp, dist) {
    const d = this.diff, P = d.power; if (!this.canAct || this.powerT > 0 || opp.isDown && opp.dead) return;
    const ready = (id) => this.cd[id] <= 0 && this.mana >= POWERS[id].cost;
    this.powerT = rand(1.2, 2.6) / (0.4 + P);
    if (Math.random() > 0.25 + P * 0.7) return;
    if (this.special >= CONFIG.specialMax && (opp.hp < 55 || Math.random() < P * 0.6) && dist < 14) { this.queue('lightning'); return; }
    const grounded = opp.pos.y < 0.4 && !opp.isDown;
    if (dist < 4.5 && grounded && ready('shock') && Math.random() < 0.5) { this.queue('shock'); return; }
    if (dist > 3.5 && dist < 11 && ready('fire') && !opp.blocking && Math.random() < 0.7) { this.queue('fire'); return; }
    if (dist > 3 && dist < 11 && ready('freeze') && Math.random() < 0.5) { this.queue('freeze'); return; }
    if (dist < 5 && grounded && ready('shock')) this.queue('shock');
  }
  /* try to avoid the player's powers (with a reaction delay that depends on difficulty) */
  dodgePowers(dt, opp) {
    if (!this.game.powers) return false; const P = this.diff.power, th = this.game.powers.threatsFor(this);
    const seen = this.threatSeen; if (!th.length) { seen.clear(); return false; }
    for (const t of th) {
      const key = t.id + (t.id === 'lightning' ? '' : ''); if (!seen.has(key)) seen.set(key, { t: 0, roll: Math.random(), wait: this.diff.reaction * rand(0.7, 1.5) });
      const s = seen.get(key); s.t += dt; if (s.t < s.wait) continue;
      const smart = s.roll < 0.2 + P * 0.55; if (!smart || this.dodgeT > 0) continue;
      const I = this.intent, me = this.pos;
      if (t.id === 'fire' || t.id === 'freeze') {
        const toMe = this._to.copy(me).sub(t.pos); toMe.y = 0; const along = toMe.dot(t.dir), lateral = Math.hypot(toMe.x - t.dir.x * along, toMe.z - t.dir.z * along);
        if (along > 0 && along < 7 && lateral < 1.3) {
          const sd = new THREE.Vector3(-t.dir.z, 0, t.dir.x); if (toMe.dot(sd) < 0) sd.negate();
          if (along < 4.5 && this.canAct && this.stamina > 10) { this.queue('dash', sd); this.dodgeT = 1.0; return false; }
          if (this.canAct && this.blockHold <= 0 && along < 6 && Math.random() < this.diff.block) { this.blockHold = 0.8; this.dodgeT = 0.6; }
          I.mx = sd.x; I.mz = sd.z; I.run = true; return true;
        }
      } else if (t.id === 'shock') {
        const dist = Math.hypot(me.x - t.org.x, me.z - t.org.z);
        if (t.r < dist && dist - t.r < 3.2 && this.canAct && this.onGround) { this.queue('jump'); this.dodgeT = 1.2; return false; }
      } else if (t.id === 'lightning') {
        const d = Math.hypot(me.x - t.pos.x, me.z - t.pos.z);
        if (d < POWERS.lightning.radius + 1.2 && this.canAct) {
          const away = this._to.set(me.x - t.pos.x, 0, me.z - t.pos.z); if (away.lengthSq() < 0.01) away.set(1, 0, 0); away.normalize();
          if (t.fixed && d < POWERS.lightning.radius + 0.4 && this.stamina > 10 && this.dodgeT <= 0) { this.queue('dash', away.clone()); this.dodgeT = 1.5; }
          I.mx = away.x; I.mz = away.z; I.run = true; return true;
        }
      }
    }
    return false;
  }
  startAttack(opp, ad) {
    const d = this.diff, n = 1 + Math.floor(Math.random() * d.comboMax);
    const plan = [];
    const useHeavy = Math.random() < 0.2 + ad.breakGuard * 0.5;
    if (useHeavy) plan.push('heavy');
    else {
      for (let i = 0; i < n; i++) plan.push('light');
      if (n >= 2 && Math.random() < 0.4) plan[plan.length - 1] = 'kick';
    }
    this.plan = plan; this.mode = 'attack'; this.modeT = 0;
  }
}
