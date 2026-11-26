import * as THREE from 'three';
import { CONFIG } from './config.js?v=2';
import { rand } from './utils.js?v=2';

function canvasTex(size, draw, repeat, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noise(ctx, s, n, a) { for (let i = 0; i < n; i++) { const v = Math.random() * 255; ctx.fillStyle = `rgba(${v},${v},${v},${a})`; ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2); } }

/* Arena 80x80: textured floor, pillars with collision, walls, torches, sky, fog. */
export class Arena {
  constructor(scene, quality) {
    this.scene = scene; this.obstacles = []; this.torches = []; this.limit = CONFIG.arenaLimit;
    const S = CONFIG.arenaSize;
    scene.fog = new THREE.FogExp2(0x2b2230, 0.017);
    scene.background = new THREE.Color(0x2b2230);

    // floor
    const floorTex = canvasTex(1024, (ctx, s) => {
      ctx.fillStyle = '#5b5248'; ctx.fillRect(0, 0, s, s);
      const n = 8, w = s / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 70 + Math.random() * 40; ctx.fillStyle = `rgb(${v + 14},${v + 6},${v - 6})`; ctx.fillRect(x * w + 2, y * w + 2, w - 4, w - 4); }
      noise(ctx, s, 9000, 0.12);
      ctx.strokeStyle = 'rgba(20,15,10,0.7)'; ctx.lineWidth = 4;
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * w, 0); ctx.lineTo(i * w, s); ctx.moveTo(0, i * w); ctx.lineTo(s, i * w); ctx.stroke(); }
      for (let i = 0; i < 60; i++) { ctx.strokeStyle = 'rgba(10,8,6,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); let x = Math.random() * s, y = Math.random() * s; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rand(-25, 25); y += rand(-25, 25); ctx.lineTo(x, y); } ctx.stroke(); }
    }, [8, 8]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    // center emblem + boundary ring
    const emb = canvasTex(512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s); ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = 'rgba(224,179,65,0.9)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, 7); ctx.stroke();
      ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, 7); ctx.stroke();
      for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, s * 0.12); ctx.lineTo(0, s * 0.38); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 0, s * 0.1, 0, 7); ctx.stroke();
    }, [1, 1]);
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: emb, transparent: true, emissive: 0x6a4a10, emissiveMap: emb, roughness: 0.6 }));
    emblem.rotation.x = -Math.PI / 2; emblem.position.y = 0.01; scene.add(emblem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(this.limit - 0.12, this.limit + 0.12, 128), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.8, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; scene.add(ring);

    // walls
    const brick = canvasTex(512, (ctx, s) => {
      ctx.fillStyle = '#3d332c'; ctx.fillRect(0, 0, s, s);
      const rh = s / 8; for (let r = 0; r < 8; r++) { const off = r % 2 ? s / 8 : 0; for (let x = -1; x < 5; x++) { const v = 50 + Math.random() * 30; ctx.fillStyle = `rgb(${v + 14},${v + 4},${v - 4})`; ctx.fillRect(x * s / 4 + off + 2, r * rh + 2, s / 4 - 4, rh - 4); } }
      noise(ctx, s, 5000, 0.1);
    }, [10, 1.5]);
    const wallMat = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 });
    const H = 12, h = S / 2 + 1;
    for (const [x, z, rot] of [[0, -h, 0], [0, h, 0], [-h, 0, Math.PI / 2], [h, 0, Math.PI / 2]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(S + 4, H, 2), wallMat); w.position.set(x, H / 2, z); w.rotation.y = rot; w.castShadow = true; w.receiveShadow = true; scene.add(w);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(S + 4, 0.6, 3), wallMat); cap.position.set(x, H + 0.3, z); cap.rotation.y = rot; scene.add(cap);
    }

    // pillars
    const stone = canvasTex(256, (ctx, s) => { ctx.fillStyle = '#7a6e60'; ctx.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 16) { ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`; ctx.fillRect(x, 0, 8, s); } noise(ctx, s, 3000, 0.15); }, [2, 3]);
    const pMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.8 });
    const pillar = (x, z, r = 0.9, height = 11, collide = true) => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r, height, 20), pMat); shaft.position.y = height / 2; shaft.castShadow = shaft.receiveShadow = true; g.add(shaft);
      const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.6, 0.5, r * 2.6), pMat); base.position.y = 0.25; base.castShadow = base.receiveShadow = true; g.add(base);
      const top = new THREE.Mesh(new THREE.BoxGeometry(r * 2.8, 0.7, r * 2.8), pMat); top.position.y = height + 0.35; top.castShadow = true; g.add(top);
      g.position.set(x, 0, z); scene.add(g); if (collide) this.obstacles.push({ x, z, r: r * 1.15 });
    };
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; pillar(Math.sin(a) * 30, Math.cos(a) * 30); }
    // torch pillars along the walls
    const torchPos = [[-30, -38], [30, -38], [-30, 38], [30, 38], [-38, -12], [-38, 12], [38, -12], [38, 12]];
    torchPos.forEach(([x, z], i) => {
      pillar(x, z, 0.8, 8, false);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.6, roughness: 0.4 }));
      const tx = x * 0.96 - Math.sign(x) * 0, tz = z;
      const ix = Math.abs(x) > 37 ? x - Math.sign(x) * 1.2 : x, iz = Math.abs(z) > 37 ? z - Math.sign(z) * 1.2 : z;
      bowl.position.set(ix, 8.4, iz); scene.add(bowl);
      const p = new THREE.Vector3(ix, 8.9, iz); this.torches.push(p);
      if (i < 6) { const l = new THREE.PointLight(0xff8a3a, 22, 38, 1.6); l.position.copy(p); scene.add(l); p.light = l; }
    });
    // banners
    const bm = new THREE.MeshStandardMaterial({ color: 0x7a1b1b, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(3, 7, 1, 6), bm); const x = -30 + i * 12; b.position.set(x, 6.5, -38.9); scene.add(b); const b2 = b.clone(); b2.position.z = 38.9; scene.add(b2); }

    // lighting
    this.hemi = new THREE.HemisphereLight(0x8aa4d8, 0x4a3828, 0.75); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.6); this.sun.position.set(14, 24, -10); this.sun.castShadow = true;
    const sh = this.sun.shadow; sh.mapSize.set(quality === 'low' ? 1024 : 2048, quality === 'low' ? 1024 : 2048);
    const c = sh.camera; c.left = c.bottom = -16; c.right = c.top = 16; c.near = 1; c.far = 70; sh.bias = -0.0004; sh.normalBias = 0.03; sh.radius = 4;
    scene.add(this.sun); scene.add(this.sun.target);
    const rim = new THREE.DirectionalLight(0x5aa0ff, 1.1); rim.position.set(-12, 8, 14); scene.add(rim);

    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 top=vec3(.03,.05,.14), mid=vec3(.35,.17,.2), low=vec3(.9,.45,.25);
        vec3 c=mix(low,mid,smoothstep(0.,.25,h)); c=mix(c,top,smoothstep(.2,.8,h)); gl_FragColor=vec4(c,1.); }`
    }));
    scene.add(sky);
    const st = new Float32Array(600 * 3); for (let i = 0; i < 600; i++) { const a = Math.random() * 6.28, e = Math.random() * 1.2 + 0.2, r = 280; st.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(st, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, fog: false, sizeAttenuation: false })));
  }
  update(dt, t, fx, midpoint) {
    this.torches.forEach((p, i) => { if (p.light) p.light.intensity = 20 + Math.sin(t * 9 + i * 2) * 3 + Math.sin(t * 23 + i) * 2; if (Math.random() < dt * 14) fx.flame(p); });
    if (midpoint) { this.sun.target.position.set(midpoint.x, 0, midpoint.z); this.sun.position.set(midpoint.x + 14, 24, midpoint.z - 10); }
  }
  constrain(f) {
    const p = f.pos, r = Math.hypot(p.x, p.z);
    if (r > this.limit) { p.x *= this.limit / r; p.z *= this.limit / r; }
    for (const o of this.obstacles) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + 0.4; if (d < m) { const k = m / (d || 0.01); p.x = o.x + dx * k; p.z = o.z + dz * k; } }
  }
}
