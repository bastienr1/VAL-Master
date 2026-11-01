/**
 * Where everything of one play phase lands on the Plays minimap.
 *
 * The minimap draws in a 1000 x 1000 SVG viewBox showing the square of the
 * minimap image that `calloutViewport` picks. This module turns a phase's
 * callout-written positions into viewBox points once, so the component only
 * draws, and so the placing rules (what resolves, what is reported as
 * unplaceable, how radii scale) are unit-tested rather than eyeballed.
 *
 * Pure, no React. Must not import `gameContent.ts` (it needs Vite's
 * `import.meta.env` and cannot be type-checked with the tests): the map is
 * taken structurally.
 */

import {
  calloutViewport,
  findCallout,
  resolvePos,
  type MapCallout,
  type PlayDoc,
  type PlayMarker,
  type PlayPhase,
  type PlayPos,
  type UtilityKind,
} from './playDoc.ts'
import { worldToImage, type MapTransform, type Viewport } from './replayScene.ts'

/** Side of the square viewBox the minimap draws in. */
export const VIEW_SIZE = 1000

/** The part of `GameMap` the scene needs. */
export interface SceneMap {
  transform: MapTransform | null
  callouts: MapCallout[]
}

export type Point = [number, number]

/** Legend label and drawing colour per utility kind, shared by the minimap and any legend. */
export const UTILITY_STYLE: Record<UtilityKind, { label: string; swatch: string }> = {
  smoke: { label: 'Smoke', swatch: 'rgba(203,213,225,0.34)' },
  flash: { label: 'Flash', swatch: '#FFCA3A' },
  molly: { label: 'Molly', swatch: 'rgba(249,115,22,0.35)' },
  recon: { label: 'Recon', swatch: '#c084fc' },
  wall: { label: 'Wall', swatch: 'rgba(125,211,252,0.7)' },
  trap: { label: 'Trap', swatch: '#FFCA3A' },
  drone: { label: 'Drone', swatch: '#94A3B8' },
  stun: { label: 'Stun', swatch: '#FFCA3A' },
  // Drawn in the agent's own colour when the registry has one.
  ult: { label: 'Ultimate', swatch: '#53CADC' },
  other: { label: 'Other', swatch: '#94A3B8' },
}

/**
 * World cm radius per kind when the item gives none. Smoke, molly, wall,
 * flash/stun and recon are the design doc's; trap matches the replay
 * minimap; ult and other have no figure in the doc.
 */
export const UTILITY_RADIUS_CM: Record<UtilityKind, number> = {
  smoke: 380,
  molly: 260,
  wall: 90,
  flash: 70,
  stun: 70,
  recon: 80,
  trap: 70,
  drone: 70,
  ult: 200,
  other: 100,
}

/**
 * Smallest radius drawn, in viewBox units. Without it a 70 cm flash is about
 * 6 units across a whole map, narrower than its own stroke.
 */
export const MIN_UTILITY_RADIUS = 16

// A typical |xMultiplier|, for sizing radii on a map without a transform
// (nothing callout-based resolves there, only dragged points).
const FALLBACK_SCALE = 7e-5

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Image units (0..1) → viewBox units. */
export function imageToView(view: Viewport, u: number, v: number): Point {
  return [((u - view.u) / view.size) * VIEW_SIZE, ((v - view.v) / view.size) * VIEW_SIZE]
}

/** ViewBox units → image units, clamped to the image. */
export function viewToImage(view: Viewport, x: number, y: number): { u: number; v: number } {
  return {
    u: clamp01((x / VIEW_SIZE) * view.size + view.u),
    v: clamp01((y / VIEW_SIZE) * view.size + view.v),
  }
}

/** A world-cm length → viewBox units. */
export function cmToView(cm: number, transform: MapTransform | null, view: Viewport): number {
  const scale = transform ? Math.abs(transform.xMultiplier) : FALLBACK_SCALE
  return ((cm * scale) / view.size) * VIEW_SIZE
}

/** The square of the image the minimap shows. The whole image when the map cannot be placed. */
export function sceneViewport(map: SceneMap): Viewport {
  return map.transform ? calloutViewport(map.callouts, map.transform) : { u: 0, v: 0, size: 1 }
}

export interface PlacedCallout {
  name: string
  x: number
  y: number
}

export interface PlacedActor {
  /** Index into the phase's `actors`, what `selected` refers to. */
  index: number
  agent: string
  note: string
  spike: boolean
  /** Where the marker is drawn: the placed point, spread apart from actors standing on the same spot. */
  x: number
  y: number
  /** `at` (spread like `x`/`y`), then `via`, then `moveTo`, when there are at least two placed points. */
  path: Point[] | null
}

export interface PlacedUtility {
  index: number
  agent: string
  kind: UtilityKind
  label: string
  x: number
  y: number
  /** ViewBox units, with the per-kind default and the minimum applied. */
  r: number
  from: Point | null
}

export interface PlacedMarker {
  index: number
  kind: PlayMarker['kind']
  label: string
  x: number
  y: number
  /** For a spike marker on a site callout: "A", "B" or "C". */
  site: string | null
}

export interface PhaseScene {
  view: Viewport
  /** The phase drawn (the index clamped to the doc), null for a doc without phases. */
  phase: PlayPhase | null
  actors: PlacedActor[]
  utility: PlacedUtility[]
  markers: PlacedMarker[]
  /** Callout names that could not be placed, each once, in the order met. */
  unresolved: string[]
}

const SITE = /^[abc]$/i

/** Actors closer than one marker diameter (viewBox units) hide each other. */
export const ACTOR_CROWD_DISTANCE = 44
/** Radius of the circle a crowd of actors is spread on, about its centroid. */
export const ACTOR_SPREAD_RADIUS = 26

/**
 * Spreads actors standing on (nearly) the same point: groups those closer than
 * `ACTOR_CROWD_DISTANCE` to each other (transitively) and puts each group of
 * two or more evenly on a circle about its centroid, in comp order from the
 * top. A path's first point moves with its actor, so the arrow leaves the
 * marker that is visible. Mutates the placed actors.
 */
function spreadCrowds(actors: PlacedActor[], comp: string[]) {
  const parent = actors.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      if (Math.hypot(actors[i].x - actors[j].x, actors[i].y - actors[j].y) < ACTOR_CROWD_DISTANCE) {
        parent[root(i)] = root(j)
      }
    }
  }
  const groups = new Map<number, PlacedActor[]>()
  actors.forEach((actor, i) => {
    const key = root(i)
    const group = groups.get(key)
    if (group) group.push(actor)
    else groups.set(key, [actor])
  })
  const rank = (actor: PlacedActor) => {
    const i = comp.indexOf(actor.agent)
    return i === -1 ? comp.length + actor.index : i
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => rank(a) - rank(b))
    const cx = group.reduce((sum, a) => sum + a.x, 0) / group.length
    const cy = group.reduce((sum, a) => sum + a.y, 0) / group.length
    group.forEach((actor, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / group.length
      actor.x = cx + Math.cos(angle) * ACTOR_SPREAD_RADIUS
      actor.y = cy + Math.sin(angle) * ACTOR_SPREAD_RADIUS
      if (actor.path) actor.path[0] = [actor.x, actor.y]
    })
  }
}

/** Every callout of the map in viewBox units, for the label layer. */
export function placeCallouts(map: SceneMap, view: Viewport = sceneViewport(map)): PlacedCallout[] {
  const { transform } = map
  if (!transform) return []
  return map.callouts.map(c => {
    const [u, v] = worldToImage(transform, c.x, c.y)
    const [x, y] = imageToView(view, u, v)
    return { name: c.name, x, y }
  })
}

/**
 * The phase at `phaseIndex` (clamped to the doc), placed. Anything whose
 * position does not resolve is left out and its callout name reported in
 * `unresolved`; so is a `toward` that does not resolve, although the point
 * then still stands on its first callout.
 */
export function sceneForPhase(doc: PlayDoc, phaseIndex: number, map: SceneMap): PhaseScene {
  const view = sceneViewport(map)
  const scene: PhaseScene = { view, phase: null, actors: [], utility: [], markers: [], unresolved: [] }
  if (doc.phases.length === 0) return scene
  const phase = doc.phases[Math.max(0, Math.min(doc.phases.length - 1, Math.trunc(phaseIndex) || 0))]
  scene.phase = phase

  const missing = new Set<string>()
  const miss = (name: string | undefined) => {
    const trimmed = name?.trim()
    if (trimmed && !missing.has(trimmed)) {
      missing.add(trimmed)
      scene.unresolved.push(trimmed)
    }
  }

  const place = (pos: PlayPos | undefined): Point | null => {
    if (!pos) return null
    const hasImagePoint = Number.isFinite(pos.u) && Number.isFinite(pos.v)
    const image = hasImagePoint
      ? ([pos.u, pos.v] as Point)
      : map.transform
        ? resolvePos(pos, map.callouts, map.transform)
        : null
    if (!image) {
      miss(pos.callout)
      return null
    }
    if (!hasImagePoint && pos.toward && !findCallout(pos.toward, map.callouts)) miss(pos.toward)
    return imageToView(view, image[0], image[1])
  }

  phase.actors.forEach((actor, index) => {
    const at = place(actor.at)
    const via = (actor.via ?? []).map(place).filter((p): p is Point => p !== null)
    const moveTo = place(actor.moveTo)
    if (!at) return
    const points: Point[] = [at, ...via]
    if (moveTo) points.push(moveTo)
    scene.actors.push({
      index,
      agent: actor.agent,
      note: actor.note,
      spike: actor.spike === true,
      x: at[0],
      y: at[1],
      path: points.length >= 2 ? points : null,
    })
  })

  spreadCrowds(scene.actors, doc.comp)

  phase.utility.forEach((item, index) => {
    const at = place(item.at)
    const from = place(item.from)
    if (!at) return
    const cm = item.radius ?? UTILITY_RADIUS_CM[item.kind]
    scene.utility.push({
      index,
      agent: item.agent,
      kind: item.kind,
      label: item.label,
      x: at[0],
      y: at[1],
      r: Math.max(MIN_UTILITY_RADIUS, cmToView(cm, map.transform, view)),
      from,
    })
  })

  phase.markers.forEach((marker, index) => {
    const at = place(marker.at)
    if (!at) return
    let site: string | null = null
    if (marker.kind === 'spike' && marker.at.callout) {
      const superRegion = findCallout(marker.at.callout, map.callouts)?.superRegion.trim() ?? ''
      if (SITE.test(superRegion)) site = superRegion.toUpperCase()
    }
    scene.markers.push({ index, kind: marker.kind, label: marker.label ?? '', x: at[0], y: at[1], site })
  })

  return scene
}
