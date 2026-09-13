import { forwardRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { mapImageFor } from '../lib/gameContent'
import GameImage from './GameImage'

interface PlaybookMapCardProps {
  map: string
  playbookCount: number
  matchCount: number
  /** When playbookCount === 1 the card routes straight to this playbook. */
  firstPlaybookSlug: string | null
  highlighted?: boolean
  /** Called for maps with more than one playbook. */
  onSelectMap: (map: string) => void
}

const PlaybookMapCard = forwardRef<HTMLButtonElement, PlaybookMapCardProps>(function PlaybookMapCard(
  { map, playbookCount, matchCount, firstPlaybookSlug, highlighted = false, onSelectMap },
  ref,
) {
  const navigate = useNavigate()
  const empty = playbookCount === 0

  const handleClick = () => {
    if (playbookCount === 1 && firstPlaybookSlug) navigate(`/playbook/${firstPlaybookSlug}`)
    else if (playbookCount > 1) onSelectMap(map)
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      disabled={empty}
      className={`group relative aspect-[3/2] w-full rounded-xl overflow-hidden border bg-bg-card text-left transition-colors ${
        highlighted ? 'border-val-cyan' : 'border-bg-elevated'
      } ${empty ? 'cursor-default' : 'hover:border-val-cyan'}`}
    >
      <GameImage
        kind="map"
        src={mapImageFor({ map })}
        alt={map}
        className={`absolute inset-0 w-full h-full object-cover transition-[filter] ${
          empty ? 'brightness-[0.3]' : 'brightness-[0.4] group-hover:brightness-50'
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-bg-primary/80 via-transparent to-transparent" />

      {!empty && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-primary/70 border border-val-cyan/25 text-val-cyan text-xs font-stats">
          <BookOpen className="w-3 h-3" />
          {playbookCount}
        </div>
      )}

      <div className="absolute bottom-2 left-3 font-heading text-lg text-text-primary">{map}</div>
      <div className="absolute bottom-2.5 right-3 text-xs">
        {empty ? (
          <span className="text-val-yellow/70">No playbooks yet</span>
        ) : (
          <span className="text-text-muted">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </span>
        )}
      </div>
    </button>
  )
})

export default PlaybookMapCard
