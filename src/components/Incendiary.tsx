/**
 * Brimstone's Incendiary on the plays board: the fire as the game draws it,
 * seen from straight above, at the game's size and on the game's clock (the
 * impact, the spread at 6 m/s, the 8.0 s burn, the last flames and embers
 * dying; nothing burns in the actor's last seconds). Drawn about the origin,
 * inside the ability's own `<g>`; the board's plain disc shows until the fire
 * can be painted, and for good where WebGL is missing.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { INCENDIARY, incendiaryIdle, incendiaryState } from '../lib/incendiary'
import { INCENDIARY_EXTENT, incendiaryStatus, paintIncendiary, subscribeIncendiary } from '../lib/incendiaryGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface IncendiaryProps {
  /** The radius the fire hurts in, viewBox units (the ability's own `r`: 450 cm). */
  r: number
  /** Ms since the fire's patch actor appeared (the grenade came to rest), on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The game's enemy treatment: a redder flame, a thinner line on the edge. */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No flickering when the user asked for less motion. */
  still: boolean
  /** What the board draws for a molly otherwise. */
  fallback: ReactNode
}

const OPACITY = 1
/** A still, placed fire is shown this far into its loop, seconds. */
const STILL_AT = 2
/** The line on the spreading front, and the grenade's rim: the prototype's hot orange. */
const FRONT = '#FFB36B'
/** The grenade lying there before the fire starts out: 16 cm, with a floor on screen. */
const GRENADE_CM = 16
const GRENADE = '#2A2F3A'
/** The mark of where the fire was, once it is out. */
const FOOTPRINT = '#94A3B8'

export function Incendiary({ r, age, enemy, k, still, fallback }: IncendiaryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeIncendiary, incendiaryStatus, () => 'loading' as const)
  const ready = status === 'ready'
  // On a replay frame: exactly the fire at that age.
  const state = useMemo(() => (age !== null ? incendiaryState(age) : null), [age])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (state) {
      fitSmokeCanvas(canvas)
      paintIncendiary(canvas, state, enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintIncendiary(canvas, incendiaryIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only burns.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintIncendiary(canvas, incendiaryIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / INCENDIARY.hurtCm
  const half = r * INCENDIARY_EXTENT

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state && state.footprint > 0 && (
        // The fire is out and nothing hurts: a faint dashed mark of where it was, until the actor ends.
        <circle
          r={r}
          fill="none"
          stroke={FOOTPRINT}
          strokeWidth={Math.max(3 * cm, k)}
          strokeDasharray={`${Math.max(14 * cm, 3 * k)} ${Math.max(18 * cm, 4 * k)}`}
          opacity={state.footprint}
        />
      )}
      {state && state.front > 0 && state.spread > 0 && (
        // The front of the fire as it spreads to its full size.
        <circle r={r * state.spread} fill="none" stroke={FRONT} strokeWidth={Math.max(6 * cm, 1.2 * k)} opacity={state.front} />
      )}
      {state && state.impact > 0 && (
        // The grenade at rest, the moment before it lights.
        <circle r={Math.max(GRENADE_CM * cm, 1.8 * k)} fill={GRENADE} stroke={FRONT} strokeWidth={Math.max(4 * cm, 0.8 * k)} opacity={state.impact} />
      )}
    </g>
  )
}
