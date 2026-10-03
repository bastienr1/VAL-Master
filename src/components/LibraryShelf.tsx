import { ChevronRight } from 'lucide-react'
import { formatDuration, type ShelfBlock } from '../lib/libraryShelves'
import type { GuideCounts } from '../lib/referenceReviews'
import ReviewCard, { type ReviewBadge } from './ReviewCard'

interface LibraryShelfProps {
  block: ShelfBlock
  open: boolean
  onToggle: () => void
  counts: Map<string, GuideCounts>
  /** Review ids the user marked watched; drives the check and the "Up next" badge. */
  watched: Set<string>
}

function badgeFor(block: ShelfBlock, reviewId: string, watched: Set<string>): ReviewBadge | null {
  if (watched.has(reviewId)) return 'watched'
  if (block.upNextId === reviewId) return 'up-next'
  return null
}

/**
 * One collapsible shelf of the Pro Study library — a series, a skill group, a
 * map, or one of the catch-alls — with its sections and their card grids.
 *
 * Closed by default and remembered by the page: the two coaching series alone
 * are fifty cards, and the header already says what is inside. The same
 * `ReviewCard` as the flat grid, so a guide looks the same wherever it sits.
 * A series header also says how far through it the user is.
 */
export default function LibraryShelf({ block, open, onToggle, counts, watched }: LibraryShelfProps) {
  const { videos, durationSeconds, drills } = block.stats
  const stats = [
    `${videos} video${videos === 1 ? '' : 's'}`,
    formatDuration(durationSeconds),
    drills > 0 ? `${drills} drill${drills === 1 ? '' : 's'}` : '',
    block.watched ? `${block.watched} of ${videos} watched` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-elevated/40 transition-colors rounded-xl"
      >
        <ChevronRight
          className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-heading font-bold text-base tracking-wide truncate">{block.title}</span>
        <span className="font-stats text-xs text-text-muted ml-auto shrink-0">{stats}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {block.sections.map(section => (
            <div key={section.key} className="space-y-2">
              {section.title && (
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
                  <span>{section.title}</span>
                  <span className="font-stats">{section.reviews.length}</span>
                </div>
              )}
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {section.reviews.map(review => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    counts={counts.get(review.id)}
                    badge={badgeFor(block, review.id, watched)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
