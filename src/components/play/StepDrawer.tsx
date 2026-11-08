import { useState } from 'react'
import { X } from 'lucide-react'
import type { AbilityElement, AbilitySlot, AgentElement, PlayStep } from '../../lib/playDoc'
import { UTILITY_STYLE } from '../../lib/playScene'
import type { ReplayBundle } from '../../lib/replayBundle'
import type { ReplayPlay } from '../../lib/replayToPlay'
import type { PlaySide } from '../../lib/types'
import AgentIcon from './AgentIcon'
import ReplayPicker from './ReplayPicker'

interface StepDrawerProps {
  /** True while nothing is drawn on any step: the replay picker shows. */
  isEmpty: boolean
  /** The editor's map: the replay picker lists its matches first. */
  map: string
  /** A round of one of the user's replays, converted: replaces the play. */
  onLoadReplay(play: ReplayPlay): void
  /** A whole match of the user's replays, opened in the replay mode (§2.8). */
  onPlayReplay(bundle: ReplayBundle, matchId: string): void

  side: PlaySide
  step: PlayStep | null
  stepIndex: number
  selectedId: string | null
  onSelect(id: string): void
  onCaption(caption: string): void
  onNote(elementId: string, note: string): void
  /** Makes this agent the step's spike carrier, or takes the spike off them. */
  onSpike(elementId: string): void
  onRemoveElement(elementId: string): void
  /** The registry's name for an agent's ability, or null when it does not know it. */
  abilityName(agent: string, slot: AbilitySlot | null): string | null
}

const label = 'text-[10px] uppercase tracking-widest text-text-secondary'
const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'
const sectionClass = 'p-4 space-y-3 border-b border-bg-elevated'

/**
 * The right-hand panel (docs/plays-editor-v2.md §2.4): the replay picker
 * while the play is empty (behind a "From a replay" link once something is
 * drawn) and what is on the map in this step (the caption, each ally's note
 * and the spike, the abilities placed). Map and side live in the rail.
 */
export default function StepDrawer(props: StepDrawerProps) {
  const { step, stepIndex, selectedId, side } = props
  /** The replay picker, opened from its link over a play with something drawn. */
  const [replayOpen, setReplayOpen] = useState(false)
  const showReplay = props.isEmpty || replayOpen
  const allies = (step?.elements ?? []).filter((e): e is AgentElement => e.kind === 'agent' && e.team === 'ally')
  const abilities = (step?.elements ?? []).filter((e): e is AbilityElement => e.kind === 'ability')

  const abilityText = (a: AbilityElement) =>
    a.label || props.abilityName(a.agent, a.slot) || UTILITY_STYLE[a.shape].label

  return (
    <div className="w-full">
      {showReplay && (
        <section className={sectionClass}>
          <div className="flex items-center justify-between gap-2">
            <div className={label}>From a replay</div>
            {!props.isEmpty && (
              <button
                type="button"
                onClick={() => setReplayOpen(false)}
                aria-label="Close the replay picker"
                title="Close"
                className="p-0.5 rounded text-text-muted hover:text-text-primary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <ReplayPicker
            currentMap={props.map}
            hasElements={!props.isEmpty}
            onLoad={play => {
              setReplayOpen(false)
              props.onLoadReplay(play)
            }}
            onPlay={(bundle, matchId) => {
              setReplayOpen(false)
              props.onPlayReplay(bundle, matchId)
            }}
          />
        </section>
      )}

      {!showReplay && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => setReplayOpen(true)}
            title="Replace the steps with a round of one of your replays"
            className="text-xs text-text-secondary hover:text-val-cyan underline transition-colors"
          >
            From a replay
          </button>
        </div>
      )}

      {step && (
        <section className={sectionClass}>
          <div className={label}>
            This step · {stepIndex + 1} {step.name}
          </div>
          <textarea
            rows={2}
            value={step.caption}
            onChange={e => props.onCaption(e.target.value)}
            placeholder="What this step is about, and what has to be true before it starts."
            aria-label="Step caption"
            className={`${field} p-2.5 w-full`}
          />

          {allies.length > 0 && (
            <ul className="space-y-1.5">
              {allies.map(a => (
                <li key={a.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onSelect(a.id)}
                    title={`Select ${a.agent} on the map`}
                    className={`shrink-0 rounded-full ${selectedId === a.id ? 'ring-2 ring-val-cyan' : ''}`}
                  >
                    <AgentIcon name={a.agent} size={24} />
                  </button>
                  <input
                    value={a.note ?? ''}
                    onChange={e => props.onNote(a.id, e.target.value)}
                    placeholder={`${a.agent}: what they do`}
                    aria-label={`${a.agent} note`}
                    className={`${field} px-2 py-1 min-w-0 flex-1 text-xs`}
                  />
                  {side === 'attack' && (
                    <button
                      type="button"
                      onClick={() => props.onSpike(a.id)}
                      aria-pressed={Boolean(a.spike)}
                      aria-label={`${a.agent} carries the spike`}
                      title={a.spike ? 'Spike carrier' : 'Give the spike'}
                      className="shrink-0 p-1"
                    >
                      <span
                        className={`block w-2 h-2 rounded-full ${a.spike ? 'bg-val-yellow' : 'border border-text-muted/60'}`}
                      />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {abilities.length > 0 && (
            <div className="space-y-1">
              <div className={label}>Abilities</div>
              <ul className="space-y-0.5">
                {abilities.map(a => (
                  <li
                    key={a.id}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${selectedId === a.id ? 'bg-val-cyan/10' : ''}`}
                  >
                    <AgentIcon name={a.agent} size={18} />
                    <button
                      type="button"
                      onClick={() => props.onSelect(a.id)}
                      className="min-w-0 flex-1 text-left text-xs text-text-secondary hover:text-text-primary truncate"
                      title={abilityText(a)}
                    >
                      {abilityText(a)}
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onRemoveElement(a.id)}
                      aria-label={`Remove ${abilityText(a)}`}
                      title="Remove"
                      className="shrink-0 p-0.5 rounded text-text-muted hover:text-val-red"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {allies.length === 0 && abilities.length === 0 && (
            <p className="text-xs text-text-muted">Pick agents from the strip below to place them on the map.</p>
          )}
        </section>
      )}
    </div>
  )
}
