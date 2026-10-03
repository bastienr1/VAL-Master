import { Link } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import { guideMarkdown } from '../lib/guideMarkdown'
import { snapshotChanged } from '../lib/savedDrillScope'
import { formatTime } from '../lib/youtube'
import type { PracticeDrill, SavedDrill } from '../lib/types'

/** The empty line of every saved-drills shelf: how to put something on it. */
export const SAVED_DRILLS_EMPTY = 'Open a guide in Pro Study and bookmark a drill in its Practice tab.'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-val-cyan/10 text-val-cyan border-val-cyan/20',
  done: 'bg-val-green/10 text-val-green border-val-green/20',
}

interface SavedDrillCardProps {
  saved: SavedDrill
  /** The drill as it is now, when the page has it; the card then shows status and flags a changed note. */
  live?: Pick<PracticeDrill, 'title' | 'status' | 'position'> | null
  logCount?: number
  onRemove?: () => void
}

/** `6:11 - 7:19`, or the start alone when the note gave no end. */
function sourceLabel(saved: SavedDrill): string {
  const start = formatTime(saved.source_start_seconds ?? 0)
  return saved.source_end_seconds === null ? start : `${start} - ${formatTime(saved.source_end_seconds)}`
}

/**
 * A saved drill on a shelf: what to practise, where, what to watch for, and
 * the way back to the moment in the guide it came from.
 *
 * Shows the copy taken at save time, not the live drill, and says so when the
 * two have drifted. The jump link carries the drill so the review page opens
 * its Practice tab with that row marked.
 */
export default function SavedDrillCard({ saved, live = null, logCount = 0, onRemove }: SavedDrillCardProps) {
  const changed = snapshotChanged(saved, live?.title ?? null)
  // The review page marks a drill by id or position; the id is on the save
  // itself, so the mark works from a shelf that never looked the drill up.
  const mark = live ? String(live.position) : saved.drill_id
  const jump =
    saved.reference_review_id && saved.source_start_seconds !== null
      ? `/study/${saved.reference_review_id}?t=${saved.source_start_seconds}${mark ? `&drill=${mark}` : ''}`
      : null

  return (
    <article className="h-full flex flex-col bg-bg-card border border-bg-elevated rounded-xl px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <NoteMarkdown>{guideMarkdown(saved.title)}</NoteMarkdown>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Trained enough? Remove the bookmark"
            className="shrink-0 -mr-1 -mt-0.5 p-1 rounded text-text-muted hover:text-val-red transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {saved.venue && (
          <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px] font-medium">
            {saved.venue}
          </span>
        )}
        {saved.agent && (
          <span className="px-1.5 py-0.5 rounded-full bg-val-cyan/10 border border-val-cyan/20 text-val-cyan text-[10px] font-medium">
            {saved.agent}
          </span>
        )}
        {live && STATUS_STYLE[live.status] && (
          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLE[live.status]}`}>
            {live.status}
          </span>
        )}
        {logCount > 0 && <span className="font-stats text-[10px] text-text-muted">{logCount} logged</span>}
      </div>

      {(saved.cue || saved.success_signal) && (
        <dl className="mt-2 space-y-1 text-[12px] leading-snug">
          {saved.cue && (
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-text-muted">Watch for</dt>
              <dd className="text-text-secondary">{saved.cue}</dd>
            </div>
          )}
          {saved.success_signal && (
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-text-muted">Success</dt>
              <dd className="text-text-secondary">{saved.success_signal}</dd>
            </div>
          )}
        </dl>
      )}

      {changed && <p className="mt-2 text-[10px] text-text-muted">Note changed since saved</p>}

      <div className="mt-auto pt-3 flex items-center gap-2 min-w-0">
        <span className="text-[11px] text-text-muted truncate" title={saved.source_title ?? undefined}>
          {saved.source_title ?? 'Source guide removed'}
        </span>
        {jump && (
          <Link
            to={jump}
            title="Open the guide at this drill's moment"
            className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-val-cyan/10 border border-val-cyan/20 text-val-cyan font-stats text-[10px] whitespace-nowrap hover:bg-val-cyan/20 transition-colors"
          >
            <Play className="w-3 h-3" />
            {sourceLabel(saved)}
          </Link>
        )}
      </div>
    </article>
  )
}
