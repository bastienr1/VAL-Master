import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MapPortalCard from './MapPortalCard'
import { contentForMap, type MapContent, type PortalMap } from '../../lib/mapContent'
import type { StatSummary } from '../../lib/homeStats'

interface MapCarouselProps {
  /** Already in display order: most study material first. */
  maps: PortalMap[]
  grouped: Map<string, MapContent>
  /** The player's record per lower-cased map name, for the period in `recordLabel`. */
  records: Map<string, StatSummary>
  recordLabel: string
}

// Card width. The row is padded by half the leftover on each side, so the first
// and last cards can still reach the centre. On load the row opens a few cards
// in (see the layout effect below) so that padding is never visible by default.
const CARD_WIDTH = '13rem'

const arrowClass =
  'absolute top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border border-bg-elevated bg-bg-primary/80 text-text-secondary flex items-center justify-center hover:text-val-cyan hover:border-val-cyan/50 transition-colors disabled:opacity-30 disabled:pointer-events-none'

/**
 * Explore Maps: a scroll-snap row with the centred card scaled up. Scrolls by
 * drag, wheel, the arrow buttons, or ←/→ while focused. No carousel library.
 */
export default function MapCarousel({ maps, grouped, records, recordLabel }: MapCarouselProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [active, setActive] = useState(0)

  // The centred card is whichever one sits closest to the middle of the row.
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      const middle = el.scrollLeft + el.clientWidth / 2
      let nearest = 0
      let nearestDistance = Infinity
      Array.from(el.children).forEach((child, i) => {
        const card = child as HTMLElement
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = i
        }
      })
      setActive(nearest)
    })
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // Open with the row filled edge to edge: centre the first card that has enough
  // neighbours on its left to cover the leading padding. With too few maps to
  // fill both sides, fall back to the middle card.
  useLayoutEffect(() => {
    const el = scroller.current
    const first = el?.children[0] as HTMLElement | undefined
    if (!el || !first) return
    const second = el.children[1] as HTMLElement | undefined
    const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth
    const side = (el.clientWidth - first.offsetWidth) / 2
    const start = Math.max(0, Math.min(Math.ceil(side / step), Math.floor((maps.length - 1) / 2)))
    const card = el.children[start] as HTMLElement
    el.scrollLeft = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2
    setActive(start)
  }, [maps.length])

  const go = (index: number) => {
    const el = scroller.current
    const card = el?.children[Math.max(0, Math.min(maps.length - 1, index))] as HTMLElement | undefined
    if (!el || !card) return
    el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(active - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(active + 1)
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => go(active - 1)} disabled={active <= 0} aria-label="Previous map" className={`${arrowClass} left-0`}>
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div
        ref={scroller}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="group"
        aria-label="Maps. Use the left and right arrow keys to browse."
        className="vm-scroll-row relative flex items-center gap-5 overflow-x-auto overflow-y-hidden snap-x snap-mandatory py-8 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-val-cyan/40"
        style={{ paddingInline: `calc(50% - ${CARD_WIDTH} / 2)` }}
      >
        {maps.map((map, i) => (
          <div
            key={map.uuid ?? map.name}
            className={`snap-center shrink-0 transition-[transform,opacity] duration-300 ${
              i === active ? 'scale-110 z-10' : 'opacity-75 hover:opacity-100'
            }`}
            style={{ width: CARD_WIDTH }}
          >
            <MapPortalCard
              map={map}
              counts={contentForMap(grouped, map.name).counts}
              record={records.get(map.name.trim().toLowerCase()) ?? null}
              recordLabel={recordLabel}
              className={i === active ? 'border-val-red/70 shadow-[0_0_28px_-6px_var(--color-val-red)]' : ''}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={() => go(active + 1)} disabled={active >= maps.length - 1} aria-label="Next map" className={`${arrowClass} right-0`}>
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}
