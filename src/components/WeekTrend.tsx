import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  STREAK_THRESHOLD,
  averageRating,
  goalFor,
  shortDate,
  trendWeeks,
  weekProgress,
  weekRange,
} from '../lib/weeklyPlan'
import type { BlockLog, RoutineBlock, WeeklyGoal } from '../lib/types'

interface WeekTrendProps {
  blocks: RoutineBlock[]
  goals: WeeklyGoal[]
  logs: BlockLog[]
  /** Monday of the running week. */
  currentStart: string
  /** Monday of the week in view. */
  week: string
}

interface BlockWeek {
  start: string
  focus: string | null
  rating: number | null
  done: number
  target: number
}

/**
 * The last eight weeks: adherence per week as a bar, then per block the focus
 * it had each week beside its average rating. Plain `div`s — the app has no
 * chart on this page to justify a library.
 */
export default function WeekTrend({ blocks, goals, logs, currentStart, week }: WeekTrendProps) {
  const weeks = useMemo(() => trendWeeks(blocks, logs, currentStart), [blocks, logs, currentStart])

  const perBlock = useMemo(() => {
    const rows = new Map<string, { block: RoutineBlock; weeks: BlockWeek[] }>()
    // Newest week first inside each table.
    for (const { start } of [...weeks].reverse()) {
      for (const row of weekProgress(blocks, logs, start)) {
        const entry = rows.get(row.block.id) ?? { block: row.block, weeks: [] }
        entry.weeks.push({
          start,
          focus: goalFor(goals, row.block.id, start)?.focus_text ?? null,
          rating: averageRating(logs, row.block.id, start),
          done: row.done,
          target: row.target,
        })
        rows.set(row.block.id, entry)
      }
    }
    return [...rows.values()].sort((a, b) => a.block.position - b.block.position)
  }, [weeks, blocks, goals, logs])

  if (weeks.length === 0) return null

  const weekLink = (start: string) => (start === currentStart ? '/plan' : `/plan?week=${start}`)

  return (
    <section aria-label="Trend" className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-lg font-bold tracking-wide">Week over week</h2>
        <span className="text-xs text-text-muted">
          Sessions done out of planned · line at {Math.round(STREAK_THRESHOLD * 100)}%
        </span>
      </div>

      <div className="bg-bg-card border border-bg-elevated rounded-xl p-5">
        <div className="relative h-28 flex items-end gap-2">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-[80%] border-t border-dashed border-text-muted/50"
          />
          {weeks.map(row => {
            const percent = Math.round(row.ratio * 100)
            const label = `Week of ${weekRange(row.start)}: ${row.done} / ${row.planned}, ${percent}%`
            return (
              <Link
                key={row.start}
                to={weekLink(row.start)}
                aria-label={label}
                aria-current={row.start === week ? 'true' : undefined}
                title={label}
                className="group relative flex-1 max-w-[4.5rem] h-full flex items-end"
              >
                <div
                  className={`w-full rounded-t transition-colors ${
                    row.ratio >= STREAK_THRESHOLD ? 'bg-val-cyan/70' : 'bg-text-muted/40'
                  } ${row.start === week ? 'outline outline-2 outline-offset-2 outline-val-cyan' : 'group-hover:bg-val-cyan/50'}`}
                  // The one inline style: a height from data has no class.
                  style={{ height: `${Math.max(percent, 3)}%` }}
                />
              </Link>
            )
          })}
        </div>
        <div className="mt-2 flex gap-2" aria-hidden="true">
          {weeks.map(row => (
            <div
              key={row.start}
              className={`flex-1 max-w-[4.5rem] text-center text-[10px] leading-tight ${
                row.start === week ? 'text-val-cyan' : 'text-text-muted'
              }`}
            >
              <div>{shortDate(row.start)}</div>
              <div className="font-stats">{Math.round(row.ratio * 100)}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {perBlock.map(({ block, weeks: blockWeeks }) => (
          <div key={block.id} className="bg-bg-card border border-bg-elevated rounded-xl p-4">
            <h3 className="font-heading text-base font-bold tracking-wide mb-2">
              {block.name}
              {block.archived_at !== null && (
                <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-text-muted">archived</span>
              )}
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                  <th scope="col" className="font-normal py-1 pr-3 w-16">Week</th>
                  <th scope="col" className="font-normal py-1 pr-3">Focus</th>
                  <th scope="col" className="font-normal py-1 pr-3 w-12 text-right">Rating</th>
                  <th scope="col" className="font-normal py-1 w-12 text-right">Done</th>
                </tr>
              </thead>
              <tbody>
                {blockWeeks.map(row => (
                  <tr key={row.start} className="border-t border-bg-elevated">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <Link
                        to={weekLink(row.start)}
                        className={row.start === week ? 'text-val-cyan' : 'text-text-secondary hover:text-val-cyan'}
                      >
                        {shortDate(row.start)}
                      </Link>
                    </td>
                    <td className={`py-1.5 pr-3 ${row.focus ? 'text-text-primary' : 'text-text-muted'}`}>
                      {row.focus ?? 'No focus set'}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-stats text-text-secondary">
                      {row.rating !== null ? row.rating.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 text-right font-stats text-text-secondary whitespace-nowrap">
                      {row.done} / {row.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}
