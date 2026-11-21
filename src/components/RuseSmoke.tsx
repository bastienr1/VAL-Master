/**
 * Clove's Ruse on the plays board (docs/plays-editor-v2.md §2.21): the animated
 * smoke, at the game's size and on the game's clock. Drawn about the origin,
 * inside the ability's own `<g>`; the board's plain circle shows until the
 * smoke can be painted, and for good where WebGL is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { RUSE, ruseIdle, ruseState, type RuseCast } from '../lib/ruseSmoke'
import { RUSE_EXTENT, paintRuse, ruseStatus, subscribeRuse } from '../lib/ruseSmokeGl'

interface RuseSmokeProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since the smoke's actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  cast: RuseCast
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No drifting when the user asked for less motion. */
  still: boolean
  /** What the board draws for a smoke otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.92
/** The picture's backing size, device pixels: a step up from what is on screen, within these. */
const MIN_SIZE = 64
const MAX_SIZE = 512
const SIZE_STEP = 32
/** The textures of a still, placed smoke are shown this far in, seconds. */
const STILL_AT = 6

const RIPPLE = '#A991FD'
/** The game's "this smoke is about to end" colour (Indicator Color 9DFFFF). */
const WARN = '#9DFFFF'
const WARN_COUNT = 9
const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3

/** The canvas's backing size for how big it is on screen now. */
function fit(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const shown = canvas.getBoundingClientRect().width * dpr
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.ceil(shown / SIZE_STEP) * SIZE_STEP))
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
}

export function RuseSmoke({ r, age, cast, k, still, fallback }: RuseSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeRuse, ruseStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fit(canvas)
      paintRuse(canvas, ruseState(age, cast), cast, OPACITY)
      return
    }
    if (still) {
      fit(canvas)
      paintRuse(canvas, ruseIdle(STILL_AT), cast, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fit(canvas)
      paintRuse(canvas, ruseIdle((now - began) / 1000), cast, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, cast, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / RUSE.visionCm
  const shell = RUSE.shellCm * cm
  const half = shell * RUSE_EXTENT
  const state = age !== null ? ruseState(age, cast) : null
  const line = 1.5 * k

  return (
    <g pointerEvents="none">
      {state && state.ripple >= 0 && (
        <>
          {/* Announced: its footprint, and two ripples out to it. */}
          <circle r={shell} fill="none" stroke={RIPPLE} strokeWidth={line} strokeDasharray={`${4 * k} ${5 * k}`} opacity={0.6 * Math.min(1, state.ripple * 3)} />
          {[0, 1].map(i => {
            const x = Math.min(1, Math.max(0, state.ripple * 1.35 - i * 0.35))
            return x > 0 ? <circle key={i} r={shell * easeOut(x)} fill="none" stroke={RIPPLE} strokeWidth={line * 1.6} opacity={0.85 * (1 - x)} /> : null
          })}
        </>
      )}
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state && state.flash > 0 && <circle r={shell * (0.32 + 0.46 * (1 - state.flash))} fill="#8E9BFF" opacity={0.55 * state.flash} />}
      {state && state.warn > 0 && state.phase !== 'gone' && age !== null && (
        // About to end: the game's flickering triangles, round its edge.
        <g transform={`rotate(${(age / 1000) * 24})`} opacity={state.phase === 'dissolving' ? Math.max(0, 1 - (state.dissolve + 0.45) / 0.75) : 1}>
          {Array.from({ length: WARN_COUNT }, (_, i) => {
            const flicker = 0.35 + 0.65 * Math.abs(Math.sin((age / 1000) * 9 + i * 2.1))
            const tip = shell * 1.07
            const size = shell * 0.07
            return (
              <path
                key={i}
                transform={`rotate(${(360 / WARN_COUNT) * i})`}
                d={`M0 ${-tip} l${size * 0.6} ${size} h${-size * 1.2} z`}
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
