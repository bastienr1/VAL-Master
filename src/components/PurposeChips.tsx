import { purposeCounts, purposeFilterLabel, type Lineup, type PurposeFilter } from '../lib/lineupModel'

const chip = (on: boolean) =>
  `inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors ${
    on ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40' : 'bg-bg-card text-text-secondary border-bg-elevated hover:border-val-cyan/30 hover:text-text-primary'
  }`

/**
 * The purposes of a list of line-ups as a row of chips, each with its count.
 * Press one to see only those; press it again, or All, to see them all.
 * `rows` is the list before it is narrowed, so the counts do not move.
 */
export default function PurposeChips({ rows, value, onPick, className = '' }: {
  rows: ReadonlyArray<Pick<Lineup, 'purpose'>>
  value: PurposeFilter | null
  onPick(value: PurposeFilter | null): void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="group" aria-label="Filter by purpose">
      <button type="button" aria-pressed={value === null} onClick={() => onPick(null)} className={chip(value === null)}>
        <span>All</span>
        <span className="font-stats text-[11px] opacity-80">{rows.length}</span>
      </button>
      {purposeCounts(rows).map(({ purpose, count }) => {
        const on = value === purpose
        return (
          <button key={purpose} type="button" aria-pressed={on} onClick={() => onPick(on ? null : purpose)} className={chip(on)}>
            <span>{purposeFilterLabel(purpose)}</span>
            <span className="font-stats text-[11px] opacity-80">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
