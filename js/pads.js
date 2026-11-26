import { CONFIG } from './config.js?v=4';

/* Gamepad manager (standard mapping: DualShock 4 / DualSense).
   Slot 0 = first pad that connected (Player 1), slot 1 = second (Player 2), and so on.
   Read once per frame with update(). pressed() = just pressed this frame, held() = still down. */
export class Pads {
  constructor() {
    this.slots = [];            // slot -> gamepad index (or null when that pad is unplugged)
    this.cur = []; this.prev = []; this.info = [];
    this.source = () => (navigator.getGamepads ? navigator.getGamepads() : []);  // replaceable for tests
    this.onConnect = null; this.onDisconnect = null;
    this.map = Pads.defaults(); this.load();
    addEventListener('gamepadconnected', (e) => this.connect(e.gamepad));
    addEventListener('gamepaddisconnected', (e) => this.disconnect(e.gamepad.index));
  }
  /* ---- button map: action -> list of bindings. Binding strings: 'b7' button 7, 'a3+' / 'a3-' axis 3 pushed up/down, 'h9:0.43' hat-switch axis 9 at value 0.43 ---- */
  static defaults() {
    const M = CONFIG.padMap, b = (i) => (i >= 0 ? ['b' + i] : []);
    return { jump: b(M.jump), dash: b(M.dash), light: b(M.light), heavy: b(M.heavy), mod: b(M.mod), lightning: b(M.lightning), fire: b(M.fire), freeze: [], shock: [],
             block: b(M.blockA), kick: b(M.kick), lock: b(M.lock), pause: b(M.pause), dup: b(M.dpadUp), ddown: b(M.dpadDown), dleft: b(M.dpadLeft), dright: b(M.dpadRight) };
  }
  load() { try { const j = JSON.parse(localStorage.getItem('ia_padmap') || 'null'); if (j) for (const k in j) if (Array.isArray(j[k])) this.map[k] = j[k]; } catch (e) {} }
  save() { try { const d = Pads.defaults(), o = {}; for (const k in this.map) if (JSON.stringify(this.map[k]) !== JSON.stringify(d[k])) o[k] = this.map[k]; localStorage.setItem('ia_padmap', JSON.stringify(o)); } catch (e) {} }
  resetMap() { this.map = Pads.defaults(); try { localStorage.removeItem('ia_padmap'); } catch (e) {} }
  setBinding(action, b) { this.map[action] = b ? [b] : []; }
  static test(c, b) {
    if (!c) return false; const i = parseInt(b.slice(1)); const t = b[0];
    if (t === 'b') return !!c.b[i];
    if (t === 'a') { const dir = b.includes('-') ? -1 : 1; return (c.a[i] || 0) * dir > 0.5; }
    if (t === 'h') { const v = parseFloat(b.split(':')[1]); return Math.abs((c.a[i] || 0) - v) < 0.07; }
    return false;
  }
  evalAct(c, k) { if (k === 'confirm') k = 'jump'; const l = this.map[k]; if (!l) return false; for (const b of l) if (Pads.test(c, b)) return true; return false; }
  label(k) {
    const l = this.map[k === 'confirm' ? 'jump' : k] || []; if (!l.length) return '-';
    const names = ['\u2715', '\u25CB', '\u25A1', '\u25B3', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'], d = Pads.defaults()[k] || [];
    return l.map(b => (JSON.stringify(l) === JSON.stringify(d) && b[0] === 'b' && names[+b.slice(1)]) ? names[+b.slice(1)] : (b[0] === 'b' ? 'Button ' + b.slice(1) : b[0] === 'a' ? 'Axis ' + b.slice(1).replace(/[+-]/, '') + (b.includes('-') ? '-' : '+') : 'Hat ' + b.slice(1))).join(' / ');
  }
  connect(gp) {
    if (!gp) return -1;
    let s = this.slots.indexOf(gp.index);
    if (s < 0) { s = this.slots.indexOf(null); if (s < 0) s = this.slots.length; this.slots[s] = gp.index; }
    this.info[s] = { id: gp.id, mapping: gp.mapping };
    this.cur[s] = this.cur[s] || { b: [], a: [] }; this.prev[s] = { b: [], a: [] };
    if (this.onConnect) this.onConnect(s, gp);
    return s;
  }
  disconnect(index) {
    const s = this.slots.indexOf(index); if (s < 0) return;
    this.slots[s] = null; this.cur[s] = { b: [], a: [] }; this.prev[s] = { b: [], a: [] };
    if (this.onDisconnect) this.onDisconnect(s);
  }
  connected(s) { return this.slots[s] !== undefined && this.slots[s] !== null; }
  get count() { return this.slots.filter(x => x !== null && x !== undefined).length; }
  update() {
    const list = [...(this.source() || [])];
    for (const gp of list) if (gp && gp.connected && this.slots.indexOf(gp.index) < 0) this.connect(gp);   // pad seen without an event
    for (let s = 0; s < this.slots.length; s++) {
      const idx = this.slots[s]; if (idx === null || idx === undefined) continue;
      const gp = list.find(g => g && g.index === idx);
      if (!gp || !gp.connected) { this.disconnect(idx); continue; }
      this.prev[s] = this.cur[s];
      const b = gp.buttons.map(x => !!(x.pressed || x.value > 0.5)), v = gp.buttons.map(x => x.value || 0), a = [...gp.axes];
      // hat-switch D-pad exposed as an axis (generic pads): -1 up, then clockwise in steps of 2/7, rest ~1.29
      if (gp.mapping !== 'standard' && gp.buttons.length < 16) { const h = a.find((x, i) => i >= 4 && x >= -1.05 && x <= 1.05 && Math.abs(x * 7 + 7 - Math.round(x * 7 + 7)) < 0.15 && Math.abs(x) > 0.05); const hv = a.length >= 10 ? a[9] : undefined;
        if (hv !== undefined && hv >= -1.05 && hv <= 1.05) { const i8 = Math.round((hv + 1) / 0.2857); b[12] = [0, 1, 7].includes(i8); b[15] = [1, 2, 3].includes(i8); b[13] = [3, 4, 5].includes(i8); b[14] = [5, 6, 7].includes(i8); } }
      // non-standard layouts: some browsers expose the triggers as axes (rest = -1, pressed = +1) and have no button 6/7
      if (gp.mapping !== 'standard' && gp.buttons.length < 8 && a.length >= 5) { if (a[3] > 0.3 && a[3] <= 1) b[6] = true; if (a[4] > 0.3 && a[4] <= 1) b[7] = true; }
      this.cur[s] = { b, a, v, raw: gp.buttons.length, mapping: gp.mapping, id: gp.id };
    }
  }
  held(s, k) { const c = this.cur[s]; if (!c) return false; return typeof k === 'number' ? !!c.b[k] : this.evalAct(c, k); }
  pressed(s, k) { const c = this.cur[s], p = this.prev[s]; if (!c) return false; if (typeof k === 'number') return !!(c.b[k] && !(p && p.b[k])); return this.evalAct(c, k) && !(p && p.b && this.evalAct(p, k)); }
  anyPressed(s) { const c = this.cur[s]; return !!(c && c.b.some(Boolean)); }
  axis(s, i) { const c = this.cur[s]; const v = c && c.a[i] || 0; return Math.abs(v) < CONFIG.padDeadzone ? 0 : v; }
  /* Rumble: silently ignored when the browser/pad does not support it. */
  rumble(s, strong = 0.6, weak = 0.4, ms = 150) {
    try {
      const idx = this.slots[s]; if (idx === null || idx === undefined) return;
      const gp = [...(this.source() || [])].find(g => g && g.index === idx); if (!gp) return;
      const act = gp.vibrationActuator;
      if (act && act.playEffect) { const p = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: weak, strongMagnitude: strong }); if (p && p.catch) p.catch(() => {}); }
      else if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) { const p = gp.hapticActuators[0].pulse(strong, ms); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* ignore */ }
  }
}
