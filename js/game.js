import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';
import { clamp, damp, lerp } from './utils.js';
import { AudioEngine } from './audio.js';
import { Particles } from './particles.js';
import { Arena } from './arena.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { Combat } from './combat.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Pads } from './pads.js';
import { loadCharacterAsset, createModel } from './rig.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-.5; float v=smoothstep(.85,.25,length(d*vec2(1.1,1.))); c.rgb*=mix(1.-amount,1.,v); gl_FragColor=c; }`
};

export class Game {
  constructor(params) {
    this.params = params; this.canvas = document.getElementById('game');
    this.mode = '1p'; this.missing = new Set(); this.joined = [false, false]; this.padUsed = false; this.rawDt = 0.016; this.pauseMsg = '';
    this.state = 'loading'; this.paused = false; this.timers = []; this.hitStopT = 0; this.slow = null; this.timeScale = 1;
    this.wins = { player: 0, enemy: 0 }; this.round = 1; this.roundTime = CONFIG.roundTime; this.clock = 0; this.fpsAcc = 0; this.fpsN = 0; this.lowQ = false;
    try { const d = localStorage.getItem('ia_diff'); if (d && CONFIG.difficulties[d]) CONFIG.difficulty = d; } catch (e) {}
    if (params.get('diff') && CONFIG.difficulties[params.get('diff')]) CONFIG.difficulty = params.get('diff');
    window.__shake = CONFIG.shake;
  }
  get frozen() { return this.state !== 'fight'; }

  async init() {
    const ui = this.ui = new UI(this); this.audio = new AudioEngine(); this.pads = new Pads();
    this.pads.onDisconnect = (s) => this.padLost(s); this.pads.onConnect = (s) => this.padBack(s);
    ui.only('loading'); ui.progress(0.05, 'Starting renderer...');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.75)); r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.cam = new CameraRig(innerWidth / innerHeight);
    ui.progress(0.15, 'Building arena...'); await new Promise(r => setTimeout(r, 20));
    this.fx = new Particles(this.scene, r); this.fx.resize();
    this.arena = new Arena(this.scene, this.params.get('q'));
    // post-processing
    const comp = this.composer = new EffectComposer(r);
    comp.addPass(new RenderPass(this.scene, this.cam.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 1.0); comp.addPass(this.bloom);
    this.vig = new ShaderPass(VignetteShader); comp.addPass(this.vig); comp.addPass(new OutputPass());
    this.bloom.enabled = CONFIG.bloom;

    // character model (optional GLB, otherwise built-in fighter)
    ui.progress(0.3, 'Loading character model...');
    const asset = await loadCharacterAsset(CONFIG.modelUrl, (p) => ui.progress(0.3 + 0.5 * p));
    if (asset.error) { console.warn('Model load failed:', asset.error); ui.toast('Could not load assets/characterRIGGED.glb. Using the built-in fallback fighter instead.', 7000); }
    this.asset = asset; ui.progress(0.85, 'Creating fighters...'); await new Promise(r => setTimeout(r, 20));
    this.player = new Player(this, createModel(asset, 'player', CONFIG.modelHeight), 0);
    this.ai = new Enemy(this, createModel(asset, 'enemy', CONFIG.modelHeight));
    this.p2 = new Player(this, createModel(asset, 'enemy', CONFIG.modelHeight), 1);
    this.enemy = this.ai; this.setMode('1p'); this.renderPadMap();
    this.combat = new Combat(this);
    this.placeFighters(); this.bindUI(); this.bindWindow();
    ui.progress(1, 'Ready'); await new Promise(r => setTimeout(r, 250));
    this.toMenu();
    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
    if (this.params.get('auto')) this.startMatch();
  }

  /* ---------------- flow ---------------- */
  setMode(m) {
    this.mode = m; const two = m === '2p';
    this.enemy = two ? this.p2 : this.ai; this.ai.root.visible = !two; this.p2.root.visible = two;
    this.player.kbEnabled = !two; this.player.keys.clear(); this.player.lockOn = true; this.p2.lockOn = true;
    this.cam.twoP = two; this.ui.setNames(two);
  }
  rumble(f, strong, weak, ms) { if (f && f.padSlot !== undefined && this.pads.connected(f.padSlot)) this.pads.rumble(f.padSlot, strong, weak, ms); }
  padLost(s) { // a pad was unplugged / lost connection
    const inMatch = ['fight', 'intro', 'roundend'].includes(this.state);
    const used = this.mode === '2p' ? s < 2 : (s === 0 && this.padUsed);
    if (this.state === 'lobby') { this.joined[s] = false; return; }
    if (inMatch && used) { this.missing.add(s); this.pause('Reconnect Player ' + (s + 1) + "'s pad, then press any button on it"); }
  }
  padBack(s) {
    if (this.missing.has(s)) { this.missing.delete(s); if (this.paused) this.showPauseMsg(); }
  }
  showPauseMsg() {
    const el = document.getElementById('pauseMsg'), btn = document.getElementById('btnResume');
    if (this.missing.size) { const l = [...this.missing].map(s => 'Player ' + (s + 1)).join(' and '); el.textContent = "Reconnect " + l + "'s pad, then press any button on it"; el.classList.remove('hidden'); btn.disabled = true; }
    else if (this.pauseMsg) { el.textContent = 'Pad reconnected. Press Resume (or Options).'; el.classList.remove('hidden'); btn.disabled = false; }
    else { el.classList.add('hidden'); btn.disabled = false; }
  }
  padLabel(i) { return ['\u2715 (X)', '\u25CB (Circle)', '\u25A1 (Square)', '\u25B3 (Triangle)', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right'][i] || ('Button ' + i); }
  renderPadMap() {
    const M = CONFIG.padMap, L = (k) => this.padLabel(M[k]);
    const rows = [['Left stick / D-pad', 'Move'], [L('jump'), 'Jump'], [L('light'), 'Light attack (combo up to 5 hits)'], [L('heavy'), 'Heavy attack (breaks guard)'], [L('dash'), 'Dash / dodge'],
      [L('blockA') + ' or ' + L('blockB'), 'Block (hold). Tap just before a hit = Parry'], [L('special'), 'Special move (full gold bar)'], [L('kick'), 'Kick'], [L('pause'), 'Pause'],
      ['Right stick', '1-player only: camera'], [L('lock'), '1-player only: lock-on on/off'], [L('confirm') + ' in lobby', 'Join / leave a 2-player match']];
    document.getElementById('padMap').innerHTML = '<table>' + rows.map(r => `<tr><td>${r[0]}</td><td colspan="3">${r[1]}</td></tr>`).join('') + '</table><p class="dim">Same buttons for Player 1 and Player 2. To remap, edit CONFIG.padMap in js/config.js.</p>';
  }
  enterLobby() { this.setMode('2p'); this.state = 'lobby'; this.joined = [false, false]; this.ui.only('lobby'); this.player.reset(); this.p2.reset(); this.placeFighters(true); this.updateLobby(); }
  leaveLobby() { this.toMenu(); }
  updateLobby() {
    const P = this.pads, M = CONFIG.padMap;
    for (let s = 0; s < 2; s++) {
      if (P.connected(s) && P.pressed(s, M.confirm)) { this.joined[s] = !this.joined[s]; this.audio.init(); this.audio.ui(); }
      if (!P.connected(s)) this.joined[s] = false;
      const el = document.getElementById('lobP' + (s + 1)), ps = el.querySelector('.ps'), hint = el.querySelector('.hint');
      el.classList.toggle('ready', this.joined[s]); el.classList.toggle('off', !P.connected(s));
      if (!P.connected(s)) { ps.textContent = 'NO PAD DETECTED'; hint.textContent = 'Connect a pad and press any button on it'; }
      else if (this.joined[s]) { ps.textContent = 'READY'; hint.textContent = 'Press \u2715 again to leave'; }
      else { const i = P.info[s] || {}; ps.textContent = 'PAD CONNECTED'; hint.textContent = (i.id || '').slice(0, 48) + (i.mapping && i.mapping !== 'standard' ? ' (non-standard mapping, buttons may differ)' : '') + '  |  Press \u2715 to join'; }
    }
    const both = this.joined[0] && this.joined[1]; document.getElementById('btnLobbyStart').disabled = !both;
    if (both && (P.pressed(0, M.pause) || P.pressed(1, M.pause))) this.startMatch();
  }
  placeFighters(menu) {
    const p = this.player, e = this.enemy;
    if (menu) { p.pos.set(-1.4, 0, 0); p.yaw = Math.PI / 2; e.pos.set(1.4, 0, 0); e.yaw = -Math.PI / 2; }
    else { p.pos.set(0, 0, -5); p.yaw = 0; e.pos.set(0, 0, 5); e.yaw = Math.PI; }
    p.root.rotation.y = p.yaw; e.root.rotation.y = e.yaw;
  }
  toMenu() {
    this.setMode('1p'); this.state = 'menu'; this.paused = false; this.missing.clear(); this.pauseMsg = ''; this.ui.hud(false); this.ui.only('menu'); this.wins = { player: 0, enemy: 0 };
    this.player.reset(); this.ai.reset(); this.p2.reset(); this.placeFighters(true); this.player.faceOpp = false; this.enemy.faceOpp = false;
    this.player.enabled = false; this.audio.setIntensity(0.1); this.refreshDiffBtn(); this.cam.zoom = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  startMatch() {
    this.audio.init(); this.audio.startMusic(); this.wins = { player: 0, enemy: 0 }; this.round = 1; this.drawCount = 0;
    this.ai.setDifficulty(CONFIG.difficulty); this.missing.clear(); this.pauseMsg = ''; this.padUsed = this.pads.anyPressed(0); this.ui.setNames(this.mode === '2p'); this.ui.hideAllScreens(); this.ui.hud(true); this.startRound();
  }
  startRound() {
    const p = this.player, e = this.enemy;
    p.reset(); e.reset(); if (e.resetAI) e.resetAI(); this.placeFighters(); this.roundTime = CONFIG.roundTime; this.ui.setTimer(this.roundTime);
    this.ui.setRound(this.round); this.ui.setPips(this.wins); this.ui.setLock(p.lockOn); this.ui.setCombo('player', 0);
    this.state = 'intro'; p.enabled = false; this.cam.forceSnap(); this.cam.zoom = -1.2; this.zoomTarget = 0; this.audio.setIntensity(0.25);
    this.ui.banner('ROUND ' + this.round); this.audio.bell();
    this.after(1.6, () => { this.ui.banner('FIGHT!'); this.audio.fight(); this.state = 'fight'; p.enabled = true; e.enabled = true; });
  }
  endRound(winner, reason) { // winner: player|enemy|null
    if (this.state !== 'fight') return;
    this.state = 'roundend'; this.player.enabled = false; this.enemy.enabled = false;
    if (winner) this.wins[winner]++; else this.drawCount++;
    this.ui.setPips(this.wins);
    if (reason === 'time') this.ui.banner(winner ? 'TIME UP' : 'DRAW', '', 1800);
    if (winner) { const w = winner === 'player' ? this.player : this.enemy; this.after(reason === 'ko' ? 2.2 : 1.2, () => { if (!w.dead) { w.state = 'victory'; w.model.setAnim('victory'); } }); }
    this.after(4.2, () => {
      const need = CONFIG.roundsToWin;
      if (this.wins.player >= need || this.wins.enemy >= need) this.endMatch(); else { this.round++; this.startRound(); }
    });
  }
  onKO(loser, winner) {
    if (this.state !== 'fight') return;
    this.audio.ko(); this.ui.banner('K.O.', 'ko'); this.slowmo(0.2, 1.9); this.zoomTarget = 1; this.cam.shake(0.4); this.ui.hitFlash();
    this.rumble(loser, 1, 1, 650); this.rumble(winner, 0.4, 0.8, 350);
    this.endRound(winner.side, 'ko');
  }
  endMatch() {
    this.state = 'matchend'; this.zoomTarget = 0; const win = this.wins.player > this.wins.enemy;
    document.getElementById('resultTitle').textContent = this.mode === '2p' ? (win ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS') : (win ? 'VICTORY' : 'DEFEAT');
    document.getElementById('resultSub').textContent = `Rounds ${this.wins.player} - ${this.wins.enemy}  |  ${CONFIG.difficulties[CONFIG.difficulty].label}`;
    this.ui.hud(false); this.ui.only('result'); if (document.pointerLockElement) document.exitPointerLock(); this.audio.setIntensity(0.1);
  }
  togglePause() { if (this.paused) this.resume(); else this.pause(); }
  pause(msg) {
    if (this.paused || !['fight', 'intro', 'roundend'].includes(this.state)) { if (this.paused && msg) { this.pauseMsg = msg; this.showPauseMsg(); } return; }
    this.pauseMsg = msg || ''; this.paused = true; this.ui.show('pause'); this.showPauseMsg(); if (document.pointerLockElement) document.exitPointerLock(); this.player.keys.clear(); this.audio.ctx && this.audio.ctx.suspend();
  }
  resume() { if (!this.paused || this.missing.size) return; this.paused = false; this.ui.hide('pause'); this.ui.hide('controls'); this.ui.hide('sound'); this.audio.ctx && this.audio.ctx.resume(); this.lockPointer(); }
  lockPointer() { if (this.mode === '2p') return; if (this.canvas.requestPointerLock && !this.params.get('nolock')) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  hitStop(s) { this.hitStopT = Math.max(this.hitStopT, s); }
  slowmo(scale, dur) { this.slow = { scale, t: dur }; }

  /* ---------------- UI + window ---------------- */
  refreshDiffBtn() { document.getElementById('btnDiff').textContent = 'DIFFICULTY: ' + CONFIG.difficulties[CONFIG.difficulty].label.toUpperCase(); }
  bindUI() {
    const $ = (id) => document.getElementById(id), a = this.audio, ui = this.ui; let back = 'menu';
    const click = (id, fn) => $(id).addEventListener('click', () => { a.init(); a.ui(); fn(); });
    click('btnStart', () => { this.setMode('1p'); this.startMatch(); });
    click('btnTwo', () => this.enterLobby());
    click('btnLobbyStart', () => { if (this.joined[0] && this.joined[1]) this.startMatch(); });
    click('btnLobbyControls', () => ui.show('controls')); click('btnLobbyBack', () => this.leaveLobby());
    click('btnDiff', () => { const k = Object.keys(CONFIG.difficulties); CONFIG.difficulty = k[(k.indexOf(CONFIG.difficulty) + 1) % k.length]; try { localStorage.setItem('ia_diff', CONFIG.difficulty); } catch (e) {} this.refreshDiffBtn(); });
    click('btnControls', () => { back = 'menu'; ui.show('controls'); });
    click('btnSound', () => { back = 'menu'; ui.show('sound'); });
    click('btnControlsBack', () => ui.hide('controls')); click('btnSoundBack', () => ui.hide('sound'));
    click('btnResume', () => this.resume()); click('btnPauseControls', () => ui.show('controls')); click('btnPauseSound', () => ui.show('sound'));
    click('btnRestart', () => { this.paused = false; ui.hide('pause'); this.timers = []; this.startMatch(); this.lockPointer(); });
    click('btnQuit', () => { this.paused = false; this.timers = []; this.audio.ctx && this.audio.ctx.resume(); this.toMenu(); });
    click('btnReplay', () => { this.timers = []; this.startMatch(); this.lockPointer(); }); click('btnMenu', () => { this.timers = []; this.toMenu(); });
    $('volMaster').oninput = (e) => a.setVolume('master', +e.target.value); $('volSfx').oninput = (e) => a.setVolume('sfx', +e.target.value);
    $('volMusic').oninput = (e) => a.setVolume('music', +e.target.value); $('mute').onchange = (e) => a.setMuted(e.target.checked);
  }
  bindWindow() {
    addEventListener('resize', () => this.resize());
    addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) this.togglePause(); } });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.state === 'fight' && !this.paused) this.pause(); });
    this.canvas.addEventListener('mousedown', () => { if (this.mode === '1p' && !this.paused && ['fight', 'intro'].includes(this.state) && !document.pointerLockElement) this.lockPointer(); });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === this.canvas && !this.paused) { this.cam.addYaw(-e.movementX * 0.0026); this.cam.addPitch(e.movementY * 0.0020); } });
    addEventListener('keydown', (e) => { if (this.audio.ctx === null) this.audio.init(); });
  }
  padFrame() { // per-frame pad handling that is not tied to a fighter: pause button, lobby
    if (this.state === 'lobby') { this.updateLobby(); return; }
    const M = CONFIG.padMap;
    if (this.state === 'fight' || this.state === 'intro' || this.state === 'roundend' || this.paused) {
      const slots = this.mode === '2p' ? [0, 1] : [0];
      if (slots.some(s => this.pads.connected(s) && this.pads.pressed(s, M.pause))) this.togglePause();
    }
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.cam.setAspect(innerWidth / innerHeight); this.fx.resize();
  }

  /* ---------------- main loop ---------------- */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.rawDt = raw;
    this.pads.update(); this.padFrame();
    this.clock += raw;
    // adaptive quality
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc > 3) { const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; if (fps < 32 && !this.lowQ && this.state !== 'loading') { this.lowQ = true; this.renderer.setPixelRatio(1); this.bloom.enabled = false; this.resize(); this.ui.toast('Low FPS detected: lowered quality', 3000); } }
    if (!this.paused) {
      for (const t of this.timers) t.t -= raw; const due = this.timers.filter(t => t.t <= 0); this.timers = this.timers.filter(t => t.t > 0); due.forEach(t => t.fn());
      let target = 1;
      if (this.hitStopT > 0) { this.hitStopT -= raw; target = 0.02; }
      else if (this.slow) { this.slow.t -= raw; target = this.slow.scale; if (this.slow.t <= 0) this.slow = null; }
      this.timeScale = target < this.timeScale ? target : damp(this.timeScale, target, 14, raw);
      this.step(raw * this.timeScale * CONFIG.gameSpeed, raw);
    }
    this.cam.zoom = damp(this.cam.zoom, this.zoomTarget ?? 0, 2.2, raw);
    this.composer.render();
  }
  step(dt, raw) {
    const p = this.player, e = this.enemy;
    if (this.params.get('bot') && this.state === 'fight' && this.mode === '1p') this.botPlayer(dt);
    if (this.state === 'menu' || this.state === 'matchend' || this.state === 'lobby') { this.menuCam(raw); }
    p.think(dt, e); e.think(dt, p);
    p.update(dt, e); e.update(dt, p);
    this.separate(p, e); this.arena.constrain(p); this.arena.constrain(e);
    this.combat.update(dt, p, e);
    if (this.state === 'fight') {
      this.roundTime -= raw * (this.timeScale > 0.5 ? 1 : 0); this.ui.setTimer(this.roundTime);
      if (this.roundTime <= 0) { const a = p.hp, b = e.hp; this.endRound(a > b ? 'player' : b > a ? 'enemy' : null, 'time'); }
    }
    if (this.state !== 'menu' && this.state !== 'matchend' && this.state !== 'lobby') this.cam.update(raw, p, e, p.lockOn || this.mode === '2p', this.state === 'roundend' ? 'ko' : this.state);
    this.fx.update(dt); this.arena.update(raw, this.clock, this.fx, this.player.pos.clone().lerp(this.enemy.pos, 0.5));
    this.vig.uniforms.amount.value = 0.5 + (1 - Math.min(p.hp / CONFIG.maxHP, 1)) * 0.25;
    this.ui.update(raw, p, e, p.lockOn && this.mode === '1p');
    const danger = 1 - Math.min(p.hp, e.hp) / CONFIG.maxHP, act = (p.state === 'attack' || e.state === 'attack') ? 0.15 : 0;
    this._int = damp(this._int ?? 0.3, clamp(0.25 + danger * 0.55 + act, 0, 1), 1.5, raw); if (this.state !== 'menu') this.audio.setIntensity(this._int);
    this.audio.update();
  }
  menuCam(raw) {
    this.menuT = (this.menuT || 0) + raw * 0.2; const c = this.cam.camera, r = 7;
    c.position.set(Math.sin(this.menuT) * r, 1.8, Math.cos(this.menuT) * r); c.lookAt(0, 1.3, 0); c.fov = 45; c.updateProjectionMatrix();
    this.cam.yaw = this.menuT + Math.PI; this.cam.focus.set(0, 1.3, 0);
  }
  separate(a, b) {
    if (a.state === 'dash' || b.state === 'dash' || a.pos.y > 0.5 || b.pos.y > 0.5) return;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.isDown || b.isDown ? 0.7 : 0.95;
    if (d < min && d > 0.0001) { const k = (min - d) / 2 / d; a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k; }
  }
  botPlayer(dt) { // debug autoplay: ?bot=1
    const p = this.player, e = this.enemy; this._bot = (this._bot || 0) - dt; p.enabled = true;
    const to = e.pos.clone().sub(p.pos); const d = to.length();
    if (this._bot <= 0) { this._bot = 0.25 + Math.random() * 0.3; const r = Math.random();
      if (d > 2.3) { p.keys.add('KeyW'); } else { p.keys.delete('KeyW'); if (r < 0.5) p.queue('light'); else if (r < 0.65) p.queue('kick'); else if (r < 0.75) p.queue('heavy'); else if (r < 0.8) p.queue('special'); else if (r < 0.88) p.queue('dash', p.moveDir()); }
      if (Math.random() < 0.1) p.keys.add('ShiftLeft'); else p.keys.delete('ShiftLeft'); }
  }
}
