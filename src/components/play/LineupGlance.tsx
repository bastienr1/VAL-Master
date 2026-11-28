import { Link } from 'react-router-dom'
import { ArrowUpRight, X } from 'lucide-react'
import { IMAGE_SLOT_LABELS, LINEUP_IMAGE_SLOTS, PURPOSE_LABELS, boardLink, imageColumn, recipeLine, type Lineup } from '../../lib/lineupModel'
import { lineupImageUrl } from '../../lib/lineups'
import AgentIcon from './AgentIcon'

interface LineupGlanceProps {
  /** The line-up the selected throw was added from; null when it is no longer in the library. */
  lineup: Lineup | null
  /** The throw's own label, for a line-up that is gone. */
  label: string
  loading: boolean
  abilityIcon?: string
  onClose(): void
}

/**
 * How to throw the selected line-up, over the map's corner (§2.32): its
 * pictures, recipe and note, and the way to its card on the board. Read only;
 * the line-up is edited on the board.
 */
export default function LineupGlance({ lineup, label, loading, abilityIcon, onClose }: LineupGlanceProps) {
  const head = (
    <div className="flex items-center gap-2">
      {lineup && <AgentIcon name={lineup.agent} size={22} />}
      {abilityIcon && <img src={abilityIcon} alt="" className="w-5 h-5 object-contain shrink-0" />}
      <span className="min-w-0 flex-1 text-xs font-semibold text-text-primary truncate" title={lineup?.title ?? label}>
        {lineup?.title ?? label}
      </span>
      <button type="button" onClick={onClose} aria-label="Close the line-up" title="Close" className="p-1 rounded-md text-text-muted hover:text-text-secondary">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )

  if (!lineup) {
    return (
      <div role="dialog" aria-label="Line-up" className="w-[min(300px,calc(100vw-24px))] rounded-xl border border-bg-elevated bg-bg-card/95 backdrop-blur shadow-lg p-3 space-y-1.5">
        {head}
        <p className="text-[11px] text-text-muted">{loading ? 'Loading the line-up…' : 'This line-up is no longer in your library. The strat keeps its throw.'}</p>
      </div>
    )
  }

  const pictures = LINEUP_IMAGE_SLOTS.map(slot => ({ slot, path: lineup[imageColumn(slot)] })).filter(p => p.path)
  const recipe = recipeLine(lineup)
  const where = [lineup.stand_callout, lineup.land_callout].filter(Boolean).join(' → ')
  const facts = [lineup.purpose ? PURPOSE_LABELS[lineup.purpose] : null, where || null].filter(Boolean).join(' · ')

  return (
    <div role="dialog" aria-label={`Line-up: ${lineup.title}`} className="w-[min(300px,calc(100vw-24px))] max-h-[min(420px,70vh)] overflow-y-auto rounded-xl border border-bg-elevated bg-bg-card/95 backdrop-blur shadow-lg p-3 space-y-2">
      {head}
      {facts && <p className="text-[11px] text-text-secondary">{facts}</p>}
      {pictures.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {pictures.map(({ slot, path }) => (
            <a key={slot} href={lineupImageUrl(path as string)} target="_blank" rel="noreferrer" title={`${IMAGE_SLOT_LABELS[slot].title}: ${IMAGE_SLOT_LABELS[slot].hint}`} className="block">
              <img src={lineupImageUrl(path as string)} alt={IMAGE_SLOT_LABELS[slot].title} loading="lazy" className="w-full aspect-video object-cover rounded-md border border-bg-elevated" />
              <span className="block mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">{IMAGE_SLOT_LABELS[slot].title}</span>
            </a>
          ))}
        </div>
      )}
      <div className="space-y-0.5">
        <div className="text-[10px] uppercase tracking-widest text-text-secondary">How to throw it</div>
        <p className="text-xs text-text-primary">{recipe || 'No recipe written yet.'}</p>
      </div>
      {lineup.note && <p className="text-xs text-text-secondary whitespace-pre-line">{lineup.note}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px]">
        {lineup.video_url && (
          <a href={lineup.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-secondary hover:text-val-cyan">
            Watch the clip <ArrowUpRight className="w-3 h-3" />
          </a>
        )}
        <Link to={boardLink({ id: lineup.id })} className="inline-flex items-center gap-1 text-val-cyan hover:underline">
          Open line-up <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}
