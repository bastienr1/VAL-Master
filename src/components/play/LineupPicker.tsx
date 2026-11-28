import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Plus, X } from 'lucide-react'
import { LINEUP_PURPOSES, PURPOSE_LABELS, recipeLine, type Lineup, type LineupPurpose } from '../../lib/lineupModel'
import { purposesOf } from '../../lib/lineupRecall'
import AgentIcon from './AgentIcon'

interface LineupPickerProps {
  /** The strat's line-ups (same map and side), comp agents first. */
  rows: Lineup[]
  loading: boolean
  /** Why none can be listed (the table is missing, a failed read), or null. */
  problem: string | null
  /** "Bind attack". */
  where: string
  /** How many of each line-up the step already has, by id. */
  counts: Map<string, number>
  /** The ability's icon, when the registry knows it. */
  abilityIcon(agent: string, slot: Lineup['slot']): string | undefined
  onAdd(lineup: Lineup): void
  onClose(): void
  /** The library at this map and side; the board to make a new one. */
  libraryHref: string
  boardHref: string
}

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
    on ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-secondary hover:text-text-primary'
  }`

/**
 * The line-ups of the strat's map and side, to add to the step
 * (docs/plays-editor-v2.md §2.32): a click draws the throw and sends that
 * agent to where they stand. It stays open, so several can be added.
 */
export default function LineupPicker(props: LineupPickerProps) {
  const { rows, loading, problem, where, counts } = props
  const [purpose, setPurpose] = useState<LineupPurpose | null>(null)
  const purposes = purposesOf(rows, LINEUP_PURPOSES)
  // A purpose no line-up has any more (one was deleted) falls back to all.
  const picked = purpose && purposes.some(p => p.purpose === purpose) ? purpose : null
  const shown = picked ? rows.filter(row => row.purpose === picked) : rows

  return (
    <div
      role="dialog"
      aria-label={`Line-ups · ${where}`}
      className="w-[min(340px,calc(100vw-24px))] max-h-[min(460px,70vh)] flex flex-col rounded-xl border border-bg-elevated bg-bg-card/95 backdrop-blur shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-bg-elevated">
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">Line-ups</span>
        <span className="text-xs font-semibold text-text-primary truncate">{where}</span>
        <span className="font-stats text-[11px] text-text-muted">{rows.length}</span>
        <button type="button" onClick={props.onClose} aria-label="Close line-ups" title="Close (Esc)" className="ml-auto p-1 rounded-md text-text-muted hover:text-text-secondary">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {purposes.length > 1 && (
        <div role="group" aria-label="Purpose" className="flex flex-wrap items-center gap-0.5 px-2.5 py-1.5 border-b border-bg-elevated">
          <button type="button" onClick={() => setPurpose(null)} aria-pressed={picked === null} className={chip(picked === null)}>
            All
          </button>
          {purposes.map(p => (
            <button key={p.purpose} type="button" onClick={() => setPurpose(picked === p.purpose ? null : p.purpose)} aria-pressed={picked === p.purpose} className={chip(picked === p.purpose)}>
              {PURPOSE_LABELS[p.purpose]} <span className="font-stats text-text-muted">{p.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {problem ? (
          <p className="px-3 py-3 text-xs text-val-yellow">{problem}</p>
        ) : loading && rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-text-muted">Loading your line-ups…</p>
        ) : rows.length === 0 ? (
          <div className="px-3 py-3 space-y-2 text-xs text-text-muted">
            <p>No line-ups for {where} yet.</p>
            <Link to={props.boardHref} className="inline-flex items-center gap-1 text-val-cyan hover:underline">
              Make one on the board <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <ul className="py-1">
            {shown.map(row => {
              const count = counts.get(row.id) ?? 0
              const icon = props.abilityIcon(row.agent, row.slot)
              const recipe = recipeLine(row)
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => props.onAdd(row)}
                    title={count > 0 ? `Add ${row.title} again` : `Add ${row.title} to this step`}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-elevated/60 transition-colors"
                  >
                    <AgentIcon name={row.agent} size={22} />
                    {icon ? <img src={icon} alt="" className="w-5 h-5 object-contain shrink-0" /> : <span className="w-5 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-text-primary truncate">{row.title}</span>
                      <span className="block text-[11px] text-text-muted truncate">
                        {[row.purpose ? PURPOSE_LABELS[row.purpose] : null, recipe || null].filter(Boolean).join(' · ') || row.agent}
                      </span>
                    </span>
                    {count > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-val-cyan shrink-0" aria-label={`${count} on this step`}>
                        <Check className="w-3.5 h-3.5" />
                        {count > 1 ? count : ''}
                      </span>
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="px-3 py-2 border-t border-bg-elevated text-[11px]">
        <Link to={props.libraryHref} className="inline-flex items-center gap-1 text-text-secondary hover:text-val-cyan">
          Open the line-up library <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}
