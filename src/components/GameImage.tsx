import { useState } from 'react'
import { Map as MapIcon, User } from 'lucide-react'

interface GameImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** null when no UUID could be resolved — renders the placeholder immediately. */
  src: string | null
  kind: 'map' | 'agent'
}

/**
 * Renders a game asset, or a neutral placeholder when the id couldn't be
 * resolved or the CDN request failed. Never substitutes a different asset —
 * a wrong map splash is worse than an obviously missing one.
 */
export default function GameImage({ src, kind, className, alt, ...rest }: GameImageProps) {
  const [failed, setFailed] = useState(false)
  const [attempted, setAttempted] = useState(src)

  // A new src deserves a fresh attempt — reset during render rather than in an
  // effect, so the retry happens before the placeholder can flash.
  if (src !== attempted) {
    setAttempted(src)
    setFailed(false)
  }

  if (src && !failed) {
    return (
      <img
        {...rest}
        src={src}
        alt={alt}
        className={className}
        onError={() => {
          console.warn('[gameContent] asset failed to load', { kind, src })
          setFailed(true)
        }}
      />
    )
  }

  const Glyph = kind === 'map' ? MapIcon : User

  return (
    <div
      className={`${className ?? ''} bg-bg-elevated flex items-center justify-center`}
      role="img"
      aria-label={typeof alt === 'string' && alt ? alt : `${kind} artwork unavailable`}
      title={typeof alt === 'string' ? alt : undefined}
    >
      <Glyph className="w-1/3 h-1/3 min-w-3 min-h-3 text-text-muted" strokeWidth={1.5} />
    </div>
  )
}
