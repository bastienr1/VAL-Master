/**
 * The Plays canvas: one step of a set play drawn on the map and edited in
 * place (docs/plays-editor-v2.md §2.2).
 *
 * SVG in a 1000 x 1000 viewBox showing the square of the minimap image that
 * holds every callout, turned so the play's own spawn is at the bottom. The
 * map art goes through a colour matrix that draws its grey walls teal on a
 * navy backdrop. Bottom to top: map, callout labels, pen strokes, abilities,
 * arrows, agent move paths, markers, text, ghosts of the previous step's
 * agents, agents, the selection, then hover labels and whatever is being
 * drawn. Every point comes from `sceneForStep`; this file only draws and
 * turns pointer gestures into edits.
 *
 * The canvas keeps no document state: every edit is a new step handed to
 * `onChange`, every selection goes through `onSelect`. What it does keep is
 * the gesture in progress (a ref) and its preview (a drag offset, a stroke
 * being drawn, an inline text draft). Agents are keyed by element id and
 * placed with a CSS `translate`, so stepping through the play animates them
 * walking.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useGameContent } from '../hooks/useGameContent'
import { agentColor, type GameAgent, type GameMap } from '../lib/gameContent'
import { abilityShape } from '../lib/agentAbilities'
import {
  elementAt,
  newId,
  withElement,
  withoutElement,
  type AbilityElement,
  type AbilitySlot,
  type MarkerElement,
  type PlayElement,
  type PlayPos,
  type PlayStep,
  type TextElement,
} from '../lib/playDoc'
import {
  UTILITY_STYLE,
  VIEW_SIZE,
  ghostAgents,
  sceneForStep,
  viewToImage,
  type PlacedAbility,
  type PlacedAgent,
  type PlacedMarker,
  type Point,
} from '../lib/playScene'
import type { PlaySide } from '../lib/types'

export type Tool = 'select' | 'pen' | 'arrow' | 'text' | 'eraser' | 'spike' | 'enemy' | 'pin'

export interface PlayCanvasProps {
  map: GameMap
  side: PlaySide
  step: PlayStep
  /** The previous step, when any: its agents are drawn as faint ghosts so a move reads. */
  previous: PlayStep | null
  tool: Tool
  /** An ability waiting for a click on the map (from the strip popover). */
  pending: { agent: string; slot: AbilitySlot } | null
  selectedId: string | null
  showCallouts: boolean
  /** False while scrubbing fast. */
  animate: boolean
  onSelect(id: string | null): void
  /** Every edit of the step goes through here, as a new step object. */
  onChange(step: PlayStep): void
  /** Pen/arrow/text/marker/ability placements call this with the new element appended. */
  onPendingDone(): void
  onUnresolved?(names: string[]): void
}

// ── Looks ───────────────────────────────────────────────────────────────────

const BACKDROP = '#0B1220'
const ALLY = '#53CADC'
const ENEMY = '#FF4655'
const SPIKE = '#FFCA3A'
const WHITE = '#FFFFFF'
const TILE_FILL = '#1A1F2E'
const CALLOUT_COLOR = '#5B8A98'
const FONT = 'Inter, sans-serif'
/** Dark outline behind map text, so labels read over the map and over each other. */
const HALO = { paintOrder: 'stroke', stroke: BACKDROP, strokeWidth: 5, strokeLinejoin: 'round' } as const

/**
 * The map art's tint, in three passes, alpha kept throughout: luminance
 * (L = 0.3 R + 0.59 G + 0.11 B) into every channel; squared, so the light
 * grey floor of the Riot minimap sinks towards the backdrop while its white
 * wall lines stay bright; then scaled to about #2BB3C9 (0.17, 0.70, 0.79).
 * Walls read teal, the floor a navy a shade lighter than the void around it.
 * A plain luminance matrix (no squaring) left the floor a mid teal.
 */
const LUMINANCE_MATRIX = '0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0'
const FLOOR_GAMMA = 2
const TEAL_MATRIX = '0.17 0 0 0 0  0 0.7 0 0 0  0 0 0.79 0 0  0 0 0 1 0'
const MAP_OPACITY = 0.85

const TILE = 44
const HALF = TILE / 2
const TILE_RX = 6
const TILE_RING = 3
const GHOST_OPACITY = 0.25

const ABILITY_FILL = 0.35
/**
 * Agent colours are backdrop gradients, and several (Omen, Clove, Cypher…) are
 * near-navy, so an ability drawn in them vanishes on the map. Mixing in white
 * keeps the hue and makes every agent's utility readable.
 */
const LIFT = 0.45
function liftColor(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const lift = (c: string) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * LIFT).toString(16).padStart(2, '0')
  return `#${lift(m[1])}${lift(m[2])}${lift(m[3])}`
}
const ABILITY_RING = 0.9
/** Ring of a filled shape. */
const RING_WIDTH = 1.5
/** Stroke of a shape that is only a ring (recon, ult, other). */
const OUTLINE_WIDTH = 4
const ABILITY_ICON = 18
const ICON_DISC = 13
/** Shapes too small to read around the icon get at least this size. */
const BURST_MIN = 28
const TRAP_MIN = 22
const DRONE_MIN = 16
const WALL_WIDTH = 14
const WALL_BAR_MIN = 48
/** Hit radius around anything small. */
const HIT_R = 22

const SPIKE_R = 19
const ENEMY_R = 18
/** The pin's head: a circle `PIN_R` wide, `PIN_HEAD` above the point it marks. */
const PIN_R = 14
const PIN_HEAD = 26

const PEN_WIDTH = 5
const ARROW_WIDTH = 6
const PATH_WIDTH = 7
const HANDLE_R = 12
const TEXT_SIZE = 24
const TEXT_BOX_H = 34
const UTILITY_LABEL = 20
const CALLOUT_LABEL = 22
const NOTE_MAX = 42
/** Below this rendered width (px) ability, marker and agent labels hide. */
const LABEL_MIN_WIDTH_PX = 280
/** Below this rendered width (px) callout and small labels are set 15% smaller, so they stay rather than crowd. */
const COMPACT_LABEL_WIDTH_PX = 420
const COMPACT_LABEL_SCALE = 0.85
const EASE = 'transform 450ms cubic-bezier(.2,.8,.2,1)'

// ── Gestures ────────────────────────────────────────────────────────────────

/** A press that moves less than this (client px) is a click. */
const DRAG_THRESHOLD_PX = 4
/** A pen stroke takes a point each time the pointer has moved this far (client px). */
const PEN_SAMPLE_PX = 6
/** An arrow shorter than this (client px) is a slip, not an arrow. */
const ARROW_MIN_PX = 8

const DRAW_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['pen', 'arrow', 'text', 'spike', 'enemy', 'pin'])

/** Which part of an element a press grabbed: arrows have two ends besides the body. */
type Part = 'body' | 'from' | 'to'

type Press =
  | {
      mode: 'move'
      pointerId: number
      id: string
      part: Part
      /** Client px of the press, for the drag threshold. */
      client: Point
      /** ViewBox point of the press: drag offsets are measured from here. */
      start: Point
      dragging: boolean
      /** The element was already selected: a click on a selected text edits it. */
      wasSelected: boolean
    }
  | { mode: 'pen'; pointerId: number; lastClient: Point; points: Point[] }
  | { mode: 'arrow'; pointerId: number; client: Point; from: Point; to: Point }
  | { mode: 'click'; pointerId: number; at: Point; id: string | null }

/** An element displaced by the drag in progress, in viewBox units. */
interface Live {
  id: string
  part: Part
  dx: number
  dy: number
}

/** A stroke or an arrow being drawn, before it is an element. */
type Draft = { kind: 'pen'; points: Point[] } | { kind: 'arrow'; from: Point; to: Point }

// ── Helpers ─────────────────────────────────────────────────────────────────

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const readReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

const inSquare = ([x, y]: Point) => x >= 0 && x <= VIEW_SIZE && y >= 0 && y <= VIEW_SIZE

const clampPoint = ([x, y]: Point): Point => [clamp(x, 0, VIEW_SIZE), clamp(y, 0, VIEW_SIZE)]

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

const pointsAttr = (points: Point[], dx = 0, dy = 0) =>
  points.map(([x, y]) => `${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`).join(' ')

/** No text measuring in SVG without a layout pass: an average glyph width of Inter. */
const textWidth = (s: string, size: number) => Math.max(size, s.length * size * 0.56) + 16

/** An eight-point star, outer radius `r`: the flash burst. */
function burst(r: number): string {
  const points: string[] = []
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2
    const k = i % 2 === 0 ? r : r * 0.5
    points.push(`${(Math.cos(a) * k).toFixed(1)},${(Math.sin(a) * k).toFixed(1)}`)
  }
  return points.join(' ')
}

const diamond = (r: number) => `0,${-r} ${r},0 0,${r} ${-r},0`

const spikeTriangle = (r: number) => `M0,${-r}L${r * 0.85},${r * 0.6}L${-r * 0.85},${r * 0.6}Z`

/** A map pin whose point is the origin: a round head on a tapering stem. */
const PIN_PATH =
  `M0,0C-3,-7 -${PIN_R},-15 -${PIN_R},-${PIN_HEAD}` +
  `A${PIN_R},${PIN_R} 0 1 1 ${PIN_R},-${PIN_HEAD}C${PIN_R},-15 3,-7 0,0Z`

/** A marker id for an arrowhead in this colour, unique to the canvas instance. */
const colorKey = (color: string) => color.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'none'

/** Where an ability is drawn to, from its centre: its selection ring and label sit outside it. */
function abilityExtent(item: PlacedAbility): number {
  switch (item.shape) {
    case 'flash':
      return Math.max(item.r, BURST_MIN)
    case 'trap':
      return Math.max(item.r, TRAP_MIN)
    case 'drone':
      return Math.max(item.r * 0.8, DRONE_MIN) * Math.SQRT2
    case 'wall':
      return item.from ? WALL_WIDTH : Math.max(item.r * 2, WALL_BAR_MIN) / 2
    default:
      return item.r
  }
}

function abilityName(item: PlacedAbility, agent: GameAgent | null): string {
  const fromRegistry = item.slot ? agent?.abilities.find(a => a.slot === item.slot)?.name : undefined
  return fromRegistry || UTILITY_STYLE[item.shape].label
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PlayCanvas({
  map,
  side,
  step,
  previous,
  tool,
  pending,
  selectedId,
  showCallouts,
  animate,
  onSelect,
  onChange,
  onPendingDone,
  onUnresolved,
}: PlayCanvasProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const boxClip = `${uid}-box`
  const tileClip = `${uid}-tile`
  const tint = `${uid}-tint`
  const arrowHead = (color: string) => `${uid}-head-${colorKey(color)}`

  const { registry } = useGameContent()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)

  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pressRef = useRef<Press | null>(null)
  /** Set by Escape so the blur that follows does not commit. */
  const skipBlurRef = useRef(false)

  const [width, setWidth] = useState(0)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState<{ id: string; value: string } | null>(null)

  const scene = useMemo(() => sceneForStep(step, map, side), [step, map, side])
  const previousScene = useMemo(() => (previous ? sceneForStep(previous, map, side) : null), [previous, map, side])
  const ghosts = useMemo(
    () => (previousScene ? ghostAgents(previous, step, map, side, previousScene) : []),
    [previousScene, previous, step, map, side],
  )

  /** Element id → the viewBox points a drag moves: one for most, both ends of an arrow, a whole stroke. */
  const anchors = useMemo(() => {
    const byId = new Map<string, Point[]>()
    for (const a of scene.agents) byId.set(a.id, [[a.x, a.y]])
    for (const a of scene.abilities) byId.set(a.id, [[a.x, a.y]])
    for (const m of scene.markers) byId.set(m.id, [[m.x, m.y]])
    for (const t of scene.texts) byId.set(t.id, [[t.x, t.y]])
    for (const a of scene.arrows) byId.set(a.id, [a.from, a.to])
    for (const p of scene.pens) byId.set(p.id, p.points)
    return byId
  }, [scene])

  // Arrowheads per colour: arrows in their own, move paths in the team's, the draft in white.
  const headColors = useMemo(
    () => [...new Set([ALLY, ENEMY, WHITE, ...scene.arrows.map(a => a.color)])],
    [scene],
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      // The map is the largest square that fits: that is the width labels care about.
      if (rect) setWidth(Math.min(rect.width, rect.height || rect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Report unplaceable callouts when the set changes, not on every render.
  const unresolvedKey = scene.unresolved.join('\n')
  const onUnresolvedRef = useRef(onUnresolved)
  useEffect(() => {
    onUnresolvedRef.current = onUnresolved
  })
  const reportedRef = useRef('')
  useEffect(() => {
    if (reportedRef.current === unresolvedKey) return
    reportedRef.current = unresolvedKey
    onUnresolvedRef.current?.(unresolvedKey ? unresolvedKey.split('\n') : [])
  }, [unresolvedKey])

  // A text that has just been placed, or clicked again, takes the keyboard.
  useEffect(() => {
    if (!editingId || editingId !== selectedId) return
    const input = inputRef.current
    if (input && document.activeElement !== input) {
      input.focus()
      input.select()
    }
  }, [editingId, selectedId])

  const agentOf = (name: string): GameAgent | null => registry?.agents.byName.get(name.trim().toLowerCase()) ?? null

  const showLabels = width >= LABEL_MIN_WIDTH_PX
  // Width is 0 until the first measure: full size then, so callouts do not flash small.
  const labelScale = width > 0 && width < COMPACT_LABEL_WIDTH_PX ? COMPACT_LABEL_SCALE : 1
  // 22 → 19 and 20 → 17 viewBox units on a compact canvas.
  const calloutLabel = Math.round(CALLOUT_LABEL * labelScale)
  const utilityLabel = Math.round(UTILITY_LABEL * labelScale)
  const drawing = pending !== null || DRAW_TOOLS.has(tool)
  const selecting = tool === 'select' && pending === null
  const dragging = live !== null
  const elementCursor = selecting ? (dragging ? 'grabbing' : 'grab') : undefined

  /** The drag offset of this element (or of this end of an arrow), when it is the one being dragged. */
  const offsetOf = (id: string, part: Part = 'body'): Point =>
    live && live.id === id && (live.part === 'body' || live.part === part) ? [live.dx, live.dy] : [0, 0]

  const placement = (x: number, y: number, animated = false, moving = false): CSSProperties => ({
    transform: `translate(${x}px, ${y}px)`,
    transformOrigin: '0 0',
    transition: animated && animate && !moving && !reducedMotion ? EASE : 'none',
  })

  // ── Geometry → document ─────────────────────────────────────────────────

  /** A viewBox point as a dragged position: image units, no callout. */
  const toPos = ([x, y]: Point): PlayPos => {
    const { u, v } = viewToImage(scene.view, x, y, scene.turns)
    return { u: round5(u), v: round5(v) }
  }

  const toView = (clientX: number, clientY: number): Point | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [p.x, p.y]
  }

  const anchorsOf = (id: string, part: Part): Point[] => {
    const points = anchors.get(id) ?? []
    return part === 'from' ? points.slice(0, 1) : part === 'to' ? points.slice(1, 2) : points
  }

  /** A drag offset that keeps everything it moves inside the map. */
  const clampDelta = (id: string, part: Part, dx: number, dy: number): Point => {
    const points = anchorsOf(id, part)
    if (points.length === 0) return [dx, dy]
    const xs = points.map(p => p[0])
    const ys = points.map(p => p[1])
    return [
      clamp(dx, -Math.min(...xs), VIEW_SIZE - Math.max(...xs)),
      clamp(dy, -Math.min(...ys), VIEW_SIZE - Math.max(...ys)),
    ]
  }

  /** The element moved by a drag, positions rewritten as image units; null when it is not drawn. */
  const moved = (id: string, part: Part, dx: number, dy: number): PlayElement | null => {
    const el = elementAt(step, id)
    const points = anchors.get(id)
    if (!el || !points || points.length === 0) return null
    const shift = ([x, y]: Point): Point => [x + dx, y + dy]
    switch (el.kind) {
      case 'agent':
      case 'ability':
      case 'marker':
      case 'text':
        return { ...el, at: toPos(shift(points[0])) }
      case 'arrow':
        return {
          ...el,
          from: part === 'to' ? el.from : toPos(shift(points[0])),
          to: part === 'from' ? el.to : toPos(shift(points[1] ?? points[0])),
        }
      case 'pen':
        return {
          ...el,
          points: points.map(p => {
            const { u, v } = toPos(shift(p))
            return { u: u as number, v: v as number }
          }),
        }
    }
  }

  const commitText = () => {
    const skip = skipBlurRef.current
    skipBlurRef.current = false
    const said = textDraft
    setEditingId(null)
    setTextDraft(null)
    if (skip || !said) return
    const el = elementAt(step, said.id)
    if (el?.kind !== 'text') return
    // A blank text would leave nothing to see or click: keep the old one.
    const text = said.value.trim() ? said.value : el.text
    if (text !== el.text) onChange(withElement(step, { ...el, text }))
  }

  const startEditing = (id: string) => {
    setTextDraft(null)
    setEditingId(id)
  }

  /** A press that ended where it started, for every tool that acts on a click. */
  const click = (press: Extract<Press, { mode: 'click' }>) => {
    if (pending) {
      if (!inSquare(press.at)) return
      const { shape, radius } = abilityShape(pending.agent, pending.slot)
      const el: AbilityElement = {
        kind: 'ability',
        id: newId(),
        agent: pending.agent,
        slot: pending.slot,
        shape,
        radius,
        at: toPos(press.at),
      }
      onChange(withElement(step, el))
      onSelect(el.id)
      onPendingDone()
      return
    }
    switch (tool) {
      case 'select':
        onSelect(press.id)
        return
      case 'eraser':
        if (!press.id) return
        onChange(withoutElement(step, press.id))
        if (press.id === selectedId) onSelect(null)
        return
      case 'text': {
        // On an existing text the tool edits it rather than stacking a new one on top.
        if (press.id && elementAt(step, press.id)?.kind === 'text') {
          onSelect(press.id)
          startEditing(press.id)
          return
        }
        if (!inSquare(press.at)) return
        const el: TextElement = { kind: 'text', id: newId(), text: 'Text', color: WHITE, at: toPos(press.at) }
        onChange(withElement(step, el))
        onSelect(el.id)
        startEditing(el.id)
        return
      }
      case 'spike':
      case 'enemy':
      case 'pin': {
        if (!inSquare(press.at)) return
        const el: MarkerElement = { kind: 'marker', id: newId(), type: tool, at: toPos(press.at) }
        onChange(withElement(step, el))
        onSelect(el.id)
        return
      }
      default:
        return
    }
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || pressRef.current) return
    const target = e.target as Element
    // The inline text input places its own caret.
    if (target.closest('foreignObject')) return
    // Pressing the map ends an inline edit the way leaving the field does.
    if (inputRef.current && document.activeElement === inputRef.current) inputRef.current.blur()
    const at = toView(e.clientX, e.clientY)
    if (!at) return

    const hit = target.closest('[data-id]')
    const id = hit?.getAttribute('data-id') ?? null
    const said = hit?.getAttribute('data-part')
    const part: Part = said === 'from' || said === 'to' ? said : 'body'
    const client: Point = [e.clientX, e.clientY]
    const { pointerId } = e

    let press: Press
    if (pending) {
      press = { mode: 'click', pointerId, at, id }
    } else if (tool === 'select') {
      press = id
        ? { mode: 'move', pointerId, id, part, client, start: at, dragging: false, wasSelected: id === selectedId }
        : { mode: 'click', pointerId, at, id: null }
    } else if (tool === 'pen' || tool === 'arrow') {
      if (!inSquare(at)) return
      if (tool === 'pen') {
        press = { mode: 'pen', pointerId, lastClient: client, points: [at] }
        setDraft({ kind: 'pen', points: [at] })
      } else {
        press = { mode: 'arrow', pointerId, client, from: at, to: at }
        setDraft({ kind: 'arrow', from: at, to: at })
      }
    } else {
      press = { mode: 'click', pointerId, at, id }
    }

    e.preventDefault()
    pressRef.current = press
    e.currentTarget.setPointerCapture(pointerId)
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId || press.mode === 'click') return
    const at = toView(e.clientX, e.clientY)
    if (!at) return
    switch (press.mode) {
      case 'move': {
        if (!press.dragging && Math.hypot(e.clientX - press.client[0], e.clientY - press.client[1]) <= DRAG_THRESHOLD_PX) {
          return
        }
        press.dragging = true
        const [dx, dy] = clampDelta(press.id, press.part, at[0] - press.start[0], at[1] - press.start[1])
        setLive({ id: press.id, part: press.part, dx, dy })
        return
      }
      case 'pen': {
        if (Math.hypot(e.clientX - press.lastClient[0], e.clientY - press.lastClient[1]) < PEN_SAMPLE_PX) return
        press.lastClient = [e.clientX, e.clientY]
        press.points = [...press.points, clampPoint(at)]
        setDraft({ kind: 'pen', points: press.points })
        return
      }
      case 'arrow': {
        press.to = clampPoint(at)
        setDraft({ kind: 'arrow', from: press.from, to: press.to })
        return
      }
    }
  }

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId) return
    pressRef.current = null
    const at = toView(e.clientX, e.clientY)

    switch (press.mode) {
      case 'move': {
        if (press.dragging) {
          const [dx, dy] = at
            ? clampDelta(press.id, press.part, at[0] - press.start[0], at[1] - press.start[1])
            : [live?.dx ?? 0, live?.dy ?? 0]
          setLive(null)
          const el = moved(press.id, press.part, dx, dy)
          if (el) onChange(withElement(step, el))
          if (press.id !== selectedId) onSelect(press.id)
        } else if (press.wasSelected && elementAt(step, press.id)?.kind === 'text') {
          // A second click on a selected text opens it for typing.
          startEditing(press.id)
        } else {
          onSelect(press.id)
        }
        return
      }
      case 'pen': {
        setDraft(null)
        let points = press.points
        if (at && Math.hypot(e.clientX - press.lastClient[0], e.clientY - press.lastClient[1]) > 1) {
          points = [...points, clampPoint(at)]
        }
        if (points.length < 2) return
        onChange(
          withElement(step, {
            kind: 'pen',
            id: newId(),
            points: points.map(p => {
              const { u, v } = toPos(p)
              return { u: u as number, v: v as number }
            }),
            color: WHITE,
          }),
        )
        return
      }
      case 'arrow': {
        setDraft(null)
        if (Math.hypot(e.clientX - press.client[0], e.clientY - press.client[1]) < ARROW_MIN_PX) return
        const to = at ? clampPoint(at) : press.to
        onChange(withElement(step, { kind: 'arrow', id: newId(), from: toPos(press.from), to: toPos(to), color: WHITE }))
        return
      }
      case 'click':
        click(press)
        return
    }
  }

  const onPointerCancel = () => {
    pressRef.current = null
    setLive(null)
    setDraft(null)
  }

  /** What every element on the map answers to: hover, keyboard selection, the hit target. */
  const interactive = (id: string, label: string) => ({
    'data-id': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': id === selectedId,
    onPointerEnter: () => setHoverId(id),
    onPointerLeave: () => setHoverId(h => (h === id ? null : h)),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  })

  // ── Layers ──────────────────────────────────────────────────────────────

  const smallLabel = (text: string, y: number, key?: string) =>
    showLabels && text ? (
      <text
        key={key}
        y={y}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize={utilityLabel}
        fill="#CBD5E1"
        pointerEvents="none"
        {...HALO}
      >
        {truncate(text, NOTE_MAX)}
      </text>
    ) : null

  const ringOf = (agent: Pick<PlacedAgent, 'team' | 'spike'>) => (agent.spike ? SPIKE : agent.team === 'enemy' ? ENEMY : ALLY)

  /** An agent's square portrait tile about the origin. */
  const tile = (name: string, ring: string) => {
    const icon = agentOf(name)?.displayIcon ?? null
    return (
      <>
        <rect x={-HALF} y={-HALF} width={TILE} height={TILE} rx={TILE_RX} fill={TILE_FILL} />
        {icon ? (
          <image
            href={icon}
            x={-HALF}
            y={-HALF}
            width={TILE}
            height={TILE}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${tileClip})`}
          />
        ) : (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontWeight="bold"
            fontSize={16}
            fill="#F1F5F9"
            pointerEvents="none"
          >
            {name.slice(0, 3)}
          </text>
        )}
        <rect x={-HALF} y={-HALF} width={TILE} height={TILE} rx={TILE_RX} fill="none" stroke={ring} strokeWidth={TILE_RING} />
      </>
    )
  }

  const pens = scene.pens.map(pen => {
    const [dx, dy] = offsetOf(pen.id)
    const points = pointsAttr(pen.points, dx, dy)
    return (
      <g key={pen.id} {...interactive(pen.id, 'Pen stroke')} style={{ cursor: elementCursor }}>
        {/* Hit area: a 5 px line is hard to grab. */}
        <polyline points={points} fill="none" stroke="transparent" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
        <polyline
          points={points}
          fill="none"
          stroke={pen.color}
          strokeWidth={PEN_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </g>
    )
  })

  const renderAbility = (item: PlacedAbility) => {
    const [dx, dy] = offsetOf(item.id)
    const agent = agentOf(item.agent)
    const color = liftColor(agentColor(agent))
    const icon = item.slot ? (agent?.abilities.find(a => a.slot === item.slot)?.icon ?? null) : null
    const { r } = item
    // `from` stays put while `at` is dragged.
    const fx = item.from ? item.from[0] - item.x - dx : 0
    const fy = item.from ? item.from[1] - item.y - dy : 0
    const filled = { fill: color, fillOpacity: ABILITY_FILL, stroke: color, strokeOpacity: ABILITY_RING, strokeWidth: RING_WIDTH }
    const ring = { fill: 'none', stroke: color, strokeOpacity: ABILITY_RING, strokeWidth: OUTLINE_WIDTH }

    let shape: ReactNode
    switch (item.shape) {
      case 'smoke':
      case 'molly':
      case 'slow':
      case 'stun':
        shape = <circle r={r} {...filled} />
        break
      case 'flash':
        shape = <polygon points={burst(Math.max(r, BURST_MIN))} strokeLinejoin="round" {...filled} />
        break
      case 'wall':
        if (item.from) {
          const length = Math.hypot(fx, fy)
          const angle = (Math.atan2(fy, fx) * 180) / Math.PI
          shape = (
            <rect
              x={-WALL_WIDTH / 2}
              y={-WALL_WIDTH / 2}
              width={length + WALL_WIDTH}
              height={WALL_WIDTH}
              rx={WALL_WIDTH / 2}
              transform={`rotate(${angle.toFixed(2)})`}
              {...filled}
            />
          )
        } else {
          const length = Math.max(r * 2, WALL_BAR_MIN)
          shape = (
            <rect x={-length / 2} y={-WALL_WIDTH / 2} width={length} height={WALL_WIDTH} rx={WALL_WIDTH / 2} {...filled} />
          )
        }
        break
      case 'trap':
        shape = <polygon points={diamond(Math.max(r, TRAP_MIN))} strokeLinejoin="round" {...filled} />
        break
      case 'drone': {
        const h = Math.max(r * 0.8, DRONE_MIN)
        shape = <rect x={-h} y={-h} width={h * 2} height={h * 2} rx={4} {...filled} />
        break
      }
      case 'recon':
        shape = <circle r={r} {...ring} />
        break
      case 'ult':
        shape = (
          <>
            <circle r={r} {...filled} strokeWidth={OUTLINE_WIDTH} />
            <circle r={r * 0.7} {...ring} />
          </>
        )
        break
      default:
        shape = <circle r={r} {...ring} strokeDasharray="1 9" strokeLinecap="round" />
    }

    const name = abilityName(item, agent)
    return (
      <g
        key={item.id}
        {...interactive(item.id, `${name}${item.agent ? ` (${item.agent})` : ''}${item.label ? `: ${item.label}` : ''}`)}
        style={{ ...placement(item.x + dx, item.y + dy), cursor: elementCursor }}
      >
        {item.from && item.shape !== 'wall' && (
          <line
            x1={fx}
            y1={fy}
            x2={0}
            y2={0}
            stroke={color}
            strokeOpacity={ABILITY_RING}
            strokeWidth={3}
            strokeDasharray="10 8"
            pointerEvents="none"
          />
        )}
        {/* Hit area: rings and small shapes are hard to grab. */}
        <circle r={Math.max(item.shape === 'wall' ? 0 : abilityExtent(item), HIT_R)} fill="transparent" />
        {shape}
        {icon && (
          <g pointerEvents="none">
            <circle r={ICON_DISC} fill={BACKDROP} fillOpacity={0.85} />
            <image
              href={icon}
              x={-ABILITY_ICON / 2}
              y={-ABILITY_ICON / 2}
              width={ABILITY_ICON}
              height={ABILITY_ICON}
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        )}
      </g>
    )
  }

  const arrows = scene.arrows.map(arrow => {
    const [fdx, fdy] = offsetOf(arrow.id, 'from')
    const [tdx, tdy] = offsetOf(arrow.id, 'to')
    const line = { x1: arrow.from[0] + fdx, y1: arrow.from[1] + fdy, x2: arrow.to[0] + tdx, y2: arrow.to[1] + tdy }
    return (
      <g key={arrow.id} {...interactive(arrow.id, 'Arrow')} style={{ cursor: elementCursor }}>
        <line {...line} stroke="transparent" strokeWidth={24} strokeLinecap="round" />
        <line
          {...line}
          stroke={arrow.color}
          strokeWidth={ARROW_WIDTH}
          strokeLinecap="round"
          markerEnd={`url(#${arrowHead(arrow.color)})`}
          pointerEvents="none"
        />
      </g>
    )
  })

  // Paths start under the agent; a dragged agent takes its path's start along.
  const paths = scene.agents.flatMap(agent => {
    if (!agent.path) return []
    const [dx, dy] = offsetOf(agent.id)
    const points = agent.path.map(([x, y], i): Point => (i === 0 ? [x + dx, y + dy] : [x, y]))
    const color = agent.team === 'enemy' ? ENEMY : ALLY
    return [
      <polyline
        key={`path:${agent.id}`}
        points={pointsAttr(points)}
        fill="none"
        stroke={color}
        strokeWidth={PATH_WIDTH}
        strokeLinejoin="round"
        strokeLinecap="round"
        markerEnd={`url(#${arrowHead(color)})`}
        pointerEvents="none"
      />,
    ]
  })

  const renderMarker = (marker: PlacedMarker) => {
    const [dx, dy] = offsetOf(marker.id)
    let shape: ReactNode
    let name: string
    let labelY: number
    if (marker.type === 'spike') {
      name = 'Spike'
      labelY = SPIKE_R + 8 + utilityLabel
      shape = (
        <>
          <circle r={HIT_R} fill="transparent" />
          <path d={spikeTriangle(SPIKE_R)} fill={SPIKE} stroke={BACKDROP} strokeWidth={2} strokeLinejoin="round" />
          {marker.site && (
            <text
              y={SPIKE_R * 0.12}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, sans-serif"
              fontWeight="bold"
              fontSize={18}
              fill={BACKDROP}
              pointerEvents="none"
            >
              {marker.site}
            </text>
          )}
        </>
      )
    } else if (marker.type === 'enemy') {
      name = 'Enemy'
      labelY = ENEMY_R + 8 + utilityLabel
      shape = (
        <>
          <circle r={HIT_R} fill="transparent" />
          <circle r={ENEMY_R} fill={BACKDROP} fillOpacity={0.6} stroke={ENEMY} strokeWidth={4} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontWeight="bold"
            fontSize={22}
            fill={ENEMY}
            pointerEvents="none"
          >
            ?
          </text>
        </>
      )
    } else {
      name = 'Pin'
      labelY = 8 + utilityLabel
      shape = (
        <>
          <circle cy={-PIN_HEAD + 4} r={HIT_R} fill="transparent" />
          <path d={PIN_PATH} fill={SPIKE} stroke={BACKDROP} strokeWidth={2} strokeLinejoin="round" />
          <circle cy={-PIN_HEAD} r={5} fill={BACKDROP} pointerEvents="none" />
        </>
      )
    }
    return (
      <g
        key={marker.id}
        {...interactive(marker.id, marker.label ? `${name}: ${marker.label}` : name)}
        style={{ ...placement(marker.x + dx, marker.y + dy), cursor: elementCursor }}
      >
        {shape}
        {smallLabel(marker.label, labelY)}
      </g>
    )
  }

  // The inline editor: over the selected text while the select or text tool is on.
  const editorText =
    selectedId && pending === null && (tool === 'select' || tool === 'text')
      ? (scene.texts.find(t => t.id === selectedId) ?? null)
      : null
  const editing = editorText !== null && editingId === editorText.id
  const textValue = (t: { id: string; text: string }) => (textDraft?.id === t.id ? textDraft.value : t.text)

  const texts = scene.texts.map(t => {
    const [dx, dy] = offsetOf(t.id)
    const value = textValue(t)
    const w = textWidth(value, TEXT_SIZE)
    return (
      <g
        key={t.id}
        {...interactive(t.id, `Text: ${value}`)}
        style={{ ...placement(t.x + dx, t.y + dy), cursor: elementCursor }}
      >
        <rect x={-w / 2} y={-TEXT_BOX_H / 2} width={w} height={TEXT_BOX_H} fill="transparent" />
        {!(editing && editorText?.id === t.id) && (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontSize={TEXT_SIZE}
            fontWeight={600}
            fill={t.color}
            pointerEvents="none"
            {...HALO}
          >
            {value}
          </text>
        )}
      </g>
    )
  })

  const ghostTiles = ghosts.map(ghost => (
    <g key={`ghost:${ghost.id}`} opacity={GHOST_OPACITY} style={placement(ghost.x, ghost.y)}>
      {tile(ghost.agent, ringOf(ghost))}
    </g>
  ))

  const agentTiles = scene.agents.map(agent => {
    const [dx, dy] = offsetOf(agent.id)
    const label = `${agent.agent}${agent.team === 'enemy' ? ' (enemy)' : ''}${agent.spike ? ', spike carrier' : ''}${
      agent.note ? `: ${agent.note}` : ''
    }`
    return (
      <g
        key={agent.id}
        {...interactive(agent.id, label)}
        style={{ ...placement(agent.x + dx, agent.y + dy, true, live?.id === agent.id), cursor: elementCursor }}
      >
        {tile(agent.agent, ringOf(agent))}
      </g>
    )
  })

  // ── Selection ───────────────────────────────────────────────────────────

  const dashed = { fill: 'none', stroke: WHITE, strokeWidth: 3, strokeDasharray: '8 6' } as const

  const selection = (): ReactNode => {
    if (!selectedId) return null
    const agent = scene.agents.find(a => a.id === selectedId)
    if (agent) {
      const [dx, dy] = offsetOf(agent.id)
      const pad = 6
      return (
        <g
          key={`sel:${agent.id}`}
          pointerEvents="none"
          style={placement(agent.x + dx, agent.y + dy, true, live?.id === agent.id)}
        >
          <rect
            x={-HALF - pad}
            y={-HALF - pad}
            width={TILE + pad * 2}
            height={TILE + pad * 2}
            rx={TILE_RX + 4}
            fill="none"
            stroke={WHITE}
            strokeWidth={3}
          />
        </g>
      )
    }
    const ability = scene.abilities.find(a => a.id === selectedId)
    if (ability) {
      const [dx, dy] = offsetOf(ability.id)
      if (ability.shape === 'wall' && ability.from) {
        const fx = ability.from[0] - ability.x - dx
        const fy = ability.from[1] - ability.y - dy
        const pad = WALL_WIDTH / 2 + 6
        const angle = (Math.atan2(fy, fx) * 180) / Math.PI
        return (
          <g key={`sel:${ability.id}`} pointerEvents="none" style={placement(ability.x + dx, ability.y + dy)}>
            <rect
              x={-pad}
              y={-pad}
              width={Math.hypot(fx, fy) + pad * 2}
              height={pad * 2}
              rx={pad}
              transform={`rotate(${angle.toFixed(2)})`}
              {...dashed}
            />
          </g>
        )
      }
      return (
        <g key={`sel:${ability.id}`} pointerEvents="none" style={placement(ability.x + dx, ability.y + dy)}>
          <circle r={abilityExtent(ability) + 8} {...dashed} />
        </g>
      )
    }
    const marker = scene.markers.find(m => m.id === selectedId)
    if (marker) {
      const [dx, dy] = offsetOf(marker.id)
      const cy = marker.type === 'pin' ? -PIN_HEAD + 6 : 0
      const r = marker.type === 'pin' ? PIN_R + 18 : marker.type === 'spike' ? SPIKE_R + 8 : ENEMY_R + 8
      return (
        <g key={`sel:${marker.id}`} pointerEvents="none" style={placement(marker.x + dx, marker.y + dy)}>
          <circle cy={cy} r={r} {...dashed} />
        </g>
      )
    }
    const text = scene.texts.find(t => t.id === selectedId)
    if (text) {
      if (editing) return null
      const [dx, dy] = offsetOf(text.id)
      const w = textWidth(textValue(text), TEXT_SIZE) + 12
      const h = TEXT_BOX_H + 10
      return (
        <g key={`sel:${text.id}`} pointerEvents="none" style={placement(text.x + dx, text.y + dy)}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} {...dashed} />
        </g>
      )
    }
    const pen = scene.pens.find(p => p.id === selectedId)
    if (pen) {
      const [dx, dy] = offsetOf(pen.id)
      const xs = pen.points.map(p => p[0] + dx)
      const ys = pen.points.map(p => p[1] + dy)
      const pad = 10
      const x0 = Math.min(...xs) - pad
      const y0 = Math.min(...ys) - pad
      return (
        <rect
          key={`sel:${pen.id}`}
          x={x0}
          y={y0}
          width={Math.max(...xs) + pad - x0}
          height={Math.max(...ys) + pad - y0}
          rx={8}
          pointerEvents="none"
          {...dashed}
        />
      )
    }
    const arrow = scene.arrows.find(a => a.id === selectedId)
    if (arrow) {
      const ends: [Part, Point][] = [
        ['from', arrow.from],
        ['to', arrow.to],
      ]
      return (
        <g key={`sel:${arrow.id}`}>
          {ends.map(([part, [x, y]]) => {
            const [dx, dy] = offsetOf(arrow.id, part)
            return (
              <circle
                key={part}
                data-id={arrow.id}
                data-part={part}
                cx={x + dx}
                cy={y + dy}
                r={HANDLE_R}
                fill={BACKDROP}
                stroke={WHITE}
                strokeWidth={3}
                pointerEvents={selecting ? undefined : 'none'}
                style={{ cursor: elementCursor }}
              />
            )
          })}
        </g>
      )
    }
    return null
  }

  // ── Labels ──────────────────────────────────────────────────────────────

  const agentLabel = (agent: PlacedAgent) => {
    const [dx, dy] = offsetOf(agent.id)
    const ax = agent.x + dx
    const ay = agent.y + dy
    const note = truncate(agent.note, NOTE_MAX)
    const w = Math.max(agent.agent.length * 20 * 0.62, note.length * 18 * 0.54) + 28
    const h = note ? 64 : 38
    const gap = HALF + 12
    const left = clamp(ax - w / 2, 8, VIEW_SIZE - 8 - w)
    const top = ay + gap + h > VIEW_SIZE - 8 ? ay - gap - h : ay + gap
    return (
      <g key={`label:${agent.id}`} style={placement(ax, ay, true, live?.id === agent.id)}>
        <rect x={left - ax} y={top - ay} width={w} height={h} rx={10} fill="#111827" stroke="#242938" strokeWidth={1} />
        <text x={left - ax + 14} y={top - ay + 26} fontFamily={FONT} fontSize={20} fontWeight={600} fill="#F1F5F9" {...HALO}>
          {agent.agent}
        </text>
        {note && (
          <text x={left - ax + 14} y={top - ay + 52} fontFamily={FONT} fontSize={18} fill="#94A3B8" {...HALO}>
            {note}
          </text>
        )}
      </g>
    )
  }

  const labels: ReactNode[] = []
  if (showLabels) {
    const shown = new Set([hoverId, selectedId].filter((id): id is string => id !== null))
    for (const agent of scene.agents) if (shown.has(agent.id)) labels.push(agentLabel(agent))
    for (const ability of scene.abilities) {
      if (!shown.has(ability.id)) continue
      const [dx, dy] = offsetOf(ability.id)
      labels.push(
        <g key={`label:${ability.id}`} style={placement(ability.x + dx, ability.y + dy)}>
          {smallLabel(abilityName(ability, agentOf(ability.agent)), abilityExtent(ability) + 10 + utilityLabel)}
        </g>,
      )
    }
  }

  // ── Draft ───────────────────────────────────────────────────────────────

  let draftLayer: ReactNode = null
  if (draft?.kind === 'pen') {
    draftLayer =
      draft.points.length === 1 ? (
        <circle cx={draft.points[0][0]} cy={draft.points[0][1]} r={PEN_WIDTH / 2} fill={WHITE} />
      ) : (
        <polyline
          points={pointsAttr(draft.points)}
          fill="none"
          stroke={WHITE}
          strokeWidth={PEN_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
  } else if (draft?.kind === 'arrow') {
    draftLayer = (
      <line
        x1={draft.from[0]}
        y1={draft.from[1]}
        x2={draft.to[0]}
        y2={draft.to[1]}
        stroke={WHITE}
        strokeWidth={ARROW_WIDTH}
        strokeLinecap="round"
        markerEnd={`url(#${arrowHead(WHITE)})`}
      />
    )
  }

  // ── Inline text editor ──────────────────────────────────────────────────

  let editor: ReactNode = null
  if (editorText) {
    const [dx, dy] = offsetOf(editorText.id)
    const value = textValue(editorText)
    const w = Math.max(160, textWidth(value, TEXT_SIZE) + 32)
    const h = 44
    const id = editorText.id
    editor = (
      <foreignObject
        x={editorText.x + dx - w / 2}
        y={editorText.y + dy - h / 2}
        width={w}
        height={h}
        // Until it is opened, the field waits unseen and lets presses through to the text, so it can be dragged.
        style={{ pointerEvents: editing ? 'auto' : 'none', opacity: editing ? 1 : 0, overflow: 'visible' }}
      >
        <input
          ref={inputRef}
          value={value}
          aria-label="Text"
          tabIndex={editing ? 0 : -1}
          onChange={e => setTextDraft({ id, value: e.target.value })}
          onFocus={() => {
            if (editingId !== id) startEditing(id)
          }}
          onBlur={commitText}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              skipBlurRef.current = true
              e.currentTarget.blur()
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: 8,
            border: `2px solid ${ALLY}`,
            background: 'rgba(11, 18, 32, 0.9)',
            color: editorText.color,
            font: `600 ${TEXT_SIZE}px ${FONT}`,
            textAlign: 'center',
            outline: 'none',
          }}
        />
      </foreignObject>
    )
  }

  // ── Frame ───────────────────────────────────────────────────────────────

  const view = scene.view
  const imageSize = VIEW_SIZE / view.size
  const counts = `${scene.agents.length} agent${scene.agents.length === 1 ? '' : 's'}, ${scene.abilities.length} abilit${
    scene.abilities.length === 1 ? 'y' : 'ies'
  }`

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      className="block h-full w-full select-none"
      role="group"
      aria-label={`${map.name}, ${step.name || 'step'}: ${counts}`}
      style={{ touchAction: 'none', userSelect: 'none', cursor: drawing ? 'crosshair' : dragging ? 'grabbing' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <defs>
        <clipPath id={boxClip}>
          <rect width={VIEW_SIZE} height={VIEW_SIZE} rx={14} />
        </clipPath>
        {/* User space of the referencing image: every tile is drawn about its own origin. */}
        <clipPath id={tileClip}>
          <rect x={-HALF} y={-HALF} width={TILE} height={TILE} rx={TILE_RX} />
        </clipPath>
        <filter id={tint} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={LUMINANCE_MATRIX} />
          <feComponentTransfer>
            <feFuncR type="gamma" exponent={FLOOR_GAMMA} />
            <feFuncG type="gamma" exponent={FLOOR_GAMMA} />
            <feFuncB type="gamma" exponent={FLOOR_GAMMA} />
          </feComponentTransfer>
          <feColorMatrix type="matrix" values={TEAL_MATRIX} />
        </filter>
        {headColors.map(color => (
          <marker
            key={color}
            id={arrowHead(color)}
            viewBox="0 0 10 10"
            refX={7}
            refY={5}
            markerWidth={3.5}
            markerHeight={3.5}
            markerUnits="strokeWidth"
            orient="auto-start-reverse"
          >
            <path d="M0,0L10,5L0,10Z" fill={color} />
          </marker>
        ))}
      </defs>

      <g clipPath={`url(#${boxClip})`}>
        <rect width={VIEW_SIZE} height={VIEW_SIZE} fill={BACKDROP} />
        {map.displayIcon && (
          // The picture turns about the centre; everything else is placed
          // already turned by the scene, so it stays upright.
          <g transform={`rotate(${scene.turns * 90} ${VIEW_SIZE / 2} ${VIEW_SIZE / 2})`} pointerEvents="none">
            <image
              href={map.displayIcon}
              x={(-view.u / view.size) * VIEW_SIZE}
              y={(-view.v / view.size) * VIEW_SIZE}
              width={imageSize}
              height={imageSize}
              preserveAspectRatio="none"
              filter={`url(#${tint})`}
              opacity={MAP_OPACITY}
            />
          </g>
        )}

        {showCallouts && (
          <g
            pointerEvents="none"
            fontFamily={FONT}
            fontSize={calloutLabel}
            fill={CALLOUT_COLOR}
            textAnchor="middle"
            {...HALO}
          >
            {scene.callouts.map((c, i) => (
              <text key={`${c.name}:${i}`} x={c.x} y={c.y} dominantBaseline="central">
                {c.name}
              </text>
            ))}
          </g>
        )}

        <g>{pens}</g>
        <g>{scene.abilities.map(renderAbility)}</g>
        <g>{arrows}</g>
        <g>{paths}</g>
        <g>{scene.markers.filter(m => m.type === 'spike').map(renderMarker)}</g>
        <g>{scene.markers.filter(m => m.type !== 'spike').map(renderMarker)}</g>
        <g>{texts}</g>
        <g pointerEvents="none">{ghostTiles}</g>
        <g>{agentTiles}</g>
        <g>{selection()}</g>
        <g pointerEvents="none">{labels}</g>
        <g pointerEvents="none">{draftLayer}</g>
        {editor}
      </g>
    </svg>
  )
}
