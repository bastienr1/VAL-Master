import { Bookmark, BookmarkCheck } from 'lucide-react'
import type { SavedDrill } from '../lib/types'

interface SaveDrillButtonProps {
  saved: SavedDrill | null
  busy?: boolean
  onToggle: () => void
}

/**
 * The bookmark on a drill row. Filled when the drill is saved; a click on a
 * filled one removes the save. Where the save goes is the row's business, not
 * this button's.
 */
export default function SaveDrillButton({ saved, busy = false, onToggle }: SaveDrillButtonProps) {
  const isSaved = saved !== null
  const Icon = isSaved ? BookmarkCheck : Bookmark

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={isSaved}
      title={isSaved ? 'Remove saved drill' : 'Save drill'}
      className={`shrink-0 flex items-center justify-center w-7 h-7 rounded border transition-colors disabled:opacity-60 ${
        isSaved
          ? 'bg-val-yellow/15 border-val-yellow/30 text-val-yellow hover:bg-val-yellow/25'
          : 'bg-transparent border-bg-elevated text-text-muted hover:border-text-muted hover:text-text-secondary'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}
