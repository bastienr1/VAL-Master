/**
 * The replay layers the Plays canvas draws beside a frame (docs/plays-editor-v2.md
 * §2.12): each player's view cone, stopped by the map's walls, smokes and sight-blocking utility, and last 3 seconds of path, and which
 * abilities are pawns. Kept out of the frame itself, so a captured step holds
 * none of it.
 *
 * Pure, no imports beyond other tested modules, so `node --test` can check it.
 */

import { isDeathmatchBundle, type ReplayBundle, type ReplayTrackSample } from './replayBundle.ts'
import type { FrameIds } from './replayFrame.ts'
import { playerStateAt, sampleIndex, worldToImage, type MapTransform } from './replayScene.ts'
import { UTILITY_RADIUS_CM } from './playScene.ts'
import type { PlayStep } from './playDoc.ts'
import { castRay, clipRay, type SightBlockers, type SightGrid } from './sightGrid.ts'
import { classInfo } from './utilityClasses.ts'

export interface ImagePoint {
  u: number
  v: number
}

export interface AgentMotion {
  /** Where the player stands, the frame of reference for `cone`. */
  at: ImagePoint
  /** The view wedge's far edge, left to right, each point where a sight line stops; null with the View layer off. */
  cone: ImagePoint[] | null
  /** The last 3 seconds, oldest first; null with the Trails layer off. */
  trail: ImagePoint[] | null
}

const CONE_HALF_RAD = 0.42 // about a 48° wedge
/** Sight lines across the wedge: one a degree. */
const CONE_RAYS = 49
/** The reach while the map's walls are not known; with them sight runs until a wall stops it. */
const CONE_FALLBACK_CM = 900
const TRAIL_MS = 3000
/** Samples are 100 ms apart: a longer silence is a break in the track, not a walk (as in `replayScene.ts`). */
const TRACK_GAP_MS = 250

const image = (transform: MapTransform, x: number, y: number): ImagePoint => {
  const [u, v] = worldToImage(transform, x, y)
  return { u, v }
}

/**
 * Where the life shown at row `last` began, no earlier than `first`: the row
 * after the last dead one, or the first row after a gap. A Deathmatch player
 * comes back elsewhere right after their dead rows, so a trail through them
 * would draw a line from where they fell to where they respawned (§2.19).
 */
export function lifeStart(rows: ReadonlyArray<ReplayTrackSample>, first: number, last: number): number {
  for (let i = last; i >= first; i--) {
    if (rows[i][4] === 0) return i + 1
    if (i > first && rows[i][0] - rows[i - 1][0] > TRACK_GAP_MS) return i
  }
  return first
}

/**
 * The landed smokes and sight-blocking walls of a frame, as drawn (a paused
 * frame's edits included). Only utility with a known life counts: a bare cast
 * badge is not a smoke yet, nor is one still in flight. A wall with a line is
 * one that hides what is behind it (High Tide, Toxic Screen, Blaze, Fast Lane,
 * Sage's wall).
 */
export function sightBlockers(step: PlayStep, transform: MapTransform): SightBlockers {
  const blockers: SightBlockers = { circles: [], segments: [] }
  const scale = Math.abs(transform.xMultiplier)
  for (const el of step.elements) {
    if (el.kind !== 'ability' || el.life === undefined || el.progress !== undefined) continue
    if (el.shape === 'smoke' && el.at.u !== undefined && el.at.v !== undefined) {
      blockers.circles.push({ u: el.at.u, v: el.at.v, r: (el.radius ?? UTILITY_RADIUS_CM.smoke) * scale })
    } else if (el.shape === 'wall' && el.path) {
      for (let i = 1; i < el.path.length; i++) {
        const p = el.path[i - 1]
        const q = el.path[i]
        if (p.u !== undefined && p.v !== undefined && q.u !== undefined && q.v !== undefined) {
          blockers.segments.push([{ u: p.u, v: p.v }, { u: q.u, v: q.v }])
        }
      }
    }
  }
  return blockers
}

/** Per agent element id: the cone and the trail asked for, at replay time `t`. */
export function frameMotion(
  bundle: ReplayBundle,
  t: number,
  transform: MapTransform,
  ids: FrameIds,
  want: { cones: boolean; trails: boolean; sight?: SightGrid | null; blockers?: SightBlockers | null },
): Map<string, AgentMotion> {
  const motion = new Map<string, AgentMotion>()
  if (!want.cones && !want.trails) return motion
  const respawns = isDeathmatchBundle(bundle)
  for (const player of bundle.players) {
    const rows = bundle.tracks.byPlayer[player.subject] ?? []
    const state = playerStateAt(rows, t)
    if (!state) continue
    let cone: AgentMotion['cone'] = null
    if (want.cones) {
      const rad = (state.yaw * Math.PI) / 180
      const from = image(transform, state.x, state.y)
      cone = []
      for (let i = 0; i < CONE_RAYS; i++) {
        const angle = rad - CONE_HALF_RAD + (2 * CONE_HALF_RAD * i) / (CONE_RAYS - 1)
        // Through the map transform, so the rays turn the way the map does.
        const far = image(transform, state.x + Math.cos(angle) * CONE_FALLBACK_CM, state.y + Math.sin(angle) * CONE_FALLBACK_CM)
        const end = want.sight ? castRay(want.sight, from.u, from.v, far.u - from.u, far.v - from.v) : far
        cone.push(want.blockers ? clipRay(from, end, want.blockers) : end)
      }
    }
    let trail: ImagePoint[] | null = null
    if (want.trails) {
      trail = []
      let from = Math.max(0, sampleIndex(rows, t - TRAIL_MS))
      if (respawns) from = lifeStart(rows, from, sampleIndex(rows, t))
      for (let i = from; i < rows.length && rows[i][0] <= t; i++) {
        trail.push(image(transform, rows[i][1], rows[i][2]))
      }
    }
    motion.set(ids.forSubject(player.subject), { at: image(transform, state.x, state.y), cone, trail })
  }
  return motion
}

/** The element ids of the bundle's pawn effects (drones, cameras, bots), for the Pawns layer. */
export function pawnEffectIds(bundle: ReplayBundle, ids: FrameIds): Set<string> {
  const pawns = new Set<string>()
  bundle.effects.forEach((effect, index) => {
    if (classInfo(effect.cls, effect.kind).role === 'pawn') pawns.add(ids.forEffect(index))
  })
  return pawns
}
