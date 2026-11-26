import { CONFIG } from './config.js?v=2';

/* Gamepad manager (standard mapping: DualShock 4 / DualSense).
   Slot 0 = first pad that connected (Player 1), slot 1 = second (Player 2), and so on.
   Read once per frame with update(). pressed() = just pressed this frame, held() = still down. */
export class Pads {
  constructor() {
    this.slots = [];            // slot -> gamepad index (or null when that pad is unplugged)
    this.cur = []; this.prev = []; this.info = [];
    this.source = () => (navigator.getGamepads ? navigator.getGamepads() : []);  // replaceable for tests
    this.onConnect = null; this.onDisconnect = null;
    addEventListener('gamepadconnected', (e) => this.connect(e.gamepad));
    addEventListener('gamepaddisconnected', (e) => this.disconnect(e.gamepad.index));
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
      this.cur[s] = { b: gp.buttons.map(b => !!(b.pressed || b.value > 0.5)), a: [...gp.axes] };
    }
  }
  held(s, i) { const c = this.cur[s]; return !!(c && c.b[i]); }
  pressed(s, i) { const c = this.cur[s], p = this.prev[s]; return !!(c && c.b[i] && !(p && p.b[i])); }
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
