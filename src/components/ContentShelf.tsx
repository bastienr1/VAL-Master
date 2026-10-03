import { Children, useState } from 'react'
import ScrollRow from './ScrollRow'

interface ContentShelfProps {
  title: string
  /** Shown when the shelf has no cards: how to put something on it. */
  emptyLine: string
  /** One card per child. */
  children: React.ReactNode
  /** Something small beside the title — a link to the full list, say. */
  action?: React.ReactNode
  /** A row between the heading and the cards — a chip filter, say. Shown whenever given. */
  toolbar?: React.ReactNode
}

/**
 * One shelf of a Map Hub: a titled, counted row of cards. A row with more than
 * fits offers "View all", which lays the same cards out as a grid. An empty
 * shelf stays on the page and says how to fill it.
 */
export default function ContentShelf({ title, emptyLine, children, action, toolbar }: ContentShelfProps) {
  const cards = Children.toArray(children)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-lg font-bold tracking-wide flex items-baseline gap-3">
          <span>
            {title}
            <span className="ml-2 font-stats text-xs font-normal text-text-muted">{cards.length}</span>
          </span>
          {action}
        </h2>
        {cards.length > 0 && (overflowing || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded(open => !open)}
            aria-expanded={expanded}
            className="text-xs text-text-secondary hover:text-val-cyan transition-colors"
          >
            {expanded ? 'Show less' : `View all ${cards.length}`}
          </button>
        )}
      </div>

      {toolbar}

      {cards.length === 0 ? (
        <p className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">{emptyLine}</p>
      ) : expanded ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{cards}</div>
      ) : (
        <ScrollRow label={title} onOverflowChange={setOverflowing}>
          {cards.map((card, i) => (
            <div key={i} className="snap-start shrink-0 w-72">
              {card}
            </div>
          ))}
        </ScrollRow>
      )}
    </section>
  )
}
