import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink } from 'lucide-react'
import FocusPicker from './FocusPicker'
import { longDate, type BlockProgress } from '../lib/weeklyPlan'
import {
  clearGoal,
  isPending,
  linkFromGoal,
  setGoal,
  tick,
  untick,
  updateLog,
} from '../lib/weeklyPlanStore'
import type { BlockLog, SavedDrill, WeeklyGoal } from '../lib/types'

/** Column template shared by the grid's header and every row: name, then Mon–Sun. */
export const PLAN_ROW_GRID = 'grid grid-cols-[minmax(13rem,1fr)_repeat(7,3rem)] gap-x-1 px-4'

const RATINGS = [1, 2, 3, 4, 5]

interface CheckInPanelProps {
  log: BlockLog
  /** The rating is about the week's focus, so it is offered only when there is one. */
  hasGoal: boolean
  canRemove: boolean
  onRate: (rating: number) => void
  onNote: (note: string) => void
  onRemove: () => void
}

function CheckInPanel({ log, hasGoal, canRemove, onRate, onNote, onRemove }: CheckInPanelProps) {
  // Still on its way to the database: there is no row to rate yet.
  const pending = isPending(log)

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-bg-elevated bg-bg-secondary p-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="text-xs text-text-secondary">{longDate(log.logged_on)}</span>

        {hasGoal && (
          <div className="flex items-center gap-1.5" role="group" aria-label="How well the focus held, 1 to 5">
            {RATINGS.map(rating => (
              <button
                key={rating}
                type="button"
                aria-pressed={log.rating === rating}
                disabled={pending}
                onClick={() => {
                  if (log.rating !== rating) onRate(rating)
                }}
                className={`w-8 h-8 rounded-md border font-stats text-sm transition-colors disabled:opacity-50 ${
                  log.rating === rating
                    ? 'border-val-cyan bg-val-cyan/15 text-val-cyan'
                    : 'border-bg-elevated text-text-secondary hover:border-val-cyan/50'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
        )}

        <input
          key={`${log.id}:${log.note ?? ''}`}
          type="text"
          defaultValue={log.note ?? ''}
          disabled={pending}
          aria-label="Note"
          placeholder="One line on how it went"
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={e => {
            if (e.target.value.trim() !== (log.note ?? '')) onNote(e.target.value)
          }}
          className="flex-1 min-w-[12rem] bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors disabled:opacity-50"
        />

        {canRemove && (
          <button
            type="button"
            disabled={pending}
            onClick={onRemove}
            className="text-xs text-val-red hover:underline disabled:opacity-50"
          >
            Remove check-in
          </button>
        )}
      </div>
    </div>
  )
}

interface PlanBlockRowProps {
  progress: BlockProgress
  /** Monday of the week in view, and its seven dates. */
  week: string
  days: string[]
  today: string
  /** Past weeks are read-only apart from ratings and notes. */
  isCurrentWeek: boolean
  goal: WeeklyGoal | null
  /** Last week's goal and its average rating, for the Keep / New focus prompt. */
  lastGoal: WeeklyGoal | null
  lastAverage: number | null
  /** This block's check-ins in the week in view. */
  logs: BlockLog[]
  saved: SavedDrill[]
  /** Runs a write; a failure, or a message it returns, goes to the page's error line. */
  run: (action: () => Promise<unknown>, what: string) => void
}

/** One block of the routine for one week: its focus, and seven day cells to tick. */
export default function PlanBlockRow({
  progress,
  week,
  days,
  today,
  isCurrentWeek,
  goal,
  lastGoal,
  lastAverage,
  logs,
  saved,
  run,
}: PlanBlockRowProps) {
  const { block, done, target } = progress
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const logByDay = new Map(logs.map(log => [log.logged_on, log]))
  const openLog = openDay ? (logByDay.get(openDay) ?? null) : null

  const expanded = openDay !== null || picking
  useEffect(() => {
    if (!expanded) return
    const close = () => {
      setOpenDay(null)
      setPicking(false)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded])

  const onCell = (day: string) => {
    const log = logByDay.get(day)
    setPicking(false)
    if (!log) {
      run(() => tick(block.id, day), 'save the check-in')
      setOpenDay(goal ? day : null)
      return
    }
    // With no focus and nothing written on it, a tick is a plain toggle.
    if (isCurrentWeek && !goal && log.rating === null && !log.note) {
      if (!isPending(log)) run(() => untick(log.id), 'remove the check-in')
      setOpenDay(null)
      return
    }
    setOpenDay(open => (open === day ? null : day))
  }

  const openPicker = () => {
    setOpenDay(null)
    setPicking(true)
  }

  const guideLink =
    goal && goal.saved_drill_id && goal.source_review_id
      ? `/study/${goal.source_review_id}${goal.source_start_seconds !== null ? `?t=${goal.source_start_seconds}` : ''}`
      : null

  const showPrompt = isCurrentWeek && !goal && lastGoal !== null && !picking

  return (
    <div ref={rowRef} className="border-t border-bg-elevated">
      <div className={`${PLAN_ROW_GRID} items-center py-3`}>
        <div className="sticky left-0 z-10 bg-bg-card pr-3 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-heading text-base font-bold tracking-wide truncate">{block.name}</span>
            <span className={`font-stats text-xs shrink-0 ${done >= target ? 'text-val-green' : 'text-text-secondary'}`}>
              {done} / {target}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs min-w-0">
            {goal ? (
              <>
                {isCurrentWeek ? (
                  <button
                    type="button"
                    onClick={openPicker}
                    title={goal.focus_text}
                    className="truncate text-left text-text-secondary hover:text-val-cyan transition-colors"
                  >
                    {goal.focus_text}
                  </button>
                ) : (
                  <span className="truncate text-text-secondary" title={goal.focus_text}>
                    {goal.focus_text}
                  </span>
                )}
                {guideLink && (
                  <Link
                    to={guideLink}
                    className="shrink-0 inline-flex items-center gap-1 text-val-cyan hover:underline"
                  >
                    Open in guide
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </Link>
                )}
              </>
            ) : isCurrentWeek ? (
              !showPrompt && (
                <button type="button" onClick={openPicker} className="text-val-cyan hover:underline">
                  Set focus
                </button>
              )
            ) : (
              <span className="text-text-muted">No focus set</span>
            )}
          </div>
        </div>

        {days.map(day => {
          const log = logByDay.get(day)
          const future = day > today
          const label = `${block.name}, ${longDate(day)}, ${log ? 'done' : 'not done'}`
          return (
            <button
              key={day}
              type="button"
              aria-pressed={log !== undefined}
              aria-label={label}
              title={label}
              disabled={future || (!isCurrentWeek && !log)}
              onClick={() => onCell(day)}
              className={`mx-auto w-9 h-9 rounded-md border flex items-center justify-center font-stats text-sm transition-colors disabled:cursor-not-allowed ${
                log
                  ? 'border-val-cyan bg-val-cyan/15 text-val-cyan'
                  : `text-text-muted enabled:hover:border-val-cyan/50 disabled:opacity-40 ${
                      day === today ? 'border-val-cyan/40' : 'border-bg-elevated'
                    }`
              } ${openDay === day ? 'ring-2 ring-val-cyan/40' : ''}`}
            >
              {log ? (log.rating ?? <Check className="w-4 h-4" aria-hidden="true" />) : null}
            </button>
          )
        })}
      </div>

      {showPrompt && lastGoal && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className="text-text-muted">Last week</span>
          <span className="text-text-secondary">{lastGoal.focus_text}</span>
          {lastAverage !== null && <span className="font-stats text-text-muted">avg {lastAverage.toFixed(1)}</span>}
          <button
            type="button"
            onClick={() =>
              run(
                () => setGoal(block.id, week, { focusText: lastGoal.focus_text, link: linkFromGoal(lastGoal) }),
                'keep the focus',
              )
            }
            className="px-2.5 py-1 rounded-md border border-val-cyan/30 text-val-cyan hover:bg-val-cyan/10 transition-colors"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={openPicker}
            className="px-2.5 py-1 rounded-md border border-bg-elevated text-text-secondary hover:border-val-cyan/50 transition-colors"
          >
            New focus
          </button>
        </div>
      )}

      {picking && (
        <FocusPicker
          blockName={block.name}
          goal={goal}
          saved={saved}
          onSave={(focusText, link) => {
            setPicking(false)
            run(() => setGoal(block.id, week, { focusText, link }), 'save the focus')
          }}
          onClear={
            goal && !isPending(goal)
              ? () => {
                  setPicking(false)
                  run(() => clearGoal(goal.id), 'clear the focus')
                }
              : undefined
          }
          onClose={() => setPicking(false)}
        />
      )}

      {openLog && (
        <CheckInPanel
          log={openLog}
          hasGoal={goal !== null}
          canRemove={isCurrentWeek}
          onRate={rating => run(() => updateLog(openLog.id, { rating, note: openLog.note }), 'save the rating')}
          onNote={note => run(() => updateLog(openLog.id, { rating: openLog.rating, note }), 'save the note')}
          onRemove={() => {
            setOpenDay(null)
            run(() => untick(openLog.id), 'remove the check-in')
          }}
        />
      )}
    </div>
  )
}
