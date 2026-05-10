import { useState, useEffect, useRef, useCallback } from 'react'

interface UseSplitterOptions {
  initialWidth: number
  minWidth: number
  maxWidth: number
  storageKey: string
  onResize?: (width: number) => void
}

interface DragHandlers {
  onMouseDown: (e: React.MouseEvent) => void
}

export function useSplitter({
  initialWidth,
  minWidth,
  maxWidth,
  storageKey,
  onResize,
}: UseSplitterOptions) {
  const clamp = useCallback(
    (w: number) => Math.max(minWidth, Math.min(maxWidth, w)),
    [minWidth, maxWidth]
  )

  const [width, setWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return initialWidth
    const stored = window.localStorage.getItem(storageKey)
    const parsed = stored ? parseInt(stored, 10) : NaN
    return Number.isFinite(parsed) ? clamp(parsed) : initialWidth
  })

  const setWidth = useCallback(
    (w: number) => {
      const clamped = clamp(w)
      setWidthState(clamped)
      window.localStorage.setItem(storageKey, String(clamped))
      onResize?.(clamped)
    },
    [clamp, storageKey, onResize]
  )

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragStateRef.current = { startX: e.clientX, startWidth: width }

      const handleMove = (ev: MouseEvent) => {
        const drag = dragStateRef.current
        if (!drag) return
        // Splitter is between left and right panels; right panel is on the right.
        // Dragging left increases right panel width, dragging right decreases it.
        const delta = drag.startX - ev.clientX
        const next = clamp(drag.startWidth + delta)
        setWidthState(next)
      }

      const handleUp = () => {
        const drag = dragStateRef.current
        dragStateRef.current = null
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        if (drag) {
          // Persist final width via setWidth (which writes to localStorage)
          // Use the live state by reading the latest stored value via the closure
          // -- simpler: re-clamp the last computed width and persist
        }
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [width, clamp]
  )

  // Persist whenever width changes (covers drag end + programmatic setWidth)
  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width))
    onResize?.(width)
  }, [width, storageKey, onResize])

  const dragHandlers: DragHandlers = { onMouseDown }

  return { width, setWidth, dragHandlers }
}

interface SplitterHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
}

export function SplitterHandle({ onMouseDown }: SplitterHandleProps) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true)
    onMouseDown(e)
    const stopDrag = () => {
      setDragging(false)
      window.removeEventListener('mouseup', stopDrag)
    }
    window.addEventListener('mouseup', stopDrag)
  }

  const active = hovered || dragging

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-1.5 cursor-col-resize select-none flex-shrink-0 group"
      style={{ touchAction: 'none' }}
    >
      <div
        className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 transition-colors ${
          active ? 'bg-val-cyan/40' : 'bg-bg-elevated'
        }`}
      />
    </div>
  )
}
