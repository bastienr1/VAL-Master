import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { CANVAS_SKIN_IDS, CANVAS_SKINS, type CanvasSkinId } from '../../lib/canvasSkins'

interface SkinPickerProps {
  skin: CanvasSkinId
  onPick(skin: CanvasSkinId): void
  /** The toolbar's button look, closed. */
  buttonClass: string
}

/** The toolbar's Skin button and its menu: each canvas skin with its colours. The K key cycles them (§2.11). */
export default function SkinPicker({ skin, onPick, buttonClass }: SkinPickerProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Canvas skin: ${CANVAS_SKINS[skin].name} (K cycles)`}
        className={buttonClass}
      >
        <Palette className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Skin</span>
      </button>
      {open && (
        <div role="menu" aria-label="Canvas skin" className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border border-bg-elevated bg-bg-card shadow-lg p-1">
          {CANVAS_SKIN_IDS.map(id => {
            const s = CANVAS_SKINS[id]
            const active = id === skin
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onPick(id)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors ${
                  active ? 'bg-val-cyan/10' : 'hover:bg-bg-elevated/60'
                }`}
              >
                <span aria-hidden="true" className="shrink-0 flex rounded overflow-hidden border border-bg-elevated">
                  {[s.back, s.wall, s.ally, s.enemy].map((color, i) => (
                    <span key={i} className="block w-3.5 h-6" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-text-primary">{s.name}</span>
                  <span className="block text-[11px] leading-snug text-text-secondary">{s.blurb}</span>
                </span>
                {active && <Check className="shrink-0 w-4 h-4 text-val-cyan" />}
              </button>
            )
          })}
          <p className="px-2 pt-1.5 pb-1 text-[11px] text-text-secondary">
            Press <kbd className="font-stats text-text-primary">K</kbd> to cycle, <kbd className="font-stats text-text-primary">Shift K</kbd> to go back.
          </p>
        </div>
      )}
    </div>
  )
}
