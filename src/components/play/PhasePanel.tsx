import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useGameContent } from '../../hooks/useGameContent'
import type { PlayPhase, PlayUtility, UtilityKind } from '../../lib/playDoc'
import { UTILITY_STYLE } from '../../lib/playScene'
import type { PlaySelection } from '../PlayMinimap'
import AgentIcon from './AgentIcon'

interface PhasePanelProps {
  /** Null until a play is composed or started blank. */
  phase: PlayPhase | null
  phaseIndex: number
  comp: string[]
  selected: PlaySelection | null
  onSelect(sel: PlaySelection): void
  onCaption(caption: string): void
  onNote(actorIndex: number, note: string): void
  /** The page drops it at the agent's position and selects it for dragging. */
  onAddUtility(item: Pick<PlayUtility, 'agent' | 'kind' | 'label'>): void
  onRemoveUtility(index: number): void
  /** Appends an agent to the comp, standing in spawn in every phase. */
  onAddAgent(name: string): void
  /** Takes an agent, and its utility, out of every phase. */
  onRemoveAgent(name: string): void
}

const KINDS = Object.keys(UTILITY_STYLE) as UtilityKind[]

const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'

function KindChip({ kind }: { kind: UtilityKind }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: UTILITY_STYLE[kind].swatch }} />
      {UTILITY_STYLE[kind].label}
    </span>
  )
}

/** The tiny form behind "Add utility": who throws what. */
function AddUtilityForm({ comp, onAdd }: { comp: string[]; onAdd: PhasePanelProps['onAddUtility'] }) {
  const [agent, setAgent] = useState(comp[0] ?? '')
  const [kind, setKind] = useState<UtilityKind>('smoke')
  const [label, setLabel] = useState('')
  // The comp can change under the form (a recompose); fall back to its first agent.
  const who = comp.includes(agent) ? agent : (comp[0] ?? '')

  const add = () => {
    if (!who) return
    onAdd({ agent: who, kind, label: label.trim() || UTILITY_STYLE[kind].label })
    setLabel('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={who}
        onChange={e => setAgent(e.target.value)}
        disabled={comp.length === 0}
        aria-label="Agent"
        className={`${field} px-2 py-1 disabled:opacity-50`}
      >
        {comp.length === 0 && <option value="">Add agents first</option>}
        {comp.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        value={kind}
        onChange={e => setKind(e.target.value as UtilityKind)}
        aria-label="Kind"
        className={`${field} px-2 py-1`}
      >
        {KINDS.map(k => (
          <option key={k} value={k}>
            {UTILITY_STYLE[k].label}
          </option>
        ))}
      </select>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') add()
        }}
        placeholder="Heaven smoke"
        aria-label="Label"
        className={`${field} px-2 py-1 flex-1 min-w-[8rem]`}
      />
      <button
        type="button"
        onClick={add}
        disabled={!who}
        className="px-2.5 py-1 rounded-md text-xs font-medium text-val-cyan border border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add
      </button>
    </div>
  )
}

/**
 * The comp of a play short of five agents (a blank one): the members with a
 * remove button, then a picker per empty slot. A composed play has its five
 * and never shows this.
 */
function CompEditor({ comp, onAdd, onRemove }: { comp: string[]; onAdd(name: string): void; onRemove(name: string): void }) {
  const { registry } = useGameContent()
  const taken = new Set(comp.map(name => name.toLowerCase()))
  const options = registry
    ? [...registry.agents.byId.values()]
        .map(a => a.name)
        .filter(name => !taken.has(name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
    : []
  const empty = Array.from({ length: 5 - comp.length }, (_, i) => comp.length + i)

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-widest text-text-secondary">Comp</div>
      {comp.map(name => (
        <div key={name} className="flex items-center gap-2 px-1.5 py-1">
          <AgentIcon name={name} size={24} />
          <span className="flex-1 min-w-0 text-sm font-medium truncate">{name}</span>
          <button
            type="button"
            onClick={() => onRemove(name)}
            aria-label={`Remove ${name}`}
            className="p-1 rounded-md text-text-muted hover:text-val-red transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {empty.map(slot => (
        <select
          key={slot}
          value=""
          onChange={e => {
            if (e.target.value) onAdd(e.target.value)
          }}
          aria-label={`Agent ${slot + 1}`}
          className={`${field} px-2 py-1 w-full`}
        >
          <option value="">Pick an agent</option>
          {options.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ))}
    </div>
  )
}

/** "This phase": caption, what each agent does, and the utility thrown. */
export default function PhasePanel(props: PhasePanelProps) {
  const { phase, phaseIndex, comp, selected, onSelect } = props
  const [adding, setAdding] = useState(false)

  if (!phase) {
    return (
      <section className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
        <p className="text-sm text-text-muted">Compose a play or start blank to edit phases.</p>
      </section>
    )
  }

  const isSelected = (kind: PlaySelection['kind'], index: number) =>
    selected?.kind === kind && selected.index === index

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-text-secondary">
        Phase {phaseIndex + 1} · {phase.name}
      </div>
      <textarea
        rows={2}
        value={phase.caption}
        onChange={e => props.onCaption(e.target.value)}
        placeholder="What this phase is about"
        aria-label="Phase caption"
        className={`${field} p-3 w-full`}
      />

      {comp.length < 5 && <CompEditor comp={comp} onAdd={props.onAddAgent} onRemove={props.onRemoveAgent} />}

      <div className="space-y-0.5">
        {phase.actors.map((actor, i) => (
          <div
            key={actor.agent}
            onClick={() => onSelect({ kind: 'actor', index: i })}
            className={`flex items-center gap-2 px-1.5 py-1 cursor-pointer ${
              isSelected('actor', i) ? 'bg-val-cyan/10 rounded-md' : ''
            }`}
          >
            <AgentIcon name={actor.agent} size={24} />
            <span className="text-sm font-medium w-16 truncate" title={actor.agent}>
              {actor.agent}
            </span>
            <input
              value={actor.note}
              onChange={e => props.onNote(i, e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="What they do"
              aria-label={`${actor.agent} note`}
              className="flex-1 min-w-0 bg-transparent border-b border-transparent focus:border-val-cyan text-sm outline-none"
            />
            {actor.spike && <span className="w-2 h-2 rounded-full bg-val-yellow shrink-0" title="Spike carrier" />}
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-widest text-text-secondary">Utility</div>
        {phase.utility.map((item, i) => (
          <div
            key={`${item.kind}-${i}`}
            onClick={() => onSelect({ kind: 'utility', index: i })}
            className={`flex items-center gap-2 px-1.5 py-1 cursor-pointer ${
              isSelected('utility', i) ? 'bg-val-cyan/10 rounded-md' : ''
            }`}
          >
            <KindChip kind={item.kind} />
            <span className="flex-1 min-w-0 truncate text-sm text-text-secondary">
              {item.agent} · {item.label}
            </span>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                props.onRemoveUtility(i)
              }}
              aria-label={`Remove ${item.label}`}
              className="p-1 rounded-md text-text-muted hover:text-val-red transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setAdding(a => !a)}
          aria-expanded={adding}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-val-cyan transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add utility
        </button>
        {adding && <AddUtilityForm comp={comp} onAdd={props.onAddUtility} />}
      </div>
    </section>
  )
}
