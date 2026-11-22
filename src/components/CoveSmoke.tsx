/**
 * Harbor's Cove on the plays board: the animated water smoke, at the game's
 * size and on the game's clock (as cast; the board cannot tell when it was
 * turned into a shield). Drawn about the origin, inside the ability's own
 * `<g>`; the board's plain circle shows until the smoke can be painted, and
 * for good where WebGL is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { COVE, coveIdle, coveState } from '../lib/coveSmoke'
import { COVE_EXTENT, coveStatus, paintCove, subscribeCove } from '../lib/coveSmokeGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface CoveSmokeProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since the smoke's actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** Draw the game's enemy treatment (red sand). */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No drifting when the user asked for less motion. */
  still: boolean
  /** What the board draws for a smoke otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.92
/** The textures of a still, placed smoke are shown this far in, seconds. */
const STILL_AT = 6
/** The game's "this smoke is about to end" colour (Indicator Color 9DFFFF). */
const WARN = '#9DFFFF'
const WARN_COUNT = 9
/** PS_SmokeWarn: triangles round Extra Triangle Radius 500 cm, turning 0.045 turn/s. */
const WARN_RADIUS_CM = 500
const WARN_TURN_PER_S = 0.045

export function CoveSmoke({ r, age, enemy, k, still, fallback }: CoveSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeCove, coveStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintCove(canvas, coveState(age), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintCove(canvas, coveIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintCove(canvas, coveIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / COVE.visionCm
  const half = COVE.shellCm * cm * COVE_EXTENT
  const state = age !== null ? coveState(age) : null
  const end = COVE.delayMs + COVE.durationMs

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state && state.warn > 0 && state.phase !== 'gone' && age !== null && (
        // About to end: the game's flickering triangles round its edge, pointing in.
        <g transform={`rotate(${(age / 1000) * 360 * WARN_TURN_PER_S})`} opacity={state.phase === 'dissolving' ? Math.max(0, 1 - (age - end) / 250) : 1}>
          {Array.from({ length: WARN_COUNT }, (_, i) => {
            const flicker = 0.35 + 0.65 * Math.abs(Math.sin((age / 1000) * 9 + i * 2.1))
            const size = 40 * cm
            const tip = (WARN_RADIUS_CM - 20) * cm
            return (
              <path
                key={i}
                transform={`rotate(${(360 / WARN_COUNT) * i})`}
                d={`M0 ${-tip} l${size * 0.6} ${-size} h${-size * 1.2} z`}
                fill={WARN}
                opacity={Math.min(1, state.warn * 4) * flicker}
              />
            )
          })}
        </g>
      )}
    </g>
  )
}
