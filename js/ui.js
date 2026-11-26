import * as THREE from 'three';
import { CONFIG } from './config.js?v=2';

const $ = (id) => document.getElementById(id);
export class UI {
  constructor(game) {
    this.game = game; this.v = new THREE.Vector3();
    const q = (s) => document.querySelector(s);
    this.h = {
      player: { hp: q('.left .hp'), hpf: q('.left .hp .fill'), trail: q('.left .hp .trail'), sp: q('.left .sp'), spf: q('.left .sp .fill'), st: q('.left .st'), stf: q('.left .st .fill'), pips: [...document.querySelectorAll('.left .pips i')] },
      enemy: { hp: q('.right .hp'), hpf: q('.right .hp .fill'), trail: q('.right .hp .trail'), sp: q('.right .sp'), spf: q('.right .sp .fill'), st: q('.right .st'), stf: q('.right .st .fill'), pips: [...document.querySelectorAll('.right .pips i')] }
    };
    this.screens = ['loading', 'menu', 'lobby', 'controls', 'sound', 'pause', 'result'];
  }
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  only(id) { this.screens.forEach(s => (s === id ? this.show(s) : this.hide(s))); }
  hideAllScreens() { this.screens.forEach(s => this.hide(s)); }
  hud(on) { $('hud').classList.toggle('hidden', !on); if (!on) $('reticle').style.display = 'none'; }
  progress(p, text) { $('loadfill').style.width = Math.round(p * 100) + '%'; if (text) $('loadtext').textContent = text; }
  toast(msg, ms = 6000) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.add('hidden'), ms); }
  banner(text, cls = '', ms = 1300) { const b = $('banner'); b.className = ''; void b.offsetWidth; b.textContent = text; b.className = 'show ' + cls; }
  setTimer(t) { $('timer').textContent = Math.max(0, Math.ceil(t)); }
  setRound(n) { $('roundlbl').textContent = 'ROUND ' + n; }
  setPips(wins) { ['player', 'enemy'].forEach(k => this.h[k].pips.forEach((p, i) => p.classList.toggle('on', i < wins[k]))); }
  setNames(two) {
    $('nameP1').textContent = two ? 'PLAYER 1' : 'YOU'; $('enemyName').textContent = two ? 'PLAYER 2' : 'RIVAL';
    $('nameP1').className = 'name' + (two ? ' p1' : ''); $('enemyName').className = 'name' + (two ? ' p2' : '');
    $('lockhint').classList.toggle('hidden', two); document.querySelector('.bars').classList.toggle('twop', two);
  }
  setLock(on) { $('lockhint').textContent = 'LOCK-ON: ' + (on ? 'ON' : 'OFF') + ' (Tab)'; }
  setCombo(k, n) { const c = $(k === 'player' ? 'combo' : 'combo2'); if (n >= 2) { c.textContent = n + ' HIT COMBO'; c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; } else c.classList.add('hidden'); }
  hitFlash() { const f = $('hitflash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
  flashStamina(f) { const el = this.h[f.side].st; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 250); }
  flashSpecial(f) { const el = this.h[f.side].sp; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 250); }
  popText(f, text, color) {
    const p = this.project(f.pos, 2.1, this.v); if (!p) return;
    const d = document.createElement('div'); d.className = 'pop'; d.textContent = text; d.style.color = color; d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
    $('texts').appendChild(d); setTimeout(() => d.remove(), 950);
  }
  project(pos, dy, out) {
    out.copy(pos); out.y += dy; out.project(this.game.cam.camera);
    if (out.z > 1) return null;
    return { x: (out.x * 0.5 + 0.5) * innerWidth, y: (-out.y * 0.5 + 0.5) * innerHeight };
  }
  update(dt, player, enemy, locked) {
    for (const [k, f] of [['player', player], ['enemy', enemy]]) {
      const h = this.h[k], pct = f.hp / CONFIG.maxHP;
      h.hpf.style.width = (pct * 100) + '%'; h.trail.style.width = (pct * 100) + '%';
      h.hp.classList.toggle('low', pct < 0.3);
      h.spf.style.width = (f.special / CONFIG.specialMax * 100) + '%'; h.sp.classList.toggle('full', f.special >= CONFIG.specialMax);
      h.stf.style.width = (f.stamina / CONFIG.maxStamina * 100) + '%';
    }
    const r = $('reticle');
    if (locked && this.game.state === 'fight' && !enemy.dead) { const p = this.project(enemy.pos, 1.3, this.v); if (p) { r.style.display = 'block'; r.style.left = p.x + 'px'; r.style.top = p.y + 'px'; } else r.style.display = 'none'; }
    else r.style.display = 'none';
  }
}
