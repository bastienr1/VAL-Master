import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { PlayTemplate } from '../../lib/playTemplates'
import type { PlaySide } from '../../lib/types'
import TemplateStrip from './TemplateStrip'

export interface ComposeFailure {
  message: string
  /** The composer's secret is missing: offer a blank play instead of a retry. */
  notConfigured: boolean
}

interface BriefPanelProps {
  mapNames: string[]
  map: string
  onMap(map: string): void
  side: PlaySide
  onSide(side: PlaySide): void
  brief: string
  onBrief(brief: string): void
  /** False when the brief is empty or the map has no callouts to place agents on. */
  canCompose: boolean
  composing: boolean
  onCompose(): void
  composedWith: string | null
  hasDoc: boolean
  error: ComposeFailure | null
  onStartBlank(): void
  templates: PlayTemplate[]
  /** The map's sites, for the templates played around one. */
  sites: string[]
  onApplyTemplate(template: PlayTemplate, site: string | null): void
}

const SIDES: { value: PlaySide; label: string }[] = [
  { value: 'attack', label: 'Attack' },
  { value: 'defense', label: 'Defense' },
]

const PLACEHOLDER =
  'Ascent attack, comp Omen Sova Jett KAY/O Killjoy. Default A: Sova recon from A Main, Omen smokes Heaven and Generator…'

const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'

/**
 * The brief card: map, side, the user's words, and the Compose button. Before
 * any play exists the templates sit above the brief; after, they hide behind
 * a "Templates" link and ask before replacing the phases.
 */
export default function BriefPanel(props: BriefPanelProps) {
  const { mapNames, map, side, brief, composing, error, hasDoc } = props
  const [showTemplates, setShowTemplates] = useState(false)
  // A saved play on a map the registry no longer lists keeps its own name in the picker.
  const options = map && !mapNames.includes(map) ? [map, ...mapNames] : mapNames

  const applyTemplate = (template: PlayTemplate, site: string | null) => {
    setShowTemplates(false)
    props.onApplyTemplate(template, site)
  }

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-text-secondary">Brief</div>
      <div className="flex items-center gap-2">
        <select
          value={map}
          onChange={e => props.onMap(e.target.value)}
          aria-label="Map"
          className={`${field} px-2 py-1.5 flex-1 min-w-0`}
        >
          {options.length === 0 && <option value="">Loading maps…</option>}
          {options.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Side" className="inline-flex shrink-0 rounded-lg border border-bg-elevated p-0.5">
          {SIDES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => props.onSide(s.value)}
              aria-pressed={side === s.value}
              className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                side === s.value ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {!hasDoc && (
        <TemplateStrip templates={props.templates} sites={props.sites} onApply={applyTemplate} confirmReplace={false} />
      )}
      <textarea
        rows={7}
        value={brief}
        onChange={e => props.onBrief(e.target.value)}
        placeholder={PLACEHOLDER}
        aria-label="Brief"
        className={`${field} p-3 w-full`}
      />
      <button
        type="button"
        onClick={props.onCompose}
        disabled={!props.canCompose || composing}
        className="flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {composing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        <span className="text-sm font-medium">{composing ? 'Composing…' : 'Compose play'}</span>
      </button>
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
      {(props.composedWith || hasDoc) && (
        <div className="text-[11px] text-text-muted space-y-0.5">
          {props.composedWith && <p>Composed with {props.composedWith}</p>}
          {hasDoc && <p>Positions you dragged are kept where the brief did not change.</p>}
        </div>
      )}
      {!hasDoc && !error?.notConfigured && (
        <button
          type="button"
          onClick={props.onStartBlank}
          className="text-xs text-text-secondary hover:text-val-cyan underline transition-colors"
        >
          Start blank
        </button>
      )}
      {hasDoc && (
        <>
          <button
            type="button"
            onClick={() => setShowTemplates(s => !s)}
            aria-expanded={showTemplates}
            className="text-xs text-text-secondary hover:text-val-cyan underline transition-colors"
          >
            Templates
          </button>
          {showTemplates && (
            <TemplateStrip templates={props.templates} sites={props.sites} onApply={applyTemplate} confirmReplace />
          )}
        </>
      )}
    </section>
  )
}
