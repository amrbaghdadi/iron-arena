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
  difficulties: {
    easy:   { label: 'Easy',   reaction: 0.55, aggression: 0.32, block: 0.18, dodge: 0.08, comboMax: 2, speed: 0.85, damage: 0.7, decide: 0.75, adapt: 0.0,  mistake: 0.30 },
    medium: { label: 'Medium', reaction: 0.32, aggression: 0.55, block: 0.38, dodge: 0.22, comboMax: 3, speed: 1.0,  damage: 1.0, decide: 0.5,  adapt: 0.55, mistake: 0.15 },
    hard:   { label: 'Hard',   reaction: 0.17, aggression: 0.78, block: 0.55, dodge: 0.38, comboMax: 5, speed: 1.1,  damage: 1.2, decide: 0.32, adapt: 1.0,  mistake: 0.07 }
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
