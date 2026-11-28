import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookMarked, FolderOpen, Layers, Star } from 'lucide-react'
import ArtSlot from '../ArtSlot'
import { HERO_GRADIENT } from '../home/HomeHero'
import { SLOT_KEYS } from '../../lib/artSlots'

/** The line-ups pages' tabs. Only the library is built; the others are where flashcards, collections and bookmarks will go. */
const TABS = [
  { key: 'library', label: 'Library', icon: BookMarked },
  { key: 'flashcards', label: 'Flashcards', icon: Layers },
  { key: 'collections', label: 'Collections', icon: FolderOpen },
  { key: 'mine', label: 'My Line-ups', icon: Star },
] as const

/**
 * The top of both line-ups pages: a banner with the title (its picture is the
 * "Line-ups banner" art slot, set from the home page's art manager), the back
 * link above it, and the tabs under it with `right` at their end.
 */
export default function LineupsHeader({ back, right }: { back: { to: string; label: string }; right?: ReactNode }) {
  return (
    <div className="space-y-3">
      <ArtSlot slotKey={SLOT_KEYS.lineupsHero} scrim="left" gradientFallback={HERO_GRADIENT} className="rounded-xl border border-bg-elevated">
        <div className="relative px-6 sm:px-8 pt-4 pb-6 min-h-[132px] flex flex-col justify-end">
          <Link to={back.to} className="absolute top-3 left-6 sm:left-8 text-sm text-text-secondary hover:text-val-cyan transition-colors">
            {back.label}
          </Link>
          <h1 className="font-display italic font-extrabold uppercase text-5xl leading-none tracking-wide text-text-primary drop-shadow">Line-ups</h1>
          <p className="mt-1.5 text-text-secondary text-sm sm:text-base">Master throwable line-ups for every map, agent and situation.</p>
        </div>
      </ArtSlot>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-bg-elevated">
        <nav className="flex flex-wrap -mb-px" aria-label="Line-ups">
          {TABS.map(({ key, label, icon: Icon }) =>
            key === 'library' ? (
              <span
                key={key}
                aria-current="page"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-t-lg border-b-2 border-val-red bg-val-red/10 text-text-primary font-heading font-semibold text-base"
              >
                <Icon className="w-4 h-4 text-val-red" />
                {label}
              </span>
            ) : (
              <span
                key={key}
                aria-disabled="true"
                title="Not built yet"
                className="inline-flex items-center gap-2 px-4 py-2.5 border-b-2 border-transparent text-text-muted font-heading font-semibold text-base cursor-default"
              >
                <Icon className="w-4 h-4" />
                {label}
                <span className="text-[10px] font-sans font-normal uppercase tracking-wider opacity-70">Soon</span>
              </span>
            ),
          )}
        </nav>
        {right && <div className="flex flex-wrap items-center gap-2 pb-2">{right}</div>}
      </div>
    </div>
  )
}
