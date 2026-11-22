/**
 * Brimstone's Sky Smoke on the plays board: the animated smoke, at the game's
 * size and on the game's clock. Drawn about the origin, inside the ability's
 * own `<g>`; the board's plain circle shows until the smoke can be painted, and
 * for good where WebGL is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { SKY_SMOKE, skySmokeIdle, skySmokeState } from '../lib/skySmoke'
import { SKY_SMOKE_EXTENT, paintSkySmoke, skySmokeStatus, subscribeSkySmoke } from '../lib/skySmokeGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface SkySmokeProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since the smoke's actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The game's enemy treatment (red marker, red through the smoke's mask). */
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
/** The landing marker, ally (0.5, 5, 5) × 0.2 and enemy (5, 0.6, 0.6) × 0.2. */
const MARKER = { ally: '#4CF2F2', enemy: '#FF5A5A' }
/** The game's "this smoke is about to end" colour for Brimstone (Indicator Color FFC49F). */
const WARN = '#FFC49F'
const WARN_COUNT = 9
/** The marker sphere sits 65 cm above the ground: where it meets the ground. */
const groundCm = (sphereCm: number) => Math.sqrt(Math.max(0, sphereCm * sphereCm - 65 * 65))

export function SkySmoke({ r, age, enemy, k, still, fallback }: SkySmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeSkySmoke, skySmokeStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintSkySmoke(canvas, skySmokeState(age), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintSkySmoke(canvas, skySmokeIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintSkySmoke(canvas, skySmokeIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / SKY_SMOKE.visionCm
  const shell = SKY_SMOKE.shellCm * cm
  const half = shell * SKY_SMOKE_EXTENT
  const state = age !== null ? skySmokeState(age) : null
  const line = 1.5 * k
  const marker = enemy ? MARKER.enemy : MARKER.ally
  // The marker lies on the ground: the smoke covers it as it forms.
  const under = state ? 1 - Math.min(1, state.bodyA * 1.5) : 0

  return (
    <g pointerEvents="none">
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {state && state.markerA > 0 && under > 0 && (
        <>
          {/* Where it lands (Sarge_E_SmokeBomb_Incoming), and the ring that grows out to it. */}
          <circle r={groundCm(SKY_SMOKE.markerCm) * cm} fill="none" stroke={marker} strokeWidth={line} opacity={0.9 * state.markerA * under} />
          {state.growA > 0 && state.growCm > 65 && (
            <circle r={groundCm(state.growCm) * cm} fill="none" stroke={marker} strokeWidth={line * 0.8} opacity={0.6 * state.growA * under} />
          )}
        </>
      )}
      {state && state.warn > 0 && age !== null && (
        // About to end: the game's flickering triangles, turning −0.04 a second.
        <g transform={`rotate(${-14.4 * state.warnSeconds})`} opacity={state.warn}>
          {Array.from({ length: WARN_COUNT }, (_, i) => {
            const flicker = 0.55 + 0.45 * Math.abs(Math.sin((age / 1000) * 9 + i * 2.1))
            const tip = SKY_SMOKE.warnCm * cm
            const size = shell * 0.07
            return (
              <path
                key={i}
                transform={`rotate(${(360 / WARN_COUNT) * i})`}
                d={`M0 ${-tip} l${size * 0.6} ${size} h${-size * 1.2} z`}
                fill={WARN}
                opacity={flicker}
              />
            )
          })}
        </g>
      )}
    </g>
  )
}
