import { Link } from 'react-router-dom'
import { BookOpen, Video } from 'lucide-react'
import { mapImageFor } from '../lib/gameContent'
import type { PlaybookWithCount } from '../lib/types'
import GameImage from './GameImage'

/**
 * A playbook as a card that opens its reader. Built to sit beside `ReviewCard`
 * on a Map Hub shelf: same height, same splash treatment, same text positions.
 */
export default function PlaybookCard({ playbook }: { playbook: PlaybookWithCount }) {
  const subLine = [
    playbook.agent,
    `${playbook.chapter_count} chapter${playbook.chapter_count === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      to={`/playbook/${playbook.slug}`}
      // Names truncate to one line; the full one stays in the tooltip.
      title={playbook.name}
      className="group block bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all"
    >
      <div className="relative h-28">
        <GameImage
          kind="map"
          src={mapImageFor({ map: playbook.map })}
          alt={playbook.map}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

        {playbook.side && (
          <span className="absolute top-2 left-3 px-1.5 py-0.5 rounded bg-bg-primary/70 text-text-secondary text-[10px] font-medium uppercase tracking-wider">
            {playbook.side}
          </span>
        )}
        {playbook.video_url && (
          <span className="absolute top-2 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded bg-val-yellow/15 text-val-yellow text-[10px] font-medium">
            <Video className="w-3 h-3" />
            Video
          </span>
        )}

        <div className="absolute bottom-2 left-3 right-3 flex items-center gap-2 min-w-0">
          <div className="w-10 h-10 rounded-full border-2 border-bg-card bg-bg-elevated flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-val-cyan" />
          </div>
          <div className="min-w-0">
            <div className="font-heading font-bold text-base leading-tight text-text-primary truncate">
              {playbook.name}
            </div>
            <div className="text-[11px] text-text-secondary truncate">{subLine}</div>
          </div>
        </div>
      </div>
    </Link>
  )
}
