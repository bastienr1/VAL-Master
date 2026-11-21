/**
 * Clove's Ruse as the game runs it, for the board's animated smoke
 * (docs/plays-editor-v2.md §2.21). Every figure here is read from the game
 * files (13.10): `GameObject_Smonk_NewSmoke` and its `_PDS` child (cast after
 * death), their parent `GameObject_NewSmokeZone_Parent`, and the effect
 * `SMO_E_Smoke-10m_PS`. The replays agree: a Ruse actor lives 15.0 s, 7.0 s
 * when cast after death.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `ruseSmokeGl.ts`.
 */

export type RuseCast = 'alive' | 'afterDeath'

export const RUSE = {
  /** The sphere that blocks sight, world cm: 0.026 × 410 × the hollow sphere's 37.32. */
  visionCm: 397.8,
  /** The shell that is seen, world cm: the 50 cm mesh × 10 × the effect's 0.82. */
  shellCm: 410,
  /** SmokeDelayTime: it is announced, not yet there. */
  delayMs: 1000,
  /** SmokeExpandDuration. */
  expandMs: 750,
  /** SmokeDuration, from the end of the delay. */
  durationMs: { alive: 13500, afterDeath: 5500 } as Record<RuseCast, number>,
  /** SmokeContractDuration. */
  contractMs: 500,
  /** SmokeEndTelegraphDuration: the warning before it goes. */
  endWarnMs: 1500,
} as const

export type RusePhase = 'incoming' | 'forming' | 'active' | 'ending' | 'dissolving' | 'gone'

export interface RuseState {
  phase: RusePhase
  /** How much of its sight-blocking radius is up, 0…1. */
  vision: number
  /** The shell's radius as a share of `shellCm`; 0 draws nothing. */
  scale: number
  /** The dissolve cut: −1 leaves it whole, 1.05 has eaten all of it. */
  dissolve: number
  /** 0 dissolves in from the centre (forming), 1 out in wisps (ending). */
  mode: 0 | 1
  /** The ground ripple of the announcement, 0…1; −1 when there is none. */
  ripple: number
  /** The glow as it forms, 1…0. */
  flash: number
  /** The warning before it ends, 0…1; 0 when there is none. */
  warn: number
  /** Seconds the smoke's own textures have been drifting. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3

/** `Curve_Smonk_E_SmokeExpand`: nothing for a third of the time, then it snaps open. */
const EXPAND: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.34, 0], [0.36, 0.5], [0.5, 0.95], [1, 1]]

export function ruseExpand(x: number): number {
  const at = clamp01(x)
  for (let i = 1; i < EXPAND.length; i++) {
    const [x1, y1] = EXPAND[i]
    if (at <= x1) {
      const [x0, y0] = EXPAND[i - 1]
      return lerp(y0, y1, (at - x0) / (x1 - x0))
    }
  }
  return 1
}

/** `Curve_Smonk_E_SmokeContract`: whole until 80 %, then gone. */
export const ruseContract = (x: number): number => (x <= 0.8 ? 1 : 0)

/** How long a Ruse actor lives, ms: delay, duration, contract. */
export const ruseTotalMs = (cast: RuseCast): number => RUSE.delayMs + RUSE.durationMs[cast] + RUSE.contractMs

/**
 * The smoke `ageMs` after its actor appeared (a replay effect's start). The
 * same age always gives the same picture, so a paused or scrubbed replay shows
 * the smoke as it was at that moment.
 */
export function ruseState(ageMs: number, cast: RuseCast): RuseState {
  const { delayMs, expandMs, contractMs, endWarnMs } = RUSE
  const end = delayMs + RUSE.durationMs[cast]
  const state: RuseState = { phase: 'gone', vision: 0, scale: 0, dissolve: -1, mode: 0, ripple: -1, flash: 0, warn: 0, materialTime: Math.max(0, ageMs - delayMs) / 1000 }
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return state
  if (ageMs < delayMs) {
    // A small orb where it will form, and a ripple on the ground out to its footprint.
    state.phase = 'incoming'
    state.scale = 0.35 * lerp(0.31, 1, easeOut(ageMs / (delayMs * 0.95)))
    state.ripple = ageMs / delayMs
    state.materialTime = (ageMs / 1000) * 3
    return state
  }
  const since = ageMs - delayMs
  state.flash = clamp01(1 - since / 500)
  if (ageMs < end) {
    const form = clamp01(since / expandMs)
    state.vision = ruseExpand(since / expandMs)
    // The effect starts a tenth too big and settles.
    state.scale = 1 + 0.1 * (1 - easeOut(since / 600))
    state.dissolve = lerp(1.05, -0.45, form * form * (3 - 2 * form))
    state.phase = since < expandMs ? 'forming' : ageMs >= end - endWarnMs ? 'ending' : 'active'
    if (state.phase === 'ending') state.warn = (ageMs - (end - endWarnMs)) / endWarnMs
    return state
  }
  const out = (ageMs - end) / contractMs
  state.phase = 'dissolving'
  state.vision = ruseContract(out)
  state.scale = 1
  state.mode = 1
  state.dissolve = lerp(-0.45, 1.05, out)
  state.warn = 1
  return state
}

/** A Ruse with no clock (placed in a strat): formed and whole, its textures at `seconds`. */
export function ruseIdle(seconds: number): RuseState {
  return { phase: 'active', vision: 1, scale: 1, dissolve: -1, mode: 0, ripple: -1, flash: 0, warn: 0, materialTime: seconds }
}

/** True for Clove's Ruse: the E of the agent the game files call Smonk. */
export function isRuse(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'clove'
}
