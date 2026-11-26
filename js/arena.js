import * as THREE from 'three';
import { CONFIG, QUALITY } from './config.js?v=3';
import { rand } from './utils.js?v=3';
import * as TX from './textures.js?v=3';

const SUN_DIR = new THREE.Vector3(14, 24, -10).normalize();

/* Procedural dramatic sky (gradient + fbm clouds + sun). Also used to build the environment map (HDRI-style lighting). */
function makeSky(radius, uniforms) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; uniform vec3 sunDir; uniform float dark; uniform float time;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(7.3,1.9); a*=.5; } return s; }
      void main(){
        vec3 d=normalize(vP); float hh=d.y;
        vec3 top=vec3(.02,.035,.11), mid=vec3(.30,.13,.17), low=vec3(1.0,.42,.18);
        vec3 c=mix(low,mid,smoothstep(0.,.22,hh)); c=mix(c,top,smoothstep(.15,.75,hh));
        float sd=max(dot(d,normalize(sunDir)),0.);
        c+=vec3(1.,.55,.25)*pow(sd,6.)*.6+vec3(1.,.85,.6)*pow(sd,180.)*4.;
        if(hh>0.02){ vec2 uv=d.xz/(hh+.25)*1.6+vec2(time*.01,0.); float cl=smoothstep(.45,.8,fbm(uv)); vec3 cc=mix(vec3(.12,.07,.1),vec3(1.,.6,.38),pow(sd,1.5)*.9+.1); c=mix(c,cc,cl*smoothstep(0.,.25,hh)*.85); }
        c*=1.-dark*.8; c=mix(c,vec3(.04,.07,.16),dark*.5);
        gl_FragColor=vec4(c,1.); }`
  }));
}

/* Arena 80x80: PBR stone floor, brick walls, pillars + ruins, fire pits and torches, sky, fog, env map. */
export class Arena {
  constructor(scene, renderer, quality) {
    this.scene = scene; this.renderer = renderer; this.obstacles = []; this.torches = []; this.limit = CONFIG.arenaLimit; this.moodK = 0; this.envBase = 0.65;
    const S = CONFIG.arenaSize;
    this.fogCol = new THREE.Color(0x35272c);
    scene.fog = new THREE.FogExp2(this.fogCol, 0.016);
    scene.background = this.fogCol.clone();

    // floor: PBR stone tiles + dirt decal on top
    const fl = TX.stoneTiles(1024, 8, [10, 10]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1, metalness: 0.02, normalScale: new THREE.Vector2(1.2, 1.2) }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const dirtT = TX.dirtDecal(1024); dirtT.wrapS = dirtT.wrapT = THREE.RepeatWrapping; dirtT.repeat.set(3, 3);
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: dirtT, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.005; dirt.receiveShadow = true; scene.add(dirt);
    // center emblem + boundary ring
    const ec = document.createElement('canvas'); ec.width = ec.height = 512; const ctx = ec.getContext('2d'); ctx.translate(256, 256);
    ctx.strokeStyle = 'rgba(224,179,65,0.9)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 230, 0, 7); ctx.stroke(); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 195, 0, 7); ctx.stroke();
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(0, 195); ctx.stroke(); } ctx.beginPath(); ctx.arc(0, 0, 50, 0, 7); ctx.stroke();
    const emb = new THREE.CanvasTexture(ec); emb.colorSpace = THREE.SRGBColorSpace;
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: emb, transparent: true, emissive: 0x6a4a10, emissiveMap: emb, roughness: 0.5, metalness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    emblem.rotation.x = -Math.PI / 2; emblem.position.y = 0.012; scene.add(emblem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(this.limit - 0.12, this.limit + 0.12, 128), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.8, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; scene.add(ring);

    // walls (PBR bricks)
    const bk = TX.bricks(512, [12, 1.6]);
    const wallMat = new THREE.MeshStandardMaterial({ map: bk.map, normalMap: bk.normalMap, roughnessMap: bk.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(1.5, 1.5) });
    const H = 12, h = S / 2 + 1;
    for (const [x, z, rot] of [[0, -h, 0], [0, h, 0], [-h, 0, Math.PI / 2], [h, 0, Math.PI / 2]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(S + 4, H, 2), wallMat); w.position.set(x, H / 2, z); w.rotation.y = rot; w.castShadow = true; w.receiveShadow = true; scene.add(w);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(S + 4, 0.6, 3), wallMat); cap.position.set(x, H + 0.3, z); cap.rotation.y = rot; scene.add(cap);
    }

    // pillars: intact ring + broken ones + fallen columns
    const cs = TX.columnStone(512, [2, 3]);
    const pMat = new THREE.MeshStandardMaterial({ map: cs.map, normalMap: cs.normalMap, roughnessMap: cs.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3) });
    const add = (g, geo, x, y, z) => { const m = new THREE.Mesh(geo, pMat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const pillar = (x, z, r = 0.9, height = 11, collide = true, broken = false) => {
      const g = new THREE.Group(), ht = broken ? height * rand(0.25, 0.5) : height;
      add(g, new THREE.CylinderGeometry(r * 0.88, r, ht, 20), 0, ht / 2, 0);
      add(g, new THREE.BoxGeometry(r * 2.6, 0.5, r * 2.6), 0, 0.25, 0);
      if (!broken) { add(g, new THREE.BoxGeometry(r * 2.8, 0.7, r * 2.8), 0, ht + 0.35, 0); for (const y of [2.5, ht * 0.6]) add(g, new THREE.TorusGeometry(r * 0.92, 0.07, 6, 20), 0, y, 0).rotation.x = Math.PI / 2; }
      else { const top = add(g, new THREE.DodecahedronGeometry(r * 0.9, 0), 0, ht, 0); top.scale.set(1, 0.5, 1); top.rotation.set(rand(0, 1), rand(0, 6), rand(0, 1)); }
      g.position.set(x, 0, z); scene.add(g); if (collide) this.obstacles.push({ x, z, r: r * 1.15 });
    };
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; pillar(Math.sin(a) * 30, Math.cos(a) * 30, 0.9, 11, true, i % 3 === 1); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.3, r = 22 + rand(-2, 3); pillar(Math.sin(a) * r, Math.cos(a) * r, rand(0.55, 0.8), 6, true, true); }
    for (let i = 0; i < 6; i++) { // fallen column drums
      const a = rand(0, 6.28), r = rand(14, 31), x = Math.sin(a) * r, z = Math.cos(a) * r; const g = new THREE.Group();
      const m = add(g, new THREE.CylinderGeometry(0.7, 0.75, rand(2.5, 5), 16), 0, 0.7, 0); m.rotation.z = Math.PI / 2; m.rotation.y = rand(0, 3);
      g.position.set(x, 0, z); g.rotation.y = rand(0, 3); scene.add(g); this.obstacles.push({ x, z, r: 1.1 });
    }
    // rubble (instanced)
    const rub = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), pMat, 160), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 160; i++) {
      const a = rand(0, 6.28), r = rand(9, 36), sc = rand(0.12, 0.55); e.set(rand(0, 6), rand(0, 6), rand(0, 6)); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(Math.sin(a) * r, sc * 0.3, Math.cos(a) * r), q, new THREE.Vector3(sc, sc * 0.7, sc)); rub.setMatrixAt(i, mtx);
    }
    rub.castShadow = rub.receiveShadow = true; scene.add(rub);

    // torches on wall pillars + fire pits (static fires). First entries get real lights.
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.8, roughness: 0.4 });
    const fire = (p) => this.torches.push(p);
    for (const [x, z] of [[-18, -18], [18, 18], [-18, 18], [18, -18]]) { // fire pits (ground level)
      const g = new THREE.Group(); g.position.set(x, 0, z);
      for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), pMat); s.position.set(Math.cos(a) * 0.85, 0.22, Math.sin(a) * 0.85); s.rotation.set(a, a * 2, 0); s.castShadow = s.receiveShadow = true; g.add(s); }
      const coal = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false })); coal.rotation.x = -Math.PI / 2; coal.position.y = 0.2; g.add(coal);
      scene.add(g); fire(new THREE.Vector3(x, 0.5, z)); this.obstacles.push({ x, z, r: 1.0 });
    }
    for (const [x, z] of [[-30, -38], [30, -38], [-30, 38], [30, 38], [-38, -12], [-38, 12], [38, -12], [38, 12]]) {
      pillar(x, z, 0.8, 8, false);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.4, 12), metal);
      const ix = Math.abs(x) > 37 ? x - Math.sign(x) * 1.2 : x, iz = Math.abs(z) > 37 ? z - Math.sign(z) * 1.2 : z;
      bowl.position.set(ix, 8.4, iz); scene.add(bowl); fire(new THREE.Vector3(ix, 8.9, iz));
    }
    this.lights = [];
    for (let i = 0; i < 6; i++) { const t = this.torches[i < 4 ? i : 4 + (i - 4) * 2]; const l = new THREE.PointLight(0xff8a3a, 22, 34, 1.6); l.position.copy(t); l.position.y += 0.8; scene.add(l); this.lights.push(l); t.light = l; }
    // banners
    const cw = TX.clothWeave('#7a1b1b', 256, [1, 2]);
    const bm = new THREE.MeshStandardMaterial({ map: cw.map, normalMap: cw.normalMap, roughness: 1, side: THREE.DoubleSide });
    this.banners = [];
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(3, 7, 1, 6), bm); const x = -30 + i * 12; b.position.set(x, 6.5, -38.9); scene.add(b); this.banners.push(b); const b2 = b.clone(); b2.position.z = 38.9; scene.add(b2); }

    // lighting
    this.hemi = new THREE.HemisphereLight(0x8aa4d8, 0x4a3828, 0.45); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd0a0, 3.0); this.sun.position.copy(SUN_DIR).multiplyScalar(28); this.sun.castShadow = true;
    const c = this.sun.shadow.camera; c.left = c.bottom = -16; c.right = c.top = 16; c.near = 1; c.far = 80; this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 5; this.sun.shadow.blurSamples = 16;
    scene.add(this.sun); scene.add(this.sun.target);
    this.rim = new THREE.DirectionalLight(0x5aa0ff, 1.0); this.rim.position.set(-12, 8, 14); scene.add(this.rim);
    this.sunBase = new THREE.Color(0xffd0a0); this.sunDark = new THREE.Color(0x7aa8ff);

    // sky + HDRI-style environment map
    this.skyU = { sunDir: { value: SUN_DIR.clone() }, dark: { value: 0 }, time: { value: 0 } };
    this.sky = makeSky(300, this.skyU); scene.add(this.sky);
    const st = new Float32Array(500 * 3); for (let i = 0; i < 500; i++) { const a = Math.random() * 6.28, el = Math.random() * 1.0 + 0.35, r = 280; st.set([Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(st, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, fog: false, sizeAttenuation: false, transparent: true, opacity: 0.6 })));
    try {
      const es = new THREE.Scene(), eu = { sunDir: { value: SUN_DIR.clone() }, dark: { value: 0 }, time: { value: 3 } }; es.add(makeSky(50, eu));
      const g = new THREE.Mesh(new THREE.CircleGeometry(60, 16), new THREE.MeshBasicMaterial({ color: 0x2a2018 })); g.rotation.x = -Math.PI / 2; g.position.y = -2; es.add(g);
      const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 9, 5) })); sunDisc.position.copy(SUN_DIR).multiplyScalar(40); es.add(sunDisc);
      const pm = new THREE.PMREMGenerator(renderer); this.env = pm.fromScene(es, 0.02).texture; pm.dispose();
      scene.environment = this.env; scene.environmentIntensity = this.envBase;
    } catch (err) { console.warn('env map failed', err); }

    // floating dust motes
    const N = 220, pos = new Float32Array(N * 3); this.moteSeed = [];
    for (let i = 0; i < N; i++) { pos.set([rand(-24, 24), rand(0.3, 9), rand(-24, 24)], i * 3); this.moteSeed.push(Math.random() * 100); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.07, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })); this.motes.frustumCulled = false; scene.add(this.motes);
    this.setQuality(quality || CONFIG.quality);
  }
  setQuality(name) {
    const Q = QUALITY[name] || QUALITY.medium; this.q = Q;
    const s = this.sun.shadow; if (s.mapSize.x !== Q.shadow) { s.mapSize.set(Q.shadow, Q.shadow); if (s.map) { s.map.dispose(); s.map = null; } }
    this.lights.forEach((l, i) => { l.visible = i < Q.torchLights; });
    this.motes.visible = name !== 'low';
  }
  mood(k) { // 0..1: lightning charge darkens the sky and turns the light cold blue
    if (Math.abs(k - this.moodK) < 0.004) return; this.moodK = k;
    this.sun.intensity = 3.0 * (1 - 0.7 * k) + k * 1.2 * Math.random(); this.sun.color.copy(this.sunBase).lerp(this.sunDark, k);
    this.hemi.intensity = 0.45 * (1 - 0.4 * k); this.skyU.dark.value = k; if (this.scene.environmentIntensity !== undefined) this.scene.environmentIntensity = this.envBase * (1 - 0.55 * k);
  }
  update(dt, t, fx, midpoint) {
    this.skyU.time.value = t;
    this.torches.forEach((p, i) => { if (p.light && p.light.visible) p.light.intensity = 20 + Math.sin(t * 9 + i * 2) * 3 + Math.sin(t * 23 + i) * 2; if (Math.random() < dt * 14) fx.flame(p); });
    if (midpoint) { this.sun.target.position.set(midpoint.x, 0, midpoint.z); this.sun.position.set(midpoint.x + SUN_DIR.x * 28, SUN_DIR.y * 28, midpoint.z + SUN_DIR.z * 28); }
    if (this.motes.visible) { const a = this.motes.geometry.attributes.position; for (let i = 0; i < this.moteSeed.length; i++) { const s = this.moteSeed[i]; a.array[i * 3] += Math.sin(t * 0.3 + s) * dt * 0.25; a.array[i * 3 + 1] += (Math.sin(t * 0.5 + s * 2) * 0.12 + 0.05) * dt; if (a.array[i * 3 + 1] > 9) a.array[i * 3 + 1] = 0.3; } a.needsUpdate = true; }
    this.banners.forEach((b, i) => { b.rotation.x = Math.sin(t * 1.2 + i) * 0.03; });
  }
  constrain(f) {
    const p = f.pos, r = Math.hypot(p.x, p.z);
    if (r > this.limit) { p.x *= this.limit / r; p.z *= this.limit / r; }
    for (const o of this.obstacles) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + 0.4; if (d < m) { const k = m / (d || 0.01); p.x = o.x + dx * k; p.z = o.z + dz * k; } }
  }
}
