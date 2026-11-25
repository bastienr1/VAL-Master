/**
 * Fade's Prowler on the plays board (docs/plays-editor-v2.md §2.28): on a
 * replay it runs its real way as the game draws it, its head, tail and
 * whiskers in place of the scout's token and dashed way. Drawn in the board's
 * own coordinates, about where it is now; the board's token and way show until
 * its pictures are in.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { PROWLER, prowlerAt, prowlerLook, prowlerWay, type ProwlerWayPoint } from '../lib/prowler'
import { PROWLER_EXTENT_CM, paintProwler, prowlerStatus, subscribeProwler } from '../lib/prowlerPaint'

interface ProwlerProps {
  /** Its whole way, viewBox units, each point with how long ago it was passed (ms; negative for what is still ahead). */
  course: readonly ProwlerWayPoint[]
  /** ViewBox units to the world centimetre. */
  perCm: number
  /** Sent by the other team: the game draws it red. */
  enemy: boolean
  /** ViewBox units per screen pixel: how far the board is zoomed. */
  k: number
  /** No weaving and no loop when the user asked for less motion. */
  still: boolean
  /** What the board draws for a scout otherwise. */
  fallback: ReactNode
}

/** The picture's backing size, device pixels: a step up from what is on screen, within these. */
const MIN_SIZE = 96
const MAX_SIZE = 1024
const SIZE_STEP = 32

function fit(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const shown = canvas.getBoundingClientRect().width * dpr
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.ceil(shown / SIZE_STEP) * SIZE_STEP))
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
}

export function Prowler({ course, perCm, enemy, k, still, fallback }: ProwlerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const status = useSyncExternalStore(subscribeProwler, prowlerStatus, () => 'loading' as const)
  const ready = status === 'ready'
  const way = useMemo(() => prowlerWay(course), [course])
  const head = way.length >= 2 ? prowlerAt(way, 0) : null
  // How long its head would be on screen at the game's size decides how it is drawn (§2.28).
  const look = prowlerLook((PROWLER.headCm * perCm) / k)

  // A replay frame is a new picture every time: paint after every render.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready || !head || !(perCm > 0)) return
    fit(canvas)
    paintProwler(canvas, way.map(p => ({ x: (p.x - head.x) / perCm, y: (p.y - head.y) / perCm, ago: p.ago })), { enemy, still, ...look })
  })

  if (!ready || !head || !(perCm > 0)) return <>{fallback}</>

  const half = PROWLER_EXTENT_CM * perCm
  return (
    <foreignObject x={head.x - half} y={head.y - half} width={half * 2} height={half * 2} style={{ pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </foreignObject>
  )
}
