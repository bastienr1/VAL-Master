/**
 * The Plays canvas: one step of a set play drawn on the map and edited in
 * place (docs/plays-editor-v2.md §2.2).
 *
 * SVG in a 1000 x 1000 viewBox showing the square of the minimap image that
 * holds every callout, turned so the play's own spawn is at the bottom. The
 * map art goes through a colour matrix that draws its grey walls teal on a
 * navy backdrop. Bottom to top: map, callout labels, the map-control overlay
 * (§2.9, when a grid is given), pen strokes, abilities,
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
 *
 * The svg fills its whole column and its viewBox takes the column's shape
 * (`viewBoxFor`): at zoom 1 the map square fits the shorter side, centred on
 * the longer; zoomed in, the map runs edge to edge and pans. Zoom and pan
 * (§2.2) are view state, never saved and reset with the map. Every pointer
 * goes through the svg's screen matrix, so a press lands on what is drawn
 * under it at any zoom and shape. Real sizes (utility areas, wall extents,
 * the map art and the control overlay) grow with the zoom; everything
 * symbolic (tiles, badges, markers, labels, line widths, arrowheads,
 * selection rings, handles, ghosts) keeps its size on screen through
 * `k = 1 / zoom` (§2.2 "Constant-size markers"). At zoom 1, k = 1.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Maximize2 } from 'lucide-react'
import { useGameContent } from '../hooks/useGameContent'
import { type GameAgent, type GameMap } from '../lib/gameContent'
import { SLOT_KEYS, abilityShape } from '../lib/agentAbilities'
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
  imageToView,
  MAX_ZOOM,
  MIN_ZOOM,
  UTILITY_STYLE,
  VIEW_SIZE,
  clampCamera,
  cmToView,
  ghostAgents,
  polylineMidpoint,
  sceneForStep,
  throwArc,
  throwOrigin,
  viewBoxFor,
  viewToImage,
  zoomAbout,
  type Camera,
  type ViewRect,
  type PlacedAbility,
  type PlacedAgent,
  type PlacedMarker,
  type Point,
} from '../lib/playScene'
import type { AgentMotion } from '../lib/replayMotion'
import { canvasSkin, hexChannels, skinDrawColor, skinMapMatrix, type CanvasSkin, type CanvasSkinId } from '../lib/canvasSkins'
import type { ControlGrid } from '../lib/mapControl'
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
  /** A replay's view cones and trails, by agent element id (§2.12). */
  motion?: ReadonlyMap<string, AgentMotion> | null
  /** False for an ability a replay layer hides. It stays in the step, so edits and captures keep it. */
  abilityVisible?: (id: string) => boolean
  /** The canvas skin (§2.11); the default skin when not given. */
  skin?: CanvasSkinId
  /** A name under every agent tile: who played it (a replay's Riot name), else the agent. */
  showNames?: boolean
  /** False while scrubbing fast, and for a replay's frames. */
  animate: boolean
  onSelect(id: string | null): void
  /**
   * Every edit of the step goes through here, as a new step object. Absent,
   * the canvas is read-only (a replay playing, §2.8): a press selects, the map
   * zooms and pans, and nothing is moved, drawn or placed.
   */
  onChange?(step: PlayStep): void
  /** Pen/arrow/text/marker/ability placements call this with the new element appended. */
  onPendingDone(): void
  onUnresolved?(names: string[]): void
  /**
   * Who holds the space (§2.9), drawn over the map art and callouts, under
   * every element. Repainted only when its `version` (or `n`) changes, so a
   * grid stepped in place must bump `version`.
   */
  control?: ControlGrid | null
}

/** What the page can ask of the canvas: its `+` / `-` / `0` keys zoom about the centre. */
export interface PlayCanvasHandle {
  zoomIn(): void
  zoomOut(): void
  resetZoom(): void
  /** The image-unit point at the centre of what is shown: where the strip places a new agent. */
  visibleCentre(): { u: number; v: number }
}

// ── Looks ───────────────────────────────────────────────────────────────────

/** Overlay alpha at full control (|v| = 1). */
const CONTROL_ALPHA = 0.42
/** Below this |v| a cell is left clear. */
const CONTROL_EPSILON = 0.02

let controlCanvas: HTMLCanvasElement | null = null

/** The grid as a PNG data URL, one pixel per cell; masked-out and near-neutral cells stay clear. */
function paintControl(grid: ControlGrid, skin: CanvasSkin): string | null {
  const { n, values, mask } = grid
  if (typeof document === 'undefined' || n <= 0) return null
  controlCanvas ??= document.createElement('canvas')
  const canvas = controlCanvas
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const ally = hexChannels(skin.ally)
  const enemy = hexChannels(skin.enemy)
  const image = ctx.createImageData(n, n)
  const px = image.data
  for (let i = 0; i < n * n; i++) {
    const v = values[i]
    if (!mask[i] || !(Math.abs(v) > CONTROL_EPSILON)) continue
    const [r, g, b] = v > 0 ? ally : enemy
    const o = i * 4
    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = Math.round(CONTROL_ALPHA * Math.min(1, Math.abs(v)) * 255)
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
const WHITE = '#FFFFFF'
/** The little key tag on a badge stays dark on every skin: it sits on the badge's colour. */
const KEY_TAG_FILL = '#0B1220'
const FONT = 'Inter, sans-serif'

/**
 * The map art's tint, in three passes, alpha kept throughout: luminance
 * (L = 0.3 R + 0.59 G + 0.11 B) into every channel; squared, so the light
 * grey floor of the Riot minimap sinks towards the backdrop while its white
 * wall lines stay bright; then mapped between the skin's floor and wall colours
 * (`skinMapMatrix`), the walls bright, the floor a shade off the void around it.
 * A plain luminance matrix (no squaring) left the floor a mid teal.
 */
const LUMINANCE_MATRIX = '0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0'
const FLOOR_GAMMA = 2

const TILE = 44
const HALF = TILE / 2
const TILE_RX = 6
const TILE_RING = 3
const GHOST_OPACITY = 0.25

/** Areas are drawn in their shape's colour (`UTILITY_COLORS`), not the agent's. */
const ABILITY_FILL = 0.3
/** Smokes block vision, so they read a little denser. */
const SMOKE_FILL = 0.38
/** Above this radius an area is drawn as an outline with a faint fill. */
const HUGE_AREA_CM = 1500
const HUGE_FILL = 0.06
const ABILITY_RING = 0.85
/** Ring of a filled shape. */
const RING_WIDTH = 1.5
/** Stroke of a shape that is only a ring (recon, ult, other). */
const OUTLINE_WIDTH = 4
/** The ability badge (§2.10): a disc in the shape's colour, a ring in the thrower's team colour, the white glyph inside. */
const BADGE_R = 13
const BADGE_RING = 2
/** The time-left ring around a replay frame's badge: its radius, width and length. */
const LIFE_R = BADGE_R + BADGE_RING + 3.5
const LIFE_WIDTH = 3
const LIFE_LENGTH = 2 * Math.PI * LIFE_R
const BADGE_GLYPH = 18
/** The letter drawn instead when the registry has no glyph. */
const BADGE_LETTER = 14
/** The key tag at the badge's top-right: an 11-unit rounded square with the C / Q / E / X letter. */
const KEY_TAG = 11
const KEY_TAG_RX = 2.5
const KEY_LETTER = 8
/** The tag's centre, on the badge's rim at 45°. */
const KEY_TAG_AT = BADGE_R * Math.SQRT1_2
/** The throw arc: dashed, in the agent's colour; fainter while the ability is still in flight. */
const ARC_WIDTH = 2
const ARC_DASH = '5 4'
const ARC_OPACITY = 0.9
const ARC_FLIGHT_OPACITY = 0.55
/** The arc stops this short of a badge at the landing, so its arrowhead shows. */
const ARC_END_GAP = BADGE_R + 2
/** A wall's line through its path. */
const WALL_LINE = 7
const WALL_LINE_OPACITY = 0.9
/** The handle at a selected ability's `from`. */
const FROM_HANDLE_R = 10
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
/** The name under an agent tile (Names toggle). */
const NAME_SIZE = 20
const NAME_MAX = 16
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

/** What one press of a zoom button or key multiplies the zoom by. */
const ZOOM_STEP = 1.25
/** The wheel zooms by `exp(-deltaY * WHEEL_RATE)`. */
const WHEEL_RATE = 0.0015
/** A wheel that counts lines (Firefox) moves about this many pixels a line. */
const WHEEL_LINE_PX = 16

const DRAW_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['pen', 'arrow', 'text', 'spike', 'enemy', 'pin'])

/** Which part of an element a press grabbed: arrows have two ends besides the body. */
type Part = 'body' | 'from' | 'to'

type ClickPress = { mode: 'click'; pointerId: number; at: Point; id: string | null }

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
  | ClickPress
  | {
      mode: 'pan'
      pointerId: number
      /** Client px of the press, for the drag threshold. */
      client: Point
      /** The viewBox point pressed: the pan keeps it under the pointer. */
      grab: Point
      dragging: boolean
      /** What the press does if it never moves: the select tool's click on the empty map. */
      click: ClickPress | null
    }

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

/** The whole map, fitted to the canvas (playScene's `clampCamera` centres it). */
const HOME: Camera = { zoom: 1, x: 0, y: 0 }

const centreOf = ({ x, y, w, h }: ViewRect): Point => [x + w / 2, y + h / 2]

const viewBoxAttr = ({ x, y, w, h }: ViewRect) => [x, y, w, h].map(n => Math.round(n * 1e3) / 1e3).join(' ')

/** A space typed in a field is not Space held to pan. */
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable)

/** A dash pattern times `k`: unchanged at 1. */
const scaleDashes = (pattern: string, k: number) => (k === 1 ? pattern : pattern.split(/\s+/).map(n => Number(n) * k).join(' '))

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

/** In flight (§2.10): thrown, with a progress; the badge rides the arc and no area is drawn yet. */
const inFlight = (item: PlacedAbility): item is PlacedAbility & { from: Point; progress: number } =>
  item.from !== null && item.progress !== null

/**
 * Where an ability is drawn to, from its centre: its selection ring sits
 * outside it. `k` is the marker scale (1 / zoom): the badge and the smallest
 * shapes keep their size on screen, real areas do not.
 */
function abilityExtent(item: PlacedAbility, k: number): number {
  // Only the badge stands at the centre of a throw in flight or of a wall drawn along its path.
  if (inFlight(item) || item.path) return BADGE_R * k
  switch (item.shape) {
    case 'flash':
      return Math.max(item.r, BURST_MIN * k)
    case 'trap':
      return Math.max(item.r, TRAP_MIN * k)
    case 'drone':
      return Math.max(item.r * 0.8, DRONE_MIN * k) * Math.SQRT2
    case 'wall':
      return Math.max(item.r * 2, WALL_BAR_MIN * k) / 2
    default:
      return item.r
  }
}

/** The registry's name for the slot, else the element's label, else the shape's. */
function abilityName(item: PlacedAbility, agent: GameAgent | null): string {
  const fromRegistry = item.slot ? agent?.abilities.find(a => a.slot === item.slot)?.name : undefined
  return fromRegistry || item.label || UTILITY_STYLE[item.shape].label
}

// ── Component ───────────────────────────────────────────────────────────────

const PlayCanvas = forwardRef<PlayCanvasHandle, PlayCanvasProps>(function PlayCanvas(
  {
    map,
    side,
    step,
    previous,
    tool,
    pending,
    selectedId,
    showCallouts,
    showNames = false,
    motion = null,
    abilityVisible,
    skin: skinId,
    animate,
    onSelect,
    onChange,
    onPendingDone,
    onUnresolved,
    control,
  },
  ref,
) {
  const skin = canvasSkin(skinId)
  /** An outline in the backdrop's colour behind map text, so labels read over the map and over each other. */
  const halo = { paintOrder: 'stroke', stroke: skin.back, strokeWidth: 5, strokeLinejoin: 'round' } as const
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const boxClip = `${uid}-box`
  const tileClip = `${uid}-tile`
  const tint = `${uid}-tint`
  const arrowHead = (color: string) => `${uid}-head-${colorKey(color)}`
  const badgeClip = `${uid}-badge`
  const throwHead = (color: string) => `${uid}-throw-${colorKey(color)}`

  const { registry } = useGameContent()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)

  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const backdropRef = useRef<SVGRectElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pressRef = useRef<Press | null>(null)
  /** Set by Escape so the blur that follows does not commit. */
  const skipBlurRef = useRef(false)

  /** The svg's size in px, which the viewBox takes the shape of. */
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState<{ id: string; value: string } | null>(null)

  const [camera, setCamera] = useState<Camera>(HOME)
  /** The camera as last shown: gestures and the wheel read and move it between renders. */
  const cameraRef = useRef<Camera>(HOME)
  const [cameraMap, setCameraMap] = useState(map.uuid)
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** Touch points on the map by pointer id, in client px: two make a pinch. */
  const touchesRef = useRef(new Map<number, Point>())
  /** The pinch in progress: the fingers' first spread, the viewBox point between them, the zoom then. */
  const pinchRef = useRef<{ spread: number; grab: Point; zoom: number } | null>(null)

  // Zoom is view state: a new map starts whole.
  if (cameraMap !== map.uuid) {
    setCameraMap(map.uuid)
    setCamera(HOME)
  }
  useEffect(() => {
    cameraRef.current = HOME
  }, [map.uuid])

  /**
   * The marker scale (§2.2 "Constant-size markers"): symbolic sizes are
   * multiplied by it so they stay the same on screen at any zoom. Follows the
   * committed camera, so a pinch in progress rescales when it ends.
   */
  const k = 1 / camera.zoom
  /** The transform that keeps a group drawn about its own origin at its screen size; none at zoom 1. */
  const sized = k === 1 ? undefined : `scale(${k})`
  const scene = useMemo(() => {
    const built = sceneForStep(step, map, side, k)
    return abilityVisible ? { ...built, abilities: built.abilities.filter(a => abilityVisible(a.id)) } : built
  }, [step, map, side, k, abilityVisible])
  /** A dash pattern drawn in map units, kept at its screen size. */
  const dashes = (pattern: string) => scaleDashes(pattern, k)
  // The grid may be stepped in place, so its version says when to repaint; a
  // new grid object (another round, another step) repaints too.
  const controlVersion = control?.version
  const controlN = control?.n
  const controlUrl = useMemo(
    () => (control && controlN ? paintControl(control, skin) : null),
    // `controlVersion` is the point: the lint cannot see an in-place mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [control, controlVersion, controlN, skin],
  )
  const previousScene = useMemo(
    () => (previous ? sceneForStep(previous, map, side, k) : null),
    [previous, map, side, k],
  )
  const ghosts = useMemo(
    () => (previousScene ? ghostAgents(previous, step, map, side, previousScene) : []),
    [previousScene, previous, step, map, side],
  )

  /**
   * Element id → the viewBox points a drag moves: one for most, both ends of
   * an arrow, a whole stroke; an ability's `at` then its wall path, if any.
   */
  const anchors = useMemo(() => {
    const byId = new Map<string, Point[]>()
    for (const a of scene.agents) byId.set(a.id, [[a.x, a.y]])
    for (const a of scene.abilities) byId.set(a.id, [[a.x, a.y], ...(a.path ?? [])])
    for (const m of scene.markers) byId.set(m.id, [[m.x, m.y]])
    for (const t of scene.texts) byId.set(t.id, [[t.x, t.y]])
    for (const a of scene.arrows) byId.set(a.id, [a.from, a.to])
    for (const p of scene.pens) byId.set(p.id, p.points)
    return byId
  }, [scene])

  /** Ability id → where it is thrown from: what its `from` handle drags. */
  const throwFrom = useMemo(() => {
    const byId = new Map<string, Point>()
    for (const a of scene.abilities) if (a.from) byId.set(a.id, a.from)
    return byId
  }, [scene])

  // Arrowheads per colour: arrows in their own, move paths in the team's, the draft in white.
  const headColors = useMemo(
    () => [...new Set([skin.ally, skin.enemy, skin.ink, ...scene.arrows.map(a => skinDrawColor(skin, a.color))])],
    [scene, skin],
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Space held turns a drag on the map into a pan, under any tool.
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.key === ' ' && !isEditable(e.target)) setSpaceHeld(true)
    }
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false)
    }
    // A key released in another window never comes back as a keyup.
    const release = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
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
      // Zoomed in, the field can reach past the map: focus must not scroll the box around it.
      input.focus({ preventScroll: true })
      input.select()
    }
  }, [editingId, selectedId])

  const agentOf = (name: string): GameAgent | null => registry?.agents.byName.get(name.trim().toLowerCase()) ?? null

  // The map square fits the svg's shorter side at zoom 1. Labels keep their
  // size on screen at any zoom, so they go by the canvas' rendered width alone.
  const fit = Math.min(size.width, size.height)
  const drawnWidth = fit
  const showLabels = drawnWidth >= LABEL_MIN_WIDTH_PX
  // Size is 0 until the first measure: full size then, so callouts do not flash small.
  const labelScale = fit > 0 && drawnWidth < COMPACT_LABEL_WIDTH_PX ? COMPACT_LABEL_SCALE : 1
  // 22 → 19 and 20 → 17 viewBox units on a compact canvas.
  const calloutLabel = Math.round(CALLOUT_LABEL * labelScale)
  const utilityLabel = Math.round(UTILITY_LABEL * labelScale)
  const readOnly = onChange === undefined
  const drawing = !readOnly && (pending !== null || DRAW_TOOLS.has(tool))
  const selecting = !readOnly && tool === 'select' && pending === null
  const dragging = live !== null
  /** A pan in progress holds the map and Space held offers to: either outranks the tool's cursor. */
  const panCursor = panning ? 'grabbing' : spaceHeld ? 'grab' : undefined
  const elementCursor = panCursor ?? (selecting ? (dragging ? 'grabbing' : 'grab') : undefined)

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

  // ── Camera ──────────────────────────────────────────────────────────────

  /** What the camera shows on the svg as it is now sized. */
  const viewOf = (camera: Camera) => viewBoxFor(camera, size.width, size.height)

  /**
   * Shows the map through `next`, clamped to the map. The attributes are set
   * at once, so the next pointer event already converts through them;
   * `commit` false leaves React state for the end of a pan or a pinch,
   * sparing a render per move.
   */
  const applyCamera = (next: Camera, commit = true) => {
    const shown = clampCamera(next, size.width, size.height)
    cameraRef.current = shown
    const view = viewOf(shown)
    svgRef.current?.setAttribute('viewBox', viewBoxAttr(view))
    const backdrop = backdropRef.current
    if (backdrop) {
      backdrop.setAttribute('x', String(view.x))
      backdrop.setAttribute('y', String(view.y))
      backdrop.setAttribute('width', String(view.w))
      backdrop.setAttribute('height', String(view.h))
    }
    if (commit) setCamera(shown)
  }

  /** The camera at another zoom with the viewBox point `p` where `at` is on screen (default `p`). */
  const zoomed = (p: Point, zoom: number, at: Point = p) =>
    zoomAbout(cameraRef.current, p, zoom, size.width, size.height, at)

  const zoomCentre = (factor: number) => {
    const current = cameraRef.current
    applyCamera(zoomed(centreOf(viewOf(current)), current.zoom * factor))
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomCentre(ZOOM_STEP),
    zoomOut: () => zoomCentre(1 / ZOOM_STEP),
    resetZoom: () => applyCamera(HOME),
    visibleCentre: () => {
      const [x, y] = centreOf(viewOf(cameraRef.current))
      const { u, v } = viewToImage(scene.view, x, y, scene.turns)
      return { u, v }
    },
  }))

  /** The wheel zooms about the pointer, and the page under the map does not scroll. */
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const at = toView(e.clientX, e.clientY)
    if (!at) return
    const unit =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? VIEW_SIZE : 1
    const current = cameraRef.current
    const next = zoomed(at, current.zoom * Math.exp(-e.deltaY * unit * WHEEL_RATE))
    if (next.zoom !== current.zoom) applyCamera(next)
  }
  const onWheelRef = useRef(onWheel)
  useEffect(() => {
    onWheelRef.current = onWheel
  })
  // React listens to the wheel passively, where `preventDefault` does nothing: this listener is not passive.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const listener = (e: WheelEvent) => onWheelRef.current(e)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [])

  const anchorsOf = (id: string, part: Part): Point[] => {
    // An ability's `from` handle moves the hand alone; its body moves `at` (and a wall's path).
    const hand = throwFrom.get(id)
    if (hand) return part === 'from' ? [hand] : (anchors.get(id) ?? [])
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
      case 'ability': {
        if (part === 'from') {
          const hand = throwFrom.get(id)
          return hand ? { ...el, from: toPos(shift(hand)) } : null
        }
        // `from` stays put; a wall's path goes along with its badge.
        const wall = points.slice(1)
        return wall.length >= 2
          ? { ...el, at: toPos(shift(points[0])), path: wall.map(p => toPos(shift(p))) }
          : { ...el, at: toPos(shift(points[0])) }
      }
      case 'agent':
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
    if (text !== el.text) onChange?.(withElement(step, { ...el, text }))
  }

  const startEditing = (id: string) => {
    setTextDraft(null)
    setEditingId(id)
  }

  /** A press that ended where it started, for every tool that acts on a click. */
  const click = (press: ClickPress) => {
    if (readOnly) {
      onSelect(press.id)
      return
    }
    if (pending) {
      if (!inSquare(press.at)) return
      const { shape, radius } = abilityShape(pending.agent, pending.slot)
      // Placed more than 3 m from its agent on the map, the ability is thrown from there (§2.10).
      const from = throwOrigin(step, pending.agent, press.at, map, scene)
      const el: AbilityElement = {
        kind: 'ability',
        id: newId(),
        agent: pending.agent,
        slot: pending.slot,
        shape,
        radius,
        at: toPos(press.at),
        ...(from ? { from } : {}),
      }
      onChange?.(withElement(step, el))
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
        onChange?.(withoutElement(step, press.id))
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
        onChange?.(withElement(step, el))
        onSelect(el.id)
        startEditing(el.id)
        return
      }
      case 'spike':
      case 'enemy':
      case 'pin': {
        if (!inSquare(press.at)) return
        const el: MarkerElement = { kind: 'marker', id: newId(), type: tool, at: toPos(press.at) }
        onChange?.(withElement(step, el))
        onSelect(el.id)
        return
      }
      default:
        return
    }
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && touchDown(e)) return
    const middle = e.button === 1
    if ((e.button !== 0 && !middle) || pressRef.current) return
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
    if (middle || spaceHeld) {
      // A middle-button drag, or a drag with Space held, pans under any tool.
      press = { mode: 'pan', pointerId, client, grab: at, dragging: true, click: null }
      setPanning(true)
    } else if (readOnly) {
      // Nothing to move or draw: a press selects, and zoomed in the map pans.
      const select: ClickPress = { mode: 'click', pointerId, at, id }
      press =
        cameraRef.current.zoom > MIN_ZOOM ? { mode: 'pan', pointerId, client, grab: at, dragging: false, click: select } : select
    } else if (pending) {
      press = { mode: 'click', pointerId, at, id }
    } else if (tool === 'select') {
      const empty: ClickPress = { mode: 'click', pointerId, at, id: null }
      press = id
        ? { mode: 'move', pointerId, id, part, client, start: at, dragging: false, wasSelected: id === selectedId }
        : cameraRef.current.zoom > MIN_ZOOM
          ? // Zoomed in, the empty map pans; a press that does not move still clears the selection.
            { mode: 'pan', pointerId, client, grab: at, dragging: false, click: empty }
          : empty
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
    if (touchMove(e)) return
    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId || press.mode === 'click') return
    const at = toView(e.clientX, e.clientY)
    if (!at) return
    switch (press.mode) {
      case 'pan': {
        if (!press.dragging) {
          if (Math.hypot(e.clientX - press.client[0], e.clientY - press.client[1]) <= DRAG_THRESHOLD_PX) return
          press.dragging = true
          setPanning(true)
        }
        // Same zoom: the grabbed point comes back under the pointer.
        applyCamera(zoomed(press.grab, cameraRef.current.zoom, at), false)
        return
      }
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
    if (touchUp(e.pointerId)) return
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
          if (el) onChange?.(withElement(step, el))
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
        onChange?.(
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
        onChange?.(withElement(step, { kind: 'arrow', id: newId(), from: toPos(press.from), to: toPos(to), color: WHITE }))
        return
      }
      case 'pan':
        setPanning(false)
        applyCamera(cameraRef.current)
        if (!press.dragging && press.click) click(press.click)
        return
      case 'click':
        click(press)
        return
    }
  }

  /** Drops the gesture in progress; a pan keeps the view it reached. */
  const cancelPress = () => {
    pressRef.current = null
    setLive(null)
    setDraft(null)
    setPanning(false)
    applyCamera(cameraRef.current)
  }

  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => {
    if (!touchUp(e.pointerId)) cancelPress()
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

  // ── Pinch ───────────────────────────────────────────────────────────────

  /** A finger on the map: a second one turns whatever the first began into a pinch. True when the pinch takes it. */
  const touchDown = (e: PointerEvent<SVGSVGElement>): boolean => {
    const touches = touchesRef.current
    touches.set(e.pointerId, [e.clientX, e.clientY])
    if (pinchRef.current) return true
    if (touches.size < 2) return false
    const [a, b] = [...touches.values()]
    const grab = toView((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    if (!grab) return false
    cancelPress()
    pinchRef.current = { spread: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), grab, zoom: cameraRef.current.zoom }
    e.currentTarget.setPointerCapture(e.pointerId)
    return true
  }

  /** Two fingers zoom by their spread and pan by their midpoint. True when the pinch takes the move. */
  const touchMove = (e: PointerEvent<SVGSVGElement>): boolean => {
    const touches = touchesRef.current
    if (!touches.has(e.pointerId)) return false
    touches.set(e.pointerId, [e.clientX, e.clientY])
    const pinch = pinchRef.current
    if (!pinch) return false
    const [a, b] = [...touches.values()]
    const at = toView((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    if (at) {
      const zoom = (pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.spread
      applyCamera(zoomed(pinch.grab, zoom, at), false)
    }
    return true
  }

  /** A finger lifted: below two the pinch ends and its view is kept. True when it was pinching. */
  const touchUp = (pointerId: number): boolean => {
    const touches = touchesRef.current
    if (!touches.delete(pointerId) || !pinchRef.current) return false
    if (touches.size < 2) {
      pinchRef.current = null
      applyCamera(cameraRef.current)
    }
    return true
  }

  // ── Layers ──────────────────────────────────────────────────────────────

  const smallLabel = (text: string, y: number, key?: string) =>
    showLabels && text ? (
      <text
        key={key}
        y={y}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize={utilityLabel}
        fill={skin.label}
        pointerEvents="none"
        {...halo}
      >
        {truncate(text, NOTE_MAX)}
      </text>
    ) : null

  const ringOf = (agent: Pick<PlacedAgent, 'team' | 'spike'>) => (agent.spike ? skin.spike : agent.team === 'enemy' ? skin.enemy : skin.ally)

  /** An agent's square portrait tile about the origin, at its screen size. */
  const tile = (name: string, ring: string) => {
    const icon = agentOf(name)?.displayIcon ?? null
    return (
      <g transform={sized}>
        <rect x={-HALF} y={-HALF} width={TILE} height={TILE} rx={TILE_RX} fill={skin.tile} />
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
            fill={skin.allyName}
            pointerEvents="none"
          >
            {name.slice(0, 3)}
          </text>
        )}
        <rect x={-HALF} y={-HALF} width={TILE} height={TILE} rx={TILE_RX} fill="none" stroke={ring} strokeWidth={TILE_RING} />
      </g>
    )
  }

  const pens = scene.pens.map(pen => {
    const [dx, dy] = offsetOf(pen.id)
    const points = pointsAttr(pen.points, dx, dy)
    return (
      <g key={pen.id} {...interactive(pen.id, 'Pen stroke')} style={{ cursor: elementCursor }}>
        {/* Hit area: a 5 px line is hard to grab. */}
        <polyline points={points} fill="none" stroke="transparent" strokeWidth={22 * k} strokeLinecap="round" strokeLinejoin="round" />
        <polyline
          points={points}
          fill="none"
          stroke={skinDrawColor(skin, pen.color)}
          strokeWidth={PEN_WIDTH * k}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </g>
    )
  })

  /**
   * The team colour of whoever threw an ability: the step's agent element of
   * that name, ally when the step has none.
   */
  const throwerRing = (name: string) => {
    const key = name.trim().toLowerCase()
    const thrower = key ? scene.agents.find(a => a.agent.trim().toLowerCase() === key) : undefined
    return thrower?.team === 'enemy' ? skin.enemy : skin.ally
  }

  /** The drag offset of an ability's hand: only while its `from` handle is dragged. */
  const handOffsetOf = (id: string): Point => (live && live.id === id && live.part === 'from' ? [live.dx, live.dy] : [0, 0])

  /**
   * An ability as drawn now, the drag in progress included: its landing, its
   * hand, its wall line, its throw arc and where the badge stands (on the arc
   * in flight, at the middle of a wall's path, else at the landing).
   */
  const abilityLayout = (item: PlacedAbility) => {
    const [dx, dy] = offsetOf(item.id)
    const at: Point = [item.x + dx, item.y + dy]
    const [hx, hy] = handOffsetOf(item.id)
    const from: Point | null = item.from ? [item.from[0] + hx, item.from[1] + hy] : null
    const path = item.path ? item.path.map(([x, y]): Point => [x + dx, y + dy]) : null
    const flying = inFlight(item)
    // Landed, the badge covers the landing: the arc stops at its rim so the arrowhead shows.
    const arc = from ? throwArc(from, at, flying ? 0 : ARC_END_GAP * k) : null
    const badge: Point = flying && arc ? arc.pointAt(item.progress ?? 0) : path ? (polylineMidpoint(path) ?? at) : at
    // A throw shorter than the badge has nothing to show between hand and landing.
    const showArc = from !== null && Math.hypot(at[0] - from[0], at[1] - from[1]) > BADGE_R * 2 * k
    return { at, from, path, flying, arc: showArc ? arc : null, badge }
  }

  /** The badge (§2.10) about the origin: a disc in the shape's colour ringed in the thrower's team colour, the glyph, the key tag. */
  const badgeOf = (item: PlacedAbility, color: string, icon: string | null) => {
    const key = item.slot ? SLOT_KEYS[item.slot] : null
    return (
      <g pointerEvents="none" transform={sized}>
        <circle r={BADGE_R} fill={color} stroke={throwerRing(item.agent)} strokeWidth={BADGE_RING} />
        {item.life !== null && (
          // Time left on a replay frame: a ring outside the badge, full when it starts, emptying clockwise from the top.
          <g transform="rotate(-90)">
            <circle r={LIFE_R} fill="none" stroke={skin.back} strokeOpacity={0.7} strokeWidth={LIFE_WIDTH + 2} />
            <circle
              r={LIFE_R}
              fill="none"
              stroke={color}
              strokeWidth={LIFE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={`${(LIFE_LENGTH * item.life).toFixed(2)} ${LIFE_LENGTH.toFixed(2)}`}
            />
          </g>
        )}
        {icon ? (
          <image
            href={icon}
            x={-BADGE_GLYPH / 2}
            y={-BADGE_GLYPH / 2}
            width={BADGE_GLYPH}
            height={BADGE_GLYPH}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${badgeClip})`}
          />
        ) : (
          <text textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="bold" fontSize={BADGE_LETTER} fill={WHITE}>
            {UTILITY_STYLE[item.shape].label.slice(0, 1)}
          </text>
        )}
        {key && (
          <g transform={`translate(${KEY_TAG_AT.toFixed(2)} ${(-KEY_TAG_AT).toFixed(2)})`}>
            <rect x={-KEY_TAG / 2} y={-KEY_TAG / 2} width={KEY_TAG} height={KEY_TAG} rx={KEY_TAG_RX} fill={KEY_TAG_FILL} />
            <text textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="bold" fontSize={KEY_LETTER} fill={WHITE}>
              {key}
            </text>
          </g>
        )}
      </g>
    )
  }

  const renderAbility = (item: PlacedAbility) => {
    const agent = agentOf(item.agent)
    const color = skin.utility[item.shape]
    const icon = item.slot ? (agent?.abilities.find(a => a.slot === item.slot)?.icon ?? null) : null
    const { at, path, flying, arc, badge } = abilityLayout(item)
    const { r } = item
    // Map-wide ultimates (KAY/O's NULL/cmd, Killjoy's Lockdown) keep their true
    // size but only a faint wash, so they do not bury everything under them.
    const huge = r > cmToView(HUGE_AREA_CM, map.transform, scene.view)
    const fillOpacity = huge ? HUGE_FILL : item.shape === 'smoke' ? SMOKE_FILL : ABILITY_FILL
    // The area is real size; its outline is a line and keeps its width on screen.
    const filled = { fill: color, fillOpacity, stroke: color, strokeOpacity: ABILITY_RING, strokeWidth: RING_WIDTH * k }
    const ring = { fill: 'none', stroke: color, strokeOpacity: ABILITY_RING, strokeWidth: OUTLINE_WIDTH * k }

    // No area while in flight; a wall with a path is its line instead.
    let shape: ReactNode = null
    if (!flying && !path) {
      switch (item.shape) {
        case 'smoke':
        case 'molly':
        case 'slow':
        case 'stun':
          shape = <circle r={r} {...filled} />
          break
        case 'flash':
          shape = <polygon points={burst(Math.max(r, BURST_MIN * k))} strokeLinejoin="round" {...filled} />
          break
        case 'wall': {
          // Real length; the bar's thickness is a line width.
          const length = Math.max(r * 2, WALL_BAR_MIN * k)
          const thick = WALL_WIDTH * k
          shape = <rect x={-length / 2} y={-thick / 2} width={length} height={thick} rx={thick / 2} {...filled} />
          break
        }
        case 'trap':
          shape = <polygon points={diamond(Math.max(r, TRAP_MIN * k))} strokeLinejoin="round" {...filled} />
          break
        case 'drone': {
          const h = Math.max(r * 0.8, DRONE_MIN * k)
          shape = <rect x={-h} y={-h} width={h * 2} height={h * 2} rx={4 * k} {...filled} />
          break
        }
        case 'recon':
          shape = <circle r={r} {...ring} />
          break
        case 'ult':
          shape = (
            <>
              <circle r={r} {...filled} strokeWidth={OUTLINE_WIDTH * k} />
              <circle r={r * 0.7} {...ring} />
            </>
          )
          break
        default:
          shape = <circle r={r} {...ring} strokeDasharray={`${k} ${9 * k}`} strokeLinecap="round" />
      }
    }

    const name = abilityName(item, agent)
    const note = item.label && item.label !== name ? `: ${item.label}` : ''
    return (
      <g
        key={item.id}
        {...interactive(item.id, `${name}${item.agent ? ` (${item.agent})` : ''}${note}`)}
        style={{ cursor: elementCursor }}
      >
        {shape && (
          <g style={placement(at[0], at[1])}>
            {/* Hit area: rings and small shapes are hard to grab. */}
            <circle r={Math.max(item.shape === 'wall' ? 0 : abilityExtent(item, k), HIT_R * k)} fill="transparent" />
            {shape}
          </g>
        )}
        {arc && (
          <path
            d={arc.d}
            fill="none"
            stroke={color}
            strokeWidth={ARC_WIDTH * k}
            strokeDasharray={dashes(ARC_DASH)}
            opacity={flying ? ARC_FLIGHT_OPACITY : ARC_OPACITY}
            markerEnd={`url(#${throwHead(color)})`}
            pointerEvents="none"
          />
        )}
        {path && (
          <>
            {/* Hit area: the whole wall grabs, not only its badge. */}
            <polyline
              points={pointsAttr(path)}
              fill="none"
              stroke="transparent"
              strokeWidth={22 * k}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={pointsAttr(path)}
              fill="none"
              stroke={color}
              strokeOpacity={WALL_LINE_OPACITY}
              strokeWidth={WALL_LINE * k}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          </>
        )}
        <g style={placement(badge[0], badge[1])}>
          {!shape && <circle r={HIT_R * k} fill="transparent" />}
          {badgeOf(item, color, icon)}
        </g>
      </g>
    )
  }

  const arrows = scene.arrows.map(arrow => {
    const [fdx, fdy] = offsetOf(arrow.id, 'from')
    const [tdx, tdy] = offsetOf(arrow.id, 'to')
    const line = { x1: arrow.from[0] + fdx, y1: arrow.from[1] + fdy, x2: arrow.to[0] + tdx, y2: arrow.to[1] + tdy }
    return (
      <g key={arrow.id} {...interactive(arrow.id, 'Arrow')} style={{ cursor: elementCursor }}>
        <line {...line} stroke="transparent" strokeWidth={24 * k} strokeLinecap="round" />
        <line
          {...line}
          stroke={skinDrawColor(skin, arrow.color)}
          strokeWidth={ARROW_WIDTH * k}
          strokeLinecap="round"
          markerEnd={`url(#${arrowHead(skinDrawColor(skin, arrow.color))})`}
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
    const color = agent.team === 'enemy' ? skin.enemy : skin.ally
    return [
      <polyline
        key={`path:${agent.id}`}
        points={pointsAttr(points)}
        fill="none"
        stroke={color}
        strokeWidth={PATH_WIDTH * k}
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
          <path d={spikeTriangle(SPIKE_R)} fill={skin.spike} stroke={skin.back} strokeWidth={2} strokeLinejoin="round" />
          {marker.site && (
            <text
              y={SPIKE_R * 0.12}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, sans-serif"
              fontWeight="bold"
              fontSize={18}
              fill={skin.back}
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
          <circle r={ENEMY_R} fill={skin.back} fillOpacity={0.6} stroke={skin.enemy} strokeWidth={4} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontWeight="bold"
            fontSize={22}
            fill={skin.enemy}
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
          <path d={PIN_PATH} fill={skin.spike} stroke={skin.back} strokeWidth={2} strokeLinejoin="round" />
          <circle cy={-PIN_HEAD} r={5} fill={skin.back} pointerEvents="none" />
        </>
      )
    }
    return (
      <g
        key={marker.id}
        {...interactive(marker.id, marker.label ? `${name}: ${marker.label}` : name)}
        style={{ ...placement(marker.x + dx, marker.y + dy), cursor: elementCursor }}
      >
        <g transform={sized}>
          {shape}
          {smallLabel(marker.label, labelY)}
        </g>
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
        <g transform={sized}>
          <rect x={-w / 2} y={-TEXT_BOX_H / 2} width={w} height={TEXT_BOX_H} fill="transparent" />
          {!(editing && editorText?.id === t.id) && (
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={FONT}
              fontSize={TEXT_SIZE}
              fontWeight={600}
              fill={skinDrawColor(skin, t.color)}
              pointerEvents="none"
              {...halo}
            >
              {value}
            </text>
          )}
        </g>
      </g>
    )
  })

  const ghostTiles = ghosts.map(ghost => (
    <g key={`ghost:${ghost.id}`} opacity={GHOST_OPACITY} style={placement(ghost.x, ghost.y)}>
      {tile(ghost.agent, ringOf(ghost))}
    </g>
  ))

  // A replay's view cones and trails, under everything the player placed: about the tile as it is drawn now.
  const motionLayer = motion
    ? scene.agents.flatMap(agent => {
        const m = motion.get(agent.id)
        if (!m) return []
        const [dx, dy] = offsetOf(agent.id)
        const origin = imageToView(scene.view, m.at.u, m.at.v, scene.turns)
        const shift = (p: { u: number; v: number }) => {
          const [x, y] = imageToView(scene.view, p.u, p.v, scene.turns)
          return `${(x - origin[0] + agent.x + dx).toFixed(1)},${(y - origin[1] + agent.y + dy).toFixed(1)}`
        }
        const color = agent.team === 'enemy' ? skin.enemy : skin.ally
        const here = `${(agent.x + dx).toFixed(1)},${(agent.y + dy).toFixed(1)}`
        return [
          m.trail && m.trail.length > 0 ? (
            <polyline key={`trail:${agent.id}`} points={[...m.trail.map(shift), here].join(' ')} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={3 * k} strokeLinejoin="round" strokeLinecap="round" />
          ) : null,
          m.cone ? <polygon key={`cone:${agent.id}`} points={[here, ...m.cone.map(shift)].join(' ')} fill={color} fillOpacity={0.16} /> : null,
        ]
      })
    : null

  const agentTiles = scene.agents.map(agent => {
    const [dx, dy] = offsetOf(agent.id)
    const label = `${agent.agent}${agent.player ? ` (${agent.player})` : ''}${agent.team === 'enemy' ? ' (enemy)' : ''}${
      agent.spike ? ', spike carrier' : ''
    }${agent.note ? `: ${agent.note}` : ''}`
    // The hover / selection card already names the agent; the small name would sit under it.
    const named = showNames && showLabels && agent.id !== hoverId && agent.id !== selectedId
    return (
      <g
        key={agent.id}
        {...interactive(agent.id, label)}
        style={{ ...placement(agent.x + dx, agent.y + dy, true, live?.id === agent.id), cursor: elementCursor }}
      >
        {tile(agent.agent, ringOf(agent))}
        {named && (
          <g transform={sized}>
            <text
              y={HALF + 4 + NAME_SIZE}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize={NAME_SIZE}
              fontWeight={600}
              fill={agent.team === 'enemy' ? skin.enemyName : skin.allyName}
              pointerEvents="none"
              {...halo}
            >
              {truncate(agent.player || agent.agent, NAME_MAX)}
            </text>
          </g>
        )}
      </g>
    )
  })

  // ── Selection ───────────────────────────────────────────────────────────

  /** A selection outline drawn at screen size about an origin already scaled by `k`. */
  const dashed = { fill: 'none', stroke: skin.ink, strokeWidth: 3, strokeDasharray: '8 6' } as const
  /** The same outline drawn in map units (around real-size things): its line and dashes keep their size on screen. */
  const dashedMap = { fill: 'none', stroke: skin.ink, strokeWidth: 3 * k, strokeDasharray: dashes('8 6') } as const

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
            stroke={skin.ink}
            strokeWidth={3}
            transform={sized}
          />
        </g>
      )
    }
    const ability = scene.abilities.find(a => a.id === selectedId)
    if (ability) {
      const { at, from, path, flying, badge } = abilityLayout(ability)
      // Round the area at the landing; round the badge alone in flight or on a wall's path.
      const [cx, cy] = flying || path ? badge : at
      return (
        <g key={`sel:${ability.id}`}>
          <g pointerEvents="none" style={placement(cx, cy)}>
            <circle r={abilityExtent(ability, k) + 8 * k} {...dashedMap} />
          </g>
          {from && (
            // The hand: the select tool drags it to move `from`.
            <circle
              data-id={ability.id}
              data-part="from"
              cx={from[0]}
              cy={from[1]}
              r={FROM_HANDLE_R * k}
              fill={skin.back}
              stroke={skin.ink}
              strokeWidth={3 * k}
              pointerEvents={selecting ? undefined : 'none'}
              style={{ cursor: elementCursor }}
            />
          )}
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
          <circle cy={cy} r={r} {...dashed} transform={sized} />
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
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} {...dashed} transform={sized} />
        </g>
      )
    }
    const pen = scene.pens.find(p => p.id === selectedId)
    if (pen) {
      const [dx, dy] = offsetOf(pen.id)
      const xs = pen.points.map(p => p[0] + dx)
      const ys = pen.points.map(p => p[1] + dy)
      const pad = 10 * k
      const x0 = Math.min(...xs) - pad
      const y0 = Math.min(...ys) - pad
      return (
        <rect
          key={`sel:${pen.id}`}
          x={x0}
          y={y0}
          width={Math.max(...xs) + pad - x0}
          height={Math.max(...ys) + pad - y0}
          rx={8 * k}
          pointerEvents="none"
          {...dashedMap}
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
                r={HANDLE_R * k}
                fill={skin.back}
                stroke={skin.ink}
                strokeWidth={3 * k}
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
    // Screen-size units about the agent (the group is scaled by `k`); the map edges in those units.
    const w = Math.max(agent.agent.length * 20 * 0.62, note.length * 18 * 0.54) + 28
    const h = note ? 64 : 38
    const gap = HALF + 12
    const edge = (n: number) => n / k
    const x = clamp(-w / 2, edge(8 - ax), edge(VIEW_SIZE - 8 - ax) - w)
    const y = gap + h > edge(VIEW_SIZE - 8 - ay) ? -gap - h : gap
    return (
      <g key={`label:${agent.id}`} style={placement(ax, ay, true, live?.id === agent.id)}>
        <g transform={sized}>
          <rect x={x} y={y} width={w} height={h} rx={10} fill={skin.card} stroke={skin.cardBorder} strokeWidth={1} />
          <text x={x + 14} y={y + 26} fontFamily={FONT} fontSize={20} fontWeight={600} fill={skin.cardText} {...halo}>
            {agent.agent}
          </text>
          {note && (
            <text x={x + 14} y={y + 52} fontFamily={FONT} fontSize={18} fill={skin.cardMuted} {...halo}>
              {note}
            </text>
          )}
        </g>
      </g>
    )
  }

  const labels: ReactNode[] = []
  if (showLabels) {
    const shown = new Set([hoverId, selectedId].filter((id): id is string => id !== null))
    for (const agent of scene.agents) if (shown.has(agent.id)) labels.push(agentLabel(agent))
    for (const ability of scene.abilities) {
      if (!shown.has(ability.id)) continue
      // Under the badge, wherever it stands.
      const [bx, by] = abilityLayout(ability).badge
      labels.push(
        <g key={`label:${ability.id}`} style={placement(bx, by)}>
          <g transform={sized}>
            {smallLabel(abilityName(ability, agentOf(ability.agent)), BADGE_R + BADGE_RING + 4 + utilityLabel)}
          </g>
        </g>,
      )
    }
  }

  // ── Draft ───────────────────────────────────────────────────────────────

  let draftLayer: ReactNode = null
  if (draft?.kind === 'pen') {
    draftLayer =
      draft.points.length === 1 ? (
        <circle cx={draft.points[0][0]} cy={draft.points[0][1]} r={(PEN_WIDTH / 2) * k} fill={skin.ink} />
      ) : (
        <polyline
          points={pointsAttr(draft.points)}
          fill="none"
          stroke={skin.ink}
          strokeWidth={PEN_WIDTH * k}
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
        stroke={skin.ink}
        strokeWidth={ARROW_WIDTH * k}
        strokeLinecap="round"
        markerEnd={`url(#${arrowHead(skin.ink)})`}
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
      // At screen size about the text, like the text it edits.
      <g transform={`translate(${editorText.x + dx} ${editorText.y + dy})${sized ? ` ${sized}` : ''}`}>
        <foreignObject
          x={-w / 2}
          y={-h / 2}
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
              border: `2px solid ${skin.ally}`,
              background: skin.card,
              color: skinDrawColor(skin, editorText.color),
              font: `600 ${TEXT_SIZE}px ${FONT}`,
              textAlign: 'center',
              outline: 'none',
            }}
          />
        </foreignObject>
      </g>
    )
  }

  // ── Frame ───────────────────────────────────────────────────────────────

  const view = scene.view
  const imageSize = VIEW_SIZE / view.size
  const throwColors = [...new Set(scene.abilities.filter(a => a.from).map(a => skin.utility[a.shape]))]
  const counts = `${scene.agents.length} agent${scene.agents.length === 1 ? '' : 's'}, ${scene.abilities.length} abilit${
    scene.abilities.length === 1 ? 'y' : 'ies'
  }`

  const visible = viewOf(camera)
  const zoomButton =
    'w-7 h-7 flex items-center justify-center text-text-secondary hover:text-val-cyan disabled:opacity-30 disabled:pointer-events-none transition-colors'

  return (
    <div ref={rootRef} className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={viewBoxAttr(visible)}
        // The viewBox has the svg's shape, so `meet` leaves no bands inside it.
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full select-none"
        role="group"
        aria-label={`${map.name}, ${step.name || 'step'}: ${counts}`}
        style={{
          touchAction: 'none',
          userSelect: 'none',
          // Zoomed in, the select tool's empty map pans, and says so.
          cursor:
            panCursor ??
            (drawing ? 'crosshair' : dragging ? 'grabbing' : (selecting || readOnly) && camera.zoom > MIN_ZOOM ? 'grab' : 'default'),
        }}
        // A middle press would otherwise start the browser's autoscroll.
        onMouseDown={e => {
          if (e.button === 1) e.preventDefault()
        }}
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
          {/* The glyph inside a badge drawn about its own origin, held inside the ring. */}
          <clipPath id={badgeClip}>
            <circle r={BADGE_R - BADGE_RING / 2} />
          </clipPath>
          <filter id={tint} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={LUMINANCE_MATRIX} />
            <feComponentTransfer>
              <feFuncR type="gamma" exponent={FLOOR_GAMMA} />
              <feFuncG type="gamma" exponent={FLOOR_GAMMA} />
              <feFuncB type="gamma" exponent={FLOOR_GAMMA} />
            </feComponentTransfer>
            <feColorMatrix type="matrix" values={skinMapMatrix(skin)} />
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
          {/* Throw arcs' heads, one per shape colour (§2.10): the arc's opacity carries over to them. */}
          {throwColors.map(color => (
            <marker
              key={color}
              id={throwHead(color)}
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={5}
              markerHeight={5}
              markerUnits="strokeWidth"
              orient="auto"
            >
              <path d="M0,0L10,5L0,10Z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* The whole view, beyond the map square too; kept in step with the viewBox during a pan. */}
        <rect ref={backdropRef} x={visible.x} y={visible.y} width={visible.w} height={visible.h} fill={skin.back} />

        <g clipPath={`url(#${boxClip})`}>
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
                opacity={skin.mapOpacity}
              />
            </g>
          )}

          {showCallouts && (
            <g
              pointerEvents="none"
              fontFamily={FONT}
              fontSize={calloutLabel * k}
              fill={skin.callout}
              textAnchor="middle"
              {...halo}
              strokeWidth={halo.strokeWidth * k}
            >
              {scene.callouts.map((c, i) => (
                <text key={`${c.name}:${i}`} x={c.x} y={c.y} dominantBaseline="central">
                  {c.name}
                </text>
              ))}
            </g>
          )}

          {controlUrl && (
            // Same placement and turn as the map art, so cells line up with it.
            <g transform={`rotate(${scene.turns * 90} ${VIEW_SIZE / 2} ${VIEW_SIZE / 2})`} pointerEvents="none">
              <image
                href={controlUrl}
                x={(-view.u / view.size) * VIEW_SIZE}
                y={(-view.v / view.size) * VIEW_SIZE}
                width={imageSize}
                height={imageSize}
                preserveAspectRatio="none"
                style={{ imageRendering: 'auto' }}
              />
            </g>
          )}

          <g>{pens}</g>
          <g>{scene.abilities.map(renderAbility)}</g>
          <g>{arrows}</g>
          {motionLayer && <g pointerEvents="none">{motionLayer}</g>}
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

      {/* Outside the svg: its presses never reach the map. */}
      <div
        role="group"
        aria-label="Zoom"
        className="pointer-events-auto absolute top-2 right-2 flex items-center rounded-md border border-bg-elevated bg-bg-primary/85"
      >
        <button
          type="button"
          onClick={() => zoomCentre(1 / ZOOM_STEP)}
          disabled={camera.zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          title="Zoom out (-)"
          className={`${zoomButton} text-base leading-none`}
        >
          −
        </button>
        <span className="font-stats text-[11px] text-text-secondary tabular-nums px-0.5">{Math.round(camera.zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomCentre(ZOOM_STEP)}
          disabled={camera.zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className={`${zoomButton} text-base leading-none`}
        >
          +
        </button>
        {camera.zoom > MIN_ZOOM && (
          <button type="button" onClick={() => applyCamera(HOME)} aria-label="Reset zoom" title="Reset zoom (0)" className={zoomButton}>
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
})

export default PlayCanvas
