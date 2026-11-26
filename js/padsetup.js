/* Pad setup wizard: "press the button for X", one step at a time. Works with any pad
   (standard or generic/clone layouts, buttons, trigger-axes and hat-switch D-pads). Saved in localStorage. */
const STEPS = [
  ['jump', 'JUMP', 'قفز'], ['light', 'LIGHT PUNCH', 'ضربة خفيفة'], ['heavy', 'HEAVY ATTACK', 'ضربة قوية'], ['dash', 'DASH / DODGE', 'مراوغة (داش)'],
  ['block', 'BLOCK (hold)', 'دفاع (اضغط واستمر)'], ['lightning', 'LIGHTNING (ultimate)', 'الصاعقة'], ['fire', 'FIREBALL', 'كرة النار'], ['freeze', 'FREEZE', 'التجميد'],
  ['shock', 'SHOCKWAVE', 'موجة الصدمة'], ['kick', 'KICK', 'ركلة'], ['pause', 'PAUSE', 'إيقاف مؤقت'],
  ['dup', 'D-PAD UP (optional)', 'سهم فوق (اختياري)'], ['ddown', 'D-PAD DOWN (optional)', 'سهم تحت (اختياري)'], ['dleft', 'D-PAD LEFT (optional)', 'سهم شمال (اختياري)'], ['dright', 'D-PAD RIGHT (optional)', 'سهم يمين (اختياري)']
];
const $ = (id) => document.getElementById(id);
export class PadSetup {
  constructor(game) { this.g = game; this.active = false; this.i = 0; this.wait = 0; }
  open(back) {
    const P = this.g.pads; this.back = back || 'menu';
    this.active = true; this.i = 0; this.base = null; this.wait = 0.5; this.undo = JSON.parse(JSON.stringify(P.map));
    this.g.ui.show('padsetup'); this.render(); $('wizLast').textContent = P.count ? '' : 'No pad seen yet. Press any button on the pad.';
  }
  close(save) {
    const P = this.g.pads; this.active = false; this.g.ui.hide('padsetup');
    if (save) { P.save(); this.g.renderPadMap(); this.g.ui.toast('Pad buttons saved. / تم حفظ الأزرار', 3500); } else P.map = this.undo;
  }
  render() {
    const st = STEPS[this.i];
    if (!st) { $('wizEn').textContent = 'ALL DONE'; $('wizAr').textContent = 'خلصنا! الأزرار اتحفظت'; $('wizCount').textContent = ''; $('btnWizSkip').classList.add('hidden'); $('btnWizDone').textContent = 'SAVE & FINISH'; return; }
    $('btnWizSkip').classList.remove('hidden'); $('btnWizDone').textContent = this.i >= 11 ? 'SAVE & FINISH / حفظ' : 'CANCEL / إلغاء';
    $('wizEn').textContent = 'Press the button for: ' + st[1]; $('wizAr').textContent = 'دوس على زرار: ' + st[2];
    $('wizCount').textContent = (this.i + 1) + ' / ' + STEPS.length + (this.i >= 11 ? '   (SKIP if your D-pad already works)' : '');
  }
  next() { this.i++; this.wait = 0.4; this.render(); }
  prev() { if (this.i > 0) { this.i--; this.wait = 0.3; this.render(); } }
  skip() { this.next(); }
  update(dt) {
    if (!this.active) return; const P = this.g.pads, c = P.cur[0]; if (!c || !P.connected(0)) { this.base = null; return; }
    if (!this.base) this.base = { a: [...c.a] };
    if (this.wait > 0) { this.wait -= dt; return; }
    const st = STEPS[this.i]; if (!st) return;
    // wait until everything is released before accepting the next input
    if (this.releasing) { if (!c.b.some(Boolean)) this.releasing = false; else return; }
    let found = null;
    for (let k = 0; k < c.b.length; k++) if (c.b[k]) { found = 'b' + k; break; }
    if (!found) for (let k = 4; k < c.a.length; k++) { const d = c.a[k] - this.base.a[k]; if (Math.abs(d) > 0.8 && Math.abs(c.a[k]) <= 1.05) { found = 'a' + k + (d > 0 ? '+' : '-'); break; } }
    if (!found) return;
    P.setBinding(st[0], found); $('wizLast').textContent = 'Detected: ' + (found[0] === 'b' ? 'Button ' + found.slice(1) : 'Axis ' + found.slice(1)) + '  ✓';
    this.releasing = true; this.next();
  }
}
