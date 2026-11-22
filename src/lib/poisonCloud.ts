/**
 * Viper's Poison Cloud as the game runs it, for the board's animated smoke.
 * Every figure is read from the game files (13.10): the ability
 * `Ability_Pandemic_4_SmokeGrenade` (fuel states), the cloud actor
 * `GameObject_Pandemic_4_SmokeZone` and its parent `GameObject_Zone_Smoke_Parent`,
 * Viper's `Pandemic_PC` fuel system, and the effects `Pandemic_4_SmokeDome`
 * and `Pandemic_4_SmokeDome_Outro`.
 *
 * The cloud runs on fuel: one SmokeZone actor lives for one on-period, from
 * the moment Viper turns it on until 1.75 s after it goes off (she turns it
 * off, or the tank runs dry). The replays agree: the longest of 23 clouds lived
 * 14.25 s (a full tank to empty), the shortest 4.25 s (turned off at the first
 * moment allowed).
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `poisonCloudGl.ts`.
 */

export const POISON_CLOUD = {
  /** The hidden sphere that blocks sight, world cm: SM_Sphere_Simple_UV_Vertical_InnerMesh 37.32 × Scene 0.02667 × SmokeSphere 470 (Viper's override of the parent's 371). */
  visionCm: 467.8,
  /** The opaque shell that is seen, world cm: PandemicSphere_FrontHalf_new 396.27 × particle size 1.155 (OutterShell_Static). */
  shellCm: 457.7,
  /** The translucent wisp layer, world cm: the same mesh × 1.2 (NewShape). */
  haloCm: 475.5,
  /** SmokeZone DelayTime: the dome effect and the sight sphere start here. */
  delayMs: 600,
  /** SmokeExpandTime: the sight sphere grows over this (Timeline_3 ScalePercentage). */
  expandMs: 1300,
  /** OutterShell_Intro lifetime: the shell dissolves in and is whole after this. */
  introMs: 1500,
  /** TimedState_DelayBeforeFuelDrain. */
  drainDelayMs: 500,
  /** StateComponent_InitialDrainFuel: it cannot be turned off yet (the off input lives only in ConstantDrainFuel). */
  lockMs: 2000,
  /** StateComponent_ConstantDrainFuel DrainPerSecond, tank per second: 12 s from full. */
  drainPerS: 1 / 12,
  /** Pandemic_PC Comp_AbilityFuelSystem BaseFuelChangePerSecond, tank per second: 30 s from empty. */
  refillPerS: 1 / 30,
  /** StateComponent_HasFuelAmount RequiredFuelAmount: the least fuel that turns it on. */
  minFuel: 0.3,
  /** Pandemic_PC WarningStartLevel: the low-fuel beep (a sound only in the game). */
  warnFuel: 0.3,
  /** Timeline_4 TurnOffCollision: sight returns this long after it goes off. */
  sightOffMs: 800,
  /** Pandemic_4_SmokeDome_Outro: the shell is gone this long after it goes off. */
  outroMs: 1000,
  /** Off to the actor's end, measured in the replays (4.252 s and 14.25 s lives). */
  fallMs: 1750,
  /** DeactivateCooldown: off until it can go on again. */
  cooldownMs: 5500,
  /** A full tank: drain delay + 12 s + fall. */
  fullLifeMs: 500 + 12000 + 1750,
} as const

export type PoisonCloudPhase = 'opening' | 'rising' | 'up' | 'lowfuel' | 'fading' | 'clearing' | 'gone'

export interface PoisonPuff {
  /** Radius as a share of `shellCm`. */
  r: number
  /** Opacity, 0…1. */
  a: number
  /** Texture offset, 0…1. */
  seed: number
}

export interface PoisonCloudState {
  phase: PoisonCloudPhase
  /** How much of its sight-blocking radius is up, 0…1 (1.1 while it puffs out as it goes). */
  vision: number
  /** Whether the dome is drawn at all. */
  dome: boolean
  /** The shell's radius as a share of `shellCm`; 0 draws no shell. */
  scale: number
  /** How much of the shell is eaten away, 0 whole … 1 gone (the in- and out-dissolves together). */
  dissolve: number
  /** The forming shell's dissolve, 0…1 (1 is whole). */
  disIn: number
  /** The dark inner shell's dissolve as it forms, 0…1. */
  innerDis: number
  /** Progress of the outro, 0…1; 0 when it has not begun. */
  outro: number
  /** The outro's dissolve, 1 whole … 0.1. */
  outroDis: number
  /** The translucent wisp layer, 0…1. */
  halo: number
  /** Colour boost while it forms, 2…1. */
  boost: number
  /** The centre glow as the dome starts, 1…0, and its radius in cm. */
  glow: number
  glowCm: number
  /** The canister's activation flash, 1…0. */
  flash: number
  /** The gas burst that fills it as it forms. */
  puffs: PoisonPuff[]
  /** The canister's gem, 1 lit … 0.15 when off. */
  gem: number
  /** Fuel left, assuming a full tank when it went on (the replays do not say). */
  fuel: number
  /** Low fuel, 0…1 (below 30 %); 0 when there is none. */
  warn: number
  /** Seconds the dome's textures have been drifting. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** A baked particle table: `vals` evenly spaced over [0, span] of the particle's life. */
function table(x: number, vals: readonly number[], span: number): number {
  const f = clamp01(x / span) * (vals.length - 1)
  const i = Math.min(vals.length - 2, Math.floor(f))
  return lerp(vals[i], vals[i + 1], f - i)
}
/** OutterShell_Intro SizeMultiplyLife (over 70 % of life) and Dissolve. */
const INTRO_SIZE = [0, 0.276, 0.504, 0.687, 0.827, 0.924, 0.981, 1]
const INTRO_DIS = [0, 0.055, 0.198, 0.394, 0.606, 0.802, 0.945, 1]
/** OutterShell_Outro_Trans Dissolve. */
const OUTRO_DIS = [1, 0.95, 0.822, 0.646, 0.454, 0.278, 0.15, 0.1]
/** GasBurst SizeMultiplyLife (over 90 % of life). */
const PUFF_SIZE = [0, 0.534, 0.985, 1.352, 1.636, 1.839, 1.96, 2.0]

/** Timeline_3 ScalePercentage: cubic from (0, 0) leaving at 0.251 to (1, 1) arriving at 2.835. */
export function poisonCloudExpand(x: number): number {
  const at = clamp01(x)
  const x2 = at * at
  const x3 = x2 * at
  return (x3 - 2 * x2 + at) * 0.2509162 + (-2 * x3 + 3 * x2) + (x3 - x2) * 2.8354373
}

/** Timeline_4 ScalePercentage, `s` seconds after it goes off: holds until 0.36 s, then grows to 1.1 at 0.96 s. */
export const poisonCloudContract = (s: number): number => (s <= 0.36 ? 1 : lerp(1, 1.1, clamp01((s - 0.36) / 0.6)))

/** How long the actor lives, ms: the replay's own life when known, else a full tank. */
export const poisonCloudTotalMs = (lifeMs: number | null): number => (lifeMs !== null && lifeMs > 0 ? lifeMs : POISON_CLOUD.fullLifeMs)

/** When it goes off, ms after it went on. */
export const poisonCloudOffMs = (lifeMs: number | null): number => Math.max(0, poisonCloudTotalMs(lifeMs) - POISON_CLOUD.fallMs)

function emptyState(ageMs: number): PoisonCloudState {
  return {
    phase: 'gone', vision: 0, dome: false, scale: 0, dissolve: 1, disIn: 0, innerDis: 0, outro: 0, outroDis: 1, halo: 0,
    boost: 1, glow: 0, glowCm: 0, flash: 0, puffs: [], gem: 0, fuel: 1, warn: 0,
    materialTime: Math.max(0, ageMs - POISON_CLOUD.delayMs) / 1000,
  }
}

/**
 * The cloud `ageMs` after its actor appeared (a replay effect's start: the
 * moment Viper turned it on). `lifeMs` is the actor's whole life on the replay
 * when known; it goes off at `lifeMs − 1750`. Null assumes a full tank (14.25 s).
 * The same age always gives the same picture.
 */
export function poisonCloudState(ageMs: number, lifeMs: number | null): PoisonCloudState {
  const P = POISON_CLOUD
  const total = poisonCloudTotalMs(lifeMs)
  const off = poisonCloudOffMs(lifeMs)
  const state = emptyState(ageMs)
  if (!(ageMs >= 0) || ageMs >= total) return state

  const drained = (Math.max(0, Math.min(ageMs, off) - P.drainDelayMs) / 1000) * P.drainPerS
  const refilled = (Math.max(0, ageMs - off) / 1000) * P.refillPerS
  state.fuel = clamp01(1 - drained + refilled)
  state.gem = ageMs < off ? 1 : lerp(1, 0.15, clamp01((ageMs - off) / 500))
  // The canister vents as it goes on (Pandemic_4_Activate: flash, wide gas burst, sparks).
  state.flash = clamp01(1 - ageMs / 600)

  // Sight: the hidden sphere scales with ScalePercentage; collision goes off 0.8 s into the contract.
  if (ageMs >= P.delayMs && ageMs < off) state.vision = ageMs < P.delayMs + P.expandMs ? poisonCloudExpand((ageMs - P.delayMs) / P.expandMs) : 1
  if (ageMs >= off) state.vision = ageMs - off < P.sightOffMs ? poisonCloudContract((ageMs - off) / 1000) : 0

  const d = ageMs - P.delayMs // since the dome effect started
  if (d >= 0) {
    const life = d / P.introMs
    state.dome = true
    state.scale = d < P.introMs ? table(life, INTRO_SIZE, 0.7) : 1
    state.disIn = d < P.introMs ? table(life, INTRO_DIS, 1) : 1
    state.innerDis = d < P.introMs ? 0.9 * life : 1
    state.boost = d < P.introMs ? lerp(2, 1, life) : 1
    state.halo = clamp01((d - 750) / 500)
    // centerglow: 150 cm, size ×0.2→1 over half its 0.9 s life, alpha 1→0, towards the camera.
    if (d < 900) {
      state.glow = 1 - d / 900
      state.glowCm = 75 * lerp(0.2, 1, clamp01(d / 450))
    }
    // GasBurst: 1 + 10/s for 0.5 s, 330–450 cm, growing ×2 over 90 % of its 0.6–0.7 s life.
    for (let k = 0; k < 6; k++) {
      const age = d / 1000 - k * 0.1
      const span = 0.6 + 0.1 * hash(k + 1)
      if (age < 0 || age >= span) continue
      const size = 330 + 120 * hash(k + 7)
      const f = age / span
      state.puffs.push({ r: (0.5 * size * table(f, PUFF_SIZE, 0.9)) / P.shellCm, a: 0.8 * (1 - f ** 3), seed: hash(k + 3) })
    }
  }
  if (ageMs >= off) {
    const x = ageMs - off
    state.outro = clamp01(x / P.outroMs)
    state.outroDis = x < P.outroMs ? table(x / P.outroMs, OUTRO_DIS, 1) : 0
    state.scale = x < P.outroMs ? lerp(1, 1.1, state.outro) : 0
    state.halo = clamp01(1 - x / 500)
    if (x >= P.outroMs) state.dome = false
  }
  state.dissolve = !state.dome ? 1 : state.outro > 0 ? 1 - state.outroDis : 1 - state.disIn
  state.warn = ageMs < off && state.fuel <= P.warnFuel ? clamp01((P.warnFuel - state.fuel) / P.warnFuel) : 0

  if (ageMs < P.delayMs) state.phase = 'opening'
  else if (ageMs < off && d < P.introMs) state.phase = 'rising'
  else if (ageMs < off) state.phase = state.fuel <= P.warnFuel ? 'lowfuel' : 'up'
  else if (ageMs < off + P.outroMs) state.phase = 'fading'
  else state.phase = 'clearing'
  return state
}

/** A cloud with no clock (placed in a strat): up and whole, its textures at `seconds`. */
export function poisonCloudIdle(seconds: number): PoisonCloudState {
  return {
    ...emptyState(0), phase: 'up', vision: 1, dome: true, scale: 1, dissolve: 0, disIn: 1, innerDis: 1, halo: 1, gem: 1,
    materialTime: seconds,
  }
}

/** True for Viper's Poison Cloud. */
export function isPoisonCloud(agent: string, slot: string | null): boolean {
  return slot === 'Ability1' && agent.trim().toLowerCase() === 'viper'
}
