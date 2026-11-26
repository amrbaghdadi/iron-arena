// Web Audio: every sound and the reactive music are generated in code (no audio files).
export class AudioEngine {
  constructor() {
    this.ctx = null; this.muted = false;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.5 };
    this.intensity = 0; this.musicOn = false; this.nextStep = 0; this.mstep = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.comp = c.createDynamicsCompressor();
    this.master = c.createGain(); this.sfxG = c.createGain(); this.musicG = c.createGain();
    this.sfxG.connect(this.master); this.musicG.connect(this.master);
    this.master.connect(this.comp); this.comp.connect(c.destination);
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    // sustained pad for the music
    this.pad = [0, 7].map((semi, i) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55 * Math.pow(2, semi / 12); o.detune.value = i ? 7 : -7;
      const g = c.createGain(); g.gain.value = 0.0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      o.connect(f); f.connect(g); g.connect(this.musicG); o.start();
      return { o, g, f };
    });
  }
  applyVolumes() {
    if (!this.ctx) return;
    const m = this.muted ? 0 : this.vol.master;
    this.master.gain.value = m; this.sfxG.gain.value = this.vol.sfx; this.musicG.gain.value = this.vol.music * 0.6;
  }
  setVolume(k, v) { this.vol[k] = v; this.applyVolumes(); }
  setMuted(m) { this.muted = m; this.applyVolumes(); }
  tone(o) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f1, t); osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2 || o.f1), t + o.dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(o.dest || this.sfxG); osc.start(t); osc.stop(t + o.dur + 0.05);
  }
  noise(o) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + (o.delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = o.ft || 'lowpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f1, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2 || o.f1), t + o.dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f); f.connect(g); g.connect(o.dest || this.sfxG); s.start(t); s.stop(t + o.dur + 0.05);
  }
  whoosh(p = 1) { this.noise({ ft: 'bandpass', f1: 400, f2: 2200 * p, dur: 0.18 + 0.1 * p, vol: 0.18 * p, q: 0.8, attack: 0.06 }); }
  hit(p = 1) {
    this.noise({ ft: 'lowpass', f1: 3000, f2: 200, dur: 0.12 + 0.1 * p, vol: 0.5 * p });
    this.tone({ type: 'sine', f1: 150 * (1.2 - 0.2 * p), f2: 40, dur: 0.18 + 0.1 * p, vol: 0.7 * p });
  }
  block() { this.tone({ type: 'square', f1: 900, f2: 500, dur: 0.1, vol: 0.12 }); this.noise({ ft: 'highpass', f1: 3000, f2: 3000, dur: 0.08, vol: 0.2 }); this.tone({ type: 'sine', f1: 110, f2: 60, dur: 0.12, vol: 0.4 }); }
  parry() { this.tone({ type: 'triangle', f1: 1400, f2: 2100, dur: 0.25, vol: 0.25 }); this.tone({ type: 'sine', f1: 2800, f2: 2800, dur: 0.3, vol: 0.12, delay: 0.03 }); this.noise({ ft: 'highpass', f1: 5000, dur: 0.1, vol: 0.2 }); }
  dash() { this.noise({ ft: 'bandpass', f1: 800, f2: 3000, dur: 0.25, vol: 0.22, q: 0.6, attack: 0.08 }); }
  jump() { this.tone({ type: 'sine', f1: 200, f2: 420, dur: 0.12, vol: 0.1 }); }
  land() { this.noise({ ft: 'lowpass', f1: 500, f2: 100, dur: 0.12, vol: 0.25 }); }
  step() { this.noise({ ft: 'lowpass', f1: 400, f2: 150, dur: 0.06, vol: 0.06 }); }
  ko() { this.tone({ type: 'sine', f1: 90, f2: 25, dur: 1.4, vol: 0.9 }); this.noise({ ft: 'lowpass', f1: 2000, f2: 60, dur: 1.2, vol: 0.5 }); this.tone({ type: 'sawtooth', f1: 220, f2: 55, dur: 1.0, vol: 0.15, delay: 0.05 }); }
  special() { this.tone({ type: 'sawtooth', f1: 80, f2: 600, dur: 0.45, vol: 0.2, attack: 0.1 }); this.noise({ ft: 'bandpass', f1: 300, f2: 4000, dur: 0.5, vol: 0.3, q: 1.5, attack: 0.2 }); }
  bell() { [1, 2.76, 5.4].forEach((m, i) => this.tone({ type: 'sine', f1: 330 * m, f2: 330 * m, dur: 1.4 / (i + 1), vol: 0.22 / (i + 1) })); }
  ui() { this.tone({ type: 'triangle', f1: 600, f2: 800, dur: 0.07, vol: 0.12 }); }
  fight() { this.tone({ type: 'sawtooth', f1: 110, f2: 220, dur: 0.4, vol: 0.25 }); this.noise({ ft: 'lowpass', f1: 1500, f2: 100, dur: 0.4, vol: 0.3 }); }
  swing(name) { this.whoosh(name === 'heavy' || name === 'spinKick' || name === 'special' ? 1.5 : 0.8); }

  startMusic() { if (!this.ctx) return; this.musicOn = true; this.nextStep = this.ctx.currentTime + 0.1; this.mstep = 0; }
  stopMusic() { this.musicOn = false; if (this.pad) this.pad.forEach(p => p.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)); }
  setIntensity(x) { this.intensity = x; }
  update() {
    const c = this.ctx; if (!c || !this.musicOn) return;
    const I = this.intensity;
    this.pad.forEach((p, i) => { p.g.gain.setTargetAtTime(0.05 + 0.05 * I, c.currentTime, 0.4); p.f.frequency.setTargetAtTime(250 + 900 * I, c.currentTime, 0.3); });
    const bpm = 96 + 44 * I, stepDur = 60 / bpm / 2;
    while (this.nextStep < c.currentTime + 0.15) {
      const t = this.nextStep - c.currentTime, s = this.mstep % 16;
      if (s % 4 === 0) this.tone({ type: 'sine', f1: 120, f2: 40, dur: 0.2, vol: 0.55, delay: t, dest: this.musicG });
      if (s === 4 || s === 12) this.noise({ ft: 'bandpass', f1: 1800, f2: 900, dur: 0.12, vol: 0.25, delay: t, dest: this.musicG });
      if (I > 0.25 && s % 2 === 1) this.noise({ ft: 'highpass', f1: 7000, dur: 0.04, vol: 0.08, delay: t, dest: this.musicG });
      const bass = [0, 0, 12, 0, 0, 10, 0, 7, 0, 0, 12, 0, 3, 0, 5, 0][s];
      if (s % 2 === 0 || I > 0.6) this.tone({ type: 'sawtooth', f1: 55 * Math.pow(2, (bass + (this.mstep % 64 >= 32 ? 5 : 0)) / 12), f2: 55 * Math.pow(2, bass / 12) * 0.98, dur: stepDur * 1.6, vol: 0.12 + 0.08 * I, delay: t, dest: this.musicG });
      this.nextStep += stepDur; this.mstep++;
    }
  }
}
