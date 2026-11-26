import * as THREE from 'three';

/* Procedural PBR texture sets (color + normal + roughness maps) drawn on canvases.
   Replace any of them with real image files if you have assets. */
const mkCanvas = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };
export function normalFromHeight(hc, strength = 3) {
  const s = hc.width, src = hc.getContext('2d').getImageData(0, 0, s, s).data, out = mkCanvas(s), octx = out.getContext('2d');
  const img = octx.createImageData(s, s), d = img.data;
  const h = (x, y) => src[((((y + s) % s) * s) + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0); return out;
}
function roughFromHeight(hc, lo, hi) {
  const s = hc.width, src = hc.getContext('2d').getImageData(0, 0, s, s).data, out = mkCanvas(s), octx = out.getContext('2d');
  const img = octx.createImageData(s, s), d = img.data;
  for (let i = 0; i < s * s; i++) { const v = (lo + (hi - lo) * (1 - src[i * 4] / 255)) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  octx.putImageData(img, 0, 0); return out;
}
const tex = (c, repeat, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };

/* color(ctx,size) and height(ctx,size) draw the albedo and a grayscale height map */
export function pbr({ size = 512, color, height, repeat = [1, 1], normal = 3, rough = [0.5, 0.9] }) {
  const cc = mkCanvas(size), hc = mkCanvas(size);
  color(cc.getContext('2d'), size); height(hc.getContext('2d'), size);
  return { map: tex(cc, repeat, true), normalMap: tex(normalFromHeight(hc, normal), repeat, false), roughnessMap: tex(roughFromHeight(hc, rough[0], rough[1]), repeat, false), height: hc };
}
export const rnd = (a, b) => a + Math.random() * (b - a);
export function speckle(ctx, s, n, a, size = 2, tone = 255) { for (let i = 0; i < n; i++) { const v = Math.random() * tone; ctx.fillStyle = `rgba(${v},${v},${v},${a})`; ctx.fillRect(Math.random() * s, Math.random() * s, size, size); } }

export function stoneTiles(size = 1024, tiles = 8, repeat = [8, 8]) {
  const w = size / tiles; const tileShade = [];
  for (let i = 0; i < tiles * tiles; i++) tileShade.push(Math.random());
  return pbr({
    size, repeat, normal: 4, rough: [0.55, 0.95],
    color: (ctx, s) => {
      ctx.fillStyle = '#3a342d'; ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) { const v = 72 + tileShade[y * tiles + x] * 46; ctx.fillStyle = `rgb(${v + 16},${v + 8},${v - 4})`; ctx.fillRect(x * w + 3, y * w + 3, w - 6, w - 6); }
      speckle(ctx, s, 14000, 0.12, 2); speckle(ctx, s, 3000, 0.1, 5, 120);
      for (let i = 0; i < 70; i++) { ctx.strokeStyle = 'rgba(8,6,4,0.4)'; ctx.lineWidth = rnd(1, 2.5); ctx.beginPath(); let x = Math.random() * s, y = Math.random() * s; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd(-30, 30); y += rnd(-30, 30); ctx.lineTo(x, y); } ctx.stroke(); }
    },
    height: (ctx, s) => {
      ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) { const v = 150 + tileShade[y * tiles + x] * 80; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x * w + 4, y * w + 4, w - 8, w - 8); }
      speckle(ctx, s, 22000, 0.3, 3, 255);
      for (let i = 0; i < 80; i++) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = rnd(1, 3); ctx.beginPath(); let x = Math.random() * s, y = Math.random() * s; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd(-30, 30); y += rnd(-30, 30); ctx.lineTo(x, y); } ctx.stroke(); }
    }
  });
}
export function bricks(size = 512, repeat = [10, 1.5]) {
  const rows = 8, rh = size / rows, off = [];
  return pbr({
    size, repeat, normal: 5, rough: [0.7, 1.0],
    color: (ctx, s) => { ctx.fillStyle = '#2c2520'; ctx.fillRect(0, 0, s, s); for (let r = 0; r < rows; r++) { const o = r % 2 ? s / 8 : 0; for (let x = -1; x < 5; x++) { const v = 56 + Math.random() * 34; ctx.fillStyle = `rgb(${v + 16},${v + 5},${v - 6})`; ctx.fillRect(x * s / 4 + o + 3, r * rh + 3, s / 4 - 6, rh - 6); } } speckle(ctx, s, 6000, 0.12, 2); },
    height: (ctx, s) => { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, s, s); for (let r = 0; r < rows; r++) { const o = r % 2 ? s / 8 : 0; for (let x = -1; x < 5; x++) { const v = 160 + Math.random() * 70; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x * s / 4 + o + 4, r * rh + 4, s / 4 - 8, rh - 8); } } speckle(ctx, s, 9000, 0.3, 3); }
  });
}
export function columnStone(size = 512, repeat = [2, 3]) {
  return pbr({
    size, repeat, normal: 4, rough: [0.6, 0.95],
    color: (ctx, s) => { ctx.fillStyle = '#7d7164'; ctx.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 32) { ctx.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.14})`; ctx.fillRect(x, 0, 14, s); } speckle(ctx, s, 9000, 0.14, 2); for (let i = 0; i < 25; i++) { ctx.fillStyle = 'rgba(30,50,20,0.12)'; ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, rnd(6, 26), 0, 7); ctx.fill(); } },
    height: (ctx, s) => { ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 32) { ctx.fillStyle = '#404040'; ctx.fillRect(x, 0, 14, s); } speckle(ctx, s, 12000, 0.3, 3); }
  });
}
export function clothWeave(base = '#2a4a86', size = 256, repeat = [3, 3]) {
  return pbr({
    size, repeat, normal: 2.5, rough: [0.75, 1],
    color: (ctx, s) => { ctx.fillStyle = base; ctx.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 4) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(i, 0, 2, s); ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0, i, s, 2); } speckle(ctx, s, 1500, 0.08, 2); },
    height: (ctx, s) => { for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) { const v = ((x / 4 + y / 4) % 2) ? 210 : 90; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 4, 4); } }
  });
}
export function leather(base = '#4a3220', size = 256, repeat = [2, 2]) {
  return pbr({
    size, repeat, normal: 3, rough: [0.45, 0.8],
    color: (ctx, s) => { ctx.fillStyle = base; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 5000, 0.18, 2); },
    height: (ctx, s) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 14000, 0.5, 2); speckle(ctx, s, 3000, 0.4, 4); }
  });
}
export function brushedMetal(base = '#9aa0a8', size = 256, repeat = [2, 2]) {
  return pbr({
    size, repeat, normal: 1.8, rough: [0.22, 0.55],
    color: (ctx, s) => { ctx.fillStyle = base; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 400; i++) { ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.08})`; ctx.beginPath(); const y = Math.random() * s; ctx.moveTo(0, y); ctx.lineTo(s, y + rnd(-3, 3)); ctx.stroke(); } speckle(ctx, s, 800, 0.2, 1); },
    height: (ctx, s) => { ctx.fillStyle = '#909090'; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 600; i++) { const v = rnd(60, 200); ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`; ctx.beginPath(); const y = Math.random() * s; ctx.moveTo(0, y); ctx.lineTo(s, y + rnd(-4, 4)); ctx.stroke(); } }
  });
}
export function skinTex(base = '#c58c64', size = 256) {
  return pbr({
    size, repeat: [1, 1], normal: 1.2, rough: [0.5, 0.7],
    color: (ctx, s) => { ctx.fillStyle = base; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 3000, 0.05, 2); },
    height: (ctx, s) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 9000, 0.4, 1); }
  });
}
/* transparent dirt patches drawn over the floor (not tiled) */
export function dirtDecal(size = 1024) {
  const c = mkCanvas(size), ctx = c.getContext('2d');
  for (let i = 0; i < 90; i++) { const x = Math.random() * size, y = Math.random() * size, r = rnd(30, 150); const g = ctx.createRadialGradient(x, y, 0, x, y, r); const a = rnd(0.12, 0.4); g.addColorStop(0, `rgba(70,50,32,${a})`); g.addColorStop(1, 'rgba(70,50,32,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 40; i++) { const x = Math.random() * size, y = Math.random() * size, r = rnd(10, 50); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(20,16,12,0.35)'); g.addColorStop(1, 'rgba(20,16,12,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function softDot() {
  const c = mkCanvas(64), ctx = c.getContext('2d'); const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
