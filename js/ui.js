import * as THREE from 'three';
import { CONFIG, POWERS, POWER_IDS, MANA } from './config.js?v=3';

const $ = (id) => document.getElementById(id);
export class UI {
  constructor(game) {
    this.game = game; this.v = new THREE.Vector3();
    const q = (s) => document.querySelector(s);
    this.h = {
      player: { hp: q('.left .hp'), hpf: q('.left .hp .fill'), trail: q('.left .hp .trail'), sp: q('.left .sp'), spf: q('.left .sp .fill'), st: q('.left .st'), stf: q('.left .st .fill'), pips: [...document.querySelectorAll('.left .pips i')] },
      enemy: { hp: q('.right .hp'), hpf: q('.right .hp .fill'), trail: q('.right .hp .trail'), sp: q('.right .sp'), spf: q('.right .sp .fill'), st: q('.right .st'), stf: q('.right .st .fill'), pips: [...document.querySelectorAll('.right .pips i')] }
    };
    for (const k of ['player', 'enemy']) {
      this.h[k].mp = q((k === 'player' ? '.left' : '.right') + ' .mp'); this.h[k].mpf = this.h[k].mp.querySelector('.fill'); this.h[k].chips = {};
      const box = q((k === 'player' ? '.left' : '.right') + ' .abil');
      for (const id of POWER_IDS) {
        const c = document.createElement('div'); c.className = 'chip'; c.style.setProperty('--c', POWERS[id].color);
        c.innerHTML = '<span class="pf"></span><span class="k"></span><span class="l">' + POWERS[id].label + '</span><i class="cdf"></i>';
        box.appendChild(c); this.h[k].chips[id] = { el: c, k: c.querySelector('.k'), cdf: c.querySelector('.cdf'), pf: c.querySelector('.pf') };
      }
    }
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
    this.setKeyLabels(two);
    $('lockhint').classList.toggle('hidden', two); document.querySelector('.bars').classList.toggle('twop', two);
  }
  setKeyLabels(two) {
    const kb = { lightning: 'Q', fire: 'F', freeze: 'C', shock: 'V' }, pad = { lightning: 'R1', fire: 'R2', freeze: 'L1+\u25A1', shock: 'L1+\u25B3' };
    for (const id of POWER_IDS) { this.h.player.chips[id].k.textContent = two ? pad[id] : kb[id]; this.h.enemy.chips[id].k.textContent = two ? pad[id] : ''; }
  }
  flashAbility(f, id) { const el = this.h[f.side].chips[id].el; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 250); }
  flashMana(f) { const el = this.h[f.side].mp; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 250); }
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
      h.mpf.style.width = (f.mana / MANA.max * 100) + '%';
      for (const id of POWER_IDS) {
        const c = h.chips[id], d = POWERS[id]; let ready, cdp = 0;
        if (id === 'lightning') { ready = f.special >= CONFIG.specialMax; c.pf.style.width = (f.special / CONFIG.specialMax * 100) + '%'; cdp = 0; }
        else { cdp = f.cd[id] > 0 ? f.cd[id] / f.cdMax[id] : 0; ready = cdp === 0 && f.mana >= d.cost; c.el.classList.toggle('nomana', cdp === 0 && f.mana < d.cost); }
        c.cdf.style.height = (cdp * 100) + '%'; c.el.classList.toggle('ready', ready);
      }
      h.stf.style.width = (f.stamina / CONFIG.maxStamina * 100) + '%';
    }
    const r = $('reticle');
    if (locked && this.game.state === 'fight' && !enemy.dead) { const p = this.project(enemy.pos, 1.3, this.v); if (p) { r.style.display = 'block'; r.style.left = p.x + 'px'; r.style.top = p.y + 'px'; } else r.style.display = 'none'; }
    else r.style.display = 'none';
  }
}
