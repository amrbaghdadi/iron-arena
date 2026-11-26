import * as THREE from 'three';
import { Fighter } from './fighter.js?v=4';
import { CONFIG } from './config.js?v=4';

/* Human fighter. slot 0 = Player 1 (keyboard + mouse in 1P mode, and/or pad slot 0),
   slot 1 = Player 2 (pad slot 1 only). Add more players by creating more Player(game, model, slot). */
export class Player extends Fighter {
  constructor(game, model, slot = 0) {
    super(game, slot === 0 ? 'You' : 'P2', model, true);
    this.slot = slot; this.padSlot = slot; this.side = slot === 0 ? 'player' : 'enemy';
    this.keys = new Set(); this.lockOn = true; this.enabled = false; this.kbEnabled = slot === 0;
    this._mv = new THREE.Vector3();
    this.onSwing = (f, id) => { const e = game.enemy; if (e && e !== this && e.observePlayer) e.observePlayer(id); };
    if (slot === 0) this.bind();
  }
  bind() {
    const g = this.game;
    window.addEventListener('keydown', (e) => {
      if (!this.kbEnabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled || g.paused) return;
      if (e.code === 'Space') this.queue('jump');
      else if (e.code === 'KeyE') this.queue('dash', this.moveDir());
      else if (e.code === 'KeyQ') this.queue('lightning');
      else if (e.code === 'KeyF') this.queue('fire');
      else if (e.code === 'KeyC') this.queue('freeze');
      else if (e.code === 'KeyV') this.queue('shock');
      else if (e.code === 'KeyR') this.queue('kick');
      else if (e.code === 'Tab') this.toggleLock();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    g.canvas.addEventListener('mousedown', (e) => {
      if (!this.kbEnabled || !this.enabled || g.paused) return;
      if (e.button === 0) this.queue('light'); else if (e.button === 2) this.queue('heavy');
    });
    g.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.keys.clear());
  }
  toggleLock() { if (this.game.mode === '2p') return; this.lockOn = !this.lockOn; this.game.ui.setLock(this.lockOn); this.game.audio.ui(); }
  moveDir() { // world direction from keyboard / stick / d-pad, relative to the camera
    const g = this.game, P = g.pads, s = this.slot, M = CONFIG.padMap, k = this.keys, y = g.cam.yaw; let f = 0, r = 0;
    if (this.kbEnabled) { if (k.has('KeyW')) f += 1; if (k.has('KeyS')) f -= 1; if (k.has('KeyD')) r += 1; if (k.has('KeyA')) r -= 1; }
    if (P.connected(s)) {
      r += P.axis(s, 0); f -= P.axis(s, 1);
      if (P.held(s, 'dup')) f += 1; if (P.held(s, 'ddown')) f -= 1; if (P.held(s, 'dright')) r += 1; if (P.held(s, 'dleft')) r -= 1;
    }
    const fx = Math.sin(y), fz = Math.cos(y), rx = -Math.cos(y), rz = Math.sin(y);
    const v = this._mv.set(fx * f + rx * r, 0, fz * f + rz * r); if (v.lengthSq() > 1) v.normalize(); return v.clone();
  }
  readPad() { // button presses (just-pressed edges)
    const P = this.game.pads, s = this.slot, M = CONFIG.padMap;
    if (!P.connected(s)) return;
    if (P.anyPressed(s) && s === 0) this.game.padUsed = true;
    if (!this.enabled || this.game.paused) return;
    // Powers. Direct: R1 lightning, R2 fire. With L1 held every face button is a power (fallback that works on any layout):
    // L1+Square freeze, L1+Triangle shockwave, L1+X fire, L1+Circle lightning.
    const mod = P.held(s, 'mod');
    if (mod) {
      if (P.pressed(s, 'light')) this.queue('freeze');
      if (P.pressed(s, 'heavy')) this.queue('shock');
      if (P.pressed(s, 'jump')) this.queue('fire');
      if (P.pressed(s, 'dash')) this.queue('lightning');
    } else {
      if (P.pressed(s, 'jump')) this.queue('jump');
      if (P.pressed(s, 'light')) this.queue('light');
      if (P.pressed(s, 'heavy')) this.queue('heavy');
      if (P.pressed(s, 'dash')) this.queue('dash', this.moveDir());
    }
    if (P.pressed(s, 'lightning')) this.queue('lightning');
    if (P.pressed(s, 'fire')) this.queue('fire');
    if (P.pressed(s, 'freeze')) this.queue('freeze');
    if (P.pressed(s, 'shock')) this.queue('shock');
    if (P.pressed(s, 'kick')) this.queue('kick');
    if (s === 0 && P.pressed(s, 'lock')) this.toggleLock();
    if (s === 0 && this.game.mode === '1p') { // right stick = camera (single player only)
      const rdt = this.game.rawDt || 0.016;
      const ax = P.axis(s, 2), ay = P.axis(s, 3);
      if (ax) this.game.cam.addYaw(-ax * 2.6 * rdt); if (ay) this.game.cam.addPitch(ay * 1.5 * rdt);
    }
  }
  think(dt, opp) {
    const I = this.intent, g = this.game, P = g.pads, s = this.slot, M = CONFIG.padMap, two = g.mode === '2p';
    if (!this.enabled || g.state !== 'fight') { I.mx = I.mz = 0; I.block = false; return; }
    this.readPad();
    const d = this.moveDir(); I.mx = d.x; I.mz = d.z;
    const dist = this.pos.distanceTo(opp.pos);
    if (two) this.lockOn = true;
    I.run = !(this.lockOn && dist < 5.5);
    I.block = (this.kbEnabled && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))) || (P.connected(s) && (P.held(s, 'block') || P.held(s, 'blockB')));
    if (!this.lockOn && d.lengthSq() > 0.05 && !this.isDown) { this.faceOpp = false; this.moveFacing = Math.atan2(d.x, d.z); }
    else { this.faceOpp = true; this.moveFacing = null; }
    if (this.state === 'attack' && dist < 8) { this.faceOpp = true; this.moveFacing = null; }
    if (this.kbEnabled && !two) this.cameraKeys(dt);
  }
  cameraKeys(dt) {
    const k = this.keys, c = this.game.cam;
    if (k.has('ArrowLeft')) c.addYaw(1.8 * dt); if (k.has('ArrowRight')) c.addYaw(-1.8 * dt);
    if (k.has('ArrowUp')) c.addPitch(-1.0 * dt); if (k.has('ArrowDown')) c.addPitch(1.0 * dt);
  }
}
