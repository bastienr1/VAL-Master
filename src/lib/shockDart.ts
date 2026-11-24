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

/**
 * The bolt in flight (§2.26): `Hunter_4_TeslaTrail_VFX`, the ribbon of
 * lightning it leaves behind, and `Hunter_4_Ricochet`, the flash where it
 * bounces.
 */
export const SHOCK_FLIGHT = {
  /** The ribbon lives this long behind the bolt. */
  trailMs: 400,
  /** The ribbon's width, world cm. */
  trailCm: 20,
  /** The flash at a bounce: its longest branch lives this long. */
  ricochetMs: 450,
  /** The flash's soft glow, 5 m across. */
  ricochetCm: 250,
  /** A turn in the track sharper than this is a bounce, degrees. */
  bounceDeg: 25,
  /** How fast a bolt flies along the map, cm/s: the median of the replays' flights. */
  speedCmS: 3000,
  /** What a bounce leaves of its speed: the replays show 45 to 65 %. */
  bounceKeeps: 0.55,
} as const

/** One point of a bolt's way: where, and how long ago it was there (ms; negative for what is still ahead). */
export interface ShockWayPoint {
  x: number
  y: number
  ago: number
}

export interface ShockBounce {
  x: number
  y: number
  ago: number
  /** The way off the wall, radians. */
  off: number
}

export interface ShockWay {
  /** Oldest first, each passed later than the one before. */
  points: ShockWayPoint[]
  bounces: ShockBounce[]
}

/** How far a corner may be from the samples round it, as a share of the time between them. */
const CORNER_SLACK = 1.5

/**
 * The way a bolt went from the samples of its track. A replay samples a bolt
 * every 0.1 to 0.2 s, so a bounce falls between two samples and the line from
 * one to the next cuts the corner: the track then turns twice, and the wall is
 * where the line it came in on meets the line it left on. A single turn is a
 * bounce at the sample itself.
 *
 * `exact` says the points are the way itself (a line drawn on the board, not
 * samples of a flight): every turn is then a bounce where it is, and no
 * corner is moved.
 */
export function shockWay(course: readonly ShockWayPoint[], exact = false): ShockWay {
  const pts: ShockWayPoint[] = []
  for (const p of course) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.ago)) continue
    const last = pts[pts.length - 1]
    if (last && (p.ago >= last.ago || Math.hypot(p.x - last.x, p.y - last.y) < 1e-6)) continue
    pts.push({ x: p.x, y: p.y, ago: p.ago })
  }
  if (pts.length < 3) return { points: pts, bounces: [] }

  /** From `a` to `b`: the unit vector and the distance. */
  const leg = (a: ShockWayPoint, b: ShockWayPoint) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    return [(b.x - a.x) / d, (b.y - a.y) / d, d] as const
  }
  const sharp = Math.cos((SHOCK_FLIGHT.bounceDeg * Math.PI) / 180)
  const turns = (i: number) => {
    if (i < 1 || i > pts.length - 2) return false
    const [ax, ay] = leg(pts[i - 1], pts[i])
    const [bx, by] = leg(pts[i], pts[i + 1])
    return ax * bx + ay * by < sharp
  }

  const points: ShockWayPoint[] = [pts[0]]
  const bounces: ShockBounce[] = []
  for (let i = 1; i < pts.length; i++) {
    const here = pts[i]
    if (!turns(i)) {
      points.push(here)
      continue
    }
    const [ix, iy, cameCm] = leg(pts[i - 1], here)
    if (!exact && turns(i + 1)) {
      const next = pts[i + 1]
      const [ox, oy, leftCm] = leg(next, pts[i + 2])
      const cross = ix * oy - iy * ox
      if (Math.abs(cross) > 1e-6) {
        // here + s·in = next − u·out
        const [ex, ey] = [next.x - here.x, next.y - here.y]
        const s = (ex * oy - ey * ox) / cross
        const u = (ix * ey - iy * ex) / cross
        const speedIn = cameCm / (pts[i - 1].ago - here.ago)
        const speedOut = leftCm / (next.ago - pts[i + 2].ago)
        const between = here.ago - next.ago
        if (s >= 0 && u >= 0 && s / speedIn + u / speedOut <= between * CORNER_SLACK) {
          const ago = Math.min(here.ago, Math.max(next.ago, here.ago - s / speedIn))
          const corner = { x: here.x + ix * s, y: here.y + iy * s, ago }
          points.push(here)
          if (ago < here.ago && ago > next.ago) points.push(corner)
          points.push(next)
          bounces.push({ ...corner, off: Math.atan2(oy - iy, ox - ix) })
          i++
          continue
        }
      }
    }
    const [ox, oy] = leg(here, pts[i + 1])
    points.push(here)
    bounces.push({ x: here.x, y: here.y, ago: here.ago, off: Math.atan2(oy - iy, ox - ix) })
  }
  return { points, bounces }
}

/** Where the bolt was `ago` ms back along its way, and which way it was heading (radians). Null for a way with no length. */
export function shockWayAt(way: ShockWay, ago: number): { x: number; y: number; heading: number } | null {
  const { points } = way
  if (points.length < 2) return null
  let j = 0
  while (j < points.length - 2 && points[j + 1].ago > ago) j++
  const [a, b] = [points[j], points[j + 1]]
  const f = Math.min(1, Math.max(0, (a.ago - ago) / (a.ago - b.ago)))
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) }
}

/** How long ago the head of the way was passed: 0 while the bolt flies, the time since it landed after. */
export function shockHeadAgo(way: ShockWay): number {
  const last = way.points[way.points.length - 1]
  return last ? Math.max(0, last.ago) : 0
}

/** Whether there is lightning to draw: the bolt is flying, or its ribbon or a bounce's flash has not died yet. */
export function shockFlightShown(way: ShockWay): boolean {
  if (way.points.length < 2) return false
  return shockHeadAgo(way) < SHOCK_FLIGHT.trailMs || way.bounces.some(b => b.ago >= 0 && b.ago < SHOCK_FLIGHT.ricochetMs)
}

/** One point of a throw drawn on the board, with when the bolt gets there, ms after it is thrown. */
export interface ShockThrowPoint {
  x: number
  y: number
  at: number
}

/**
 * A line drawn on the board as a flight: when a bolt thrown along `points`
 * reaches each of them, at the speed bolts fly in the replays, slower after
 * every bounce (a turn sharper than a track's bounce). `cmPerUnit` is how many
 * world centimetres one unit of the points is.
 */
export function shockThrow(points: ReadonlyArray<readonly [number, number]>, cmPerUnit: number): { points: ShockThrowPoint[]; ms: number } {
  const sharp = Math.cos((SHOCK_FLIGHT.bounceDeg * Math.PI) / 180)
  let speed = SHOCK_FLIGHT.speedCmS / 1000
  let at = 0
  const timed: ShockThrowPoint[] = []
  points.forEach(([x, y], i) => {
    if (i > 0) {
      const [px, py] = points[i - 1]
      const cm = Math.hypot(x - px, y - py) * cmPerUnit
      if (i > 1 && cm > 0) {
        const [qx, qy] = points[i - 2]
        const before = Math.hypot(px - qx, py - qy)
        const now = Math.hypot(x - px, y - py)
        if (before > 0 && ((px - qx) * (x - px) + (py - qy) * (y - py)) / (before * now) < sharp) speed *= SHOCK_FLIGHT.bounceKeeps
      }
      at += cm / speed
    }
    timed.push({ x, y, at })
  })
  return { points: timed, ms: at }
}

/** True for Sova's Shock Bolt: the Q of the agent the game files call Hunter. */
export function isShockDart(agent: string, slot: string | null): boolean {
  return slot === 'Ability1' && agent.trim().toLowerCase() === 'sova'
}
