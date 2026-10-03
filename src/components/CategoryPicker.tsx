import { useState } from 'react'
import { matchCategory, normaliseCategory, type CategoryOption } from '../lib/drillCategories'

interface CategoryPickerProps {
  options: CategoryOption[]
  current: string | null
  onPick: (category: string | null) => void
}

/**
 * The Category group of a save menu: the seed list and every category in use
 * as chips, a way to clear, and a field for a new one. Content only — the
 * menu around it positions it and handles closing.
 *
 * A typed name is matched to an existing spelling ignoring case, so the
 * vocabulary does not fork on capitalisation.
 */
export default function CategoryPicker({ options, current, onPick }: CategoryPickerProps) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const name = normaliseCategory(draft)
    if (!name) return
    onPick(matchCategory(name, options.map(option => option.name)))
    setDraft('')
  }

  const chip = (active: boolean) =>
    `px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${
      active
        ? 'bg-val-yellow/15 text-val-yellow border-val-yellow/30'
        : 'bg-transparent text-text-secondary border-bg-elevated hover:border-text-muted'
    }`

  return (
    <div>
      <div className="px-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-muted">Category</div>
      <div className="flex flex-wrap gap-1">
        {options.map(option => {
          const active = current !== null && option.name.toLowerCase() === current.toLowerCase()
          return (
            <button
              key={option.name}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => onPick(option.name)}
              className={chip(active)}
            >
              {option.name}
              {option.count > 0 && <span className="font-stats text-[10px] opacity-70">{option.count}</span>}
            </button>
          )
        })}
        {current !== null && (
          <button type="button" role="menuitem" onClick={() => onPick(null)} className={chip(false)}>
            No category
          </button>
        )}
      </div>
      <input
        type="text"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="New category…"
        aria-label="New category"
        className="mt-1.5 w-full bg-bg-primary border border-bg-elevated rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-yellow/40"
      />
    </div>
  )
}
