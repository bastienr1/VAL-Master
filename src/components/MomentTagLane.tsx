import { useMemo } from 'react'
import { hexWithAlpha } from '../lib/tagColors'
import type { MomentTag, ReviewTag } from '../lib/types'

/**
 * A thin lane of coloured dots, one per tagged moment, under a review timeline.
 *
 * Mounted on both surfaces. It renders nothing when the review has no moment
 * tags — a lane with no data is just a bar that makes the timeline taller, and
 * both timelines already have the same rule about only showing lanes that carry
 * something.
 */

interface MomentTagLaneProps {
  moments: MomentTag[]
  /** Vocabulary, for colour and name lookup. */
  tags: ReviewTag[]
  duration: number
  onSeek: (seconds: number) => void
  /** When set, moments on other tags are dimmed rather than hidden. */
  activeTagId?: string | null
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function MomentTagLane({
  moments,
  tags,
  duration,
  onSeek,
  activeTagId,
}: MomentTagLaneProps) {
  const tagsById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags])

  if (moments.length === 0 || duration <= 0) return null

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] uppercase tracking-wider text-text-muted">Tagged moments</span>
        <span className="font-stats text-[9px] text-text-muted ml-auto">{moments.length}</span>
      </div>

      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-bg-elevated" />

        {moments.map(moment => {
          const tag = tagsById.get(moment.tag_id)
          const color = tag?.color ?? '#94A3B8'
          const pct = Math.min(100, Math.max(0, (moment.video_ts / duration) * 100))
          const dimmed = !!activeTagId && moment.tag_id !== activeTagId

          return (
            <button
              key={moment.id}
              type="button"
              onClick={() => onSeek(moment.video_ts)}
              title={`${tag?.name ?? 'Tag'} · ${formatTime(moment.video_ts)}`}
              style={{
                left: `${pct}%`,
                backgroundColor: color,
                borderColor: hexWithAlpha(color, 0.4),
                opacity: dimmed ? 0.25 : 1,
              }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border-2 hover:scale-150 transition-transform"
            />
          )
        })}
      </div>
    </div>
  )
}
