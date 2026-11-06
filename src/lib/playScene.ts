/**
 * Where everything of one play step lands on the Plays canvas (docs/plays-editor-v2.md §2.2).
 *
 * The canvas draws in a 1000 x 1000 SVG viewBox showing the square of the
 * minimap image that `calloutViewport` picks. This module turns a step's
 * callout-written positions into viewBox points once, so the component only
 * draws, and so the placing rules (what resolves, what is reported as
 * unplaceable, how radii scale) are unit-tested rather than eyeballed. The
 * camera math at the end picks which part of that plane the canvas shows when
 * it fills a column of any shape and is zoomed in.
 *
 * Pure, no React. Must not import `gameContent.ts` (it needs Vite's
 * `import.meta.env` and cannot be type-checked with the tests): the map is
 * taken structurally.
 */

import {
  calloutViewport,
  findCallout,
  resolvePos,
  type AbilitySlot,
  type MapCallout,
  type MarkerType,
  type PlayPos,
  type PlayStep,
  type Team,
  type UtilityKind,
} from './playDoc.ts'
import { turnPoint, worldToImage, type MapTransform, type QuarterTurns, type Viewport } from './replayScene.ts'

export type { QuarterTurns }

/** Which team the play is for: it starts at the bottom of the map. */
export type PlaySceneSide = 'attack' | 'defense'

/** Side of the square viewBox the minimap draws in. */
export const VIEW_SIZE = 1000

/** The part of `GameMap` the scene needs. */
export interface SceneMap {
  transform: MapTransform | null
  callouts: MapCallout[]
}

export type Point = [number, number]

/** Legend label and drawing colour per ability shape, shared by the canvas and any legend. */
export const UTILITY_STYLE: Record<UtilityKind, { label: string; swatch: string }> = {
  smoke: { label: 'Smoke', swatch: 'rgba(203,213,225,0.34)' },
  flash: { label: 'Flash', swatch: '#FFCA3A' },
  molly: { label: 'Molly', swatch: 'rgba(249,115,22,0.35)' },
  recon: { label: 'Recon', swatch: '#c084fc' },
  wall: { label: 'Wall', swatch: 'rgba(125,211,252,0.7)' },
  trap: { label: 'Trap', swatch: '#FFCA3A' },
  drone: { label: 'Drone', swatch: '#94A3B8' },
  stun: { label: 'Stun', swatch: '#FFCA3A' },
  slow: { label: 'Slow', swatch: 'rgba(96,165,250,0.35)' },
  // Drawn in the agent's own colour when the registry has one.
  ult: { label: 'Ultimate', swatch: '#53CADC' },
  other: { label: 'Other', swatch: '#94A3B8' },
}

/**
 * World cm radius per shape when the ability gives none. Smoke, molly, wall,
 * flash/stun and recon are the design doc's; trap matches the replay
 * minimap; slow is the v2 doc's figure for slow orbs, GravNet and Razorvine;
 * ult and other have no figure in the doc.
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
  slow: 300,
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

/**
 * Image units (0..1) → viewBox units, with the square turned `turns` clockwise
 * quarter turns about its centre.
 */
export function imageToView(view: Viewport, u: number, v: number, turns: QuarterTurns = 0): Point {
  return turnPoint(((u - view.u) / view.size) * VIEW_SIZE, ((v - view.v) / view.size) * VIEW_SIZE, VIEW_SIZE, turns)
}

/** ViewBox units → image units, clamped to the image: the inverse of `imageToView` with the same turn. */
export function viewToImage(view: Viewport, x: number, y: number, turns: QuarterTurns = 0): { u: number; v: number } {
  const [px, py] = turnPoint(x, y, VIEW_SIZE, ((4 - turns) % 4) as QuarterTurns)
  return {
    u: clamp01((px / VIEW_SIZE) * view.size + view.u),
    v: clamp01((py / VIEW_SIZE) * view.size + view.v),
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

export interface PlacedAgent {
  /** The element's id, what selection and animation key on. */
  id: string
  agent: string
  team: Team
  note: string
  spike: boolean
  /** Where the agent is drawn: the placed point, spread apart from agents standing on the same spot. */
  x: number
  y: number
  /** `at` (spread like `x`/`y`), then `via`, then `moveTo`, when there are at least two placed points. */
  path: Point[] | null
}

export interface PlacedAbility {
  id: string
  agent: string
  slot: AbilitySlot | null
  shape: UtilityKind
  label: string
  x: number
  y: number
  /** ViewBox units: the ability's radius or the per-shape default, with the minimum applied. */
  r: number
  from: Point | null
}

export interface PlacedPen {
  id: string
  color: string
  points: Point[]
}

export interface PlacedArrow {
  id: string
  color: string
  from: Point
  to: Point
}

export interface PlacedText {
  id: string
  text: string
  color: string
  x: number
  y: number
}

export interface PlacedMarker {
  id: string
  type: MarkerType
  label: string
  x: number
  y: number
  /** For a spike marker on a site callout: "A", "B" or "C". */
  site: string | null
}

export interface StepScene {
  view: Viewport
  /** Clockwise quarter turns of the map, so the play's side starts at the bottom (`sceneTurns`). */
  turns: QuarterTurns
  /** Every callout of the map, turned like everything else, for the label layer. */
  callouts: PlacedCallout[]
  /** The step drawn, null when there is none. */
  step: PlayStep | null
  /** Each list in the step's element order. */
  agents: PlacedAgent[]
  abilities: PlacedAbility[]
  pens: PlacedPen[]
  arrows: PlacedArrow[]
  texts: PlacedText[]
  markers: PlacedMarker[]
  /** Callout names that could not be placed, each once, in the order met. */
  unresolved: string[]
}

const SITE = /^[abc]$/i

/** Agents closer than one tile (viewBox units) hide each other. */
export const AGENT_CROWD_DISTANCE = 44
/** Radius of the circle a crowd of agents is spread on, about its centroid. */
export const AGENT_SPREAD_RADIUS = 26

/**
 * Spreads agents standing on (nearly) the same point: groups those closer than
 * `AGENT_CROWD_DISTANCE` to each other (transitively) and puts each group of
 * two or more evenly on a circle about its centroid, in element order from
 * the top (the comp's order in a template or a blank play). A path's first
 * point moves with its agent, so the arrow leaves the tile that is visible.
 * Mutates the placed agents.
 */
function spreadCrowds(actors: PlacedAgent[]) {
  const parent = actors.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      if (Math.hypot(actors[i].x - actors[j].x, actors[i].y - actors[j].y) < AGENT_CROWD_DISTANCE) {
        parent[root(i)] = root(j)
      }
    }
  }
  const groups = new Map<number, PlacedAgent[]>()
  actors.forEach((actor, i) => {
    const key = root(i)
    const group = groups.get(key)
    if (group) group.push(actor)
    else groups.set(key, [actor])
  })
  // A group lists its agents in the order they were placed: element order.
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const cx = group.reduce((sum, a) => sum + a.x, 0) / group.length
    const cy = group.reduce((sum, a) => sum + a.y, 0) / group.length
    group.forEach((actor, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / group.length
      actor.x = cx + Math.cos(angle) * AGENT_SPREAD_RADIUS
      actor.y = cy + Math.sin(angle) * AGENT_SPREAD_RADIUS
      if (actor.path) actor.path[0] = [actor.x, actor.y]
    })
  }
}

/** Every callout of the map in viewBox units, for the label layer. */
export function placeCallouts(
  map: SceneMap,
  view: Viewport = sceneViewport(map),
  turns: QuarterTurns = 0,
): PlacedCallout[] {
  const { transform } = map
  if (!transform) return []
  return map.callouts.map(c => {
    const [u, v] = worldToImage(transform, c.x, c.y)
    const [x, y] = imageToView(view, u, v, turns)
    return { name: c.name, x, y }
  })
}

/**
 * How to turn the map so the play's own spawn is at the bottom and the
 * enemy's at the top: the published images of about half the maps (Ascent,
 * Haven, Split, Icebox, Abyss, Corrode) have the spawns side by side, and a
 * defense play reads upside down from an attack one. The turn among 0..3 that
 * puts the own spawn furthest below the enemy's; 0 when the map has no
 * transform or either spawn callout is missing.
 */
export function sceneTurns(map: SceneMap, side: PlaySceneSide): QuarterTurns {
  const { transform } = map
  if (!transform) return 0
  const attacker = findCallout('Attacker Side Spawn', map.callouts)
  const defender = findCallout('Defender Side Spawn', map.callouts)
  if (!attacker || !defender) return 0
  const view = sceneViewport(map)
  const at = (c: MapCallout) => imageToView(view, ...worldToImage(transform, c.x, c.y))
  const [own, enemy] = side === 'attack' ? [at(attacker), at(defender)] : [at(defender), at(attacker)]
  let best: QuarterTurns = 0
  let bestDrop = -Infinity
  for (const turns of [0, 1, 2, 3] as const) {
    const drop = turnPoint(own[0], own[1], VIEW_SIZE, turns)[1] - turnPoint(enemy[0], enemy[1], VIEW_SIZE, turns)[1]
    if (drop > bestDrop) {
      best = turns
      bestDrop = drop
    }
  }
  return best
}

/**
 * One step, placed. Anything whose position does not resolve is left out and
 * its callout name reported in `unresolved` (an arrow needs both ends); so is
 * a `toward` that does not resolve, although the point then still stands on
 * its first callout. Pen points are image units and always place. No step
 * gives the map alone.
 */
export function sceneForStep(step: PlayStep | null | undefined, map: SceneMap, side: PlaySceneSide): StepScene {
  const view = sceneViewport(map)
  const turns = sceneTurns(map, side)
  const scene: StepScene = {
    view,
    turns,
    callouts: placeCallouts(map, view, turns),
    step: step ?? null,
    agents: [],
    abilities: [],
    pens: [],
    arrows: [],
    texts: [],
    markers: [],
    unresolved: [],
  }
  if (!step) return scene

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
    return imageToView(view, image[0], image[1], turns)
  }

  for (const el of step.elements) {
    switch (el.kind) {
      case 'agent': {
        const at = place(el.at)
        const via = (el.via ?? []).map(place).filter((p): p is Point => p !== null)
        const moveTo = place(el.moveTo)
        if (!at) break
        const points: Point[] = [at, ...via]
        if (moveTo) points.push(moveTo)
        scene.agents.push({
          id: el.id,
          agent: el.agent,
          team: el.team,
          note: el.note ?? '',
          spike: el.spike === true,
          x: at[0],
          y: at[1],
          path: points.length >= 2 ? points : null,
        })
        break
      }
      case 'ability': {
        const at = place(el.at)
        const from = place(el.from)
        if (!at) break
        const cm = el.radius ?? UTILITY_RADIUS_CM[el.shape]
        scene.abilities.push({
          id: el.id,
          agent: el.agent,
          slot: el.slot,
          shape: el.shape,
          label: el.label ?? '',
          x: at[0],
          y: at[1],
          r: Math.max(MIN_UTILITY_RADIUS, cmToView(cm, map.transform, view)),
          from,
        })
        break
      }
      case 'pen':
        scene.pens.push({ id: el.id, color: el.color, points: el.points.map(p => imageToView(view, p.u, p.v, turns)) })
        break
      case 'arrow': {
        const from = place(el.from)
        const to = place(el.to)
        if (from && to) scene.arrows.push({ id: el.id, color: el.color, from, to })
        break
      }
      case 'text': {
        const at = place(el.at)
        if (at) scene.texts.push({ id: el.id, text: el.text, color: el.color, x: at[0], y: at[1] })
        break
      }
      case 'marker': {
        const at = place(el.at)
        if (!at) break
        let site: string | null = null
        if (el.type === 'spike' && el.at.callout) {
          const superRegion = findCallout(el.at.callout, map.callouts)?.superRegion.trim() ?? ''
          if (SITE.test(superRegion)) site = superRegion.toUpperCase()
        }
        scene.markers.push({ id: el.id, type: el.type, label: el.label ?? '', x: at[0], y: at[1], site })
        break
      }
    }
  }

  spreadCrowds(scene.agents)
  return scene
}

/**
 * Two image points closer than this (image units, about a tenth of a viewBox
 * unit on a cropped map) are the same place: a callout and the dragged point
 * that landed on it should not leave a ghost.
 */
const SAME_PLACE = 1e-4

/** A position in image units by the scene's rules (a dragged point wins), or null. */
function imagePoint(pos: PlayPos, map: SceneMap): Point | null {
  if (Number.isFinite(pos.u) && Number.isFinite(pos.v)) return [pos.u as number, pos.v as number]
  return map.transform ? resolvePos(pos, map.callouts, map.transform) : null
}

/**
 * The agents of `previous` that stand somewhere else in `step`, drawn where
 * `previous` drew them (crowd spread included), so the canvas can leave a
 * faint tile behind an agent that moved. An agent is matched by element id;
 * one that is not in `step`, or that does not resolve in either step, leaves
 * nothing. "Somewhere else" is read from the positions as written, before the
 * crowd spread, so an agent that stayed put does not leave a ghost just
 * because a neighbour walked away. `before` is `previous` already placed, when
 * the caller has it.
 */
export function ghostAgents(
  previous: PlayStep | null | undefined,
  step: PlayStep | null | undefined,
  map: SceneMap,
  side: PlaySceneSide,
  before: StepScene = sceneForStep(previous, map, side),
): PlacedAgent[] {
  if (!previous || !step) return []
  const now = new Map<string, Point | null>()
  for (const el of step.elements) if (el.kind === 'agent') now.set(el.id, imagePoint(el.at, map))
  const then = new Map<string, Point | null>()
  for (const el of previous.elements) if (el.kind === 'agent') then.set(el.id, imagePoint(el.at, map))

  return before.agents.filter(agent => {
    const a = then.get(agent.id)
    const b = now.get(agent.id)
    return a != null && b != null && Math.hypot(a[0] - b[0], a[1] - b[1]) > SAME_PLACE
  })
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** How far the canvas zooms: 1 shows the whole map square, fitted to the canvas' shorter side. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 6

/** What the canvas shows: the zoom and the view's top-left corner, in viewBox units. View state, never saved. */
export interface Camera {
  zoom: number
  x: number
  y: number
}

/** The part of the viewBox plane in view, shaped like the canvas: its `viewBox`. */
export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}

const clampTo = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * The view's size in viewBox units for a canvas `width` x `height` px: the map
 * square spans the shorter side at zoom 1 and the longer side shows more of
 * the plane. Square until the canvas has been measured.
 */
function viewSize(zoom: number, width: number, height: number): { w: number; h: number } {
  const span = VIEW_SIZE / zoom
  if (!(width > 0 && height > 0)) return { w: span, h: span }
  return width >= height ? { w: (span * width) / height, h: span } : { w: span, h: (span * height) / width }
}

/**
 * The zoom held to its range and, per axis, the view held on the map: centred
 * where it is wider than the map (the canvas' longer side at low zoom), else
 * kept inside it.
 */
export function clampCamera(camera: Camera, width: number, height: number): Camera {
  const zoom = clampTo(camera.zoom, MIN_ZOOM, MAX_ZOOM)
  const { w, h } = viewSize(zoom, width, height)
  const axis = (at: number, span: number) =>
    span >= VIEW_SIZE ? (VIEW_SIZE - span) / 2 : clampTo(at, 0, VIEW_SIZE - span)
  return { zoom, x: axis(camera.x, w), y: axis(camera.y, h) }
}

/** The rectangle a camera shows on a canvas `width` x `height` px, the camera clamped first. */
export function viewBoxFor(camera: Camera, width: number, height: number): ViewRect {
  const { zoom, x, y } = clampCamera(camera, width, height)
  return { x, y, ...viewSize(zoom, width, height) }
}

/**
 * The camera at another zoom with the viewBox point `p` drawn where `at` is
 * drawn now: by default `p` itself, so the point under the pointer stays put.
 * At the same zoom it is a pan that brings `p` back under the pointer at `at`.
 */
export function zoomAbout(camera: Camera, p: Point, zoom: number, width: number, height: number, at: Point = p): Camera {
  const from = clampCamera(camera, width, height)
  const z = clampTo(zoom, MIN_ZOOM, MAX_ZOOM)
  // The view's width and height both scale by 1 / zoom: an offset on screen is `k` times as many units.
  const k = from.zoom / z
  return clampCamera({ zoom: z, x: p[0] - (at[0] - from.x) * k, y: p[1] - (at[1] - from.y) * k }, width, height)
}
