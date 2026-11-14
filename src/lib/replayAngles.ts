/**
 * A player's best angles in a Deathmatch replay (docs/plays-editor-v2.md
 * §2.20): where they stood and which way they looked for their kills, grouped
 * into spots and ranked, each with the times to jump to.
 *
 * The rules are those of the vault's `dm_pathing.py`, so the list here and the
 * pathing page agree: kills within 350 units of a common centre are one spot; a
 * spot whose kills look more than 45° apart is split by facing; an angle ranks
 * by kills, then fewer deaths nearby, then more held kills.
 *
 * "Held" needs the player's speed before the kill. A Deathmatch bundle knows a
 * position only at the lobby's kill events (§2.19), so the speed is taken from
 * the kill event just before: under 120 units a second counts as held, a gap of
 * more than 4 s, or a player not alive at that event, as unknown.
 *
 * Pure: no Supabase, no DOM. Covered by `replayAngles.test.ts`.
 */

import type { ReplayBundle } from './replayBundle.ts'
import { playerStateAt } from './replayScene.ts'

/** Kills this close to their common centre are one spot (game units, 100 to a metre). */
export const ANGLE_SPOT_RADIUS = 350
/** Kills of one spot looking further than this from their mean are another angle. */
export const ANGLE_FACING_SPREAD_DEG = 45
/** A death this close to a spot counts against it. */
export const ANGLE_DEATH_RADIUS = 500
/** Slower than this before the kill (units a second) is a held kill. */
export const HELD_MAX_SPEED = 120
/** A previous position older than this says nothing about the kill. */
export const HELD_MAX_GAP_MS = 4000

/** The tracks' grid: a Deathmatch bundle has a row on every whole 100 ms. */
const TRACK_STEP_MS = 100

export type KillStance = 'held' | 'moving' | 'unknown'

export interface AngleKill {
  /** Replay time of the kill. */
  t: number
  victim: string | null
  stance: KillStance
  distanceM: number
}

export interface ReplayAngle {
  /** 1 is the best. */
  rank: number
  /** Where the player stood: the centre of the kills' positions, in world units. */
  x: number
  y: number
  /** The mean view direction, degrees, as the tracks' yaw. */
  facingDeg: number
  /** The centre of the victims' positions. */
  tx: number
  ty: number
  /** The callout nearest the spot, and the one nearest the victims; null without callouts. */
  from: string | null
  toward: string | null
  /** In time order. */
  kills: AngleKill[]
  held: number
  deathsNear: number
  medianDistanceM: number
}

interface Callout {
  name: string
  x: number
  y: number
}

type Point = [number, number]

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

function circMean(angles: number[]): number {
  return Math.atan2(
    angles.reduce((sum, a) => sum + Math.sin(a), 0) / angles.length,
    angles.reduce((sum, a) => sum + Math.cos(a), 0) / angles.length,
  )
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Greedy grouping of the items 0..n-1: the closest two groups whose union is
 * still `valid` are merged, until no pair is. Ties go to the lowest ids, so the
 * result does not depend on anything but the input.
 */
function agglomerate<C>(n: number, centre: (group: number[]) => C, valid: (group: number[]) => boolean, distance: (a: C, b: C) => number): number[][] {
  let groups: number[][] = Array.from({ length: n }, (_, i) => [i])
  for (;;) {
    let best: { key: [number, number, number]; a: number; b: number; merged: number[] } | null = null
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const merged = [...groups[a], ...groups[b]].sort((x, y) => x - y)
        if (!valid(merged)) continue
        const d = Math.round(distance(centre(groups[a]), centre(groups[b])) * 1e6) / 1e6
        const key: [number, number, number] = [d, Math.min(groups[a][0], groups[b][0]), Math.max(groups[a][0], groups[b][0])]
        if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) {
          best = { key, a, b, merged }
        }
      }
    }
    if (!best) return groups.sort((x, y) => x[0] - y[0])
    const { a, b, merged } = best
    groups = [...groups.filter((_, i) => i !== a && i !== b), merged]
  }
}

function nearestCallout(callouts: ReadonlyArray<Callout>, x: number, y: number): string | null {
  let best: Callout | null = null
  let bestD = Infinity
  for (const c of callouts) {
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < bestD || (d === bestD && best !== null && c.name < best.name)) {
      best = c
      bestD = d
    }
  }
  return best?.name ?? null
}

/**
 * The angles `subject` killed from, best first. Every kill with a known
 * position is in exactly one angle, so an angle of one kill is a kill that
 * shares its spot and facing with no other.
 */
export function bestAngles(bundle: ReplayBundle, subject: string, callouts: ReadonlyArray<Callout> = []): ReplayAngle[] {
  const rows = bundle.tracks.byPlayer[subject] ?? []
  const eventTimes = bundle.kills.map(k => k.t).sort((a, b) => a - b)

  const stanceOf = (t: number, x: number, y: number): KillStance => {
    let prev: number | null = null
    for (const e of eventTimes) {
      if (e >= t) break
      prev = e
    }
    if (prev === null || t - prev > HELD_MAX_GAP_MS) return 'unknown'
    // The row on the 100 ms grid nearest the event holds the position known there, not an interpolated one.
    const before = playerStateAt(rows, Math.round(prev / TRACK_STEP_MS) * TRACK_STEP_MS)
    if (!before || !before.alive) return 'unknown'
    const speed = Math.hypot(x - before.x, y - before.y) / ((t - prev) / 1000)
    return speed < HELD_MAX_SPEED ? 'held' : 'moving'
  }

  const kills = bundle.kills
    .filter(k => k.killer === subject && k.victim !== subject && k.kx !== null && k.ky !== null && k.vx !== null && k.vy !== null)
    .sort((a, b) => a.t - b.t)
    .map(k => {
      const at: Point = [k.kx as number, k.ky as number]
      const victim: Point = [k.vx as number, k.vy as number]
      const state = playerStateAt(rows, k.t)
      // The view when the kill landed; the line to the victim when the track has nothing there.
      const facing = state ? (state.yaw * Math.PI) / 180 : Math.atan2(victim[1] - at[1], victim[0] - at[0])
      return { t: k.t, victimId: k.victim, at, victim, facing: wrap(facing), stance: stanceOf(k.t, at[0], at[1]), distanceM: dist(at, victim) / 100 }
    })
  const deaths: Point[] = bundle.kills
    .filter(k => k.victim === subject && k.vx !== null && k.vy !== null)
    .map(k => [k.vx as number, k.vy as number])

  const centre = (group: number[]): Point => [
    group.reduce((sum, i) => sum + kills[i].at[0], 0) / group.length,
    group.reduce((sum, i) => sum + kills[i].at[1], 0) / group.length,
  ]
  const sameSpot = (group: number[]) => {
    const c = centre(group)
    return group.every(i => dist(kills[i].at, c) <= ANGLE_SPOT_RADIUS)
  }
  const sameFacing = (group: number[]) => {
    const mean = circMean(group.map(i => kills[i].facing))
    return group.every(i => Math.abs((wrap(kills[i].facing - mean) * 180) / Math.PI) <= ANGLE_FACING_SPREAD_DEG)
  }

  const groups: number[][] = []
  for (const spot of agglomerate(kills.length, centre, sameSpot, dist)) {
    if (sameFacing(spot)) {
      groups.push(spot)
      continue
    }
    const byFacing = agglomerate(
      spot.length,
      g => circMean(g.map(j => kills[spot[j]].facing)),
      g => sameFacing(g.map(j => spot[j])),
      (a, b) => Math.abs(wrap(a - b)),
    )
    for (const g of byFacing) groups.push(g.map(j => spot[j]).sort((x, y) => x - y))
  }

  return groups
    .map(group => {
      const [x, y] = centre(group)
      const tx = group.reduce((sum, i) => sum + kills[i].victim[0], 0) / group.length
      const ty = group.reduce((sum, i) => sum + kills[i].victim[1], 0) / group.length
      const facing = circMean(group.map(i => kills[i].facing))
      return {
        first: group[0],
        angle: {
          rank: 0,
          x,
          y,
          facingDeg: ((facing * 180) / Math.PI + 360) % 360,
          tx,
          ty,
          from: nearestCallout(callouts, x, y),
          toward: nearestCallout(callouts, tx, ty),
          kills: group.map(i => ({ t: kills[i].t, victim: kills[i].victimId, stance: kills[i].stance, distanceM: kills[i].distanceM })),
          held: group.filter(i => kills[i].stance === 'held').length,
          deathsNear: deaths.filter(d => dist(d, [x, y]) <= ANGLE_DEATH_RADIUS).length,
          medianDistanceM: median(group.map(i => kills[i].distanceM)),
        } satisfies ReplayAngle,
      }
    })
    .sort((a, b) => b.angle.kills.length - a.angle.kills.length || a.angle.deathsNear - b.angle.deathsNear || b.angle.held - a.angle.held || a.first - b.first)
    .map(({ angle }, i) => ({ ...angle, rank: i + 1 }))
}
