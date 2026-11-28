import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface PicturePickerOption {
  value: string
  label: string
  /** A small picture in front of the name. */
  picture: ReactNode
  /** What follows the name in the list, a count say. */
  hint?: string
  /** Shown, but quieter: a map with no line-up yet. */
  quiet?: boolean
}

/**
 * A dropdown whose choices each have a picture: the chosen one shows on the
 * button, the others in a list under it. Escape or a press outside closes it.
 */
export default function PicturePicker({ label, value, options, onPick }: {
  label: string
  value: string
  options: readonly PicturePickerOption[]
  onPick(value: string): void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const chosen = options.find(o => o.value === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-text-secondary mb-1">{label}</div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.label ?? 'none'}`}
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 p-1.5 pr-3 rounded-lg border bg-bg-primary text-left transition-colors ${
          open ? 'border-val-cyan/60' : 'border-bg-elevated hover:border-val-cyan/40'
        }`}
      >
        <span className="shrink-0 w-16 h-9 rounded-md overflow-hidden bg-bg-elevated">{chosen?.picture}</span>
        <span className="min-w-0 flex-1 font-heading font-semibold text-base truncate">{chosen?.label ?? 'Pick one'}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-lg border border-bg-elevated bg-bg-card shadow-xl p-1">
          {options.map(option => {
            const on = option.value === value
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onPick(option.value)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-3 p-1 pr-2 rounded-md text-left transition-colors ${on ? 'bg-val-cyan/10' : 'hover:bg-bg-elevated'} ${
                    option.quiet && !on ? 'opacity-55' : ''
                  }`}
                >
                  <span className="shrink-0 w-12 h-7 rounded overflow-hidden bg-bg-elevated">{option.picture}</span>
                  <span className="min-w-0 flex-1 text-sm truncate">{option.label}</span>
                  {option.hint && <span className="shrink-0 text-[11px] font-stats text-text-muted">{option.hint}</span>}
                  {on && <Check className="w-3.5 h-3.5 shrink-0 text-val-cyan" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
