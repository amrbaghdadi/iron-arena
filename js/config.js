// ============================================================
//  CONFIG: change values here to tune the game.
// ============================================================
export const CONFIG = {
  title: 'IRON ARENA',
  gameSpeed: 1.0,        // global speed (0.5 = slow motion, 1.5 = fast)
  hitPower: 1.0,         // multiplies ALL damage (player and enemy)
  playerSpeed: 1.0,      // player movement speed multiplier
  roundTime: 60,         // seconds per round
  roundsToWin: 2,        // best of 3
  arenaSize: 80,         // arena is 80 x 80
  arenaLimit: 35,        // fighters stay inside this radius
  maxHP: 100,
  maxStamina: 100,
  specialMax: 100,
  gravity: 24,
  jumpSpeed: 8.2,
  modelUrl: 'assets/characterRIGGED.glb', // optional. If missing, a built-in fighter is used
  modelHeight: 1.8,
  shake: 1.0,            // camera shake strength
  bloom: true,
  difficulty: 'medium',
  padDeadzone: 0.15,
  // Gamepad button numbers (standard mapping, PlayStation names). Change a number to remap a button.
  // 0 X, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 8 Share, 9 Options, 10 L3, 11 R3, 12 D-up, 13 D-down, 14 D-left, 15 D-right
  // v3: R1 lightning, R2 fire, L2 block, L1 = modifier (L1+Square freeze, L1+Triangle shockwave), R3 kick, L3 lock-on (1P)
  padMap: { jump: 0, dash: 1, light: 2, heavy: 3, mod: 4, lightning: 5, fire: 7, blockA: 6, blockB: -1, kick: 11, lock: 10, pause: 9, confirm: 0,
            freeze: 2, shock: 3, dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15 },
  quality: 'medium',
  difficulties: {
    easy:   { label: 'Easy',   power: 0.25, reaction: 0.55, aggression: 0.32, block: 0.18, dodge: 0.08, comboMax: 2, speed: 0.85, damage: 0.7, decide: 0.75, adapt: 0.0,  mistake: 0.30 },
    medium: { label: 'Medium', power: 0.6, reaction: 0.32, aggression: 0.55, block: 0.38, dodge: 0.22, comboMax: 3, speed: 1.0,  damage: 1.0, decide: 0.5,  adapt: 0.55, mistake: 0.15 },
    hard:   { label: 'Hard',   power: 1.0, reaction: 0.17, aggression: 0.78, block: 0.55, dodge: 0.38, comboMax: 5, speed: 1.1,  damage: 1.2, decide: 0.32, adapt: 1.0,  mistake: 0.07 }
  }
};

// ============================================================
//  MOVES: damage, timing (seconds), knockback, stamina cost...
//  startup = time before the hit is live, active = hit window,
//  cancel  = time after which the next combo hit can be chained.
// ============================================================
export const MOVES = {
  jab:      { limb: 'handR', dur: 0.36, startup: 0.10, active: 0.08, cancel: 0.20, dmg: 5,  kb: 1.6, stam: 4,  lunge: 3.5, stun: 0.28, hitStop: 0.05, shake: 0.04, snd: 'light' },
  cross:    { limb: 'handL', dur: 0.40, startup: 0.11, active: 0.08, cancel: 0.22, dmg: 6,  kb: 2.0, stam: 5,  lunge: 3.5, stun: 0.30, hitStop: 0.06, shake: 0.05, snd: 'light' },
  hook:     { limb: 'handR', dur: 0.48, startup: 0.15, active: 0.09, cancel: 0.28, dmg: 8,  kb: 2.6, stam: 7,  lunge: 3.0, stun: 0.36, hitStop: 0.07, shake: 0.07, snd: 'med' },
  uppercut: { limb: 'handL', dur: 0.52, startup: 0.16, active: 0.09, cancel: 0.30, dmg: 9,  kb: 3.2, stam: 8,  lunge: 2.5, stun: 0.42, hitStop: 0.08, shake: 0.09, snd: 'med' },
  spinKick: { limb: 'footR', dur: 0.80, startup: 0.30, active: 0.14, cancel: 9,    dmg: 13, kb: 7.0, stam: 12, lunge: 4.0, stun: 0.5,  hitStop: 0.11, shake: 0.18, snd: 'heavy', knockdown: true, spin: true, hitR: 0.3 },
  kick:     { limb: 'footR', dur: 0.56, startup: 0.19, active: 0.10, cancel: 0.34, dmg: 9,  kb: 3.6, stam: 8,  lunge: 3.0, stun: 0.40, hitStop: 0.08, shake: 0.09, snd: 'med' },
  heavy:    { limb: 'handR', dur: 0.90, startup: 0.40, active: 0.12, cancel: 9,    dmg: 17, kb: 6.0, stam: 18, lunge: 5.0, stun: 0.60, hitStop: 0.12, shake: 0.2,  snd: 'heavy', guardBreak: true },
  special:  { limb: 'handR', dur: 1.25, startup: 0.45, active: 0.28, cancel: 9,    dmg: 32, kb: 10,  stam: 0,  lunge: 11,  stun: 0.8,  hitStop: 0.20, shake: 0.38, snd: 'special', knockdown: true, blockMult: 0.5, invuln: 0.55, hitR: 0.38 }
};
export const LIGHT_CHAIN = ['jab', 'cross', 'hook', 'uppercut', 'spinKick'];

export const FIGHTER = {
  walkSpeed: 3.4, runSpeed: 6.4, blockSpeed: 1.6, dashSpeed: 15, dashTime: 0.30, dashIFrames: 0.22, dashCost: 15,
  parryWindow: 0.18, staminaRegen: 22, staminaDelay: 0.8, comboWindow: 0.4, bufferTime: 0.28,
  hurt: { chest: 0.32, head: 0.2, hips: 0.28 }
};

// ============================================================
//  POWERS (v3). cost = mana. cooldown in seconds. All numbers can be changed here.
//  startup/active/dur are the cast animation timings (release = moment the power is launched).
// ============================================================
export const MANA = { max: 100, start: 100, regen: 4, hitGain: 0.7, hitTakenGain: 0.35 };
export const POWERS = {
  lightning: { label: 'LIGHTNING', color: '#9bd0ff', needsSpecial: true, cost: 0, cooldown: 0, startup: 1.0, active: 0.25, dur: 1.9, lockAt: 0.6,
               dmg: 40, executeBelow: 35, radius: 2.2, blockMult: 0.4, kb: 9 },
  fire:      { label: 'FIRE', color: '#ff7a2a', cost: 35, cooldown: 9, startup: 0.3, active: 0.2, dur: 0.75, speed: 13, life: 1.5, radius: 0.55,
               currentFraction: 0.5, blockDivisor: 4, burnTime: 3, burnDps: 3, kb: 4 },
  freeze:    { label: 'FREEZE', color: '#7ad8ff', cost: 25, cooldown: 10, startup: 0.3, active: 0.2, dur: 0.7, speed: 17, life: 1.2, radius: 0.6,
               dmg: 5, freezeTime: 0.7, slowTime: 3.5 },
  shock:     { label: 'SHOCK', color: '#e8c56a', cost: 30, cooldown: 7, startup: 0.35, active: 0.2, dur: 0.8, speed: 14, maxRadius: 7.5,
               dmg: 10, kb: 11, blockMult: 0.5 }
};
export const POWER_IDS = ['lightning', 'fire', 'freeze', 'shock'];
export const QUALITY = {
  low:    { label: 'Low',    pr: 1,    shadow: 1024, bloom: false, ssao: false, dof: false, grain: false, ca: false, torchLights: 2 },
  medium: { label: 'Medium', pr: 1.25, shadow: 2048, bloom: true,  ssao: false, dof: false, grain: true,  ca: true,  torchLights: 4 },
  high:   { label: 'High',   pr: 1.75, shadow: 4096, bloom: true,  ssao: true,  dof: false, grain: true,  ca: true,  torchLights: 5 },
  ultra:  { label: 'Ultra',  pr: 2,    shadow: 4096, bloom: true,  ssao: true,  dof: true,  grain: true,  ca: true,  torchLights: 6 }
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
