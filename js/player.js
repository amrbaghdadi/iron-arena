import * as THREE from 'three';
import { Fighter } from './fighter.js';
import { CONFIG } from './config.js';

/* Keyboard + mouse + gamepad controller. */
export class Player extends Fighter {
  constructor(game, model) {
    super(game, 'You', model, true);
    this.keys = new Set(); this.lockOn = true; this.pad = null; this.enabled = false;
    this._mv = new THREE.Vector3(); this.padPrev = {};
    this.onSwing = (f, id) => game.enemy && game.enemy.observePlayer(id);
    this.bind();
  }
  bind() {
    const g = this.game;
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled || g.paused) return;
      if (e.code === 'Space') this.queue('jump');
      else if (e.code === 'KeyE') this.queue('dash', this.moveDir());
      else if (e.code === 'KeyQ') this.queue('special');
      else if (e.code === 'KeyR') this.queue('kick');
      else if (e.code === 'Tab') { this.lockOn = !this.lockOn; g.ui.setLock(this.lockOn); g.audio.ui(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    g.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || g.paused) return;
      if (e.button === 0) this.queue('light'); else if (e.button === 2) this.queue('heavy');
    });
    g.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.keys.clear());
  }
  moveDir() { // world direction from WASD relative to camera
    const k = this.keys, y = this.game.cam.yaw; let f = 0, r = 0;
    if (k.has('KeyW')) f += 1; if (k.has('KeyS')) f -= 1; if (k.has('KeyD')) r += 1; if (k.has('KeyA')) r -= 1;
    const gp = this.pad;
    if (gp) { if (Math.abs(gp.axes[0]) > 0.2) r += gp.axes[0]; if (Math.abs(gp.axes[1]) > 0.2) f -= gp.axes[1]; }
    const fx = Math.sin(y), fz = Math.cos(y), rx = -Math.cos(y), rz = Math.sin(y);
    const v = this._mv.set(fx * f + rx * r, 0, fz * f + rz * r); if (v.lengthSq() > 1) v.normalize(); return v.clone();
  }
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []; const gp = this.pad = pads && [...pads].find(p => p && p.connected) || null;
    if (!gp) return;
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed, prev = this.padPrev;
    const edge = (name, i, fn) => { const v = b(i); if (v && !prev[name]) fn(); prev[name] = v; };
    if (this.enabled && !this.game.paused) {
      edge('a', 0, () => this.queue('jump')); edge('x', 2, () => this.queue('light')); edge('y', 3, () => this.queue('heavy'));
      edge('b', 1, () => this.queue('dash', this.moveDir())); edge('rb', 5, () => this.queue('kick')); edge('rt', 7, () => this.queue('special'));
      edge('r3', 11, () => { this.lockOn = !this.lockOn; this.game.ui.setLock(this.lockOn); });
      if (Math.abs(gp.axes[2]) > 0.15) this.game.cam.addYaw(-gp.axes[2] * 0.05);
      if (Math.abs(gp.axes[3]) > 0.15) this.game.cam.addPitch(gp.axes[3] * 0.03);
    }
    edge('start', 9, () => this.game.togglePause());
  }
  think(dt, opp) {
    this.pollPad();
    const I = this.intent;
    if (!this.enabled || this.game.state !== 'fight') { I.mx = I.mz = 0; I.block = false; return; }
    const d = this.moveDir(); I.mx = d.x; I.mz = d.z;
    const dist = this.pos.distanceTo(opp.pos);
    I.run = !(this.lockOn && dist < 5.5);
    I.block = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!(this.pad && ((this.pad.buttons[4] && this.pad.buttons[4].pressed) || (this.pad.buttons[6] && this.pad.buttons[6].pressed)));
    if (!this.lockOn && d.lengthSq() > 0.05 && !this.isDown) { this.faceOpp = false; this.moveFacing = Math.atan2(d.x, d.z); }
    else { this.faceOpp = true; this.moveFacing = null; }
    if (this.state === 'attack' && dist < 8) { this.faceOpp = true; this.moveFacing = null; }
    this.cameraKeys(dt);
  }
  cameraKeys(dt) {
    const k = this.keys, c = this.game.cam;
    if (k.has('ArrowLeft')) c.addYaw(1.8 * dt); if (k.has('ArrowRight')) c.addYaw(-1.8 * dt);
    if (k.has('ArrowUp')) c.addPitch(-1.0 * dt); if (k.has('ArrowDown')) c.addPitch(1.0 * dt);
  }
}
