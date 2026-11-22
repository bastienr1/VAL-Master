/**
 * Harbor's Cove as the game runs it, for the board's animated smoke. Every
 * figure here is read from the game files (13.10): `GameObject_Mage_E_WorldSmoke`,
 * its parent `GameObject_NewSmokeZone_Parent`, the water dome
 * `Mage_Q_Water_Shield_WaterOnly` with `Mage_Q_Dome_V2_MI`, and the start and
 * outro effects `Mage_Q_WorldSmoke_Activate_3P` / `Mage_Q_WaterShield_Deactivate_3P`.
 * The replays agree: a Cove actor lives 20.25 s (94 smokes, median 20.245 s).
 *
 * Only the smoke as cast: REACTIVATE turns it into a 680 HP shield, but the
 * replays record no separate shield actor, so the board cannot tell. A broken
 * shield or the round's end cuts the actor short; the board just stops drawing it.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `coveSmokeGl.ts`.
 */

export const COVE = {
  /** The sphere that blocks sight, world cm: VisionBlockingSphere 1 × 460 (the parent's 410 is overridden). */
  visionCm: 460,
  /** The water that is seen, world cm: Mage_Q_Dome_Outer_100_SM 50 cm × Shield_Scale 9.4 × 0.985. */
  shellCm: 463,
  /** SmokeDelayTime: it has landed, sight is not blocked yet. */
  delayMs: 500,
  /** SmokeExpandDuration, with Curve_Smoke_Expand_Instant: sight is blocked in full at once. */
  expandMs: 500,
  /** SmokeDuration (GameObject_Mage_E_WorldSmoke), from the end of the delay. */
  durationMs: 19250,
  /** SmokeContractDuration, with Curve_Smoke_Contract_Instant: sight is back at once. */
  contractMs: 500,
  /** SmokeEndTelegraphDuration: the warning before it goes. */
  endWarnMs: 1500,
  /** Mage_Q_WorldSmoke_Activate_3P: the dome dissolves in over its 0.6 s particle life. */
  activateMs: 600,
  /** Mage_Q_WaterShield_Deactivate_3P: the dome dissolves out over 0.4 s once the contract starts. */
  outroMs: 400,
} as const

export type CovePhase = 'landing' | 'forming' | 'active' | 'ending' | 'dissolving' | 'gone'

export interface CoveState {
  phase: CovePhase
  /** How much of its sight-blocking radius is up, 0…1 (the game's curves are instant). */
  vision: number
  /** The dome's radius as a share of `shellCm`; 0 draws nothing. */
  scale: number
  /** The dissolve: 0 whole, 1 gone. */
  dissolve: number
  /** How much ground foam is left round its foot, 0…1 (the decal's dynamic parameter). */
  ring: number
  /** The warning before it ends, 0…1; 0 when there is none. */
  warn: number
  /** Not used by Cove (it has no forming glow); kept for the shared shape. */
  flash: number
  /** Seconds the water's own textures have been drifting. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/** An evenly spaced Cascade table over 0…1, read piecewise-linear. */
function table(values: readonly number[], x: number): number {
  const at = clamp01(x) * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(at))
  return lerp(values[i], values[i + 1], at - i)
}

/** The dome's Dissolve/SpeedLerp tables as 0 = whole, 1 = gone: (param + 0.75) / 0.75, clamped. */
const ACTIVATE = [0.377, -0.094, -0.547, -0.75].map(v => clamp01((v + 0.75) / 0.75))
const OUTRO = [-0.75, -0.722, -0.694, -0.65, -0.575, -0.452, -0.266, 0].map(v => clamp01((v + 0.75) / 0.75))

/** How long a Cove actor lives, ms: delay, duration, contract. */
export const coveTotalMs = (): number => COVE.delayMs + COVE.durationMs + COVE.contractMs

/**
 * The smoke `ageMs` after its actor appeared (a replay effect's start; the
 * projectile's flight and its 1.0 s hang come before). The same age always
 * gives the same picture.
 */
export function coveState(ageMs: number): CoveState {
  const { delayMs, expandMs, contractMs, endWarnMs, activateMs, outroMs } = COVE
  const end = delayMs + COVE.durationMs
  const state: CoveState = { phase: 'gone', vision: 0, scale: 0, dissolve: 1, ring: 0, warn: 0, flash: 0, materialTime: Math.max(0, ageMs) / 1000 }
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return state
  state.scale = 1
  if (ageMs < end) {
    state.dissolve = ageMs < activateMs ? table(ACTIVATE, ageMs / activateMs) : 0
    // The ground foam spreads to its full amount as it lands.
    state.ring = ageMs < delayMs ? table([0, 0.993], ageMs / delayMs) : 0.993
    state.vision = ageMs >= delayMs ? 1 : 0
    state.phase = ageMs < delayMs ? 'landing' : ageMs < delayMs + expandMs ? 'forming' : ageMs >= end - endWarnMs ? 'ending' : 'active'
    if (state.phase === 'ending') state.warn = (ageMs - (end - endWarnMs)) / endWarnMs
    return state
  }
  const out = (ageMs - end) / outroMs
  state.phase = 'dissolving'
  state.dissolve = table(OUTRO, out)
  state.ring = table([0.993, 0.001], out)
  state.warn = 1
  return state
}

/** A Cove with no clock (placed in a strat): formed and whole, its textures at `seconds`. */
export function coveIdle(seconds: number): CoveState {
  return { phase: 'active', vision: 1, scale: 1, dissolve: 0, ring: 0.993, warn: 0, flash: 0, materialTime: seconds }
}

/** True for Harbor's Cove. */
export function isCove(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'harbor'
}
