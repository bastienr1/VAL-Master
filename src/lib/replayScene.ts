/**
 * What the minimap needs to know at one instant of a replay.
 *
 * The bundle stores 10 Hz samples; the map draws at 60 fps. These helpers find
 * the sample around a time, interpolate between two, and decide who is alive.
 * Pure, so the edge cases (death tails, revives, gaps) are unit-tested rather
 * than eyeballed on a canvas.
 */

import type { ReplayBundle, ReplayPawnSample, ReplayTrackSample } from './replayBundle'

/** Index of the last row whose time is ≤ `t`, or -1 when `t` is before the first row. */
export function sampleIndex(rows: ReadonlyArray<readonly [number, ...unknown[]]>, t: number): number {
  let lo = 0
  let hi = rows.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid][0] <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export interface ActorState {
  x: number
  y: number
  /** Degrees, 0–360. */
  yaw: number
}

export interface PlayerState extends ActorState {
  /** The track's own flag: it flips on the first sample after a death. See `isAliveAt`. */
  alive: boolean
  weapon: number | null
  /** Time of the sample this state was read from. See `isPresentAt`. */
  sampledAt: number
}

// Samples are 100 ms apart. A longer gap means the body stopped reporting (it
// does about 2.7 s after a death, until the next spawn), so there is nothing to
// interpolate towards: hold the last position.
const MAX_INTERPOLATION_GAP_MS = 250

function lerpAngle(a: number, b: number, k: number): number {
  const delta = ((b - a + 540) % 360) - 180
  return (a + delta * k + 360) % 360
}

function between<T extends ReplayTrackSample | ReplayPawnSample>(rows: T[], t: number): { a: T; b: T | null; k: number } | null {
  const i = sampleIndex(rows, t)
  if (i < 0) return null
  const a = rows[i]
  const b = rows[i + 1]
  if (!b || b[0] - a[0] > MAX_INTERPOLATION_GAP_MS) return { a, b: null, k: 0 }
  return { a, b, k: (t - a[0]) / (b[0] - a[0]) }
}

export function playerStateAt(rows: ReplayTrackSample[], t: number): PlayerState | null {
  const span = between(rows, t)
  if (!span) return null
  const { a, b, k } = span
  if (!b) return { x: a[1], y: a[2], yaw: a[3], alive: a[4] === 1, weapon: a[5], sampledAt: a[0] }
  return {
    x: a[1] + (b[1] - a[1]) * k,
    y: a[2] + (b[2] - a[2]) * k,
    yaw: lerpAngle(a[3], b[3], k),
    alive: a[4] === 1,
    weapon: a[5],
    sampledAt: a[0],
  }
}

// A body in the match reports ten times a second, alive or dead (a dead one for
// about 2.7 s more). Silence longer than this from a body last seen alive means
// the player has left the match.
const LEFT_AFTER_SILENCE_MS = 3000

/**
 * Whether a player is in the match at `t`, as opposed to disconnected.
 *
 * Two cases put a player off the map: last seen alive but silent for seconds
 * (they left mid-round), or last seen before this round even started (they
 * never came back for it). A dead player whose body has gone quiet is still
 * present: their marker stays where they fell until the next round.
 */
export function isPresentAt(state: PlayerState | null, t: number, roundStartMs: number): boolean {
  if (!state) return false
  if (state.sampledAt < roundStartMs) return false
  return !state.alive || t - state.sampledAt <= LEFT_AFTER_SILENCE_MS
}

export function pawnStateAt(rows: ReplayPawnSample[], t: number): ActorState | null {
  const span = between(rows, t)
  if (!span) return null
  const { a, b, k } = span
  if (!b) return { x: a[1], y: a[2], yaw: a[3] }
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, yaw: lerpAngle(a[3], b[3], k) }
}

/** Deaths per player, each list in time order. Build once per bundle. */
export function deathTimesBySubject(bundle: ReplayBundle): Map<string, number[]> {
  const deaths = new Map<string, number[]>()
  for (const kill of bundle.kills) {
    if (!kill.victim) continue
    const list = deaths.get(kill.victim)
    if (list) list.push(kill.t)
    else deaths.set(kill.victim, [kill.t])
  }
  return deaths
}

// A track sample is at most 100 ms old, plus interpolation. Within this window
// after a death the sample can still say "alive"; after it, the sample's own
// flag is authoritative, which is what lets a revive (flag back to 1) show.
const DEATH_FLAG_LAG_MS = 400

/**
 * Whether a player is alive at `t`. The sample's flag is right except in the
 * instant after a death, where the kill list (exact to the millisecond) wins.
 */
export function isAliveAt(state: PlayerState | null, deathTimes: number[] | undefined, t: number): boolean {
  if (!state || !state.alive) return false
  if (!deathTimes) return true
  for (let i = deathTimes.length - 1; i >= 0; i--) {
    if (deathTimes[i] > t) continue
    return t - deathTimes[i] > DEATH_FLAG_LAG_MS
  }
  return true
}

export interface MapTransform {
  xMultiplier: number
  yMultiplier: number
  xScalarToAdd: number
  yScalarToAdd: number
}

/** World centimetres → position on the minimap image, 0..1 on both axes. The axes cross: world Y is horizontal. */
export function worldToImage(transform: MapTransform, x: number, y: number): [number, number] {
  return [y * transform.xMultiplier + transform.xScalarToAdd, x * transform.yMultiplier + transform.yScalarToAdd]
}

export interface Viewport {
  /** Top-left corner and side of a square region of the minimap image, in 0..1 image units. */
  u: number
  v: number
  size: number
}

/**
 * The square part of the minimap image this match was actually played on, with
 * a margin. The published images carry wide empty borders; cropping to the
 * played area roughly doubles the on-screen size of everything in a narrow rail.
 */
export function playedViewport(bundle: ReplayBundle, transform: MapTransform, margin = 0.04): Viewport {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const rows of Object.values(bundle.tracks.byPlayer)) {
    for (const row of rows) {
      const [u, v] = worldToImage(transform, row[1], row[2])
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
  }
  if (!Number.isFinite(u0)) return { u: 0, v: 0, size: 1 }

  const size = Math.min(1, Math.max(u1 - u0, v1 - v0) + margin * 2)
  const clamp = (centre: number) => Math.max(0, Math.min(1 - size, centre - size / 2))
  return { u: clamp((u0 + u1) / 2), v: clamp((v0 + v1) / 2), size }
}

// Three seconds into a round everyone is still standing in spawn.
const SPAWN_PROBE_MS = 3000

/** How far the map is turned from the published image, in clockwise quarter turns. */
export type QuarterTurns = 0 | 1 | 2 | 3

/** Where a point of a square of side `size` lands after turning the square about its centre. */
export function turnPoint(px: number, py: number, size: number, turns: QuarterTurns): [number, number] {
  switch (turns) {
    case 1: return [size - py, px]
    case 2: return [size - px, size - py]
    case 3: return [py, size - px]
    default: return [px, py]
  }
}

/**
 * For each round, how to turn the map so the bundle owner's team starts at the
 * bottom and the enemy at the top. Two things make a turn necessary: teams swap
 * spawns at half time (half a turn), and the published image of about half the
 * maps has the spawns side by side instead of one above the other (a quarter
 * turn: Ascent, Haven, Split, Icebox, Abyss, Corrode).
 *
 * Read from where the two teams actually stand at the start of each round, not
 * from a per-map rule: it needs no table and follows overtime side swaps too. A
 * round with nobody to measure keeps the previous round's orientation.
 */
export function ownSideTurns(bundle: ReplayBundle, transform: MapTransform): Map<number, QuarterTurns> {
  const turnsByRound = new Map<number, QuarterTurns>()
  let turns: QuarterTurns = 0
  for (const round of bundle.rounds) {
    const at = round.buyStartMs + SPAWN_PROBE_MS
    const centre = { ALLY: { u: 0, v: 0, n: 0 }, ENEMY: { u: 0, v: 0, n: 0 } }
    for (const player of bundle.players) {
      const state = playerStateAt(bundle.tracks.byPlayer[player.subject] ?? [], at)
      if (!isPresentAt(state, at, round.buyStartMs)) continue
      const [u, v] = worldToImage(transform, state!.x, state!.y)
      const sum = centre[player.team]
      sum.u += u
      sum.v += v
      sum.n += 1
    }
    const { ALLY: ally, ENEMY: enemy } = centre
    if (ally.n > 0 && enemy.n > 0) {
      const du = enemy.u / enemy.n - ally.u / ally.n
      const dv = enemy.v / enemy.n - ally.v / ally.n
      // Image v grows downwards: a positive dv means the enemy is below us. An
      // enemy to the right comes to the top by a quarter turn anticlockwise.
      if (Math.abs(dv) >= Math.abs(du)) turns = dv > 0 ? 2 : 0
      else turns = du > 0 ? 3 : 1
    }
    turnsByRound.set(round.n, turns)
  }
  return turnsByRound
}

/**
 * One orientation for the whole match: attackers start at the bottom, as on a
 * strategy board. Derived from the per-round turns, so it too needs no table.
 */
export function attackersBottomTurns(bundle: ReplayBundle, ownTurns: Map<number, QuarterTurns>): QuarterTurns {
  for (const round of bundle.rounds) {
    const own = ownTurns.get(round.n)
    if (own == null || !round.side) continue
    return round.side === 'attacker' ? own : (((own + 2) % 4) as QuarterTurns)
  }
  return 0
}
