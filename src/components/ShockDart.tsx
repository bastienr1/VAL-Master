/**
 * Sova's Shock Bolt on the plays board (docs/plays-editor-v2.md §2.22): the
 * arming and the blast, at the game's size and on the game's clock, in the
 * thrower's team colour. Drawn about the origin, inside the ability's own
 * `<g>`; the board's plain burst shows until the sprites are in.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { SHOCK, shockFlightShown, shockIdle, shockState, shockWay, shockWayAt, type ShockWayPoint } from '../lib/shockDart'
import { SHOCK_EXTENT, SHOCK_FLIGHT_EXTENT_CM, paintShock, paintShockFlight, shockHot, shockStatus, subscribeShock } from '../lib/shockDartPaint'

interface ShockDartProps {
  /** The blast radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since it landed, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** Thrown by the other team: the game draws it red. */
  enemy: boolean
  /** The same for the same dart on every frame, so its lightning does not flicker when paused. */
  seed: number
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No crackling when the user asked for less motion. */
  still: boolean
  /** What the board draws for a burst otherwise. */
  fallback: ReactNode
}

/** The picture's backing size, device pixels: a step up from what is on screen, within these. */
const MIN_SIZE = 64
const MAX_SIZE = 512
const SIZE_STEP = 32
/** A still, placed dart shows its spark this far in, seconds. */
const STILL_AT = 0.45

/** The canvas's backing size for how big it is on screen now. */
function fit(canvas: HTMLCanvasElement, max = MAX_SIZE) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const shown = canvas.getBoundingClientRect().width * dpr
  const size = Math.min(max, Math.max(MIN_SIZE, Math.ceil(shown / SIZE_STEP) * SIZE_STEP))
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
}

export function ShockDart({ r, age, enemy, seed, k, still, fallback }: ShockDartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeShock, shockStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fit(canvas)
      paintShock(canvas, shockState(age), seed, enemy)
      return
    }
    if (still) {
      fit(canvas)
      paintShock(canvas, shockIdle(STILL_AT), seed, enemy)
      return
    }
    // Placed in a strat: no clock of its own, so it stays armed and crackles.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fit(canvas)
      paintShock(canvas, shockIdle((now - began) / 1000), seed, enemy)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, seed, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const half = r * SHOCK_EXTENT
  const armed = age === null || shockState(age).phase === 'armed'

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {armed && (
        // Full damage inside this ring; the ball round it is where the damage ends.
        <circle r={(r * SHOCK.innerCm) / SHOCK.outerCm} fill="none" stroke={shockHot(enemy)} strokeOpacity={0.7} strokeWidth={1.2 * k} strokeDasharray={`${3 * k} ${4 * k}`} />
      )}
    </g>
  )
}

interface ShockFlightProps {
  /** The bolt's whole track and where it lands, viewBox units, each point with how long ago it was passed (ms). */
  course: readonly ShockWayPoint[]
  /** The blast radius, viewBox units: what 4 m is on the board. */
  r: number
  enemy: boolean
  seed: number
  /** ViewBox units per screen pixel. */
  k: number
  /** No crackling when the user asked for less motion. */
  still: boolean
  /** Over a dark map the lightning adds its light; over a light one it is drawn as it is. */
  screen: boolean
  /** What the board draws for a thrown thing otherwise. */
  fallback: ReactNode
}

/** The flight's picture covers far more of the board than a blast. */
const FLIGHT_MAX_SIZE = 768
/** The bolt is 66 cm long in the game; on the board it is at least this long, screen pixels, and never more than this many times its size. */
const BOLT_CM = 66
const BOLT_MIN_PX = 16
const BIG_MAX = 4

/**
 * Sova's Shock Bolt in flight (§2.26): the ribbon of lightning behind it, the
 * loops round it and the flash where it bounces, in place of the dashed way
 * and the dot. Drawn in the board's own coordinates, about the bolt. Once it
 * has landed the ribbon and the last flash die away, then there is nothing.
 */
export function ShockFlight({ course, r, enemy, seed, k, still, screen, fallback }: ShockFlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeShock, shockStatus, () => 'loading' as const)
  const ready = status === 'ready'
  const way = useMemo(() => shockWay(course), [course])
  const head = shockWayAt(way, 0)
  const perCm = r / SHOCK.outerCm
  const big = Math.min(BIG_MAX, Math.max(1, (BOLT_MIN_PX * k) / (BOLT_CM * perCm)))
  const shown = head !== null && shockFlightShown(way)

  // A replay frame is a new picture every time: paint after every render.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready || !head) return
    fit(canvas, FLIGHT_MAX_SIZE)
    const about = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: (p.x - head.x) / perCm, y: (p.y - head.y) / perCm })
    paintShockFlight(canvas, { points: way.points.map(about), bounces: way.bounces.map(about) }, { seed, enemy, big, still })
  })

  if (!ready) return <>{fallback}</>
  if (!head || !shown) return null

  const half = SHOCK_FLIGHT_EXTENT_CM * perCm
  return (
    <foreignObject x={head.x - half} y={head.y - half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none', mixBlendMode: screen ? 'screen' : 'normal' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </foreignObject>
  )
}
