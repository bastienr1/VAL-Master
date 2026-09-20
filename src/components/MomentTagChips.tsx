import { X } from 'lucide-react'
import { hexWithAlpha } from '../lib/tagColors'
import type { MomentTag, ReviewTag } from '../lib/types'

/**
 * The moment-tag chips on a note card, on both surfaces.
 *
 * Removing a chip removes the tag application only — never the note it was
 * captured with. The two are separate rows and separate decisions: a note can
 * outlive every tag on it.
 */

interface MomentTagChipsProps {
  /** Already filtered to one note, or to one moment. */
  moments: MomentTag[]
  tags: ReviewTag[]
  onRemove?: (moment: MomentTag) => void
}

export default function MomentTagChips({ moments, tags, onRemove }: MomentTagChipsProps) {
  if (moments.length === 0) return null

  const tagsById = new Map(tags.map(t => [t.id, t]))

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {moments.map(moment => {
        const tag = tagsById.get(moment.tag_id)
        if (!tag) return null

        return (
          <span
            key={moment.id}
            style={{
              backgroundColor: hexWithAlpha(tag.color, 0.12),
              color: tag.color,
              borderColor: hexWithAlpha(tag.color, 0.3),
            }}
            className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[10px] font-medium"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
            {tag.name}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(moment)}
                title={`Remove ${tag.name} from this moment`}
                className="opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
