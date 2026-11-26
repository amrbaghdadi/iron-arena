import * as THREE from 'three';
import { CONFIG, FIGHTER } from './config.js?v=2';
import { clamp } from './utils.js?v=2';

/* Bone-attached hitboxes vs hurtboxes, blocking, parry, counters, hit-stop. */
export class Combat {
  constructor(game) {
    this.game = game; this.hs = { p: new THREE.Vector3(), r: 0 }; this.hurtA = []; this.hurtB = [];
    this._d = new THREE.Vector3(); this.comboCount = { player: 0, enemy: 0 }; this.comboTimer = { player: 0, enemy: 0 };
  }
  update(dt, a, b) {
    this.check(a, b); this.check(b, a);
    for (const k of ['player', 'enemy']) { if (this.comboTimer[k] > 0) { this.comboTimer[k] -= dt; if (this.comboTimer[k] <= 0) { this.comboCount[k] = 0; this.game.ui.setCombo(k, 0); } } }
  }
  check(att, def) {
    if (!att.attackActive || att.hitDone || this.game.state !== 'fight') return;
    const hs = att.hitSphere(this.hs); const hurt = def.hurtSpheres(this.hurtA);
    let hit = null, best = 99;
    for (const h of hurt) { const d = hs.p.distanceTo(h.p); if (d < hs.r + h.r && d < best) { best = d; hit = h; } }
    if (!hit) return;
    att.hitDone = true;
    const mv = att.move, game = this.game, fx = game.fx, audio = game.audio, ui = game.ui;
    const dir = this._d.copy(def.pos).sub(att.pos); dir.y = 0; if (dir.lengthSq() < 1e-4) dir.copy(att.forward); dir.normalize();
    const contact = hs.p.clone().lerp(hit.p, 0.5);
    // invulnerable (dash i-frames, special startup, down)
    if (def.invuln > 0 || def.isDown || def.state === 'victory') { att.hitDone = false; if (def.state === 'dash' && !def._dodged) { def._dodged = true; ui.popText(def, 'DODGE', '#8df'); game.slowmo(0.35, 0.35); setTimeout(() => (def._dodged = false), 600); } return; }
    const faceAngle = def.forward.dot(dir.clone().multiplyScalar(-1));
    const guarded = def.blocking && faceAngle > 0.2;
    let dmg = mv.dmg * CONFIG.hitPower * (att.dmgMul || 1);
    const counter = def.inStartup && !guarded;
    if (guarded) {
      if (def.blockTime < FIGHTER.parryWindow && !mv.guardBreak && att.moveId !== 'special') { // PARRY
        game.rumble(def, 0.3, 0.8, 120); game.rumble(att, 0.6, 0.3, 160); audio.parry(); fx.blockFlash(contact, dir); fx.sparks(contact, dir.clone().negate(), 20, 1.2, fx.cHot);
        game.cam.shake(0.12); game.hitStop(0.12); game.slowmo(0.25, 0.4); ui.popText(def, 'PARRY!', '#ffe27a');
        att.takeHit({ dir: dir.clone().negate(), kb: 3, stun: 0.75, knockdown: false });
        def.special = clamp(def.special + 12, 0, CONFIG.specialMax); def.stamina = Math.min(CONFIG.maxStamina, def.stamina + 15);
        return;
      }
      if (mv.guardBreak || def.stamina - dmg * 1.4 <= 0) { // guard broken
        def.stamina = 0; game.rumble(def, 0.9, 0.5, 260); audio.hit(1); fx.blockFlash(contact, dir); game.cam.shake(0.2); game.hitStop(0.1);
        ui.popText(def, 'GUARD BREAK', '#f84'); def.hp = Math.max(0, def.hp - dmg * 0.4);
        def.takeHit({ dir, kb: 4, stun: 0.7, knockdown: false }); this.afterHit(att, def, dmg * 0.4); return;
      }
      const taken = dmg * (mv.blockMult ?? 0.12);
      def.hp = Math.max(0, def.hp - taken); def.spend(dmg * 1.4); def.vel.copy(dir).multiplyScalar(mv.kb * 0.5);
      game.rumble(def, 0.2, 0.6, 110); game.rumble(att, 0.1, 0.3, 60); audio.block(); fx.blockFlash(contact, dir); game.cam.shake(0.05); game.hitStop(0.05); ui.popText(def, 'BLOCK', '#9cf');
      att.special = clamp(att.special + 3, 0, CONFIG.specialMax);
      if (def.hp <= 0) { def.takeHit({ dir, kb: mv.kb, stun: 0, knockdown: true }); game.onKO(def, att); }
      return;
    }
    // clean hit
    if (counter) { dmg *= 1.5; ui.popText(def, 'COUNTER!', '#ff6a3d'); }
    def.hp = Math.max(0, def.hp - dmg);
    const ko = def.hp <= 0;
    audio.hit(clamp(0.5 + mv.dmg / 20, 0.5, 1.5)); game.rumble(def, clamp(0.3 + mv.dmg / 25, 0.3, 1), 0.5, 120 + mv.dmg * 8); game.rumble(att, 0.1, 0.4 + mv.dmg / 40, 80);
    fx.sparks(contact, dir, 10 + Math.round(mv.dmg), clamp(mv.dmg / 10, 0.6, 2)); fx.dustPuff(def.pos, 2, 1);
    game.cam.shake(mv.shake * (counter ? 1.4 : 1)); game.hitStop(mv.hitStop * (ko ? 2 : 1)); game.cam.kickFov(mv.dmg * 0.35);
    const knock = mv.knockdown || ko || counter && mv.dmg >= 9 || (def.hp / CONFIG.maxHP < 0.15 && mv.dmg >= 8);
    def.takeHit({ dir, kb: mv.kb, stun: mv.stun + (counter ? 0.15 : 0), knockdown: knock });
    this.afterHit(att, def, dmg);
    if (mv.dmg >= 13 || counter) game.ui.hitFlash();
    if (ko) game.onKO(def, att);
  }
  afterHit(att, def, dmg) {
    att.special = clamp(att.special + dmg * 0.9, 0, CONFIG.specialMax); def.special = clamp(def.special + dmg * 0.5, 0, CONFIG.specialMax);
    const k = att.side;
    this.comboCount[k]++; this.comboTimer[k] = 1.6; if (this.comboCount[k] >= 2) this.game.ui.setCombo(k, this.comboCount[k]);
    const o = att.side === 'player' ? 'enemy' : 'player'; this.comboCount[o] = 0; this.game.ui.setCombo(o, 0);
    if (att.isPlayer) this.game.enemy.observe && 0;
  }
}
