/**
 * Phoenix's Hot Hands on the plays board: the animated fire, at the game's
 * size and on the game's clock. Drawn about the origin, inside the ability's
 * own `<g>`; the board's plain circle shows until the fire can be painted, and
 * for good where WebGL is missing.
 *
 * The dashed ring is where it hurts (and heals Phoenix). It goes when the burn
 * is over, 4.2 s in, though the fire takes 3 s more to clear.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { HOT_HANDS, hotHandsIdle, hotHandsState } from '../lib/hotHands'
import { HOT_HANDS_EXTENT, hotHandsStatus, paintHotHands, subscribeHotHands } from '../lib/hotHandsGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface HotHandsProps {
  /** The radius the fire hurts in, viewBox units (the ability's own `r`: 475 cm). */
  r: number
  /** Ms since the fire's patch actor appeared (the fireball landed), on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The game's enemy treatment: the _FOE_ materials' redder fire. */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No flickering when the user asked for less motion. */
  still: boolean
  /** What the board draws for a molly otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.95
/** A still, placed fire is shown this far into its loop, seconds. */
const STILL_AT = 2
/** The hurt ring lingers this long after the burn, fading, ms. */
const RING_OUT_MS = 350
/** The spread front while the fire is still moving out. */
const FRONT = '#FFD7A8'

export function HotHands({ r, age, enemy, k, still, fallback }: HotHandsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeHotHands, hotHandsStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintHotHands(canvas, hotHandsState(age), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintHotHands(canvas, hotHandsIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only burns on.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintHotHands(canvas, hotHandsIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / HOT_HANDS.radiusCm
  const half = r * HOT_HANDS_EXTENT
  const state = age !== null ? hotHandsState(age) : hotHandsIdle(STILL_AT)
  // Whole while it burns, then gone over a third of a second.
  const ring = age === null ? 1 : state.phase === 'gone' ? 0 : state.burning ? 1 : Math.max(0, 1 - (age - HOT_HANDS.burnMs) / RING_OUT_MS)

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {/* The fire moving out from where the fireball landed, 6 m a second. */}
      {state.phase === 'spreading' && <circle r={state.frontCm * cm} fill="none" stroke={FRONT} strokeWidth={1.4 * k} opacity={0.7} />}
      {ring > 0 && (
        <circle r={r} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.2 * k} strokeDasharray={`${2 * k} ${5 * k}`} opacity={ring} />
      )}
    </g>
  )
}
