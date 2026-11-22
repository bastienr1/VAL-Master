/**
 * Astra's Nebula on the plays board: the animated smoke, at the game's size
 * and on the game's clock, for both the Nebula (15 s) and the Dissipate fake
 * (1.75 s). Drawn about the origin, inside the ability's own `<g>`; the board's
 * plain circle shows until the smoke can be painted, and for good where WebGL
 * is missing.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { NEBULA, nebulaIdle, nebulaState, type NebulaCast } from '../lib/nebulaSmoke'
import { NEBULA_EXTENT, nebulaStatus, paintNebula, subscribeNebula } from '../lib/nebulaSmokeGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface NebulaSmokeProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`: Nebula's 469.8 cm). */
  r: number
  /** Ms since the smoke's actor appeared, on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The real smoke, or the Dissipate fake (`GameObject_Rift_E_SmokeZone_Fake_C`). */
  cast: NebulaCast
  /** The game's enemy treatment: red team colour in place of the allies' gold. */
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
/** The game's "this smoke is about to end" colour (FXC_Rift_E_SmokeZone_EndTelegraph, Indicator Color FF6CFF). */
const WARN = '#FF6CFF'
/** PS_SmokeWarn's Extra Triangles; Extra Triangle Radius 510 puts the tips at about 486 cm. */
const WARN_COUNT = 10
const WARN_TIP_CM = 486
const WARN_SIZE_CM = 44

/** TeamColor modules: allies (1, 0.334, 0.061), enemies (2, 0.091, 0.015). */
const ALLY = [1, 0.3338, 0.0611] as const
const ENEMY = [2, 0.091, 0.015] as const
const COOL = [0.05, 0, 0.75] as const
/** The page's tone map: linear HDR to a CSS colour. */
function css(c: readonly number[]): string {
  const [r, g, b] = c.map(x => Math.round(255 * (1 - Math.exp(-Math.max(0, x))) ** (1 / 2.2)))
  return `rgb(${r},${g},${b})`
}

export function NebulaSmoke({ r, age, cast, enemy, k, still, fallback }: NebulaSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeNebula, nebulaStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintNebula(canvas, nebulaState(age, cast), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintNebula(canvas, nebulaIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintNebula(canvas, nebulaIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, cast, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  // `r` is Nebula's sight radius; Dissipate's own (475.6 cm) is the same scale, so one cm factor serves both.
  const cm = r / NEBULA.visionCm
  const half = NEBULA.shellCm * cm * NEBULA_EXTENT
  const state = age !== null ? nebulaState(age, cast) : nebulaIdle(STILL_AT)
  const team = enemy ? ENEMY : ALLY
  const ringR = NEBULA.ringCm * cm
  const seconds = age !== null ? age / 1000 : 0
  const end = NEBULA.durationMs[cast]

  return (
    <g pointerEvents="none">
      {/* Base_Ring / Halo_Ring: a thin ring on the ground just outside the shell. */}
      {state.baseRing > 0 && <circle r={ringR} fill="none" stroke={css(team.map(x => x * 1.6))} strokeWidth={1.2 * k} opacity={0.55 * state.baseRing} />}
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {/* The bright ring that opens the smoke as the star lands, and closes it. */}
      {state.ring.alpha > 0 && state.ring.scale > 0 && (
        <circle
          r={ringR * state.ring.scale}
          fill="none"
          stroke={css(team.map((x, i) => x * state.ring.bright * 0.22 + COOL[i] * state.ring.bright * 0.05))}
          strokeWidth={1.8 * k}
          opacity={Math.min(1, 0.8 * state.ring.alpha)}
        />
      )}
      {state.warn > 0 && state.phase !== 'gone' && age !== null && (
        // About to end: the game's flickering triangles, round its edge.
        <g transform={`rotate(${seconds * 24})`} opacity={state.phase === 'out' ? Math.max(0, 1 - (age - end) / 250) : 1}>
          {Array.from({ length: WARN_COUNT }, (_, i) => {
            const flicker = 0.35 + 0.65 * Math.abs(Math.sin(seconds * 9 + i * 2.1))
            const tip = WARN_TIP_CM * cm
            const size = WARN_SIZE_CM * cm
            return (
              <path
                key={i}
                transform={`rotate(${(360 / WARN_COUNT) * i})`}
                d={`M0 ${-tip} l${size * 0.61} ${size} h${-size * 1.23} z`}
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
