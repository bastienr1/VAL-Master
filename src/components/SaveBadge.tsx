import { AlertTriangle, Check, Loader2 } from 'lucide-react'

/** Where a page that saves as you go stands: nothing written yet, a write on its way, the last one in, or one refused. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * The small line that stands in for a Save button on a page that saves every
 * change by itself: it says so until something is written, then how the last
 * write went.
 */
export default function SaveBadge({ state, className = '' }: { state: SaveState; className?: string }) {
  const base = `inline-flex items-center gap-1 text-[11px] whitespace-nowrap ${className}`
  if (state === 'saving') {
    return (
      <span role="status" className={`${base} text-text-secondary`}>
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span role="status" className={`${base} text-val-red`}>
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        Not saved
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span role="status" className={`${base} text-val-green`}>
        <Check className="w-3 h-3" aria-hidden="true" />
        Saved
      </span>
    )
  }
  return (
    <span role="status" className={`${base} text-text-muted`} title="There is no Save button: every change is saved as you make it.">
      Saves as you go
    </span>
  )
}
