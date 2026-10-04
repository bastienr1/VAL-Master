import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ScrollRowProps {
  /** Announced to screen readers, e.g. "Agents". */
  label: string
  children: React.ReactNode
  className?: string
  /** Told whether the row has more than fits, so a caller can offer "View all". */
  onOverflowChange?: (overflowing: boolean) => void
}

const arrowClass =
  'absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full border border-bg-elevated bg-bg-primary/85 text-text-secondary flex items-center justify-center hover:text-val-cyan hover:border-val-cyan/50 transition-colors'

// The mouse wheel walks the row one card per notch, as Home's map carousel
// does: a step fires once the accumulated delta passes the threshold, with a
// short cooldown so one notch is one card. Notches arriving while the row is
// still gliding step from where it is heading, not where it is passing.
const WHEEL_STEP = 40
const WHEEL_COOLDOWN_MS = 120
const WHEEL_SETTLE_MS = 200
const WHEEL_GLIDE_MS = 600

// How far the mouse must move with the button down before it is a drag and
// not a click on the card under it.
const DRAG_THRESHOLD_PX = 5

/**
 * One horizontal row of cards. Scrolls by mouse drag, the mouse wheel (one
 * card per notch), a trackpad or touch swipe, the arrow buttons that appear at
 * an end with more beyond it, and ←/→ while focused.
 */
export default function ScrollRow({ label, children, className = '', onOverflowChange }: ScrollRowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  // Re-measure when the row or anything in it changes size: cards arrive after
  // the first paint, and the window can be resized.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [measure, children])

  const overflowing = edges.left || edges.right
  useEffect(() => {
    onOverflowChange?.(overflowing)
  }, [overflowing, onOverflowChange])

  // A plain mouse wheel over the row steps it one card at a time. Browsers only
  // move a horizontal row on shift+wheel or a trackpad swipe, so a mouse user
  // got page scroll and nothing else. A native listener, because React's
  // onWheel is passive and cannot preventDefault. At either end, and on a row
  // with nothing to scroll, the event is left alone, so the page still scrolls
  // past. A mostly horizontal delta (trackpad swipe) is left to the browser.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let accumulated = 0
    let lastEvent = 0
    let lastStep = 0
    let target = 0

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      const direction = event.deltaY > 0 ? 1 : -1
      const now = performance.now()
      // Where the row is, or where it is still heading after a recent step.
      const from = now - lastStep < WHEEL_GLIDE_MS ? target : el.scrollLeft
      const atEnd = direction > 0 ? from >= max - 4 : from <= 4
      if (atEnd) return
      event.preventDefault()

      // A pause resets the running total, so a nudge after a while is a fresh start.
      if (now - lastEvent > WHEEL_SETTLE_MS) accumulated = 0
      lastEvent = now
      accumulated += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY

      if (Math.abs(accumulated) < WHEEL_STEP || now - lastStep < WHEEL_COOLDOWN_MS) return
      accumulated = 0
      lastStep = now
      // One card: the distance from one card's edge to the next one's.
      const first = el.children[0] as HTMLElement | undefined
      const second = el.children[1] as HTMLElement | undefined
      const step = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth
      target = Math.max(0, Math.min(max, from + direction * step))
      el.scrollTo({ left: target, behavior: 'smooth' })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Dragging with the mouse moves the row. Touch and pen already scroll it
  // natively, so only a mouse is handled here.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  // A drag that ends over a card must not also open it.
  const swallowClick = useRef(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const dx = e.clientX - current.x
    if (!current.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      current.moved = true
      // Keeps the drag alive when the pointer leaves the row.
      e.currentTarget.setPointerCapture(e.pointerId)
      // Snapping would pull the row to the nearest card on every move, so the
      // drag would jump card to card. It comes back when the drag ends.
      e.currentTarget.style.scrollSnapType = 'none'
    }
    e.currentTarget.scrollLeft = current.left - dx
  }

  const endDrag = () => {
    if (drag.current?.moved) {
      swallowClick.current = true
      if (scroller.current) scroller.current.style.scrollSnapType = ''
    }
    drag.current = null
  }

  const handleClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  const page = (direction: 1 | -1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      page(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      page(1)
    }
  }

  return (
    <div className="relative">
      {edges.left && (
        <button type="button" onClick={() => page(-1)} aria-label={`Scroll ${label} left`} className={`${arrowClass} -left-3`}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      <div
        ref={scroller}
        onScroll={measure}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={handleClickCapture}
        // Cards are links and pictures, which the browser would otherwise pick
        // up and drag as a ghost instead of letting the row move.
        onDragStart={e => e.preventDefault()}
        tabIndex={0}
        role="group"
        aria-label={label}
        className={`vm-scroll-row flex gap-4 overflow-x-auto overflow-y-hidden snap-x rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-val-cyan/40 ${className}`}
      >
        {children}
      </div>
      {edges.right && (
        <button type="button" onClick={() => page(1)} aria-label={`Scroll ${label} right`} className={`${arrowClass} -right-3`}>
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
