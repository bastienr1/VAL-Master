import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import ArtSlot from '../ArtSlot'
import { SLOT_KEYS } from '../../lib/artSlots'

const GOAL_FALLBACK = 'Build your next milestone.'

interface FeatureTilesProps {
  /** The current weekly goal from the profile; blank shows the fallback line. */
  weeklyGoal: string
  /**
   * This week's progress on the Weekly Plan ('9 / 14 this week · Left today:
   * …'), or null with no active block, when the goal text shows instead.
   */
  planLine: string | null
}

/** The four ways onward from Home. Each picture is its own art slot. */
export default function FeatureTiles({ weeklyGoal, planLine }: FeatureTilesProps) {
  const goal = weeklyGoal.trim()

  const tiles = [
    { slot: SLOT_KEYS.tilePlaybook, title: 'Playbook', sub: 'Turn insights into habits.', to: '/playbook' },
    { slot: SLOT_KEYS.tileStats, title: 'Stats', sub: 'Track your growth.', to: '/analytics' },
    { slot: SLOT_KEYS.tileProVod, title: 'Pro VOD', sub: 'Learn from the best.', to: '/study' },
    { slot: SLOT_KEYS.tileGoals, title: 'Goals', sub: planLine ?? (goal || GOAL_FALLBACK), to: '/plan' },
  ]

  return (
    <section aria-label="Sections" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map(tile => (
        <Link
          key={tile.slot}
          to={tile.to}
          className="group block rounded-xl overflow-hidden border border-bg-elevated hover:border-val-cyan/50 outline-none focus-visible:border-val-cyan transition-colors"
        >
          <ArtSlot slotKey={tile.slot} scrim="bottom" className="aspect-[2/1]">
            <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="font-heading font-bold uppercase text-xl leading-tight tracking-wide">{tile.title}</div>
                <div className="text-xs text-text-secondary line-clamp-2" title={tile.sub}>
                  {tile.sub}
                </div>
              </div>
              <span
                aria-hidden="true"
                className="shrink-0 w-8 h-8 rounded-full border border-text-muted/60 flex items-center justify-center text-text-secondary group-hover:border-val-cyan group-hover:text-val-cyan transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </ArtSlot>
        </Link>
      ))}
    </section>
  )
}
