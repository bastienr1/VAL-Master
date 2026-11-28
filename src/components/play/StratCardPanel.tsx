import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { addTag, READ_MAX, removeTag, TAG_LENGTH, TAG_MAX, tagSuggestions, WHEN_MAX, type StratCard } from '../../lib/stratCard'

interface StratCardPanelProps {
  card: StratCard
  /** A changed card. `key` coalesces a run of typing into one undo step. */
  onCard(card: StratCard, key?: string): void
  /** Tags the user has used on other plays, most used first: offered while typing. */
  tagPool: string[]
}

const label = 'text-[10px] uppercase tracking-widest text-text-secondary'
const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'

/**
 * The strat card (docs/plays-editor-v2.md §2.30), at the top of the right
 * panel: the situations the strat answers as tags, the "When you see…" line
 * that should bring it to mind, and what a teammate tends to do. The Plays
 * index filters on the tags and shows the line on the card.
 */
export default function StratCardPanel({ card, onCard, tagPool }: StratCardPanelProps) {
  const [typed, setTyped] = useState('')
  const full = card.tags.length >= TAG_MAX
  const suggestions = full ? [] : tagSuggestions(tagPool, typed, card.tags)

  const add = (raw: string) => {
    const tags = addTag(card.tags, raw)
    if (tags !== card.tags) onCard({ ...card, tags })
    setTyped('')
  }

  return (
    <section className="p-4 space-y-3 border-b border-bg-elevated" aria-label="Strat card">
      <div className={label}>Strat card</div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {card.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-val-cyan/10 border border-val-cyan/25 text-val-cyan text-xs px-1.5 py-0.5">
              {tag}
              <button
                type="button"
                onClick={() => onCard({ ...card, tags: removeTag(card.tags, tag) })}
                aria-label={`Remove the tag ${tag}`}
                title="Remove"
                className="text-val-cyan/70 hover:text-val-red"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {!full && (
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  add(typed)
                } else if (e.key === 'Backspace' && typed === '' && card.tags.length > 0) {
                  onCard({ ...card, tags: card.tags.slice(0, -1) })
                }
              }}
              onBlur={() => typed.trim() && add(typed)}
              maxLength={TAG_LENGTH}
              placeholder={card.tags.length === 0 ? 'Tag the situation: Retake, B hit…' : 'Add a tag'}
              aria-label="Add a tag"
              className={`${field} px-2 py-1 text-xs min-w-[8rem] flex-1`}
            />
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Suggested tags">
            {suggestions.map(tag => (
              <button
                key={tag}
                type="button"
                // Before the input's blur adds what was typed.
                onMouseDown={e => e.preventDefault()}
                onClick={() => add(tag)}
                className="inline-flex items-center gap-0.5 rounded-md border border-bg-elevated text-text-secondary hover:text-val-cyan hover:border-val-cyan/40 text-[11px] px-1.5 py-0.5 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="block space-y-1">
        <span className={label}>When you see…</span>
        <textarea
          rows={2}
          value={card.when}
          maxLength={WHEN_MAX}
          onChange={e => onCard({ ...card, when: e.target.value }, 'card:when')}
          placeholder="The pattern that should bring this strat to mind: two hold B, their Jett lurks mid…"
          className={`${field} p-2.5 w-full`}
        />
      </label>

      <label className="block space-y-1">
        <span className={label}>Teammate read</span>
        <textarea
          rows={2}
          value={card.read}
          maxLength={READ_MAX}
          onChange={e => onCard({ ...card, read: e.target.value }, 'card:read')}
          placeholder="What a teammate tends to do here, and how the plan uses it."
          className={`${field} p-2.5 w-full`}
        />
      </label>
    </section>
  )
}
