import { useEffect, useRef, useState } from 'react'
import { ALargeSmall } from 'lucide-react'
import { AGENT_SIZES, CALLOUT_SIZES, type CanvasSizes } from '../../lib/canvasSizes'

interface SizePickerProps {
  sizes: CanvasSizes
  onSizes(sizes: CanvasSizes): void
  /** The toolbar's button look, closed. */
  buttonClass: string
}

const heading = 'text-[10px] uppercase tracking-widest text-text-secondary'

function Segments<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: readonly { id: T; label: string; name: string }[]
  value: T
  onPick(id: T): void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-label={o.name}
          title={o.name}
          onClick={() => onPick(o.id)}
          className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors ${
            value === o.id ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-secondary bg-bg-elevated/50 hover:text-text-primary hover:bg-bg-elevated'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The toolbar's Size button and its menu (§2.13): callout text and agent icons. */
export default function SizePicker({ sizes, onSizes, buttonClass }: SizePickerProps) {
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
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open} title="Callout text and agent icon size" className={buttonClass}>
        <ALargeSmall className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Size</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Sizes" className="absolute right-0 top-full mt-1 z-30 w-60 rounded-lg border border-bg-elevated bg-bg-card shadow-lg p-3 space-y-3">
          <div className="space-y-1.5">
            <div className={heading}>Callout text</div>
            <Segments label="Callout text size" options={CALLOUT_SIZES} value={sizes.callout} onPick={callout => onSizes({ ...sizes, callout })} />
            <div role="radiogroup" aria-label="When you zoom" className="flex gap-1">
              {[
                { follow: false, text: 'Fixed on screen', title: 'Callouts keep their size when you zoom' },
                { follow: true, text: 'Grow with map', title: 'Callouts get bigger as you zoom in, like the map' },
              ].map(({ follow, text, title }) => (
                <button
                  key={text}
                  type="button"
                  role="radio"
                  aria-checked={sizes.calloutsFollowZoom === follow}
                  title={title}
                  onClick={() => onSizes({ ...sizes, calloutsFollowZoom: follow })}
                  className={`flex-1 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    sizes.calloutsFollowZoom === follow ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-secondary bg-bg-elevated/50 hover:text-text-primary hover:bg-bg-elevated'
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className={heading}>Agent icons</div>
            <Segments label="Agent icon size" options={AGENT_SIZES} value={sizes.agent} onPick={agent => onSizes({ ...sizes, agent })} />
          </div>
        </div>
      )}
    </div>
  )
}
