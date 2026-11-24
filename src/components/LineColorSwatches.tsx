import { LINE_COLORS, parseLineColor } from '../lib/lineupModel'

/**
 * The colours a line-up's line can take: the ability's own, nine swatches,
 * and the system's picker for any other. `value` is the colour now: null for
 * the ability's own, undefined when the line-ups it stands for do not agree.
 */
export default function LineColorSwatches({ value, onPick, label }: {
  value: string | null | undefined
  onPick(color: string | null): void
  label: string
}) {
  const custom = typeof value === 'string' && !LINE_COLORS.some(color => color.value === value)
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onPick(null)}
        title="The colour of the ability"
        className={`px-2 py-1 rounded-md text-xs border transition-colors ${
          value === null ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40' : 'bg-bg-primary text-text-secondary border-bg-elevated hover:border-val-cyan/30'
        }`}
      >
        Ability
      </button>
      {LINE_COLORS.map(color => {
        const on = value === color.value
        return (
          <button
            key={color.value}
            type="button"
            aria-label={color.name}
            aria-pressed={on}
            title={color.name}
            onClick={() => onPick(color.value)}
            style={{ backgroundColor: color.value }}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${on ? 'border-text-primary scale-110' : 'border-bg-elevated hover:scale-110'}`}
          />
        )
      })}
      {/* Any other colour: the system's own picker. */}
      <label
        title="Another colour"
        className={`relative w-6 h-6 rounded-full border-2 overflow-hidden cursor-pointer ${custom ? 'border-text-primary scale-110' : 'border-bg-elevated hover:scale-110'} transition-transform`}
        style={{ background: custom ? value : 'conic-gradient(#FF4655, #FFCA3A, #7CFF6B, #2EE6C5, #3DA5FF, #B28DFF, #FF6BD6, #FF4655)' }}
      >
        <input
          type="color"
          aria-label="Another colour"
          value={typeof value === 'string' ? value : '#FFFFFF'}
          onChange={e => {
            const picked = parseLineColor(e.target.value)
            if (picked) onPick(picked)
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </label>
    </div>
  )
}
