import * as THREE from 'three';
import { rand } from './utils.js';

// GPU points particle pool. "additive" is used for sparks/flash, normal blend for dust.
class Pool {
  constructor(scene, max, additive) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max); this.grow = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.2,d); gl_FragColor=vec4(vC.rgb, vC.a*a); }`
    });
    this.mat = m;
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false;
    scene.add(this.points);
    this.size.fill(0);
  }
  emit(p, v, color, size, life, grav = 0, drag = 1, grow = 0) {
    const i = this.i = (this.i + 1) % this.max;
    this.pos.set(p, i * 3); this.vel.set(v, i * 3);
    this.base.set([color.r, color.g, color.b, 1], i * 4);
    this.s0[i] = size; this.life[i] = this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2]; this.col[i * 4 + 3] = k;
      this.size[i] = this.s0[i] * (k * (1 - this.grow[i]) + (1 - k) * this.grow[i] * 2 + (this.grow[i] ? 0 : 0));
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.size.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, renderer) {
    this.add = new Pool(scene, 700, true);
    this.dust = new Pool(scene, 300, false);
    this.renderer = renderer;
    this.cSpark = new THREE.Color(1, 0.7, 0.25); this.cHot = new THREE.Color(1, 0.95, 0.7);
    this.cBlock = new THREE.Color(0.5, 0.8, 1); this.cDust = new THREE.Color(0.55, 0.5, 0.42);
    this.cFlame = new THREE.Color(1, 0.5, 0.15); this.cSpecial = new THREE.Color(0.9, 0.4, 1);
  }
  resize() {
    const h = this.renderer.domElement.height;
    this.add.mat.uniforms.scale.value = this.dust.mat.uniforms.scale.value = h * 0.9;
  }
  sparks(p, dir, n = 14, power = 1, color = this.cSpark) {
    for (let i = 0; i < n; i++) {
      const v = [dir.x * 3 * power + rand(-4, 4) * power, rand(0.5, 5) * power, dir.z * 3 * power + rand(-4, 4) * power];
      this.add.emit([p.x, p.y, p.z], v, Math.random() < 0.3 ? this.cHot : color, rand(0.05, 0.12) * (0.7 + power * 0.4), rand(0.25, 0.6), 12, 0.97);
    }
    this.add.emit([p.x, p.y, p.z], [0, 0, 0], this.cHot, 0.7 * power, 0.12, 0, 1);
  }
  blockFlash(p, dir) {
    this.sparks(p, dir, 16, 0.9, this.cBlock);
    this.add.emit([p.x, p.y, p.z], [0, 0, 0], this.cBlock, 1.1, 0.18, 0, 1);
  }
  dustPuff(p, n = 6, spread = 1.5) {
    for (let i = 0; i < n; i++) this.dust.emit([p.x + rand(-0.2, 0.2), 0.05, p.z + rand(-0.2, 0.2)], [rand(-spread, spread), rand(0.2, 1), rand(-spread, spread)], this.cDust, rand(0.35, 0.7), rand(0.5, 0.9), -0.4, 0.95, 0.5);
  }
  flame(p) { this.add.emit([p.x + rand(-0.08, 0.08), p.y, p.z + rand(-0.08, 0.08)], [rand(-0.2, 0.2), rand(1, 2), rand(-0.2, 0.2)], this.cFlame, rand(0.25, 0.45), rand(0.4, 0.8), -0.5, 0.98); }
  burst(p, color = this.cSpecial, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(3, 9);
      this.add.emit([p.x, p.y, p.z], [Math.cos(a) * s, rand(-1, 4), Math.sin(a) * s], color, rand(0.08, 0.2), rand(0.3, 0.7), 4, 0.94);
    }
  }
  update(dt) { this.add.update(dt); this.dust.update(dt); }
}
