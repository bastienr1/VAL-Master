import { Check } from 'lucide-react'
import type { PlayPhase, UtilityKind } from '../../lib/playDoc'
import { UTILITY_STYLE } from '../../lib/playScene'

interface MapLegendProps {
  phase: PlayPhase | null
  showCallouts: boolean
  onToggleCallouts(): void
  /** Callout names the minimap could not place in this phase. */
  unresolved: string[]
}

/**
 * Under the map: what the marks of this phase mean, the callouts toggle, and
 * the names that could not be placed. Only kinds the phase uses are listed,
 * so the legend reads as a summary of the phase, not a key to every symbol.
 */
export default function MapLegend({ phase, showCallouts, onToggleCallouts, unresolved }: MapLegendProps) {
  const kinds: UtilityKind[] = []
  for (const item of phase?.utility ?? []) if (!kinds.includes(item.kind)) kinds.push(item.kind)
  const hasMoves = phase?.actors.some(a => a.moveTo) ?? false
  const hasEnemies = phase?.markers.some(m => m.kind === 'enemy') ?? false

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          {kinds.map(kind => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: UTILITY_STYLE[kind].swatch }} />
              {UTILITY_STYLE[kind].label}
            </span>
          ))}
          {hasMoves && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full bg-val-cyan" />
              Move
            </span>
          )}
          {hasEnemies && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-val-red" />
              Expected enemy
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCallouts}
          aria-pressed={showCallouts}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
            showCallouts
              ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
              : 'border-bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <span className="inline-flex items-center justify-center w-3 h-3 rounded-sm border border-current">
            {showCallouts && <Check className="w-2.5 h-2.5" />}
          </span>
          Callouts
        </button>
      </div>
      {unresolved.length > 0 && (
        <p className="text-xs text-val-yellow">Could not place: {unresolved.join(', ')}</p>
      )}
    </div>
  )
}
