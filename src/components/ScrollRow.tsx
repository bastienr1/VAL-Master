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

/**
 * One horizontal row of cards. Scrolls by drag or wheel, by the arrow buttons
 * that appear at an end with more beyond it, and by ←/→ while focused.
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
