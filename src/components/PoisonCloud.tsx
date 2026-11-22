/**
 * Viper's Poison Cloud on the plays board: the animated cloud at the game's
 * size and on the game's clock, with its emitter canister at the centre. Drawn
 * about the origin, inside the ability's own `<g>`; the board's plain circle
 * shows until the cloud can be painted, and for good where WebGL is missing.
 *
 * The canister sits inside the cloud in the game; it is drawn on top here so
 * the source reads, with a floor of a few screen pixels. Viper's fuel has no
 * mark in the world (the low-fuel warning is a sound), and a fuel ring does not
 * read at minimap size, so there is none.
 */

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { POISON_CLOUD, poisonCloudIdle, poisonCloudState } from '../lib/poisonCloud'
import { POISON_CLOUD_EXTENT, paintPoisonCloud, poisonCloudStatus, subscribePoisonCloud } from '../lib/poisonCloudGl'
import { fitSmokeCanvas } from '../lib/smokeGl'

interface PoisonCloudProps {
  /** The sight-blocking radius, viewBox units (the ability's own `r`). */
  r: number
  /** Ms since the cloud's actor appeared (Viper turned it on), on a replay frame; null for one placed in a strat. */
  age: number | null
  /** The actor's whole life on the replay, ms, when known (it goes off 1.75 s before the end); null assumes a full tank. */
  lifeMs: number | null
  /** The game's enemy treatment (orange-red highlights). */
  enemy: boolean
  /** ViewBox units per screen pixel, for line widths. */
  k: number
  /** No drifting when the user asked for less motion. */
  still: boolean
  /** What the board draws for a smoke otherwise. */
  fallback: ReactNode
}

const OPACITY = 0.94
/** The textures of a still, placed cloud are shown this far in, seconds. */
const STILL_AT = 6

/** The canister seen from above, cm: AB_Pandemic_S0_4_Grenade2 bounds × 1.25. */
const CAN_W = 15
const CAN_H = 13
/** Its gem (Pandemic_Emissive_Gem_MI Inner Color, enemy _FOE) and the glow round it (Pandemic_4_Projectile centerglow). */
const GEM = { ally: '#C9FF4D', enemy: '#FF4A1C' }
const GEM_OFF = { ally: '#4F6B2A', enemy: '#7A2A1C' }
const GLOW = { ally: ['#DFFF7A', '#9BFF2E', '#3BD80B'], enemy: ['#FFD0B8', '#FF3B12', '#B00000'] }
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

export function PoisonCloud({ r, age, lifeMs, enemy, k, still, fallback }: PoisonCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glowId = useId()
  const status = useSyncExternalStore(subscribePoisonCloud, poisonCloudStatus, () => 'loading' as const)
  const ready = status === 'ready'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    if (age !== null) {
      fitSmokeCanvas(canvas)
      paintPoisonCloud(canvas, poisonCloudState(age, lifeMs), enemy, OPACITY)
      return
    }
    if (still) {
      fitSmokeCanvas(canvas)
      paintPoisonCloud(canvas, poisonCloudIdle(STILL_AT), enemy, OPACITY)
      return
    }
    // Placed in a strat: no clock of its own, so it only drifts.
    let frame = 0
    let ticks = 0
    const began = performance.now()
    const tick = (now: number) => {
      // Its size on screen only changes with the zoom: no need to measure every frame.
      if (ticks++ % 20 === 0) fitSmokeCanvas(canvas)
      paintPoisonCloud(canvas, poisonCloudIdle((now - began) / 1000), enemy, OPACITY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [age, lifeMs, enemy, still, ready, r, k])

  if (!ready) return <>{fallback}</>

  const cm = r / POISON_CLOUD.visionCm
  const half = POISON_CLOUD.shellCm * cm * POISON_CLOUD_EXTENT
  const state = age !== null ? poisonCloudState(age, lifeMs) : poisonCloudIdle(STILL_AT)
  const side = enemy ? 'enemy' : 'ally'
  const glow = GLOW[side]
  // True size, but never smaller than a few screen pixels.
  const canW = Math.max(CAN_W * cm, 4.5 * k)
  const canH = canW * (CAN_H / CAN_W)
  const gemR = Math.max(3.6 * cm, 1.4 * k)
  const glowR = Math.max(30 * cm, 6 * k)
  const gone = age !== null && state.phase === 'gone'

  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" stopColor={glow[0]} stopOpacity={1} />
          <stop offset="0.35" stopColor={glow[1]} stopOpacity={0.75} />
          <stop offset="1" stopColor={glow[2]} stopOpacity={0} />
        </radialGradient>
      </defs>
      <foreignObject x={-half} y={-half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </foreignObject>
      {!gone && (
        <g>
          {/* Turned on: the canister's flash and gas burst (Pandemic_4_Activate). */}
          {state.flash > 0 && <circle r={100 * cm * lerp(0.4, 1.5, 1 - state.flash)} fill={`url(#${glowId})`} opacity={0.85 * state.flash} />}
          <circle r={glowR} fill={`url(#${glowId})`} opacity={0.9 * state.gem} />
          <rect x={-canW / 2} y={-canH / 2} width={canW} height={canH} rx={canH * 0.42} fill="#1A1F1A" stroke="#0B0D11" strokeWidth={0.8 * k} />
          <circle r={gemR} fill={state.gem > 0.5 ? GEM[side] : GEM_OFF[side]} />
        </g>
      )}
    </g>
  )
}
