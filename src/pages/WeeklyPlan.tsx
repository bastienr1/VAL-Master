import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarCheck, ChevronLeft, ChevronRight, Flame, SlidersHorizontal } from 'lucide-react'
import PlanBlockRow, { PLAN_ROW_GRID } from '../components/PlanBlockRow'
import BlockEditor from '../components/BlockEditor'
import WeekTrend from '../components/WeekTrend'
import { useResource } from '../hooks/useResource'
import { useProfile } from '../lib/profile'
import { savedDrillsResource } from '../lib/savedDrills'
import {
  SEED_BLOCKS,
  TREND_WEEKS,
  addWeeks,
  adherence,
  averageRating,
  goalFor,
  isDate,
  localDate,
  shortDate,
  streak,
  weekDays,
  weekProgress,
  weekRange,
  weekStart,
  weekdayShort,
} from '../lib/weeklyPlan'
import { createSeedBlocks, planResource } from '../lib/weeklyPlanStore'
import type { SavedDrill } from '../lib/types'

const NO_SAVED: SavedDrill[] = []

const arrowClass =
  'w-8 h-8 rounded-md border border-bg-elevated flex items-center justify-center text-text-secondary hover:border-val-cyan/50 hover:text-val-cyan transition-colors'
const arrowDisabled =
  'w-8 h-8 rounded-md border border-bg-elevated flex items-center justify-center text-text-muted opacity-40 cursor-not-allowed'

interface HeadlineProps {
  value: string
  onSave: (next: string) => Promise<void>
}

/** `profiles.weekly_goal`, edited in place: Enter or blur saves, Escape cancels. */
function Headline({ value, onSave }: HeadlineProps) {
  // null while not editing, so the field follows the profile.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  return (
    <input
      type="text"
      value={draft ?? value}
      aria-label="This week's headline"
      placeholder="This week's headline"
      onFocus={() => {
        cancelled.current = false
        setDraft(value)
      }}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        const next = (draft ?? value).trim()
        if (cancelled.current || next === value) setDraft(null)
        // Keep showing the typed text until the profile has it.
        else onSave(next).finally(() => setDraft(null))
      }}
      className="w-full bg-transparent border-b border-transparent hover:border-bg-elevated focus:border-val-cyan/50 focus:outline-none py-1 font-heading text-xl font-bold tracking-wide text-text-primary placeholder:text-text-muted placeholder:font-normal transition-colors"
    />
  )
}

/**
 * `/plan` — the routine and the week's goals, read together.
 *
 * A block is what you do, its focus is what you work on while doing it. The
 * week in view lives in the URL; past weeks are read-only apart from ratings
 * and notes. All the counting is in `weeklyPlan.ts`.
 */
export default function WeeklyPlan() {
  const { data, loading, error } = useResource(planResource)
  const savedDrills = useResource(savedDrillsResource).data ?? NO_SAVED
  const { profile, save } = useProfile()
  const [searchParams] = useSearchParams()

  const [now] = useState(() => new Date())
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const timeZone = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = localDate(now, timeZone)
  const currentStart = weekStart(today)
  // As far back as the plan is loaded for, which is as far as the trend goes.
  const oldestStart = addWeeks(currentStart, -(TREND_WEEKS - 1))

  const requested = searchParams.get('week') ?? ''
  const requestedStart = isDate(requested) ? weekStart(requested) : ''
  const week = requestedStart >= oldestStart && requestedStart <= currentStart ? requestedStart : currentStart
  const isCurrentWeek = week === currentStart
  const lastWeek = addWeeks(week, -1)
  const days = useMemo(() => weekDays(week), [week])

  const run = useCallback(async (action: () => Promise<unknown>, what: string) => {
    setNotice(null)
    try {
      const result = await action()
      // A write that went through with a caveat says so in words.
      if (typeof result === 'string') setNotice(result)
    } catch (err) {
      setNotice(`Couldn't ${what} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const progress = useMemo(() => (data ? weekProgress(data.blocks, data.logs, week) : []), [data, week])
  const total = adherence(progress)
  const streakWeeks = useMemo(
    () => (data ? streak(data.blocks, data.logs, currentStart) : 0),
    [data, currentStart],
  )

  if (loading && data === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const weekLink = (start: string) => (start === currentStart ? '/plan' : `/plan?week=${start}`)
  const hasBlocks = data !== null && data.blocks.length > 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-val-cyan" aria-hidden="true" />
          <h1 className="font-heading text-xl font-bold tracking-wide">Weekly Plan</h1>
        </div>

        <div className="flex items-center gap-2">
          {week > oldestStart ? (
            <Link to={weekLink(lastWeek)} aria-label="Previous week" title="Previous week" className={arrowClass}>
              <ChevronLeft className="w-4 h-4" />
            </Link>
          ) : (
            <span aria-disabled="true" title="No earlier weeks" className={arrowDisabled}>
              <ChevronLeft className="w-4 h-4" />
            </span>
          )}
          <span className="font-heading text-base font-bold tracking-wide min-w-[9rem] text-center">
            {weekRange(week)}
          </span>
          {isCurrentWeek ? (
            <span aria-disabled="true" title="This is the current week" className={arrowDisabled}>
              <ChevronRight className="w-4 h-4" />
            </span>
          ) : (
            <Link to={weekLink(addWeeks(week, 1))} aria-label="Next week" title="Next week" className={arrowClass}>
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>

        <div className="flex items-center gap-4">
          {total.planned > 0 && (
            <span className="font-stats text-sm text-text-primary">
              {total.done} / {total.planned}
              <span className="text-val-cyan"> · {Math.round(total.ratio * 100)}%</span>
            </span>
          )}
          {streakWeeks > 0 && (
            <span
              className="inline-flex items-center gap-1 font-stats text-sm text-val-yellow"
              title="Consecutive weeks at 80% or more"
            >
              <Flame className="w-4 h-4" aria-hidden="true" />
              {streakWeeks}-week streak
            </span>
          )}
          {hasBlocks && (
            <button
              type="button"
              onClick={() => setEditing(open => !open)}
              aria-expanded={editing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary border border-bg-elevated hover:border-val-cyan/50 hover:text-val-cyan transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Edit routine
            </button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div role="alert" className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          {notice ?? `Couldn't load the plan — ${error}`}
        </div>
      )}

      {data !== null && (
        <>
          <Headline
            value={profile.weekly_goal}
            onSave={next =>
              run(async () => {
                const res = await save({ weekly_goal: next })
                if (res.error) throw new Error(res.error)
              }, 'save the headline')
            }
          />

          {editing && <BlockEditor blocks={data.blocks} run={run} onClose={() => setEditing(false)} />}

          {!hasBlocks && !editing ? (
            <section className="bg-bg-card border border-bg-elevated rounded-xl p-8 space-y-5">
              <div>
                <h2 className="font-heading text-xl font-bold tracking-wide">Start with a routine</h2>
                <p className="text-sm text-text-secondary mt-1">
                  A routine is a short list of blocks, each with a number of sessions a week. Tick a block on the days
                  you do it.
                </p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {SEED_BLOCKS.map(seed => (
                  <li
                    key={seed.name}
                    className="rounded-lg border border-bg-elevated bg-bg-secondary px-3 py-1.5 text-sm text-text-primary"
                  >
                    {seed.name} <span className="font-stats text-xs text-text-muted">×{seed.weeklyTarget}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => run(() => createSeedBlocks(), 'create the starter routine')}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-val-cyan/10 text-val-cyan border border-val-cyan/20 hover:bg-val-cyan/20 transition-colors"
                >
                  Use the starter routine
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 rounded-lg text-sm text-text-secondary border border-bg-elevated hover:border-val-cyan/50 hover:text-text-primary transition-colors"
                >
                  Start empty
                </button>
              </div>
            </section>
          ) : progress.length === 0 ? (
            hasBlocks && (
              <p className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">
                {isCurrentWeek
                  ? 'Every block is archived. Restore one or add a new one under Edit routine.'
                  : 'No blocks in the routine that week.'}
              </p>
            )
          ) : (
            <div className="bg-bg-card border border-bg-elevated rounded-xl overflow-x-auto">
              <div className="min-w-[40rem]">
                <div className={`${PLAN_ROW_GRID} items-end py-3 text-[10px] uppercase tracking-wider text-text-muted`}>
                  <div className="sticky left-0 z-10 bg-bg-card">Block</div>
                  {days.map(day => (
                    <div
                      key={day}
                      aria-current={day === today ? 'date' : undefined}
                      className={`text-center leading-tight ${day === today ? 'text-val-cyan' : ''}`}
                    >
                      <div className="font-medium">{weekdayShort(day)}</div>
                      <div className="normal-case tracking-normal">{shortDate(day)}</div>
                    </div>
                  ))}
                </div>
                {progress.map(row => {
                  const lastGoal = goalFor(data.goals, row.block.id, lastWeek)
                  return (
                    <PlanBlockRow
                      key={row.block.id}
                      progress={row}
                      week={week}
                      days={days}
                      today={today}
                      isCurrentWeek={isCurrentWeek}
                      goal={goalFor(data.goals, row.block.id, week)}
                      lastGoal={lastGoal}
                      lastAverage={lastGoal ? averageRating(data.logs, row.block.id, lastWeek) : null}
                      logs={data.logs.filter(log => log.block_id === row.block.id && days.includes(log.logged_on))}
                      saved={savedDrills}
                      run={run}
                    />
                  )
                })}
              </div>
            </div>
          )}

          <WeekTrend blocks={data.blocks} goals={data.goals} logs={data.logs} currentStart={currentStart} week={week} />
        </>
      )}
    </div>
  )
}
