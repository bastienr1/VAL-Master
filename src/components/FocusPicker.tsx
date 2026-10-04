import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark } from 'lucide-react'
import { groupSaved, scopeLabel } from '../lib/savedDrillScope'
import { focusFromDrill } from '../lib/weeklyPlan'
import { linkFromGoal, linkFromSaved, type GoalLink } from '../lib/weeklyPlanStore'
import type { SavedDrill, SavedDrillScopeType, WeeklyGoal } from '../lib/types'

const SECTIONS: Array<{ type: SavedDrillScopeType; heading: string }> = [
  { type: 'map', heading: 'Map' },
  { type: 'agent', heading: 'Agent' },
  { type: 'concept', heading: 'Skill' },
]

interface FocusPickerProps {
  blockName: string
  /** The focus the block already has this week, if any. */
  goal: WeeklyGoal | null
  saved: SavedDrill[]
  onSave: (focusText: string, link: GoalLink | null) => void
  /** Present when there is a focus to clear. */
  onClear?: () => void
  onClose: () => void
}

/**
 * Sets a block's focus for the week: typed, or picked from a saved drill.
 * Picking a drill fills the text and holds the link; the text stays editable,
 * and unlinking keeps it.
 */
export default function FocusPicker({ blockName, goal, saved, onSave, onClear, onClose }: FocusPickerProps) {
  const [text, setText] = useState(goal?.focus_text ?? '')
  const [link, setLink] = useState<GoalLink | null>(goal ? linkFromGoal(goal) : null)
  const groups = useMemo(() => groupSaved(saved), [saved])

  const trimmed = text.trim()
  const save = () => {
    if (trimmed !== '') onSave(trimmed, link)
  }

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-bg-elevated bg-bg-secondary p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
            }}
            aria-label="Focus for the week"
            placeholder={`What to work on in ${blockName} this week`}
            autoFocus
            className="flex-1 min-w-[14rem] bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
          />
          <button
            type="button"
            onClick={save}
            disabled={trimmed === ''}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-val-cyan/10 text-val-cyan border border-val-cyan/20 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save focus
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>

        {(link || onClear) && (
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {link && (
              <span className="inline-flex items-center gap-2 text-text-secondary">
                <Bookmark className="w-3.5 h-3.5 text-val-yellow" aria-hidden="true" />
                Linked to a saved drill
                <button type="button" onClick={() => setLink(null)} className="text-val-cyan hover:underline">
                  Unlink drill
                </button>
              </span>
            )}
            {onClear && (
              <button type="button" onClick={onClear} className="text-val-red hover:underline">
                Clear focus
              </button>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted">From your saved drills</h4>
          {saved.length === 0 ? (
            <p className="text-sm text-text-muted">
              <Link to="/study" className="text-val-cyan hover:underline">
                Save a drill while watching a guide in Pro Study to pick it here.
              </Link>
            </p>
          ) : (
            SECTIONS.map(section => {
              const places = groups[section.type]
              if (places.length === 0) return null
              return (
                <div key={section.type} className="space-y-1.5">
                  <h5 className="text-xs font-medium text-text-secondary">{section.heading}</h5>
                  <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                    {places.flatMap(([value, rows]) =>
                      rows.map(row => {
                        const picked = link?.saved_drill_id === row.id
                        return (
                          <button
                            key={row.id}
                            type="button"
                            aria-pressed={picked}
                            onClick={() => {
                              setText(focusFromDrill(row))
                              setLink(linkFromSaved(row))
                            }}
                            className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                              picked
                                ? 'border-val-cyan bg-val-cyan/10'
                                : 'border-bg-elevated bg-bg-card hover:border-val-cyan/50'
                            }`}
                          >
                            <div className="text-sm text-text-primary">{row.title}</div>
                            <div className="text-xs text-text-muted">
                              {scopeLabel({ type: section.type, value })}
                              {row.cue?.trim() ? ` · ${row.cue.trim()}` : ''}
                            </div>
                          </button>
                        )
                      }),
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
