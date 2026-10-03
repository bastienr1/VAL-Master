import { useEffect, useRef } from 'react'
import CategoryPicker from './CategoryPicker'
import type { CategoryOption } from '../lib/drillCategories'
import { sameScope, scopeLabel } from '../lib/savedDrillScope'
import type { SavedDrillScope } from '../lib/types'

const SCOPE_GROUPS: Array<{ type: SavedDrillScope['type']; heading: string }> = [
  { type: 'map', heading: 'Map' },
  { type: 'agent', heading: 'Agent' },
  { type: 'concept', heading: 'Skill' },
]

interface ScopeMenuProps {
  /** Places on offer; an empty list with `category` set gives a category-only menu. */
  options: SavedDrillScope[]
  current: Pick<SavedDrillScope, 'type' | 'value'> | null
  onPick: (scope: SavedDrillScope) => void
  onClose: () => void
  /** When given, a fourth group under Skill for the save's category. */
  category?: {
    options: CategoryOption[]
    current: string | null
    onPick: (category: string | null) => void
  }
}

/**
 * The inline "save to" menu under a drill row or a card: every place the
 * guide allows, grouped, the current one marked, and the save's category.
 * Lives where it opens (no portal) so it scrolls with the list; Escape and a
 * click outside close it.
 */
export default function ScopeMenu({ options, current, onPick, onClose, category }: ScopeMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [onClose])

  const placesOnly = !category

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full mt-1 z-20 w-64 max-h-80 overflow-y-auto bg-bg-card border border-bg-elevated rounded-lg shadow-lg p-1.5 space-y-2"
    >
      {SCOPE_GROUPS.map(group => {
        const items = options.filter(option => option.type === group.type)
        if (items.length === 0) return null
        return (
          <div key={group.type}>
            <div className="px-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-muted">{group.heading}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(option => {
                const active = current !== null && sameScope(current, option)
                return (
                  <button
                    key={`${option.type}:${option.value}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => onPick(option)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                      active
                        ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
                        : 'bg-transparent text-text-secondary border-bg-elevated hover:border-text-muted'
                    }`}
                  >
                    {scopeLabel(option)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {placesOnly && options.length === 0 && (
        <p className="px-1.5 py-1 text-[11px] text-text-muted">Nothing to save to yet — the map pool is still loading.</p>
      )}
      {category && <CategoryPicker options={category.options} current={category.current} onPick={category.onPick} />}
    </div>
  )
}
