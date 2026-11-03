import { X } from 'lucide-react'
import { SLOT_KEYS, SLOT_ORDER } from '../../lib/agentAbilities'
import { agentColor, type GameAgent } from '../../lib/gameContent'
import type { AbilitySlot } from '../../lib/playDoc'

interface AbilityPopoverProps {
  agent: GameAgent
  /** How many of each of this agent's abilities are placed in this step. */
  counts: Partial<Record<AbilitySlot, number>>
  /** The slot waiting for a click on the map, lit until then. */
  pendingSlot: AbilitySlot | null
  /** Picking the lit slot again clears it. */
  onPick(slot: AbilitySlot | null): void
  onClose(): void
}

/**
 * The agent's four abilities above the strip (docs/plays-editor-v2.md §2.3),
 * C, Q, E, X in the HUD's order, with the registry's icon and name. Picking
 * one arms it: the next click on the map places it. Escape (the page's key)
 * disarms it.
 */
export default function AbilityPopover({ agent, counts, pendingSlot, onPick, onClose }: AbilityPopoverProps) {
  const color = agentColor(agent)

  return (
    <div
      role="toolbar"
      aria-label={`${agent.name} abilities`}
      className="flex items-center gap-1.5 rounded-xl border border-bg-elevated bg-bg-card/95 backdrop-blur px-2 py-1.5 shadow-lg"
    >
      <span className="text-[10px] uppercase tracking-widest text-text-secondary pr-1 max-w-24 truncate" title={agent.name}>
        {agent.name}
      </span>
      {SLOT_ORDER.map(slot => {
        const ability = agent.abilities.find(a => a.slot === slot)
        const name = ability?.name ?? slot
        const count = counts[slot] ?? 0
        const lit = pendingSlot === slot
        return (
          <button
            key={slot}
            type="button"
            onClick={() => onPick(lit ? null : slot)}
            aria-pressed={lit}
            title={`${agent.name} · ${name}`}
            aria-label={`${name} (${SLOT_KEYS[slot]})`}
            style={lit ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
            className={`relative w-10 h-10 rounded-lg border flex items-center justify-center transition-colors ${
              lit ? 'bg-bg-elevated' : 'border-bg-elevated bg-bg-primary hover:border-val-cyan/50'
            }`}
          >
            {ability?.icon ? (
              <img src={ability.icon} alt="" className="w-6 h-6 object-contain" />
            ) : (
              <span className="text-xs font-semibold text-text-secondary">{SLOT_KEYS[slot]}</span>
            )}
            <span className="absolute bottom-0 left-0.5 text-[9px] font-bold text-text-muted">{SLOT_KEYS[slot]}</span>
            {count > 0 && (
              <span className="absolute top-0 right-0.5 text-[9px] tabular-nums text-text-muted" aria-label={`${count} placed`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close abilities"
        title="Close (Esc)"
        className="p-1 rounded-md text-text-muted hover:text-text-secondary"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
