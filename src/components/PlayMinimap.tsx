/**
 * The Plays minimap: one phase of a set play drawn on the map (docs/plays-designer.md §6).
 *
 * SVG in a 1000 x 1000 viewBox showing the square of the minimap image that
 * holds every callout. Bottom to top: backdrop and map image, callout labels,
 * utility, movement paths, spike markers, enemy (and note) markers, agents,
 * then the label of the hovered or selected agent. Agents are keyed by name
 * and placed with a CSS `translate`, so stepping phases animates them walking.
 *
 * With `onMove` the markers can be dragged; a press that moves less than 4 px
 * is a click and selects. The geometry lives in `lib/playScene.ts`.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useGameContent } from '../hooks/useGameContent'
import { agentIconUrl, resolveAgentId, type GameMap } from '../lib/gameContent'
import type { PlayDoc } from '../lib/playDoc'
import {
  UTILITY_STYLE,
  VIEW_SIZE,
  placeCallouts,
  sceneForPhase,
  viewToImage,
  type PhaseScene,
  type PlacedActor,
  type PlacedMarker,
  type PlacedUtility,
} from '../lib/playScene'

export { UTILITY_STYLE }

export interface PlaySelection {
  kind: 'actor' | 'utility' | 'marker'
  index: number
}

export interface PlayMinimapProps {
  /** With transform and callouts. */
  map: GameMap
  doc: PlayDoc
  phaseIndex: number
  selected: PlaySelection | null
  onSelect(sel: PlaySelection | null): void
  /** Called at the end of a drag with the new image-unit position. Absent = read-only. */
  onMove?(sel: PlaySelection, pos: { u: number; v: number }): void
  showCallouts: boolean
  /** Callout names that could not be placed in this phase; called when the list changes. */
  onUnresolved?(names: string[]): void
}

const BACKDROP = '#0A0E17'
const TEAM = '#53CADC'
const ENEMY = '#FF4655'
const SPIKE = '#FFCA3A'
const WHITE = '#FFFFFF'
const FONT = 'Inter, sans-serif'
/** Dark outline behind map text, so labels read over the grey map and over each other. */
const HALO = { paintOrder: 'stroke', stroke: BACKDROP, strokeWidth: 5, strokeLinejoin: 'round' } as const

const ACTOR_R = 22
const ACTOR_RING = 5
const SELECT_R = 29
const SPIKE_R = 19
const ENEMY_R = 18
const NOTE_R = 14
const DRONE_HALF = 11
const WALL_LINE = 24
const UTILITY_LABEL = 20
const CALLOUT_LABEL = 22
const DRAG_THRESHOLD_PX = 4
const LABEL_MIN_WIDTH_PX = 360
const NOTE_MAX = 42
const EASE = 'transform 450ms cubic-bezier(.2,.8,.2,1)'

const HEX_RGBA = /^[0-9a-f]{8}$/i
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const readReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Six rays from 0.55 r to r: the flash/stun mark. */
function starburst(r: number): string {
  let d = ''
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    d += `M${(cos * r * 0.55).toFixed(1)},${(sin * r * 0.55).toFixed(1)}L${(cos * r).toFixed(1)},${(sin * r).toFixed(1)}`
  }
  return d
}

const spikeTriangle = (r: number) =>
  `M0,${-r}L${r * 0.85},${r * 0.6}L${-r * 0.85},${r * 0.6}Z`

const keyOf = (sel: PlaySelection, agent?: string) =>
  sel.kind === 'actor' ? `a:${agent}` : `${sel.kind === 'utility' ? 'u' : 'm'}:${sel.index}`

interface Press {
  key: string
  sel: PlaySelection
  pointerId: number
  startX: number
  startY: number
  /** Client px → viewBox units. */
  scale: number
  /** Where the marker is drawn when pressed (it may still carry a previous drag). */
  baseX: number
  baseY: number
  /** Where the scene puts it: drag offsets are measured from here. */
  originX: number
  originY: number
  dragging: boolean
}

/** A marker displaced by a drag. Only applies while the scene it was made on is drawn. */
interface DragOffset {
  key: string
  dx: number
  dy: number
  scene: PhaseScene
}

export default function PlayMinimap({
  map,
  doc,
  phaseIndex,
  selected,
  onSelect,
  onMove,
  showCallouts,
  onUnresolved,
}: PlayMinimapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const boxClip = `${uid}-box`
  const agentClip = `${uid}-agent`
  const arrowTeam = `${uid}-arrow-team`
  const arrowEnemy = `${uid}-arrow-enemy`

  const { registry } = useGameContent()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)

  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pressRef = useRef<Press | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragOffset | null>(null)

  const scene = useMemo(() => sceneForPhase(doc, phaseIndex, map), [doc, phaseIndex, map])
  const callouts = useMemo(() => placeCallouts(map, scene.view), [map, scene.view])

  // Agent name → icon and colour, once the registry is in. Until then every
  // agent shows its lettered disc.
  const agents = useMemo(() => {
    const info = new Map<string, { icon: string | null; color: string | null }>()
    if (!registry) return info
    const names = new Set(doc.comp)
    for (const phase of doc.phases) for (const item of phase.utility) names.add(item.agent)
    for (const name of names) {
      const id = resolveAgentId(name)
      const hex = id ? registry.agents.byId.get(id)?.gradient?.find(h => HEX_RGBA.test(h)) : undefined
      info.set(name, { icon: id ? agentIconUrl(id) : null, color: hex ? `#${hex.slice(0, 6)}` : null })
    }
    return info
  }, [registry, doc])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0))
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

  const showSmallLabels = width >= LABEL_MIN_WIDTH_PX
  const editable = Boolean(onMove)
  const view = scene.view

  const offsetFor = (key: string): DragOffset | null =>
    drag && drag.scene === scene && drag.key === key ? drag : null

  const isSelected = (kind: PlaySelection['kind'], index: number) =>
    selected?.kind === kind && selected.index === index

  // ── Pointer and keyboard ────────────────────────────────────────────────

  const handlersFor = (sel: PlaySelection, key: string, originX: number, originY: number) => ({
    onPointerEnter: () => setHover(key),
    onPointerLeave: () => setHover(h => (h === key ? null : h)),
    onPointerDown: (e: PointerEvent<SVGGElement>) => {
      if (e.button !== 0) return
      const rect = svgRef.current?.getBoundingClientRect()
      pressRef.current = {
        key,
        sel,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        scale: rect && rect.width > 0 ? VIEW_SIZE / rect.width : 1,
        baseX: originX + (offsetFor(key)?.dx ?? 0),
        baseY: originY + (offsetFor(key)?.dy ?? 0),
        originX,
        originY,
        dragging: false,
      }
      if (editable) {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    },
    onPointerMove: (e: PointerEvent<SVGGElement>) => {
      const press = pressRef.current
      if (!editable || !press || press.pointerId !== e.pointerId) return
      const cx = e.clientX - press.startX
      const cy = e.clientY - press.startY
      if (!press.dragging && Math.hypot(cx, cy) <= DRAG_THRESHOLD_PX) return
      press.dragging = true
      // Kept inside the box, so a marker cannot be dropped out of sight.
      const dx = clamp(press.baseX + cx * press.scale, 0, VIEW_SIZE) - press.originX
      const dy = clamp(press.baseY + cy * press.scale, 0, VIEW_SIZE) - press.originY
      setDrag({ key: press.key, dx, dy, scene })
    },
    onPointerUp: (e: PointerEvent<SVGGElement>) => {
      const press = pressRef.current
      if (!press || press.pointerId !== e.pointerId) return
      pressRef.current = null
      if (!press.dragging || !onMove) {
        onSelect(press.sel)
        return
      }
      const x = clamp(press.baseX + (e.clientX - press.startX) * press.scale, 0, VIEW_SIZE)
      const y = clamp(press.baseY + (e.clientY - press.startY) * press.scale, 0, VIEW_SIZE)
      // Stays displaced until the page hands back a doc with the new position.
      setDrag({ key: press.key, dx: x - press.originX, dy: y - press.originY, scene })
      onMove(press.sel, viewToImage(view, x, y))
    },
    onPointerCancel: () => {
      pressRef.current = null
      setDrag(null)
    },
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(sel)
      }
    },
  })

  const cursor = editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'

  const placement = (x: number, y: number, offset: DragOffset | null, animate: boolean) => ({
    transform: `translate(${x + (offset?.dx ?? 0)}px, ${y + (offset?.dy ?? 0)}px)`,
    transformOrigin: '0 0',
    transition: animate && !offset && !reducedMotion ? EASE : 'none',
  })

  // ── Layers ──────────────────────────────────────────────────────────────

  const smallLabel = (text: string, y: number) =>
    showSmallLabels && text ? (
      <text
        y={y}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize={UTILITY_LABEL}
        fill="#CBD5E1"
        opacity={0.85}
        pointerEvents="none"
        {...HALO}
      >
        {truncate(text, NOTE_MAX)}
      </text>
    ) : null

  const renderUtility = (item: PlacedUtility) => {
    const sel: PlaySelection = { kind: 'utility', index: item.index }
    const key = keyOf(sel)
    const offset = offsetFor(key)
    const { r, kind } = item
    const swatch = UTILITY_STYLE[kind].swatch
    // `from` stays put while `at` is dragged.
    const fx = item.from ? item.from[0] - item.x - (offset?.dx ?? 0) : 0
    const fy = item.from ? item.from[1] - item.y - (offset?.dy ?? 0) : 0
    const wallLine = kind === 'wall' && item.from !== null
    const ringR = wallLine ? WALL_LINE / 2 + 4 : kind === 'drone' ? DRONE_HALF + 4 : r

    let shape
    switch (kind) {
      case 'smoke':
      case 'molly':
        shape = <circle r={r} fill={swatch} />
        break
      case 'wall':
        shape = wallLine
          ? <line x1={fx} y1={fy} x2={0} y2={0} stroke={swatch} strokeWidth={WALL_LINE} strokeLinecap="round" />
          : <circle r={r} fill={swatch} />
        break
      case 'flash':
      case 'stun':
        shape = <path d={starburst(r)} stroke={SPIKE} strokeWidth={4} strokeLinecap="round" fill="none" />
        break
      case 'recon':
        shape = <circle r={r} stroke={swatch} strokeWidth={4} fill="none" />
        break
      case 'trap':
        shape = <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} fill={swatch} />
        break
      case 'drone':
        shape = <rect x={-DRONE_HALF} y={-DRONE_HALF} width={DRONE_HALF * 2} height={DRONE_HALF * 2} fill={swatch} />
        break
      case 'ult':
        shape = (
          <circle r={r} stroke={agents.get(item.agent)?.color ?? swatch} strokeWidth={4} strokeDasharray="12 8" fill="none" />
        )
        break
      default:
        shape = <circle r={r} stroke={swatch} strokeWidth={4} strokeDasharray="1 9" strokeLinecap="round" fill="none" />
    }

    return (
      <g
        key={key}
        role="button"
        tabIndex={0}
        aria-label={`${UTILITY_STYLE[kind].label}${item.label ? `: ${item.label}` : ''}${item.agent ? ` (${item.agent})` : ''}`}
        className={cursor}
        style={placement(item.x, item.y, offset, false)}
        {...handlersFor(sel, key, item.x, item.y)}
      >
        {item.from && !wallLine && (
          <line
            x1={fx}
            y1={fy}
            x2={0}
            y2={0}
            stroke={kind === 'recon' ? swatch : '#CBD5E1'}
            strokeOpacity={kind === 'recon' ? 1 : 0.6}
            strokeWidth={3}
            strokeDasharray="10 8"
            pointerEvents="none"
          />
        )}
        {/* Hit area: rays and rings alone are hard to grab. */}
        <circle r={Math.max(ringR, ACTOR_R)} fill="transparent" />
        {shape}
        {isSelected('utility', item.index) && (
          <circle r={ringR + 8} fill="none" stroke={WHITE} strokeWidth={3} strokeDasharray="8 6" pointerEvents="none" />
        )}
        {smallLabel(item.label || UTILITY_STYLE[kind].label, ringR + 8 + UTILITY_LABEL)}
      </g>
    )
  }

  const renderMarker = (marker: PlacedMarker) => {
    const sel: PlaySelection = { kind: 'marker', index: marker.index }
    const key = keyOf(sel)
    const offset = offsetFor(key)
    const r = marker.kind === 'spike' ? SPIKE_R : marker.kind === 'enemy' ? ENEMY_R : NOTE_R
    let shape
    if (marker.kind === 'spike') {
      shape = (
        <>
          <path d={spikeTriangle(r)} fill={SPIKE} />
          {marker.site && (
            <text
              y={r * 0.12}
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
    } else if (marker.kind === 'enemy') {
      shape = (
        <>
          <circle r={r} fill={BACKDROP} fillOpacity={0.6} stroke={ENEMY} strokeWidth={ACTOR_RING} />
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
      shape = <circle r={r} fill={BACKDROP} fillOpacity={0.6} stroke="#94A3B8" strokeWidth={4} />
    }
    const name = marker.kind === 'spike' ? 'Spike' : marker.kind === 'enemy' ? 'Enemy' : 'Note'
    return (
      <g
        key={key}
        role="button"
        tabIndex={0}
        aria-label={marker.label ? `${name}: ${marker.label}` : name}
        className={cursor}
        style={placement(marker.x, marker.y, offset, false)}
        {...handlersFor(sel, key, marker.x, marker.y)}
      >
        <circle r={Math.max(r, ACTOR_R)} fill="transparent" />
        {shape}
        {isSelected('marker', marker.index) && (
          <circle r={r + 8} fill="none" stroke={WHITE} strokeWidth={3} strokeDasharray="8 6" pointerEvents="none" />
        )}
        {smallLabel(marker.label, r + 8 + UTILITY_LABEL)}
      </g>
    )
  }

  const renderActor = (actor: PlacedActor) => {
    const sel: PlaySelection = { kind: 'actor', index: actor.index }
    const key = keyOf(sel, actor.agent)
    const offset = offsetFor(key)
    const icon = agents.get(actor.agent)?.icon ?? null
    return (
      <g
        key={key}
        role="button"
        tabIndex={0}
        aria-label={`${actor.agent}${actor.spike ? ', spike carrier' : ''}${actor.note ? `: ${actor.note}` : ''}`}
        aria-pressed={isSelected('actor', actor.index)}
        className={cursor}
        style={placement(actor.x, actor.y, offset, true)}
        {...handlersFor(sel, key, actor.x, actor.y)}
      >
        {icon ? (
          <>
            <circle r={ACTOR_R} fill={BACKDROP} />
            <image
              href={icon}
              x={-ACTOR_R}
              y={-ACTOR_R}
              width={ACTOR_R * 2}
              height={ACTOR_R * 2}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${agentClip})`}
            />
          </>
        ) : (
          <>
            <circle r={ACTOR_R} fill="#1A1F2E" />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={FONT}
              fontWeight="bold"
              fontSize={18}
              fill="#F1F5F9"
              pointerEvents="none"
            >
              {actor.agent.slice(0, 3)}
            </text>
          </>
        )}
        <circle r={ACTOR_R} fill="none" stroke={TEAM} strokeWidth={ACTOR_RING} />
        {actor.spike && <circle cx={ACTOR_R * 0.8} cy={-ACTOR_R * 0.8} r={8} fill={SPIKE} />}
        {isSelected('actor', actor.index) && <circle r={SELECT_R} fill="none" stroke={WHITE} strokeWidth={3} />}
      </g>
    )
  }

  const renderActorLabel = (actor: PlacedActor) => {
    const key = keyOf({ kind: 'actor', index: actor.index }, actor.agent)
    const offset = offsetFor(key)
    const ax = actor.x + (offset?.dx ?? 0)
    const ay = actor.y + (offset?.dy ?? 0)
    const note = truncate(actor.note, NOTE_MAX)
    // No text measuring in SVG without a layout pass: average glyph widths of Inter.
    const w = Math.max(actor.agent.length * 20 * 0.62, note.length * 18 * 0.54) + 28
    const h = note ? 64 : 38
    const gap = ACTOR_R + 12
    const left = clamp(ax - w / 2, 8, VIEW_SIZE - 8 - w)
    const top = ay + gap + h > VIEW_SIZE - 8 ? ay - gap - h : ay + gap
    return (
      <g key={`label:${key}`} pointerEvents="none" style={placement(actor.x, actor.y, offset, true)}>
        <rect x={left - ax} y={top - ay} width={w} height={h} rx={10} fill="#111827" stroke="#242938" strokeWidth={1} />
        <text x={left - ax + 14} y={top - ay + 26} fontFamily={FONT} fontSize={20} fontWeight={600} fill="#F1F5F9" {...HALO}>
          {actor.agent}
        </text>
        {note && (
          <text x={left - ax + 14} y={top - ay + 52} fontFamily={FONT} fontSize={18} fill="#94A3B8" {...HALO}>
            {note}
          </text>
        )}
      </g>
    )
  }

  // Paths start under the agent; a dragged agent takes its path's start along.
  const paths = scene.actors.flatMap(actor => {
    if (!actor.path) return []
    const offset = offsetFor(keyOf({ kind: 'actor', index: actor.index }, actor.agent))
    const points = actor.path
      .map(([x, y], i) => (i === 0 && offset ? [x + offset.dx, y + offset.dy] : [x, y]))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ')
    return [
      <polyline
        key={`path:${actor.agent}`}
        points={points}
        fill="none"
        stroke={TEAM}
        strokeWidth={7}
        strokeLinejoin="round"
        strokeLinecap="round"
        markerEnd={`url(#${arrowTeam})`}
        pointerEvents="none"
      />,
    ]
  })

  const labelled = scene.actors.filter(
    actor => isSelected('actor', actor.index) || hover === keyOf({ kind: 'actor', index: actor.index }, actor.agent),
  )

  const phase = scene.phase
  const ariaLabel = phase
    ? `${map.name}, ${phase.name} phase: ${phase.actors.length} agent${phase.actors.length === 1 ? '' : 's'}, ${phase.utility.length} utility`
    : `${map.name}: no phases`

  const imageSize = VIEW_SIZE / view.size

  return (
    <div ref={rootRef} className="relative w-full aspect-square select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
        className="w-full h-full block rounded-xl"
        role="group"
        aria-label={ariaLabel}
        style={{ touchAction: editable ? 'none' : undefined, userSelect: 'none' }}
      >
        <defs>
          <clipPath id={boxClip}>
            <rect width={VIEW_SIZE} height={VIEW_SIZE} />
          </clipPath>
          {/* User space of the referencing image: every agent is drawn about its own origin. */}
          <clipPath id={agentClip}>
            <circle r={ACTOR_R - 2} />
          </clipPath>
          {[
            [arrowTeam, TEAM],
            [arrowEnemy, ENEMY],
          ].map(([id, color]) => (
            <marker
              key={id}
              id={id}
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
            <image
              href={map.displayIcon}
              x={(-view.u / view.size) * VIEW_SIZE}
              y={(-view.v / view.size) * VIEW_SIZE}
              width={imageSize}
              height={imageSize}
              preserveAspectRatio="none"
              opacity={0.9}
              pointerEvents="none"
            />
          )}

          {showCallouts && (
            <g pointerEvents="none" fontFamily={FONT} fontSize={CALLOUT_LABEL} fill="#8A99B0" textAnchor="middle" {...HALO}>
              {callouts.map((c, i) => (
                <text key={`${c.name}:${i}`} x={c.x} y={c.y} dominantBaseline="central">
                  {c.name}
                </text>
              ))}
            </g>
          )}

          <g>{scene.utility.map(renderUtility)}</g>
          <g>{paths}</g>
          <g>{scene.markers.filter(m => m.kind === 'spike').map(renderMarker)}</g>
          <g>{scene.markers.filter(m => m.kind !== 'spike').map(renderMarker)}</g>
          <g>{scene.actors.map(renderActor)}</g>
          <g>{labelled.map(renderActorLabel)}</g>
        </g>
      </svg>
    </div>
  )
}
