import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The draggable divider between two columns — the Sprint 5a splitter, grown up.
 *
 * Three things make this more than a mousedown handler, and all three are
 * failure modes rather than polish:
 *
 * 1. **The iframe eats the drag.** A YouTube player sits inches from every
 *    handle in this app. Once the pointer crosses it the iframe swallows the
 *    events and the drag freezes mid-gesture. Pointer capture on the handle
 *    fixes the event routing; `pointer-events: none` on iframes (via the
 *    `vm-resizing` class on `<body>`) fixes the rest.
 * 2. **Re-rendering mid-drag is expensive.** Committing width to React state on
 *    every pointermove re-renders a tree holding two or three video embeds. The
 *    width is written straight to the panel element during the drag and
 *    committed to state only on release.
 * 3. **A saved width outlives the window that made it.** A rail sized on a wide
 *    monitor would crush the video on a laptop, so the maximum is also
 *    container-relative and re-clamped when the window changes.
 */

interface UseSplitterOptions {
  initialWidth: number
  minWidth: number
  maxWidth: number
  storageKey: string
  onResize?: (width: number) => void
  /**
   * Which side of the handle the sized panel sits on. A right-hand panel (the
   * default, and every caller before the Pro Study chapter rail) grows as the
   * handle is dragged left; a left-hand one grows as it is dragged right.
   */
  side?: 'left' | 'right'
  /**
   * Cap the width at this fraction of the parent's width as well as at
   * `maxWidth`. Omitted, only `maxWidth` applies.
   */
  maxRatio?: number
  /** Announced by the handle to screen readers. */
  label?: string
}

const KEYBOARD_STEP = 16
const KEYBOARD_STEP_LARGE = 64

/** Applied to `<body>` for the duration of a drag; see `index.css`. */
const DRAGGING_CLASS = 'vm-resizing'

function readStored(storageKey: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(storageKey)
    const parsed = stored ? Number.parseInt(stored, 10) : NaN
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    // Private mode or blocked storage — the feature degrades to session-only.
    return fallback
  }
}

function persist(storageKey: string, width: number) {
  try {
    window.localStorage.setItem(storageKey, String(width))
  } catch {
    /* ignore — a width is not worth an error */
  }
}

export function useSplitter({
  initialWidth,
  minWidth,
  maxWidth,
  storageKey,
  onResize,
  side = 'right',
  maxRatio,
  label = 'Resize panel',
}: UseSplitterOptions) {
  /** The element being sized — written to directly while dragging. */
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null)

  const effectiveMax = useCallback(() => {
    const parent = panelRef.current?.parentElement
    if (!maxRatio || !parent) return maxWidth
    return Math.min(maxWidth, Math.max(minWidth, parent.clientWidth * maxRatio))
  }, [maxWidth, maxRatio, minWidth])

  const clamp = useCallback(
    (w: number) => Math.round(Math.max(minWidth, Math.min(effectiveMax(), w))),
    [minWidth, effectiveMax],
  )

  // Read storage in the initialiser so the first paint is already the right
  // width — a flash from default to saved is worse than no persistence.
  const [width, setWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return initialWidth
    return Math.max(minWidth, Math.min(maxWidth, readStored(storageKey, initialWidth)))
  })
  const [dragging, setDragging] = useState(false)

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next)
      setWidthState(clamped)
      persist(storageKey, clamped)
      onResize?.(clamped)
      return clamped
    },
    [clamp, storageKey, onResize],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore secondary buttons; a right-click drag is not a resize.
      if (e.button !== 0) return
      e.preventDefault()

      const panel = panelRef.current
      if (!panel) return

      dragRef.current = { startX: e.clientX, startWidth: panel.getBoundingClientRect().width, pointerId: e.pointerId }
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add(DRAGGING_CLASS)
      setDragging(true)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      const panel = panelRef.current
      if (!drag || !panel) return

      // The sized panel grows as the handle moves away from it.
      const delta = side === 'right' ? drag.startX - e.clientX : e.clientX - drag.startX
      // Written to the element, not to state: the panel holds video embeds and
      // re-rendering them sixty times a second is what this avoids.
      panel.style.width = `${clamp(drag.startWidth + delta)}px`
    },
    [side, clamp],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null

      try {
        e.currentTarget.releasePointerCapture(drag.pointerId)
      } catch {
        /* already released */
      }
      document.body.classList.remove(DRAGGING_CLASS)
      setDragging(false)

      // Read back what the drag actually painted, so state and DOM agree.
      const painted = panelRef.current?.getBoundingClientRect().width
      commit(painted ?? width)
    },
    [commit, width],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
      // An arrow moves the *divider*, and the panel grows as the divider moves
      // away from it — the same rule the drag follows. So on a right-hand panel
      // ArrowLeft widens; on a left-hand one it narrows. Getting this backwards
      // makes the keyboard contradict the mouse on the same control.
      const grow = side === 'right' ? 1 : -1

      let next: number | null = null
      if (e.key === 'ArrowLeft') next = width + step * grow
      else if (e.key === 'ArrowRight') next = width - step * grow
      else if (e.key === 'Home') next = minWidth
      else if (e.key === 'End') next = effectiveMax()
      else if (e.key === 'Enter') next = initialWidth
      if (next === null) return

      e.preventDefault()
      // The review page binds ←/→ to seeking the video. Without this, resizing
      // the rail would scrub the match at the same time.
      e.stopPropagation()
      commit(next)
    },
    [width, side, minWidth, effectiveMax, initialWidth, commit],
  )

  const onDoubleClick = useCallback(() => {
    if (dragRef.current) return // a drag is finishing; ignore the stray dblclick
    commit(initialWidth)
  }, [commit, initialWidth])

  // A width saved on a wider window is re-clamped rather than left to overflow.
  useEffect(() => {
    if (!maxRatio) return
    const onWindowResize = () => setWidthState(current => clamp(current))
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [maxRatio, clamp])

  // The class lives on body, so a component unmounted mid-drag must clear it.
  useEffect(() => () => document.body.classList.remove(DRAGGING_CLASS), [])

  return {
    width,
    dragging,
    /** Spread onto the panel being sized. */
    panelProps: {
      ref: panelRef,
      style: { width, flexShrink: 0, minWidth: 0 } as React.CSSProperties,
    },
    /** Spread onto `SplitterHandle`. */
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick,
      dragging,
      'aria-valuenow': width,
      'aria-valuemin': minWidth,
      'aria-valuemax': maxWidth,
      'aria-label': label,
    },
  }
}

interface SplitterHandleProps {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onDoubleClick: () => void
  dragging: boolean
  'aria-valuenow': number
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-label': string
}

export function SplitterHandle({ dragging, ...handlers }: SplitterHandleProps) {
  const [hovered, setHovered] = useState(false)
  const active = hovered || dragging

  return (
    <div
      {...handlers}
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-2.5 cursor-col-resize select-none flex-shrink-0 group focus:outline-none"
      style={{ touchAction: 'none' }}
    >
      <div
        className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 transition-colors ${
          dragging ? 'bg-val-cyan' : active ? 'bg-val-cyan/40' : 'bg-bg-elevated'
        } group-focus-visible:bg-val-cyan/60`}
      />
      {/* Three dots mark the grip as draggable without a hover tooltip. */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className={`w-1 h-1 rounded-full transition-colors ${
              active ? 'bg-val-cyan' : 'bg-text-muted/50'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
