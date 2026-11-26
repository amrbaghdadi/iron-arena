import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { CONFIG, QUALITY, QUALITY_ORDER } from './config.js?v=4';
import { Powers } from './powers.js?v=4';
import { PadSetup } from './padsetup.js?v=4';
import { clamp, damp, lerp } from './utils.js?v=4';
import { AudioEngine } from './audio.js?v=4';
import { Particles } from './particles.js?v=4';
import { Arena } from './arena.js?v=4';
import { CameraRig } from './camera.js?v=4';
import { UI } from './ui.js?v=4';
import { Combat } from './combat.js?v=4';
import { Player } from './player.js?v=4';
import { Enemy } from './enemy.js?v=4';
import { Pads } from './pads.js?v=4';
import { loadCharacterAsset, createModel } from './rig.js?v=4';

/* Final pass: vignette + film grain + chromatic aberration (strong hits) + white flash + freeze/burn tint */
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.55 }, time: { value: 0 }, grain: { value: 0.045 }, ca: { value: 0 }, flash: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, tintAmt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount,time,grain,ca,flash,tintAmt; uniform vec3 tint; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+time)*43758.5453); }
    void main(){
      vec2 d=vUv-.5; float r=length(d); vec2 off=d*(ca*.02+.0006)*(0.4+r*2.);
      vec3 c=vec3(texture2D(tDiffuse,vUv+off).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-off).b);
      float v=smoothstep(.85,.25,length(d*vec2(1.1,1.))); c*=mix(1.-amount,1.,v);
      c=mix(c,c*tint*1.4,tintAmt*(0.4+r*1.2));
      c+=(rnd(vUv*vec2(1920.,1080.))-.5)*grain;
      c=mix(c,vec3(1.6),flash);
      gl_FragColor=vec4(c,1.); }`
};

export class Game {
  constructor(params) {
    this.params = params; this.canvas = document.getElementById('game');
    this.mode = '1p'; this.missing = new Set(); this.joined = [false, false]; this.padUsed = false; this.rawDt = 0.016; this.pauseMsg = '';
    this.state = 'loading'; this.paused = false; this.timers = []; this.hitStopT = 0; this.slow = null; this.timeScale = 1;
    this.wins = { player: 0, enemy: 0 }; this.round = 1; this.roundTime = CONFIG.roundTime; this.clock = 0; this.fpsAcc = 0; this.fpsN = 0; this.lowQ = false; this.post = { flash: 0, ca: 0 };
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
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    try { const sq = localStorage.getItem('ia_q'); if (sq && QUALITY[sq]) CONFIG.quality = sq; } catch (e) {}
    if (this.params.get('q') && QUALITY[this.params.get('q')]) CONFIG.quality = this.params.get('q');
    this.scene = new THREE.Scene();
    this.cam = new CameraRig(innerWidth / innerHeight);
    ui.progress(0.15, 'Building arena...'); await new Promise(r => setTimeout(r, 20));
    this.fx = new Particles(this.scene, r); this.fx.resize();
    this.arena = new Arena(this.scene, r, CONFIG.quality);
    // post-processing
    const comp = this.composer = new EffectComposer(r);
    comp.addPass(new RenderPass(this.scene, this.cam.camera));
    this.ssao = new SSAOPass(this.scene, this.cam.camera, innerWidth, innerHeight); this.ssao.kernelRadius = 0.7; this.ssao.minDistance = 0.002; this.ssao.maxDistance = 0.06; comp.addPass(this.ssao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.92); comp.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.cam.camera, { focus: 8, aperture: 0.00012, maxblur: 0.004 }); comp.addPass(this.bokeh);
    this.vig = new ShaderPass(FinalShader); comp.addPass(this.vig); comp.addPass(new OutputPass());
    this.applyQuality(CONFIG.quality, true);

    // character model (optional GLB, otherwise built-in fighter)
    ui.progress(0.3, 'Loading character model...');
    const asset = await loadCharacterAsset(CONFIG.modelUrl, (p) => ui.progress(0.3 + 0.5 * p));
    if (asset.error) { console.warn('Model load failed:', asset.error); ui.toast('Could not load assets/characterRIGGED.glb. Using the built-in fallback fighter instead.', 7000); }
    this.asset = asset; ui.progress(0.85, 'Creating fighters...'); await new Promise(r => setTimeout(r, 20));
    this.player = new Player(this, createModel(asset, 'player', CONFIG.modelHeight), 0);
    this.ai = new Enemy(this, createModel(asset, 'enemy', CONFIG.modelHeight));
    this.p2 = new Player(this, createModel(asset, 'enemy', CONFIG.modelHeight), 1);
    this.enemy = this.ai; this.setMode('1p'); this.renderPadMap();
    this.combat = new Combat(this); this.powers = new Powers(this); this.wiz = new PadSetup(this);
    this.placeFighters(); this.bindUI(); this.bindWindow();
    ui.progress(1, 'Ready'); await new Promise(r => setTimeout(r, 250));
    this.toMenu();
    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
    if (this.params.get('auto')) this.startMatch();
  }

  applyQuality(name, quiet) {
    const Q = QUALITY[name] || QUALITY.medium; CONFIG.quality = name; this.Q = Q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr)); this.composer.setPixelRatio && this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.enabled = Q.bloom; this.ssao.enabled = Q.ssao; this.bokeh.enabled = Q.dof; this.vig.uniforms.grain.value = Q.grain ? 0.045 : 0;
    this.arena.setQuality(name); this.resize();
    try { localStorage.setItem('ia_q', name); } catch (e) {}
    const t = 'QUALITY: ' + Q.label.toUpperCase(); for (const id of ['btnQuality', 'btnPauseQuality']) { const el = document.getElementById(id); if (el) el.textContent = t; }
    if (!quiet) this.ui.toast('Graphics quality: ' + Q.label, 1800);
  }
  cycleQuality() { this.applyQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(CONFIG.quality) + 1) % QUALITY_ORDER.length]); }

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
    const L = (k) => this.pads.label(k);
    const rows = [['Left stick / D-pad', 'Move'], [L('jump'), 'Jump'], [L('light'), 'Light attack (combo up to 5 hits)'], [L('heavy'), 'Heavy attack (breaks guard)'], [L('dash'), 'Dash / dodge'],
      [L('block'), 'Block (hold). Tap just before a hit = Parry'], [L('lightning'), 'LIGHTNING ultimate (needs a FULL gold bar)'], [L('fire'), 'FIREBALL (mana)'],
      [L('freeze') !== '-' ? L('freeze') : L('mod') + ' + ' + L('light'), 'FREEZE (mana)'], [L('shock') !== '-' ? L('shock') : L('mod') + ' + ' + L('heavy'), 'SHOCKWAVE (mana)'],
      [L('mod') + ' + ' + L('jump') + ' / ' + L('dash'), 'Backup: FIRE / LIGHTNING'], [L('kick'), 'Kick'], [L('pause'), 'Pause'],
      ['Right stick', '1-player only: camera'], [L('lock'), '1-player only: lock-on on/off'], [L('jump') + ' in lobby', 'Join / leave a 2-player match']];
    document.getElementById('padMap').innerHTML = '<table>' + rows.map(r => `<tr><td>${r[0]}</td><td colspan="3">${r[1]}</td></tr>`).join('') + '</table><p class="dim">Buttons do not match your pad? Press PAD SETUP and follow the steps. F1 (or Share + Options) shows what the browser detects.</p>';
  }
  enterLobby() { this.setMode('2p'); this.state = 'lobby'; this.joined = [false, false]; this.ui.only('lobby'); this.player.reset(); this.p2.reset(); this.placeFighters(true); this.updateLobby(); }
  leaveLobby() { this.toMenu(); }
  updateLobby() {
    const P = this.pads, M = CONFIG.padMap;
    for (let s = 0; s < 2; s++) {
      if (P.connected(s) && P.pressed(s, 'confirm')) { this.joined[s] = !this.joined[s]; this.audio.init(); this.audio.ui(); }
      if (!P.connected(s)) this.joined[s] = false;
      const el = document.getElementById('lobP' + (s + 1)), ps = el.querySelector('.ps'), hint = el.querySelector('.hint');
      el.classList.toggle('ready', this.joined[s]); el.classList.toggle('off', !P.connected(s));
      if (!P.connected(s)) { ps.textContent = 'NO PAD DETECTED'; hint.textContent = 'Connect a pad and press any button on it'; }
      else if (this.joined[s]) { ps.textContent = 'READY'; hint.textContent = 'Press \u2715 again to leave'; }
      else { const i = P.info[s] || {}; ps.textContent = 'PAD CONNECTED'; hint.textContent = (i.id || '').slice(0, 48) + (i.mapping && i.mapping !== 'standard' ? ' (non-standard mapping, buttons may differ)' : '') + '  |  Press \u2715 to join'; }
    }
    const both = this.joined[0] && this.joined[1]; document.getElementById('btnLobbyStart').disabled = !both;
    if (both && (P.pressed(0, 'pause') || P.pressed(1, 'pause'))) this.startMatch();
  }
  placeFighters(menu) {
    const p = this.player, e = this.enemy;
    if (menu) { p.pos.set(-1.4, 0, 0); p.yaw = Math.PI / 2; e.pos.set(1.4, 0, 0); e.yaw = -Math.PI / 2; }
    else { p.pos.set(0, 0, -5); p.yaw = 0; e.pos.set(0, 0, 5); e.yaw = Math.PI; }
    p.root.rotation.y = p.yaw; e.root.rotation.y = e.yaw;
  }
  toMenu() {
    this.setMode('1p'); this.state = 'menu'; this.paused = false; this.missing.clear(); this.pauseMsg = ''; this.ui.hud(false); this.ui.only('menu'); this.wins = { player: 0, enemy: 0 };
    this.player.reset(); this.ai.reset(); this.p2.reset(); this.powers && this.powers.reset(); this.placeFighters(true); this.player.faceOpp = false; this.enemy.faceOpp = false;
    this.player.enabled = false; this.audio.setIntensity(0.1); this.refreshDiffBtn(); this.cam.zoom = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  startMatch() {
    this.audio.init(); this.audio.startMusic(); this.wins = { player: 0, enemy: 0 }; this.round = 1; this.drawCount = 0;
    this.ai.setDifficulty(CONFIG.difficulty); this.missing.clear(); this.pauseMsg = ''; this.padUsed = this.pads.anyPressed(0); this.ui.setNames(this.mode === '2p'); this.ui.hideAllScreens(); this.ui.hud(true); this.startRound(); if (this.mode === '1p') this.ui.toast('Powers: Lightning needs a FULL gold bar. Fire / Freeze / Shock use the purple mana bar.', 5000);
  }
  startRound() {
    const p = this.player, e = this.enemy;
    p.reset(); e.reset(); if (e.resetAI) e.resetAI(); this.powers && this.powers.reset(); this.post.flash = 0; this.post.ca = 0; this.placeFighters(); this.roundTime = CONFIG.roundTime; this.ui.setTimer(this.roundTime);
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
    click('btnQuality', () => this.cycleQuality()); click('btnPauseQuality', () => this.cycleQuality());
    click('btnPadSetup', () => this.wiz.open('menu')); click('btnPadSetup2', () => this.wiz.open('pause')); click('btnPadSetup3', () => this.wiz.open('lobby')); click('btnPadSetup4', () => this.wiz.open('controls'));
    click('btnWizSkip', () => this.wiz.skip()); click('btnWizBack', () => this.wiz.prev()); click('btnWizReset', () => { this.pads.resetMap(); this.wiz.i = 0; this.wiz.render(); this.ui.toast('Default buttons restored', 2000); });
    click('btnWizDone', () => this.wiz.close(this.wiz.i >= 11));
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
    addEventListener('keydown', (e) => { if (e.code === 'F1') { e.preventDefault(); this.ui.padDebug(); } });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) this.togglePause(); } });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.state === 'fight' && !this.paused) this.pause(); });
    this.canvas.addEventListener('mousedown', () => { if (this.mode === '1p' && !this.paused && ['fight', 'intro'].includes(this.state) && !document.pointerLockElement) this.lockPointer(); });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === this.canvas && !this.paused) { this.cam.addYaw(-e.movementX * 0.0026); this.cam.addPitch(e.movementY * 0.0020); } });
    addEventListener('keydown', (e) => { if (this.audio.ctx === null) this.audio.init(); });
  }
  padFrame() {
    if (this.wiz && this.wiz.active) { this.wiz.update(this.rawDt); return; } // per-frame pad handling that is not tied to a fighter: pause button, lobby
    if (this.state === 'lobby') { this.updateLobby(); return; }
    const M = CONFIG.padMap;
    for (let s = 0; s < 2; s++) if (this.pads.connected(s) && this.pads.held(s, 8) && this.pads.held(s, 9) && (this.pads.pressed(s, 8) || this.pads.pressed(s, 9))) this.ui.padDebug();
    if (this.state === 'fight' || this.state === 'intro' || this.state === 'roundend' || this.paused) {
      const slots = this.mode === '2p' ? [0, 1] : [0];
      if (slots.some(s => this.pads.connected(s) && this.pads.pressed(s, 'pause'))) this.togglePause();
    }
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.ssao && this.ssao.setSize(innerWidth * this.renderer.getPixelRatio(), innerHeight * this.renderer.getPixelRatio()); this.cam.setAspect(innerWidth / innerHeight); this.fx.resize();
  }

  /* ---------------- main loop ---------------- */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.rawDt = raw;
    this.pads.update(); this.padFrame(); this.ui.updatePadDebug(this.pads);
    this.clock += raw;
    // adaptive quality
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc > 3) { const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; if (fps < 32 && this.state !== 'loading' && !this.paused) { const i = QUALITY_ORDER.indexOf(CONFIG.quality); if (i > 0) { this.applyQuality(QUALITY_ORDER[i - 1], true); this.ui.toast('Low FPS detected: quality lowered to ' + QUALITY[CONFIG.quality].label, 3500); } } }
    if (!this.paused) {
      for (const t of this.timers) t.t -= raw; const due = this.timers.filter(t => t.t <= 0); this.timers = this.timers.filter(t => t.t > 0); due.forEach(t => t.fn());
      let target = 1;
      if (this.hitStopT > 0) { this.hitStopT -= raw; target = 0.02; }
      else if (this.slow) { this.slow.t -= raw; target = this.slow.scale; if (this.slow.t <= 0) this.slow = null; }
      this.timeScale = target < this.timeScale ? target : damp(this.timeScale, target, 14, raw);
      this.step(raw * this.timeScale * CONFIG.gameSpeed, raw);
    }
    this.cam.zoom = damp(this.cam.zoom, this.zoomTarget ?? 0, 2.2, raw);
    const P = this.post, u = this.vig.uniforms; P.flash *= Math.exp(-7 * raw); P.ca *= Math.exp(-4.5 * raw);
    u.flash.value = P.flash < 0.01 ? 0 : P.flash; u.ca.value = this.Q.ca ? P.ca : 0; u.time.value = (this.clock % 100);
    const pl = this.player; let ta = 0; const tc = u.tint.value;
    if (pl.frozenT > 0 || pl.slowT > 0) { tc.set(0.55, 0.85, 1.4); ta = pl.frozenT > 0 ? 0.6 : 0.3; } else if (pl.burnT > 0) { tc.set(1.5, 0.7, 0.4); ta = 0.35; }
    u.tintAmt.value = damp(u.tintAmt.value, ta, 8, raw);
    if (this.bokeh.enabled) this.bokeh.uniforms.focus.value = this.cam.camera.position.distanceTo(this.cam.focus);
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
    this.powers.update(dt); this.fx.update(dt); this.arena.update(raw, this.clock, this.fx, this.player.pos.clone().lerp(this.enemy.pos, 0.5));
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
      if (d > 2.3) { p.keys.add('KeyW'); } else { p.keys.delete('KeyW'); if (r < 0.5) p.queue('light'); else if (r < 0.65) p.queue('kick'); else if (r < 0.75) p.queue('heavy'); else if (r < 0.8) p.queue('lightning'); else if (r < 0.88) p.queue('dash', p.moveDir()); }
      if (Math.random() < 0.1) p.keys.add('ShiftLeft'); else p.keys.delete('ShiftLeft'); }
  }
}
