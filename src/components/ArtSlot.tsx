import { useEffect, useState } from 'react'
import { useArtSlot } from '../hooks/useArtSlot'
import type { ArtCandidate, ArtSource, ScrimDirection } from '../lib/artSlots'

/** Shown when a slot has no image at all, or none that loads. */
const NEUTRAL_GRADIENT =
  'linear-gradient(135deg, var(--color-bg-elevated) 0%, var(--color-bg-secondary) 55%, var(--color-bg-primary) 100%)'

const TRANSPARENT = 'transparent'
const tint = (percent: number) => `color-mix(in srgb, var(--color-bg-primary) ${percent}%, ${TRANSPARENT})`

/** Darkens towards the side the text sits on. */
const SCRIMS: Record<ScrimDirection, string> = {
  left: `linear-gradient(90deg, var(--color-bg-primary) 0%, var(--color-bg-primary) 20%, ${tint(80)} 42%, ${tint(30)} 68%, ${TRANSPARENT} 100%)`,
  bottom: `linear-gradient(0deg, var(--color-bg-primary) 0%, var(--color-bg-primary) 18%, ${tint(85)} 42%, ${tint(25)} 72%, ${TRANSPARENT} 100%)`,
  radial: `radial-gradient(ellipse at center, ${tint(25)} 0%, ${tint(70)} 60%, var(--color-bg-primary) 100%)`,
}

interface ArtLayerProps {
  /** Named in the fallback warnings. */
  slotKey: string
  /** Images to try, best first. Empty renders the gradient alone. */
  candidates: ArtCandidate[]
  focal: { x: number; y: number }
  /** Scrim opacity, 0–1. */
  overlay: number
  scrim?: ScrimDirection
  /** CSS background behind the image and after every image has failed. */
  gradientFallback?: string | null
  /** The hero: fetched eagerly and first. Everything else is lazy. */
  priority?: boolean
  className?: string
  imgClassName?: string
  /**
   * Framing for the API image only, which is composed for the game's own UI
   * rather than for the slot. An override or bundled file is made to the slot's
   * brief and uses `focal` and `imgClassName` alone.
   */
  apiFocal?: { x: number; y: number }
  apiImgClassName?: string
  /** Reports what ended up on screen, once it is known. */
  onResolve?: (source: ArtSource) => void
  children?: React.ReactNode
}

/**
 * An image behind text, with the scrim that keeps the text readable.
 *
 * The scrim is always drawn and text always sits on it, never on the picture —
 * that is what lets the art be swapped for anything without breaking the page.
 * The gradient is always underneath, so a missing file shows as a plain panel
 * and never as a broken-image icon.
 *
 * Position children with `relative`; they render above the scrim.
 */
export function ArtLayer({
  slotKey,
  candidates,
  focal,
  overlay,
  scrim = 'bottom',
  gradientFallback,
  priority = false,
  className = '',
  imgClassName = '',
  apiFocal,
  apiImgClassName = '',
  onResolve,
  children,
}: ArtLayerProps) {
  // Sources that failed to load. Keyed by URL, so a new override gets its own
  // attempt and an old failure is simply never looked up again.
  const [failed, setFailed] = useState<string[]>([])
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)

  const current = candidates.find(c => !failed.includes(c.src)) ?? null
  const exhausted = candidates.length > 0 && !current
  const isApi = current?.source === 'api'
  const position = isApi && apiFocal ? apiFocal : focal

  const resolved: ArtSource | null = exhausted
    ? 'gradient'
    : current && loadedSrc === current.src
      ? current.source
      : null

  useEffect(() => {
    if (resolved) onResolve?.(resolved)
  }, [resolved, onResolve])

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: gradientFallback || NEUTRAL_GRADIENT }}>
      {current && (
        <img
          key={current.src}
          src={current.src}
          alt=""
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          // Fades in over the gradient once loaded: the game's map art is several
          // megabytes, and popping in a second late reads as a glitch.
          className={`absolute inset-0 w-full h-full object-cover transition-[opacity,scale] duration-500 ${
            loadedSrc === current.src ? 'opacity-100' : 'opacity-0'
          } ${imgClassName} ${isApi ? apiImgClassName : ''}`}
          style={{ objectPosition: `${position.x * 100}% ${position.y * 100}%` }}
          onLoad={() => setLoadedSrc(current.src)}
          onError={() => {
            const next = candidates.find(c => c.src !== current.src && !failed.includes(c.src))
            console.warn('[artSlot] fallback', { slotKey, from: current.source, to: next?.source ?? 'gradient' })
            setFailed(prev => [...prev, current.src])
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: SCRIMS[scrim], opacity: overlay }}
      />
      {children}
    </div>
  )
}

interface ArtSlotProps
  extends Pick<
    ArtLayerProps,
    | 'scrim'
    | 'gradientFallback'
    | 'priority'
    | 'className'
    | 'imgClassName'
    | 'apiFocal'
    | 'apiImgClassName'
    | 'onResolve'
    | 'children'
  > {
  slotKey: string
  /** The game API image for this slot. Maps and agents only. */
  apiDefault?: string | null
  /**
   * Scrim strength while the slot shows default art, which has no saved overlay
   * of its own. An override always uses the overlay saved with it.
   */
  defaultOverlay?: number
}

/** A swappable picture: the user's override, else the API image, else the bundled file, else a gradient. */
export default function ArtSlot({ slotKey, apiDefault, defaultOverlay, ...layer }: ArtSlotProps) {
  const slot = useArtSlot(slotKey, apiDefault)

  return (
    <ArtLayer
      {...layer}
      slotKey={slotKey}
      candidates={slot.candidates}
      focal={slot.focal}
      overlay={slot.override || defaultOverlay === undefined ? slot.overlay : defaultOverlay}
    />
  )
}
