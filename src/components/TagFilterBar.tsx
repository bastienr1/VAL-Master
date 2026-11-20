import { hexWithAlpha } from '../lib/tagColors'
import { isFiltering, NO_TAG_FILTER, toggleTag, type TagFilter } from '../lib/tagFilter'
import type { ReviewTag } from '../lib/types'

interface TagFilterBarProps {
  /** The tags applied in this review: only those get a chip. */
  tags: ReviewTag[]
  filter: TagFilter
  onChange: (filter: TagFilter) => void
  className?: string
}

/**
 * The tag chips above a review's notes, on both surfaces. Any number can be on
 * at once. With two or more, a switch says whether a moment has to carry all of
 * them (kills on B on defence) or any of them (every kill and every death).
 */
export default function TagFilterBar({ tags, filter, onChange, className = 'flex flex-wrap items-center gap-1.5 px-1' }: TagFilterBarProps) {
  if (tags.length === 0) return null
  return (
    <div className={className} role="group" aria-label="Filter by tag">
      {tags.map(tag => {
        const active = filter.ids.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onChange(toggleTag(filter, tag.id))}
            aria-pressed={active}
            style={
              active
                ? {
                    backgroundColor: hexWithAlpha(tag.color, 0.12),
                    color: tag.color,
                    borderColor: hexWithAlpha(tag.color, 0.3),
                  }
                : undefined
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
              active ? '' : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
            {tag.name}
          </button>
        )
      })}
      {filter.ids.length > 1 && (
        <span className="inline-flex rounded-full border border-bg-elevated overflow-hidden text-[10px]" role="group" aria-label="Match">
          {(['all', 'any'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...filter, mode })}
              aria-pressed={filter.mode === mode}
              title={mode === 'all' ? 'Moments that carry every chosen tag' : 'Moments that carry at least one chosen tag'}
              className={`px-2 py-0.5 transition-colors ${
                filter.mode === mode ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {mode}
            </button>
          ))}
        </span>
      )}
      {isFiltering(filter) && (
        <button
          type="button"
          onClick={() => onChange({ ...NO_TAG_FILTER, mode: filter.mode })}
          className="text-[10px] text-text-muted hover:text-val-cyan transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  )
}
