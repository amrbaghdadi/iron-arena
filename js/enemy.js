import * as THREE from 'three';
import { Fighter } from './fighter.js?v=2';
import { CONFIG } from './config.js?v=2';
import { rand, clamp } from './utils.js?v=2';

/* Enemy AI: approach, circle, attack combos, block, dodge, retreat.
   It is imperfect (reaction delay + random mistakes) and adapts to
   what the player repeats (see observePlayer / adapt). */
export class Enemy extends Fighter {
  constructor(game, model) {
    super(game, 'Rival', model, false);
    this.setDifficulty(CONFIG.difficulty);
    this.history = []; this.mode = 'approach'; this.modeT = 0; this.decideT = 0.5; this.circleDir = 1; this.plan = []; this.react = null; this.blockHold = 0;
    this._to = new THREE.Vector3(); this._side = new THREE.Vector3();
    this.seen = 0;
  }
  setDifficulty(k) { this.diff = CONFIG.difficulties[k] || CONFIG.difficulties.medium; this.speedMul = this.diff.speed; this.dmgMul = this.diff.damage; }
  resetAI() { this.mode = 'approach'; this.modeT = 0; this.decideT = 0.8; this.plan = []; this.react = null; this.blockHold = 0; this.history = []; }
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
    this.modeT += dt; this.decideT -= dt;
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
      if (this.special >= CONFIG.specialMax && dist < 5 && Math.random() < 0.5 * d.aggression + 0.15) this.queue('special');
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
