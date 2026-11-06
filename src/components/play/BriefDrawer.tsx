import { Loader2, Sparkles, X } from 'lucide-react'
import type { AbilityElement, AbilitySlot, AgentElement, PlayStep } from '../../lib/playDoc'
import { UTILITY_STYLE } from '../../lib/playScene'
import type { PlayTemplate } from '../../lib/playTemplates'
import type { PlaySide } from '../../lib/types'
import AgentIcon from './AgentIcon'
import TemplateStrip from './TemplateStrip'

export interface ComposeFailure {
  message: string
  /** The composer's secret is missing: offer a blank play instead of a retry. */
  notConfigured: boolean
}

interface BriefDrawerProps {
  /** True while nothing is drawn on any step: the templates show. */
  showTemplates: boolean
  templates: PlayTemplate[]
  /** The map's sites, for the templates played around one. */
  sites: string[]
  onApplyTemplate(template: PlayTemplate, site: string | null): void

  brief: string
  onBrief(brief: string): void
  /** False when the brief is empty or the map has no callouts to place agents on. */
  canCompose: boolean
  composing: boolean
  onCompose(): void
  composedWith: string | null
  error: ComposeFailure | null
  onStartBlank(): void

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

  assumptions: string[]
}

const PLACEHOLDER =
  'Ascent attack, comp Omen Sova Jett KAY/O Killjoy. Default A: Sova recon from A Main, Omen smokes Heaven and Generator…'

const label = 'text-[10px] uppercase tracking-widest text-text-secondary'
const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'
const sectionClass = 'p-4 space-y-3 border-b border-bg-elevated'

/**
 * The right-hand drawer (docs/plays-editor-v2.md §2.4): templates while the
 * play is empty, the brief and Compose, what is on the map in this step (the
 * caption, each ally's note and the spike, the abilities placed), and the
 * composer's assumptions. Map and side live in the rail.
 */
export default function BriefDrawer(props: BriefDrawerProps) {
  const { brief, composing, error, step, stepIndex, selectedId, side } = props
  const allies = (step?.elements ?? []).filter((e): e is AgentElement => e.kind === 'agent' && e.team === 'ally')
  const abilities = (step?.elements ?? []).filter((e): e is AbilityElement => e.kind === 'ability')

  const abilityText = (a: AbilityElement) =>
    a.label || props.abilityName(a.agent, a.slot) || UTILITY_STYLE[a.shape].label

  return (
    <div className="w-full">
      {props.showTemplates && (
        <section className={sectionClass}>
          <TemplateStrip templates={props.templates} sites={props.sites} onApply={props.onApplyTemplate} />
        </section>
      )}

      <section className={sectionClass}>
        <div className={label}>Brief</div>
        <textarea
          rows={6}
          value={brief}
          onChange={e => props.onBrief(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="Brief"
          className={`${field} p-3 w-full`}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={props.onCompose}
            disabled={!props.canCompose || composing}
            className="flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {composing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span className="text-sm font-medium">{composing ? 'Composing…' : 'Compose play'}</span>
          </button>
          {props.showTemplates && !error?.notConfigured && (
            <button
              type="button"
              onClick={props.onStartBlank}
              title="Put the agents the brief names in spawn"
              className="text-xs text-text-secondary hover:text-val-cyan underline transition-colors"
            >
              Start blank
            </button>
          )}
        </div>
        {error && (
          <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2 space-y-1">
            <p>{error.message}</p>
            {error.notConfigured && (
              <button type="button" onClick={props.onStartBlank} className="text-sm text-val-cyan underline">
                Start blank
              </button>
            )}
          </div>
        )}
        {(props.composedWith || !props.showTemplates) && (
          <div className="text-[11px] text-text-muted space-y-0.5">
            {props.composedWith && <p>Composed with {props.composedWith}</p>}
            {!props.showTemplates && <p>Positions you dragged are kept where the brief did not change.</p>}
          </div>
        )}
      </section>

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

      {props.assumptions.length > 0 && (
        <section className={sectionClass}>
          <div className={label}>Assumptions</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
            {props.assumptions.map((a, i) => (
              <li key={`${i}-${a}`}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
