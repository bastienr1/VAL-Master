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

import { abilityLook, type AbilityFamily } from './agentAbilities.ts'
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

/**
 * Drawing colour per ability shape: utility is coloured by what it does (areas,
 * throw arcs, badge discs); who threw it is the badge ring's team colour.
 */
export const UTILITY_COLORS: Record<UtilityKind, string> = {
  molly: '#F97316',
  smoke: '#A78BFA',
  slow: '#60A5FA',
  flash: '#FACC15',
  stun: '#C084FC',
  recon: '#22D3EE',
  trap: '#FBBF24',
  wall: '#7DD3FC',
  drone: '#94A3B8',
  ult: '#F472B6',
  other: '#CBD5E1',
}

/** Legend label and drawing colour per ability shape, shared by the canvas and any legend. */
export const UTILITY_STYLE: Record<UtilityKind, { label: string; swatch: string }> = {
  smoke: { label: 'Smoke', swatch: UTILITY_COLORS.smoke },
  flash: { label: 'Flash', swatch: UTILITY_COLORS.flash },
  molly: { label: 'Molly', swatch: UTILITY_COLORS.molly },
  recon: { label: 'Recon', swatch: UTILITY_COLORS.recon },
  wall: { label: 'Wall', swatch: UTILITY_COLORS.wall },
  trap: { label: 'Trap', swatch: UTILITY_COLORS.trap },
  drone: { label: 'Drone', swatch: UTILITY_COLORS.drone },
  stun: { label: 'Stun', swatch: UTILITY_COLORS.stun },
  slow: { label: 'Slow', swatch: UTILITY_COLORS.slow },
  ult: { label: 'Ultimate', swatch: UTILITY_COLORS.ult },
  other: { label: 'Other', swatch: UTILITY_COLORS.other },
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
  /** Who played the agent (a replay's Riot name), '' when not known. */
  player: string
  /** Where the agent is drawn: exactly the placed point, even over another agent. */
  x: number
  y: number
  /** `at`, then `via`, then `moveTo`, when there are at least two placed points. */
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
  /** Where it was thrown from (§2.10): the throw arc starts here. */
  from: Point | null
  /** 0…1 while in flight (with `from`): the badge rides the arc and no area is drawn yet. */
  progress: number | null
  /** A wall's line, at least two placed points; the badge sits at its middle by length. */
  path: Point[] | null
  /** How much of its life is left, 1…0, on a replay frame; null otherwise. */
  life: number | null
  /** Whole seconds left, on a replay frame's timed utility; null otherwise. */
  seconds: number | null
  /** How it behaves, which decides how it is drawn (§2.14). */
  family: AbilityFamily
  /** The way it really went so far, on a replay frame. */
  trail: Point[] | null
  /** Where the thrown thing is now, on a replay frame. */
  flyer: Point | null
  /** A wave's front now, on a replay frame. */
  reach: Point | null
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
 * gives the map alone. `markerScale` is the canvas' `1 / zoom` (§2.2
 * "Constant-size markers"): the smallest area radius
 * are multiplied by it, so they keep their size on screen; at 1 nothing
 * changes.
 */
export function sceneForStep(
  step: PlayStep | null | undefined,
  map: SceneMap,
  side: PlaySceneSide,
  markerScale = 1,
): StepScene {
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
          player: el.player ?? '',
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
        const path = (el.path ?? []).map(place).filter((p): p is Point => p !== null)
        const progress = typeof el.progress === 'number' && Number.isFinite(el.progress) ? clamp01(el.progress) : null
        scene.abilities.push({
          id: el.id,
          agent: el.agent,
          slot: el.slot,
          shape: el.shape,
          label: el.label ?? '',
          x: at[0],
          y: at[1],
          r: Math.max(MIN_UTILITY_RADIUS * markerScale, cmToView(cm, map.transform, view)),
          from,
          progress,
          path: path.length >= 2 ? path : null,
          life: typeof el.life === 'number' && Number.isFinite(el.life) ? clamp01(el.life) : null,
          seconds: typeof el.seconds === 'number' && Number.isFinite(el.seconds) ? el.seconds : null,
          family: el.family ?? abilityLook(el.agent, el.slot, el.shape).family,
          trail: el.trail ? el.trail.map(place).filter((p): p is Point => p !== null) : null,
          flyer: place(el.flyer),
          reach: place(el.reach),
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

  return scene
}

// ── Utility geometry (§2.10) ────────────────────────────────────────────────

/** How far a throw arc bows, as a share of its length. */
export const THROW_BOW = 0.18

export interface ThrowArc {
  /** The quadratic's control point. */
  control: Point
  /** SVG path data from `from` to `at`, or to the point `endGap` units short of `at` when one is given. */
  d: string
  /** The point at `t` (0…1, clamped) on the whole curve. */
  pointAt(t: number): Point
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

/**
 * The arc an ability is drawn thrown along: a quadratic Bézier from `from` to
 * `at` whose control point is the midpoint pushed `THROW_BOW` of the length to
 * the left of the direction of travel. Both points are viewBox points, already
 * turned, and the viewBox's y runs down, so left of travel (dx, dy) is
 * (dy, -dx): every arc bows the same way on screen whichever side the play is
 * for. `endGap` stops the drawn curve that far (viewBox units, along the end
 * tangent) short of `at`, so an arrowhead there shows outside a badge; the
 * curve is cut with de Casteljau, so it keeps its shape.
 */
export function throwArc(from: Point, at: Point, endGap = 0): ThrowArc {
  const [x0, y0] = from
  const [x2, y2] = at
  const dx = x2 - x0
  const dy = y2 - y0
  const control: Point = [(x0 + x2) / 2 + dy * THROW_BOW, (y0 + y2) / 2 - dx * THROW_BOW]
  const pointAt = (t: number): Point => {
    const k = clamp01(t)
    const a = (1 - k) * (1 - k)
    const b = 2 * (1 - k) * k
    const c = k * k
    return [a * x0 + b * control[0] + c * x2, a * y0 + b * control[1] + c * y2]
  }
  // |B'(1)| = 2 |at - control|: near the end a length `endGap` is that share of t.
  const endSpeed = 2 * Math.hypot(x2 - control[0], y2 - control[1])
  const tEnd = endGap > 0 && endSpeed > 0 ? clamp01(1 - endGap / endSpeed) : 1
  // The curve on [0, tEnd]: control lerp(from, control, tEnd), end B(tEnd).
  const c1: Point = [x0 + (control[0] - x0) * tEnd, y0 + (control[1] - y0) * tEnd]
  const end = pointAt(tEnd)
  const d = `M${fmt(x0)},${fmt(y0)}Q${fmt(c1[0])},${fmt(c1[1])} ${fmt(end[0])},${fmt(end[1])}`
  return { control, d, pointAt }
}

/** The point half way along a polyline by length: where a wall's badge sits. Its only point, or null, when it has fewer than two. */
export function polylineMidpoint(points: Point[]): Point | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
  let left = lengths.reduce((sum, n) => sum + n, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0
      const [ax, ay] = points[i]
      const [bx, by] = points[i + 1]
      return [ax + (bx - ax) * k, ay + (by - ay) * k]
    }
    left -= lengths[i]
  }
  return points[points.length - 1]
}

/** A designed ability counts as thrown when its agent stands further than this (world cm) from where it lands. */
export const THROW_MIN_CM = 300

/**
 * Where a designed ability placed at the viewBox point `click` is thrown from
 * (§2.10): a copy of the `at` of the first agent element of the step named
 * `agent` (names compared trimmed, without case), when that agent places more
 * than `THROW_MIN_CM` from the click; else null. The agent's position as
 * written. `scene` is the step placed.
 */
export function throwOrigin(
  step: PlayStep | null | undefined,
  agent: string,
  click: Point,
  map: SceneMap,
  scene: Pick<StepScene, 'view' | 'turns'>,
): PlayPos | null {
  const name = agent.trim().toLowerCase()
  const thrower = step?.elements.find(el => el.kind === 'agent' && el.agent.trim().toLowerCase() === name)
  if (!thrower || thrower.kind !== 'agent') return null
  const image = imagePoint(thrower.at, map)
  if (!image) return null
  const [x, y] = imageToView(scene.view, image[0], image[1], scene.turns)
  const far = Math.hypot(x - click[0], y - click[1]) > cmToView(THROW_MIN_CM, map.transform, scene.view)
  return far ? { ...thrower.at } : null
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
 * `previous` drew them, so the canvas can leave a
 * faint tile behind an agent that moved. An agent is matched by element id;
 * one that is not in `step`, or that does not resolve in either step, leaves
 * nothing. "Somewhere else" is read from the positions as written. `before` is `previous` already placed, when
 * the caller has it; otherwise it is placed with `markerScale` (see
 * `sceneForStep`).
 */
export function ghostAgents(
  previous: PlayStep | null | undefined,
  step: PlayStep | null | undefined,
  map: SceneMap,
  side: PlaySceneSide,
  before?: StepScene,
  markerScale = 1,
): PlacedAgent[] {
  if (!previous || !step) return []
  const placed = before ?? sceneForStep(previous, map, side, markerScale)
  const now = new Map<string, Point | null>()
  for (const el of step.elements) if (el.kind === 'agent') now.set(el.id, imagePoint(el.at, map))
  const then = new Map<string, Point | null>()
  for (const el of previous.elements) if (el.kind === 'agent') then.set(el.id, imagePoint(el.at, map))

  return placed.agents.filter(agent => {
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
