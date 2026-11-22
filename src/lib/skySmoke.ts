/**
 * Brimstone's Sky Smoke as the game runs it, for the board's animated smoke.
 * Every figure here is read from the game files (13.10):
 * `GameObject_Sarge_4_Smoke_ProductionNEW` (cast through
 * `GameObject_Sarge_4_SmokeManager_Production`), its parent
 * `GameObject_NewSmokeZone_Parent`, the loop effect `Sarge_E_SmokeBomb_FOE`
 * (one asset for both teams), `Sarge_E_SmokeBomb_Incoming`, the outro
 * `Sarge_E_SmokeBomb_Outro` and the end warning `PS_SmokeWarn`. The replays
 * agree: a Sky Smoke actor lives 20.75 s (1,039 seen, median 20.747 s).
 *
 * The prototype is `VAL-Master-Plays/prototypes/sky-smoke` in the vault. Two
 * things differ on the board: the 150 m drop of the canister is left out (from
 * straight above it never leaves the landing point), and the game's 1.4 s
 * outro, which outlives the actor, is played 2.2× faster inside the 0.5 s
 * contract so the last frame a replay shows is nearly gone.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `skySmokeGl.ts`.
 */

export const SKY_SMOKE = {
  /** The sphere that blocks sight, world cm: VisionBlockingSphere 1 × 410 (the hollow sphere 0.026829 × 410 × 37.32 = 410.5). */
  visionCm: 410,
  /** The shell that is seen, world cm: Sarge_E_SmokeBomb_Dome_HighRes 42.66 × SmokeGL size 9.2 × the effect's 1.09. */
  shellCm: 427.8,
  /** The translucent outer veil, world cm: the same dome × SmokeBombDetails 9.7 × 1.09. */
  veilCm: 451,
  /** The bright birth shell, world cm: the dome × SmokeDissolveBirth 8.3 × 1.09 (it grows to × 1.058). */
  birthCm: 386.3,
  /** The landing marker, world cm: Sarge_E_Smokebomb_UI 59.5 × 6.8, a sphere 65 cm above the ground. */
  markerCm: 404.6,
  /** The end warning's shell, world cm: Dome_LowRes 42.66 × Smoke Size 10.4 (FXC_Sarge_4_SmokeZone_EndTelegraph). */
  warnCm: 443.7,
  /** The impact shockwave, world cm: Sarge_E_SmokeBomb_SmokeRingImpact 269.77 × 0.8 × 1.09; it grows × 3. */
  shockCm: 235.2,
  /** The ground stain, world cm: SmokeDecal size 435 × 1.09. */
  decalCm: 474.15,
  /** SmokeDelayTime: the canister is falling (FXC_Sarge_4_SmokeIncoming: 150 m in this time). */
  delayMs: 1000,
  /** SmokeExpandDuration. */
  expandMs: 750,
  /** SmokeDuration, from the end of the delay. */
  durationMs: 19250,
  /** SmokeContractDuration (GameObject_NewSmokeZone_Parent). */
  contractMs: 500,
  /** SmokeEndTelegraphDuration: the warning before it goes. */
  endWarnMs: 1500,
  /** The warning effect's own life (FXC_Sarge_4_SmokeZone_EndTelegraph Lifetime 2.45). */
  warnLifeMs: 2450,
  /** The outro's body erosion (SmokeGL, AlphaDissolve 1 → 0) and its fade and darkening (SmokeGLTrans, colour 1 → 0.1). */
  outroErodeMs: 1200,
  outroFadeMs: 1400,
} as const

export type SkySmokePhase = 'incoming' | 'forming' | 'active' | 'ending' | 'dissolving' | 'gone'

/** One sprite of the impact burst (`SmokeBurst`, 4 × 4 sheet `SmokePoof_4x4_RadialBlur`), drawn at the centre. */
export interface SkyPuff {
  /** Width, world cm. */
  sizeCm: number
  alpha: number
  /** Sheet frame, 0…15. */
  frame: number
  /** Radians. */
  rot: number
  /** ColorScaleOverLife, 5 → 1. */
  heat: number
}

export interface SkySmokeState {
  phase: SkySmokePhase
  /** How much of its sight-blocking radius is up, 0…1. */
  vision: number
  /** The body's radius as a share of `shellCm`; 0 draws no body. */
  scale: number
  /** How much of the body the outro has eaten, 0 whole … 1 gone. */
  dissolve: number
  /** The end warning's strength, 0…1; 0 when there is none. */
  warn: number
  /** Seconds the warning has been up (it turns −0.04 a second). */
  warnSeconds: number
  /** The impact flash, 1…0. */
  flash: number
  /** Seconds the smoke's own textures have been drifting. */
  materialTime: number
  /** Landing marker strength and the growing ring (radius in cm) inside it. */
  markerA: number
  growCm: number
  growA: number
  /** Shockwave: radius cm, alpha, heat (colour scale), age 0…1. */
  shockCm: number
  shockA: number
  shockHeat: number
  shockAge: number
  /** Birth shell: radius cm, alpha, heat, how much is left by its erosion (1 all … 0 none). */
  birthCm: number
  birthA: number
  birthHeat: number
  birthKeep: number
  /** Body alpha, heat (colour scale while it is born, 3.98 → 1) and darkening as it goes (1 → 0.1). */
  bodyA: number
  bodyHeat: number
  bodyDark: number
  /** Outer veil: on or off, and its erosion threshold (≈0 whole, ≈1 gone). */
  veilA: number
  veilErosion: number
  /** Ground stain radius cm and strength. */
  decalCm: number
  decalA: number
  puffs: SkyPuff[]
}

type Table = ReadonlyArray<readonly [number, number]>

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
function tab(k: Table, x: number): number {
  if (x <= k[0][0]) return k[0][1]
  for (let i = 1; i < k.length; i++) {
    if (x <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]))
  }
  return k[k.length - 1][1]
}
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Particle tables from the loop and incoming systems (seconds since the particle spawned, or its life 0…1).
const T = {
  smoothSize: [[0, 0.5], [0.14, 0.811], [0.278, 0.96], [0.4175, 1]],
  smoothAlpha: [[0, 0], [0.0925, 0.129], [0.1875, 0.425], [0.28, 0.752], [0.3725, 0.972], [0.465, 1]],
  smoothHeat: [[0, 3.981], [0.08, 3.457], [0.1625, 2.908], [0.2425, 2.368], [0.3225, 1.874], [0.4025, 1.459], [0.485, 1.16], [0.565, 1.011], [0.645, 1]],
  birthSize: [[0, 0.289], [0.065, 0.513], [0.131, 0.736], [0.198, 0.875], [0.264, 0.946], [0.33, 0.996], [0.396, 1.029], [0.463, 1.046], [0.529, 1.051], [0.662, 1.055], [1, 1.058]],
  birthAlpha: [[0, 1], [0.7, 0.996], [0.8, 0.667], [0.9, 0.333], [1, 0]],
  birthHeat: [[0, 3.967], [0.066, 2.941], [0.13, 1.96], [0.194, 1.48], [0.29, 1.166], [0.386, 0.912], [0.483, 0.71], [0.579, 0.557], [0.675, 0.446], [0.771, 0.371], [0.836, 0.339], [1, 0.31]],
  detailsErosion: [[0, 0.989], [0.143, 0.501], [0.286, 0.193], [0.429, 0.027], [0.572, -0.034], [1, 0.046]],
  burstSize: [[0, 1], [0.129, 1.789], [0.257, 2.374], [0.386, 2.787], [0.514, 3.056], [0.643, 3.211], [0.771, 3.283], [0.9, 3.3]],
  burstAlpha: [[0.3, 0], [0.4, 0.993], [0.5, 1], [0.7, 0.996], [0.8, 0.667], [0.9, 0.333], [1, 0]],
  burstHeat: [[0, 5], [0.133, 4.712], [0.267, 4.019], [0.4, 3.176], [0.533, 2.435], [0.667, 1.823], [0.8, 1.329], [0.933, 1.04], [1, 1]],
  burstFrame: [[0, 0], [0.113, 0.729], [0.227, 2.631], [0.34, 5.28], [0.453, 8.249], [0.567, 11.111], [0.68, 13.44], [0.793, 14.808], [0.85, 15]],
  shockSize: [[0, 0.05], [0.032, 0.395], [0.064, 0.761], [0.097, 1.123], [0.129, 1.459], [0.161, 1.748], [0.193, 1.965], [0.225, 2.095], [0.29, 2.288], [0.387, 2.512], [0.483, 2.672], [0.58, 2.783], [0.676, 2.87], [0.773, 2.935], [0.87, 2.98], [1, 3]],
  shockAlpha: [[0, 1], [0.114, 0.945], [0.229, 0.802], [0.343, 0.606], [0.457, 0.394], [0.571, 0.198], [0.686, 0.055], [0.8, 0]],
  shockHeat: [[0, 5], [0.103, 4.342], [0.206, 2.866], [0.31, 1.32], [0.413, 0.449], [0.516, 0.282], [0.619, 0.172], [0.8, 0.1]],
  markerAlpha: [[0, 0], [0.29, 1], [0.871, 1], [0.903, 0.961], [0.935, 0.645], [0.968, 0.323], [1, 0]],
  growAlpha: [[0, 0], [0.047, 0], [0.055, 0.02], [0.299, 0.997], [0.953, 1], [0.961, 0.96], [1, 0]],
  warnIn: [[0, 0.04], [0.129, 0.789], [0.226, 1]],
} satisfies Record<string, Table>

/** `SmokeBurst`: five at once, then ten a second for half a second. */
const BURST_SPAWNS = [0, 0, 0, 0, 0, 0.05, 0.15, 0.25, 0.35, 0.45]
/** How many burst sprites the painter draws. */
export const SKY_PUFFS = BURST_SPAWNS.length

/** `Curve_Sarge_4_SmokeExpand`: 0.1 at once, linear to 0.3 at a third, then two cubic keys up to 1. */
export function skySmokeExpand(x: number): number {
  const at = clamp01(x)
  const hermite = (p0: number, m0: number, p1: number, m1: number, dt: number, s: number) => {
    const s2 = s * s
    const s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * dt * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * dt * m1
  }
  if (at <= 0.33) return lerp(0.1, 0.3, at / 0.33)
  if (at <= 0.38) return hermite(0.3, 0.9, 0.6, 0.70539546, 0.05, (at - 0.33) / 0.05)
  return hermite(0.6, 0.70540184, 1, 0.24266456, 0.62, (at - 0.38) / 0.62)
}

/** `Curve_Sarge_4_SmokeContract`: whole until 43 %, then gone. */
export const skySmokeContract = (x: number): number => (x <= 0.43 ? 1 : 0)

/** How long a Sky Smoke actor lives, ms: delay, duration, contract. */
export const skySmokeTotalMs = (): number => SKY_SMOKE.delayMs + SKY_SMOKE.durationMs + SKY_SMOKE.contractMs

function empty(materialTime: number): SkySmokeState {
  return {
    phase: 'gone', vision: 0, scale: 0, dissolve: 0, warn: 0, warnSeconds: 0, flash: 0, materialTime,
    markerA: 0, growCm: 0, growA: 0, shockCm: 0, shockA: 0, shockHeat: 0, shockAge: 0,
    birthCm: 0, birthA: 0, birthHeat: 0, birthKeep: 0, bodyA: 0, bodyHeat: 1, bodyDark: 1,
    veilA: 0, veilErosion: 1, decalCm: 0, decalA: 0, puffs: [],
  }
}

/**
 * The smoke `ageMs` after its actor appeared (a replay effect's start). The
 * same age always gives the same picture, so a paused or scrubbed replay shows
 * the smoke as it was at that moment.
 */
export function skySmokeState(ageMs: number): SkySmokeState {
  const { delayMs, expandMs, contractMs, endWarnMs } = SKY_SMOKE
  const end = delayMs + SKY_SMOKE.durationMs
  const state = empty(Math.max(0, ageMs) / 1000)
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return state
  const t = ageMs / 1000

  // The landing marker and its growing ring: 2 s each from the cast (they end under the smoke).
  if (t < 2) {
    const x = t / 2
    state.markerA = tab(T.markerAlpha, x)
    state.growCm = SKY_SMOKE.markerCm * Math.min(1, x / 0.98)
    state.growA = tab(T.growAlpha, x)
  }
  if (ageMs < delayMs) {
    state.phase = 'incoming'
    return state
  }

  const tau = (ageMs - delayMs) / 1000
  // The impact: a flash, the shockwave, the hot burst of puffs.
  state.flash = tau < 0.15 ? 1 - tau / 0.15 : 0
  if (tau < 0.8) {
    state.shockCm = SKY_SMOKE.shockCm * tab(T.shockSize, tau)
    state.shockA = tab(T.shockAlpha, tau)
    state.shockHeat = tab(T.shockHeat, tau)
    state.shockAge = tau
  }
  BURST_SPAWNS.forEach((born, i) => {
    const life = 0.5 + 0.1 * hash(i + 3)
    const age = tau - born
    if (age < 0 || age >= life) return
    const x = age / life
    state.puffs.push({ sizeCm: (160 + 170 * born) * tab(T.burstSize, x), alpha: tab(T.burstAlpha, x), frame: tab(T.burstFrame, x), rot: hash(i + 20) * Math.PI * 2, heat: tab(T.burstHeat, x) })
  })
  // The birth shell (SmokeDissolveBirth): 0.15 s in, 1.4 s life, bright, eroding away from a third of its life.
  const b = (tau - 0.15) / 1.4
  if (b >= 0 && b < 1) {
    state.birthCm = SKY_SMOKE.birthCm * tab(T.birthSize, b)
    state.birthA = tab(T.birthAlpha, b)
    state.birthHeat = tab(T.birthHeat, b)
    state.birthKeep = b < 0.3 ? 1 : lerp(1, 0, (b - 0.3) / 0.7)
  }
  // The body (SmokeSmoothBirth, then SmokeGL from 2.85 s): grows in from 0.35 s, whole by 0.77 s.
  const a = tau - 0.35
  if (a >= 0) {
    state.scale = tab(T.smoothSize, a)
    state.bodyA = tab(T.smoothAlpha, a)
    state.bodyHeat = tab(T.smoothHeat, a)
    // The ground stain (SmokeDecalGLBirth: × 0.55 → 1 in 0.35 s).
    state.decalCm = SKY_SMOKE.decalCm * lerp(0.55, 1, clamp01(a / 0.348))
    state.decalA = clamp01(a / 0.2)
  }
  // The outer veil (SmokeBombDetailsBirth at 0.5 s, 0.6 s life, then SmokeBombDetails).
  const d = tau - 0.5
  if (d >= 0) {
    state.veilA = 1
    state.veilErosion = d < 0.6 ? tab(T.detailsErosion, d / 0.6) : 0.005
  }

  if (ageMs >= end - endWarnMs) {
    const w = (ageMs - (end - endWarnMs)) / 1000
    state.warnSeconds = w
    state.warn = clamp01(tab(T.warnIn, w / (SKY_SMOKE.warnLifeMs / 1000)))
  }
  if (ageMs < end) {
    state.vision = tau * 1000 < expandMs ? skySmokeExpand((tau * 1000) / expandMs) : 1
    state.phase = tau * 1000 < expandMs ? 'forming' : ageMs >= end - endWarnMs ? 'ending' : 'active'
    return state
  }

  // Contract and outro. The game's outro (1.2 s erosion, 1.4 s fade) outlives the actor; here it
  // runs 2.2× faster so it is nearly done when the actor goes.
  const x = (ageMs - end) / contractMs
  const outro = x * contractMs * 2.2
  state.phase = 'dissolving'
  state.vision = skySmokeContract(x)
  state.scale = 1
  state.bodyA = 1
  state.bodyHeat = 1
  state.dissolve = clamp01(outro / SKY_SMOKE.outroErodeMs)
  state.bodyDark = lerp(1, 0.1, clamp01(outro / SKY_SMOKE.outroFadeMs))
  state.veilErosion = lerp(0.005, 0.984, clamp01(outro / 1000))
  state.decalA = 1 - x
  state.warn *= 1 - x
  return state
}

/** A Sky Smoke with no clock (placed in a strat): formed and whole, its textures at `seconds`. */
export function skySmokeIdle(seconds: number): SkySmokeState {
  return {
    ...empty(seconds),
    phase: 'active', vision: 1, scale: 1, bodyA: 1,
    veilA: 1, veilErosion: 0.005, decalCm: SKY_SMOKE.decalCm, decalA: 1,
  }
}

/** True for Brimstone's Sky Smoke. */
export function isSkySmoke(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'brimstone'
}
