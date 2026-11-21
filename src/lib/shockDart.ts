/**
 * Sova's Shock Bolt as the game runs it, for the board's animated blast
 * (docs/plays-editor-v2.md §2.22). Every figure is read from the game files
 * (13.10): the tuning table `AbilityTuning_Hunter_4_BoltExplosive`, the actor
 * `GameObject_Hunter_4_ExplosiveBolt_Explosion` and its two effects,
 * `Hunter_4_AOE_Radius_VFX` (arming) and `Hunter_4_AOE_Revised_Vfx` (blast).
 * The replays agree: the actor appears as the dart lands and lives 4.0 s.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `shockDartPaint.ts`.
 */

export const SHOCK = {
  /** OuterRadius: where the damage ends, world cm. */
  outerCm: 400,
  /** InnerRadius: full damage inside it. */
  innerCm: 150,
  /** MaxDamage inside the inner radius, MinDamage at the outer. */
  maxDamage: 75,
  minDamage: 30,
  /** InitialDelay: it lands, then waits this long. */
  armMs: 400,
  /** How long the blast is seen: its emitters live 0.2 to 0.4 s, the last from 0.15 s. */
  blastMs: 450,
  /** InitialLifeSpan: how long the replay keeps its actor, with nothing to see after the blast. */
  actorMs: 4000,
  /** The ball that shows its reach while it arms, and the ball of the blast. */
  warnCm: 406,
  ballCm: 403,
} as const

/** How long there is something to draw: the arming and the blast. */
export const SHOCK_SHOWN_MS = SHOCK.armMs + SHOCK.blastMs

export type ShockPhase = 'armed' | 'blast' | 'spent' | 'gone'

export interface ShockState {
  phase: ShockPhase
  /** How far through its arming, 0…1. */
  arm: number
  /** Seconds since it went off; −1 before. */
  blast: number
  /** Where the arming spark's flipbook is, 0…1. */
  spark: number
}

/** A Shock Dart `ageMs` after it landed (the start of the replay's explosion actor). */
export function shockState(ageMs: number): ShockState {
  if (!(ageMs >= 0) || ageMs >= SHOCK.actorMs) return { phase: 'gone', arm: 0, blast: -1, spark: 0 }
  if (ageMs < SHOCK.armMs) {
    const arm = ageMs / SHOCK.armMs
    // The arming effect is 0.5 s long and is cut short by the blast at 0.4 s.
    return { phase: 'armed', arm, blast: -1, spark: arm * 0.8 }
  }
  const since = ageMs - SHOCK.armMs
  if (since < SHOCK.blastMs) return { phase: 'blast', arm: 1, blast: since / 1000, spark: 0 }
  return { phase: 'spent', arm: 1, blast: -1, spark: 0 }
}

/** A Shock Dart with no clock (placed in a strat): armed, its reach showing, its spark crackling. */
export function shockIdle(seconds: number): ShockState {
  const turn = (seconds * 0.9) % 1
  return { phase: 'armed', arm: 0.75, blast: -1, spark: (turn < 0 ? turn + 1 : turn) * 0.75 }
}

/** A value in 0…1 that is always the same for the same bolt and index, so a paused frame does not flicker. */
export function shockRandom(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** A number for an element id: the same bolt has the same lightning on every frame. */
export function shockSeed(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 9973
  return hash + 1
}

/** A curve given as evenly spaced samples over 0…1, as the effects store theirs. */
export function sampleCurve(table: readonly number[], x: number): number {
  const at = Math.min(1, Math.max(0, x)) * (table.length - 1)
  const i = Math.min(table.length - 2, Math.floor(at))
  return table[i] + (table[i + 1] - table[i]) * (at - i)
}

/** True for Sova's Shock Bolt: the Q of the agent the game files call Hunter. */
export function isShockDart(agent: string, slot: string | null): boolean {
  return slot === 'Ability1' && agent.trim().toLowerCase() === 'sova'
}
