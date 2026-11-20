import MomentTagChips from './MomentTagChips'
import type { LooseMoment } from '../lib/tagFilter'
import type { MomentTag, ReviewTag } from '../lib/types'
import { formatTime } from '../lib/youtube'

interface LooseMomentListProps {
  /** Tagged seconds that belong to no note, already filtered, in tape order. */
  groups: Array<LooseMoment<MomentTag> & { label?: string }>
  tags: ReviewTag[]
  onSeek: (seconds: number) => void
  onRemoveMomentTag: (moment: MomentTag) => void
}

/**
 * The tagged moments that have no note: a quick-drop, or the kills and deaths
 * the match report tags. Each is a time to jump to and the tags on it. They are
 * listed only under a tag filter; without one, the notes are the list and these
 * stay on the timeline lane.
 */
export default function LooseMomentList({ groups, tags, onSeek, onRemoveMomentTag }: LooseMomentListProps) {
  if (groups.length === 0) return null
  // Every row shows its tags in the vocabulary's order, so the rows read as a column.
  const order = new Map(tags.map((tag, i) => [tag.id, i]))
  const inOrder = (moments: MomentTag[]) => [...moments].sort((a, b) => (order.get(a.tag_id) ?? 0) - (order.get(b.tag_id) ?? 0))
  return (
    <div>
      <p className="px-1 mb-1 text-[10px] uppercase tracking-wider text-text-muted">
        Tagged moments without a note <span className="font-stats">{groups.length}</span>
      </p>
      <ul className="space-y-0.5">
        {groups.map(group => (
          <li key={group.videoTs} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 rounded-md bg-bg-card border border-bg-elevated">
            <button
              type="button"
              onClick={() => onSeek(group.videoTs)}
              title="Jump to this moment"
              className="font-stats text-[11px] text-val-cyan hover:underline w-10 shrink-0 text-left"
            >
              {formatTime(group.videoTs)}
            </button>
            {group.label && <span className="font-stats text-[10px] text-text-muted w-7 shrink-0">{group.label}</span>}
            <MomentTagChips moments={inOrder(group.moments)} tags={tags} onRemove={onRemoveMomentTag} className="flex flex-wrap gap-1" />
          </li>
        ))}
      </ul>
    </div>
  )
}
