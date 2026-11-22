/**
 * Omen's Dark Cover as the game runs it, for the board's animated smoke. Every
 * figure here is read from the game files (13.10): the actor `Zone_Wraith_4_Smoke`
 * and its parent `GameObject_NewSmokeZone_Parent`, the curves
 * `Curve_Wraith_4_Smoke_Expand` / `_Contract`, and the effects
 * `Wraith_4_DomeTwist_ALLY_VFX` (the smoke) and `Wraith_4_DomeTwistOutro_ALLY_VFX`
 * (its end). The replays agree: the Zone actor lives 16.0 s (592 smokes, median
 * 15.998 s). The projectile that carries it (`Projectile_Wraith_4_Smoke`) waits
 * 1.0 s at the spot before the Zone appears and ends 0.5 s after; the board draws
 * that itself, so age 0 here is the Zone's start.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `darkCoverGl.ts`. Prototype: VAL-Master-Plays/prototypes/dark-cover.
 */

export const DARK_COVER = {
  /** The sphere that blocks sight, world cm: HollowVisionBlockingSphere 0.02683 × 410 × the mesh's 37.32 (VisionBlockingSphere 410). */
  visionCm: 410.5,
  /** The dark orb that is seen, world cm: Wraith_Dome 50.05 × 10 × the effect's 0.82 (Dome_Inner). */
  shellCm: 410.4,
  /** The outer wisp shell, world cm: Wraith_Dome × 10.05 × 0.82 (Dome_outter). */
  wispCm: 412.5,
  /** The overlay wisps' reach, world cm: Wraith_Dome_Overlay equator 57.4 × 10 × 0.82 (Dome_Overlay). */
  overlayCm: 470.7,
  /** The ground stain, world cm: ParticleCube 1.313 × 750 × 0.82 × the decal's Radius Scale 0.7 (its falloff is rebuilt). */
  decalCm: 566,
  /** SmokeDelayTime: it bursts, sight is not yet blocked. */
  delayMs: 300,
  /** SmokeExpandDuration (the parent's). */
  expandMs: 500,
  /** SmokeDuration, from the end of the delay. */
  durationMs: 14700,
  /** SmokeContractDuration. */
  contractMs: 1000,
  /** SmokeEndTelegraphDuration: the warning before it goes. */
  endWarnMs: 1500,
  /** The warning effect's own life (FXC_SmokeZone_EndTelegraph Lifetime 1.75). */
  warnLifeMs: 1750,
  /** FXC_Wraith_4_SmokeZone_EndTelegraph Rotation Speed, turns per second. */
  warnTurnsPerS: 0.045,
} as const

export type DarkCoverPhase = 'bursting' | 'forming' | 'active' | 'ending' | 'dissolving' | 'gone'

/** One of the two dark rings (radial_anim, a 3 × 3 flipbook). */
export interface DarkCoverRing {
  /** Flipbook frame, 0…8. */
  frame: number
  /** 0 draws nothing. */
  alpha: number
  /** The sprite's half width, world cm. */
  halfCm: number
}

export interface DarkCoverState {
  phase: DarkCoverPhase
  /** How much of its sight-blocking radius is up, 0…1. */
  vision: number
  /** The dark orb's radius as a share of `shellCm`; 0 draws no orb. */
  scale: number
  /** DissolveDownUP's Mask_Life: 0.5 shows only the rim, 1 the whole dome (it fills from the rim up). */
  fill: number
  /** DissolveDownUP's alpha as it forms, 0…1. */
  alpha: number
  /** The outro's opacity mask: 1 leaves it whole, 0 or less has eaten all of it (the game runs it 1 → −5). */
  dissolve: number
  /** EmissiveLERP: the glowing cell walls, 0…1. */
  emissive: number
  /** The outer wisp shell: size share, opacity 0…1, brightness (1 normal; the outro flashes it white). */
  wisp: { scale: number; alpha: number; glow: number }
  /** The overlay wisps: size share and opacity 0…1. */
  overlay: { scale: number; alpha: number }
  /** The ground stain: opacity 0…1 and brightness (1 normal, brighter as it fades out). */
  decal: { alpha: number; tint: number }
  /** The Zone's own dark ring (1025 cm) and the projectile's DarkRing at the same spot (500 → 1250 cm). */
  rings: { zone: DarkCoverRing; orb: DarkCoverRing }
  /** The burst, 1…0 (the zone ring's opacity). */
  flash: number
  /** How far through the 1.75 s end warning, 0…1; 0 when there is none. */
  warn: number
  /** Seconds the smoke's own textures have been drifting. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/** A cooked particle lookup table: values evenly spaced from `t0` over `span`, clamped at both ends. */
function table(x: number, t0: number, span: number, values: readonly number[]): number {
  const f = clamp01((x - t0) / span) * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(f))
  return lerp(values[i], values[i + 1], f - i)
}

/** DissolveDownUP SizeMultiplyLife: 0.2 → 1.06 → 1 in the first 5 % of its 2 s life. */
const SIZE_IN = [0.2, 0.2618, 0.4169, 0.6198, 0.8251, 0.9871, 1.0606, 1.0]
/** DissolveDownUP AlphaOverLife, first 15 % of its life. */
const ALPHA_IN = [0, 0.0554, 0.1983, 0.3936, 0.6064, 0.8017, 0.9446, 1]
/** The outro's DissolveDownUP AlphaOverLife, first 25 % of its 2 s life. */
const ALPHA_OUT = [1, 0.9233, 0.7084, 0.3758, -0.0525, -0.5556, -1.112, -1.7005, -2.2995, -2.888, -3.4444, -3.9475, -4.3758, -4.7084, -4.9233, -5]
/** The projectile's DarkRing: flipbook frames and size over its 0.45 s life. */
const ORB_RING_FRAMES = [0, 1.89, 3.5956, 5.0778, 6.2981, 7.2177, 7.7979, 8]
const ORB_RING_SIZE = [1, 1.4504, 1.8076, 2.0801, 2.2769, 2.4067, 2.4781, 2.5]

/** `Curve_Wraith_4_Smoke_Expand`: (0, 0) → (0.01, 1), linear: sight is blocked almost at once. */
export const darkCoverExpand = (x: number): number => clamp01(x / 0.01)

/** `Curve_Wraith_4_Smoke_Contract`: 1, held (constant key at 0.1) until 0.25, then 0. */
export const darkCoverContract = (x: number): number => (x < 0.25 ? 1 : 0)

/** How long a Dark Cover Zone lives, ms: delay, duration, contract (InitialLifeSpan 16.0). */
export const darkCoverTotalMs = (): number => DARK_COVER.delayMs + DARK_COVER.durationMs + DARK_COVER.contractMs

const NO_RING: DarkCoverRing = { frame: 0, alpha: 0, halfCm: 0 }

function blank(materialTime: number): DarkCoverState {
  return {
    phase: 'gone', vision: 0, scale: 0, fill: 1, alpha: 0, dissolve: 1, emissive: 0,
    wisp: { scale: 1, alpha: 0, glow: 1 }, overlay: { scale: 1, alpha: 0 }, decal: { alpha: 0, tint: 1 },
    rings: { zone: NO_RING, orb: NO_RING }, flash: 0, warn: 0, materialTime,
  }
}

/**
 * The smoke `ageMs` after its Zone actor appeared (a replay effect's start). The
 * same age always gives the same picture, so a paused or scrubbed replay shows the
 * smoke as it was at that moment. `enemy` gives the `_FOE` outro (its wisps fade
 * without the white flash); the dome itself has no team colour in the files.
 */
export function darkCoverState(ageMs: number, enemy = false): DarkCoverState {
  const { delayMs, expandMs, durationMs, contractMs, endWarnMs, warnLifeMs } = DARK_COVER
  const t = ageMs / 1000
  const state = blank(Math.max(0, t))
  const end = delayMs + durationMs
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return state

  state.phase = ageMs < delayMs ? 'bursting' : ageMs < delayMs + expandMs ? 'forming' : ageMs < end - endWarnMs ? 'active' : ageMs < end ? 'ending' : 'dissolving'
  state.vision = ageMs < delayMs ? 0 : ageMs < end ? darkCoverExpand((ageMs - delayMs) / expandMs) : darkCoverContract((ageMs - end) / contractMs)

  // Both dark rings start 0.2 s in: the Zone's radial_anim and the projectile's DarkRing.
  if (t >= 0.2 && t < 0.55) {
    const f = (t - 0.2) / 0.35
    state.rings.zone = { frame: 8 * f, alpha: 1 - f, halfCm: 512.5 * table(f, 0, 1, [1, 1.1385, 1.1304, 1.1]) }
    state.flash = 1 - f
  }
  if (t >= 0.2 && t < 0.65) {
    const f = (t - 0.2) / 0.45
    state.rings.orb = { frame: table(f, -0.0229, 0.8, ORB_RING_FRAMES), alpha: 1, halfCm: 250 * table(f, 0, 0.5, ORB_RING_SIZE) }
  }
  const warnAt = end - endWarnMs
  if (ageMs >= warnAt && ageMs < warnAt + warnLifeMs) state.warn = (ageMs - warnAt) / warnLifeMs

  if (ageMs < end) {
    if (t >= 0.2) {
      // DissolveDownUP, life 2 s; SphereStatic holds its end values from 2.2 s.
      const f = (t - 0.2) / 2
      state.scale = table(f, 0, 0.05, SIZE_IN)
      state.alpha = table(f, 0, 0.15, ALPHA_IN)
      state.fill = lerp(0.5, 1, clamp01(f / 0.15))
      state.emissive = table(f, -0.0219, 0.125, [0, 1])
      state.overlay.alpha = table(f, -0.07, 0.35, [0, 1]) // Wisp2Intro, then Wisp2Loop
    }
    if (t >= 0.3) {
      state.wisp.alpha = clamp01((t - 0.3) / 2) // WispsUp 0 → 1.25 over 2 s, then WispStatic
      state.decal.alpha = 1
    }
    return state
  }

  // The outro (Wraith_4_DomeTwistOutro), from the contract.
  const x = t - end / 1000
  state.scale = 1
  state.alpha = 1
  state.fill = 1
  state.dissolve = table(x / 2, 0, 0.25, ALPHA_OUT)
  state.emissive = table(x / 2, -0.0219, 0.125, [1, 0])
  state.wisp = enemy
    ? { scale: 1, alpha: table(x / 2, -0.05, 0.25, [1, 0]), glow: 1 - clamp01(x / 2) }
    : { scale: table(x, -0.02, 0.2, [1, 1.1]), alpha: table(x, -0.045, 0.3, [1, 0]), glow: 3.3 }
  state.overlay = { scale: table(x, -0.16, 0.8, [1, 1.25]), alpha: table(x, 0, 0.5, [1, 0]) }
  state.decal = { alpha: table(x, -0.1275, 0.85, [1, 0]), tint: 1.81 * clamp01(1 - x) }
  return state
}

/** A Dark Cover with no clock (placed in a strat): formed and whole, its textures at `seconds`. */
export function darkCoverIdle(seconds: number): DarkCoverState {
  return {
    ...blank(seconds),
    phase: 'active', vision: 1, scale: 1, alpha: 1, emissive: 1,
    wisp: { scale: 1, alpha: 1, glow: 1 }, overlay: { scale: 1, alpha: 1 }, decal: { alpha: 1, tint: 1 },
  }
}

/** True for Omen's Dark Cover. */
export function isDarkCover(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'omen'
}
