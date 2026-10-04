import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ImageOff, Play } from 'lucide-react'

interface HubCardProps {
  to: string
  /** Null when there is no picture to show: the placeholder renders at once. */
  image: string | null
  title: string
  meta: string
  /** An arrow for a page to read, a play mark for a video to watch. */
  mark: 'arrow' | 'play'
}

/**
 * One card of an IMPROVE hub row: a picture, a title, one line under it. The
 * same component for playbooks, guides and pro VODs, so the three rows read as
 * one page. The whole card is the link.
 */
export default function HubCard({ to, image, title, meta, mark }: HubCardProps) {
  const [failed, setFailed] = useState(false)
  const [attempted, setAttempted] = useState(image)

  // A new image deserves a fresh attempt — reset during render, as GameImage does.
  if (image !== attempted) {
    setAttempted(image)
    setFailed(false)
  }

  return (
    <Link
      to={to}
      className="group relative block aspect-[2/1] rounded-xl overflow-hidden border border-bg-elevated bg-bg-card hover:border-val-cyan/50 outline-none focus-visible:border-val-cyan transition-colors"
    >
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        // Never a broken image: a missing or failed picture is a plain panel.
        <div aria-hidden="true" className="absolute inset-0 bg-bg-elevated flex items-center justify-center">
          <ImageOff className="w-8 h-8 text-text-muted" strokeWidth={1.5} />
        </div>
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-bg-primary via-bg-primary/60 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading font-bold text-lg leading-tight tracking-wide line-clamp-2" title={title}>
            {title}
          </div>
          {meta && (
            <div className="text-xs text-text-secondary truncate" title={meta}>
              {meta}
            </div>
          )}
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 w-8 h-8 rounded-full border border-text-muted/60 flex items-center justify-center text-text-secondary group-hover:border-val-cyan group-hover:text-val-cyan transition-colors"
        >
          {mark === 'play' ? <Play className="w-3.5 h-3.5 fill-current translate-x-px" /> : <ArrowRight className="w-4 h-4" />}
        </span>
      </div>
    </Link>
  )
}
