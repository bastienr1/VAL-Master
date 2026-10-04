import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Crosshair, Gem, Play, Skull, Target, type LucideIcon } from 'lucide-react'
import { blockIcon, type BlockIcon } from '../../lib/improveHub'
import { adherence, goalFor, leftToday, weekRange, type BlockProgress } from '../../lib/weeklyPlan'
import type { WeeklyGoal } from '../../lib/types'

const ICONS: Record<BlockIcon, LucideIcon> = {
  crosshair: Crosshair,
  skull: Skull,
  bars: BarChart3,
  rank: Gem,
  play: Play,
  target: Target,
}

interface PlanSummaryProps {
  /** Monday of the running week. */
  week: string
  today: string
  /** This week's active blocks, as `/plan` counts them. */
  progress: BlockProgress[]
  goals: WeeklyGoal[]
  /** `profiles.weekly_goal`; blank leaves the line out. */
  headline: string
}

/**
 * This week on the Weekly Plan, read-only: the count and what is left today on
 * the left, each block with its focus on the right. Ticking happens on `/plan`.
 */
export default function PlanSummary({ week, today, progress, goals, headline }: PlanSummaryProps) {
  if (progress.length === 0) {
    return (
      <Link
        to="/plan"
        className="group flex items-center justify-between gap-3 bg-bg-card border border-dashed border-bg-elevated rounded-xl px-5 py-5 text-sm text-text-secondary hover:border-val-cyan/50 hover:text-val-cyan transition-colors"
      >
        Build your routine
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </Link>
    )
  }

  const total = adherence(progress)
  const percent = Math.round(total.ratio * 100)
  const left = leftToday(progress, today).map(block => block.name)
  const goal = headline.trim()

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-xl grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="p-5 sm:p-6 space-y-3 border-b md:border-b-0 md:border-r border-bg-elevated">
        <div className="text-[11px] uppercase tracking-widest text-text-secondary">{weekRange(week)}</div>
        <div className="font-stats text-4xl font-medium leading-none">
          {total.done} / {total.planned}
          <span className="text-2xl text-val-cyan"> · {percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Sessions done this week"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 rounded-full bg-bg-elevated overflow-hidden"
        >
          {/* A width from data has no class. */}
          <div className="h-full rounded-full bg-val-cyan" style={{ width: `${percent}%` }} />
        </div>
        {goal && <p className="text-sm text-text-primary">{goal}</p>}
        <p className="text-xs text-text-secondary">
          {left.length > 0 ? `Left today: ${left.join(', ')}` : 'Done for today'}
        </p>
      </div>

      <ul className="p-5 sm:p-6 divide-y divide-bg-elevated">
        {progress.map(row => {
          const Icon = ICONS[blockIcon(row.block.name)]
          const focus = goalFor(goals, row.block.id, week)?.focus_text ?? null
          return (
            <li
              key={row.block.id}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:grid-cols-[1.25rem_9rem_3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0"
            >
              <Icon className="w-4 h-4 text-text-secondary" aria-hidden="true" />
              <span className="font-heading font-bold uppercase tracking-wide text-sm truncate">{row.block.name}</span>
              <span
                className={`font-stats text-xs whitespace-nowrap ${row.done >= row.target ? 'text-val-green' : 'text-text-secondary'}`}
              >
                {row.done} / {row.target}
              </span>
              <span
                className={`col-start-2 col-span-2 sm:col-start-auto sm:col-span-1 text-xs truncate ${focus ? 'text-text-secondary' : 'text-text-muted'}`}
                title={focus ?? undefined}
              >
                {focus ?? 'No focus set'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
