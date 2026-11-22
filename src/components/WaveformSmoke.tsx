/**
 * Miks's Waveform on the plays board: the animated smoke, at the game's size and
 * on the game's clock (`src/lib/waveformSmoke.ts`). Drawn about the origin,
 * inside the ability's own `<g>`; the board's plain circle shows until the smoke
 * can be painted, and for good where WebGL is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { fitSmokeCanvas } from '../lib/smokeGl'
import { WAVEFORM, waveformIdle, waveformState } from '../lib/waveformSmoke'
import { WAVEFORM_EXTENT, paintWaveform, subscribeWaveform, waveformStatus } from '../lib/waveformSmokeGl'

interface WaveformSmokeProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since the smoke's actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The files' enemy treatment (TeamColor 12, 0, 0 on the Nora pattern). */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No drifting when the user asked for less motion. */
  still: boolean
  /** What the board draws for a smoke otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.94
/** The textures of a still, placed smoke are shown this far in, seconds. */
const STILL_AT = 6
/** The game's "this smoke is about to end" colour (Indicator Color 9DFFFF). */
const WARN = '#9DFFFF'
/** The announcement's torus rings go from gold to purple over their life. */
const RING_FROM = [0xff, 0xf3, 0xb0]
const RING_TO = [0x6e, 0x42, 0xb4]

function ringColor(life: number): string {
  const f = Math.min(1, Math.max(0, (life - 0.1) / 0.9))
  return `rgb(${RING_FROM.map((a, i) => Math.round(a + (RING_TO[i] - a) * f)).join(',')})`
}

export function WaveformSmoke({ r, age, enemy, k, still, fallback }: WaveformSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeWaveform, waveformStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintWaveform(canvas, waveformState(age), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintWaveform(canvas, waveformIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintWaveform(canvas, waveformIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / WAVEFORM.visionCm
  const half = WAVEFORM.shellCm * cm * WAVEFORM_EXTENT
  const state = age !== null ? waveformState(age) : null

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state?.rings.map((ring, i) => (
        // Announced: the two torus rings that open at its centre.
        <circle key={i} r={ring.r * cm} fill="none" stroke={ringColor(ring.life)} strokeWidth={Math.max(1.5 * k, ring.width * cm)} opacity={ring.opacity} />
      ))}
      {state && state.triangles.length > 0 && (
        // About to end: the game's cyan triangles, thrown out from 4.6 m.
        <g>
          {state.triangles.map((tri, i) => (
            <path
              key={i}
              transform={`translate(${tri.x * cm} ${tri.y * cm}) rotate(${tri.rotate}) scale(${tri.size * cm})`}
              d="M0 -0.58 L0.5 0.29 L-0.5 0.29 Z"
              fill={WARN}
              opacity={tri.opacity}
            />
          ))}
        </g>
      )}
    </g>
  )
}
