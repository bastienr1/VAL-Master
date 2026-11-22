/**
 * Omen's Dark Cover on the plays board: the animated smoke, at the game's size
 * and on the game's clock (age 0 = the Zone actor appears; the board draws the
 * projectile before it). Drawn about the origin, inside the ability's own `<g>`;
 * the board's plain circle shows until the smoke can be painted, and for good
 * where WebGL is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { DARK_COVER, darkCoverIdle, darkCoverState } from '../lib/darkCover'
import { DARK_COVER_EXTENT, darkCoverStatus, paintDarkCover, subscribeDarkCover } from '../lib/darkCoverGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface DarkCoverProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`, 410.5 cm in the game). */
  r: number
  /** Ms since the Zone actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** An enemy's smoke: the files' `_FOE` outro (the dome itself has no team colour). */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No drifting when the user asked for less motion. */
  still: boolean
  /** What the board draws for a smoke otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.95
/** The textures of a still, placed smoke are shown this far in, seconds. */
const STILL_AT = 6
/** The game's "this smoke is about to end" colour (FXC_Wraith_4_SmokeZone_EndTelegraph Indicator Color 90BBFF). */
const WARN = '#90BBFF'
const WARN_COUNT = 9
/** The warning dome's radius, world cm: Smoke Size 10.4 × the 42.66 cm dome mesh. */
const WARN_TIP_CM = 443.7
/** PS_SmokeWarn Triangles AlphaOverLife: it brightens toward the end. */
const WARN_ALPHA = [0.04, 0.086, 0.246, 0.491, 0.789, 1.11, 1.423, 1.696]

function warnAlpha(f: number): number {
  const x = Math.min(1, Math.max(0, f)) * (WARN_ALPHA.length - 1)
  const i = Math.min(WARN_ALPHA.length - 2, Math.floor(x))
  return WARN_ALPHA[i] + (WARN_ALPHA[i + 1] - WARN_ALPHA[i]) * (x - i)
}

export function DarkCover({ r, age, enemy, k, still, fallback }: DarkCoverProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeDarkCover, darkCoverStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintDarkCover(canvas, darkCoverState(age, enemy), OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintDarkCover(canvas, darkCoverIdle(STILL_AT), OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintDarkCover(canvas, darkCoverIdle((now - began) / 1000), OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / DARK_COVER.visionCm
  const half = DARK_COVER.shellCm * cm * DARK_COVER_EXTENT
  const state = age !== null ? darkCoverState(age, enemy) : null
  const warnSince = state && state.warn > 0 ? (state.warn * DARK_COVER.warnLifeMs) / 1000 : 0

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state && state.warn > 0 && age !== null && (
        // About to end: the game's flickering triangles on the warning dome, turning 0.045 turn/s.
        <g transform={`rotate(${warnSince * DARK_COVER.warnTurnsPerS * 360})`}>
          {Array.from({ length: WARN_COUNT }, (_, i) => {
            const flicker = 0.55 + 0.45 * Math.abs(Math.sin((age / 1000) * 9 + i * 2.1))
            const tip = WARN_TIP_CM * cm
            // At least a few pixels, so they still read at minimap size.
            const size = Math.max(40 * cm, 3 * k)
            return (
              <path
                key={i}
                transform={`rotate(${(360 / WARN_COUNT) * i})`}
                d={`M0 ${-tip} l${size * 0.6} ${size} h${-size * 1.2} z`}
                fill={WARN}
                opacity={Math.min(1, 0.3 + warnAlpha(state.warn) * 0.45) * flicker}
              />
            )
          })}
        </g>
      )}
    </g>
  )
}
