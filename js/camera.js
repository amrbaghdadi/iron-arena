import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff, rand } from './utils.js?v=2';

/* Third-person cinematic camera: mouse orbit, lock-on framing, shake, FOV kicks, KO zoom. */
export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 400);
    this.yaw = 0; this.pitch = 0.34; this.dist = 7.4; this.baseFov = 55; this.fovKick = 0; this.shakeAmp = 0; this.lockOffset = 0;
    this.focus = new THREE.Vector3(0, 1.4, 0); this.mode = 'follow'; this.t = 0; this.zoom = 0; this.snap = true; this.twoP = false;
    this._p = new THREE.Vector3(); this._look = new THREE.Vector3(); this.intro = 0;
  }
  addYaw(d) { this.yaw += d; this.lockOffset = clamp(this.lockOffset + d, -0.9, 0.9); }
  addPitch(d) { this.pitch = clamp(this.pitch + d, 0.03, 1.0); }
  shake(a) { this.shakeAmp = Math.min(0.6, this.shakeAmp + a); }
  kickFov(d) { this.fovKick = Math.min(14, this.fovKick + d); }
  update(dt, player, enemy, locked, state) {
    this.t += dt;
    const mid = this._p.copy(player.pos).lerp(enemy.pos, 0.5);
    const dx = enemy.pos.x - player.pos.x, dz = enemy.pos.z - player.pos.z, sep = Math.hypot(dx, dz);
    const target = Math.atan2(dx, dz);
    let focusT = this._look.copy(player.pos);
    if (locked || state !== 'fight') {
      focusT.lerp(enemy.pos, this.twoP ? 0.5 : (state === 'fight' ? 0.3 : 0.5));
      this.lockOffset = damp(this.lockOffset, 0, 1.2, dt);
      const want = (this.twoP ? target - 1.1 : target - 0.32) + this.lockOffset; // slightly over the shoulder
      this.yaw = this.snap ? want : dampAngle(this.yaw, want, 6, dt);
    } else { focusT.lerp(enemy.pos, 0.12); }
    focusT.y = 1.35;
    this.focus.lerp(focusT, this.snap ? 1 : 1 - Math.exp(-9 * dt));
    let dist = this.twoP ? this.dist + 1.0 + clamp(sep - 3, 0, 14) * 0.9 - this.zoom * 2.4 : this.dist + clamp(sep - 3, 0, 8) * 0.55 - this.zoom * 2.4;
    let pitch = this.pitch + (state === 'ko' ? -0.1 : 0);
    this.dist_ = damp(this.dist_ ?? dist, dist, 4, dt); dist = this.dist_;
    const cp = Math.cos(pitch);
    const pos = new THREE.Vector3(this.focus.x - Math.sin(this.yaw) * cp * dist, this.focus.y + Math.sin(pitch) * dist, this.focus.z - Math.cos(this.yaw) * cp * dist);
    // keep inside the walls
    const lim = 38, r = Math.hypot(pos.x, pos.z); if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; }
    pos.y = Math.max(0.5, pos.y);
    this.camera.position.copy(pos);
    this.shakeAmp = damp(this.shakeAmp, 0, 7, dt);
    const s = this.shakeAmp * 0.35 * (window.__shake ?? 1);
    if (s > 0.002) this.camera.position.add(new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s)));
    this.camera.lookAt(this.focus);
    this.camera.rotateZ(rand(-s, s) * 0.15);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.camera.fov = this.baseFov + this.fovKick - this.zoom * 8;
    this.camera.updateProjectionMatrix();
    this.snap = false;
  }
  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }
  forceSnap() { this.snap = true; this.dist_ = undefined; }
}
