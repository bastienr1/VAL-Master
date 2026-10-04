import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight, Play, X } from 'lucide-react'
import ArtSlot from '../ArtSlot'
import { useArtSlot } from '../../hooks/useArtSlot'
import { SLOT_KEYS } from '../../lib/artSlots'
import { formatActRange, type ValorantAct } from '../../lib/acts'
import { extractYouTubeId } from '../../lib/youtube'
import { normalizeUrl } from '../../lib/url'
import type { StatSummary } from '../../lib/homeStats'

// The art's own job is the right two thirds; this is what shows before any art
// is added, and behind art that fails to load.
export const HERO_GRADIENT =
  'linear-gradient(115deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 45%, color-mix(in srgb, var(--color-val-red) 30%, var(--color-bg-primary)) 100%)'

interface HomeHeroProps {
  /** Null while matches are loading, or when there are none: the strip shows dashes. */
  summary: StatSummary | null
  loading: boolean
  /** The act behind "This act"; null hides the toggle (nothing played in any act). */
  act: ValorantAct | null
  actIsCurrent: boolean
  choice: 'act' | 'all'
  onChoice: (choice: 'act' | 'all') => void
}

function Stat({ value, label, tone = 'text-text-primary', loading }: { value: string; label: React.ReactNode; tone?: string; loading: boolean }) {
  return (
    <div className="sm:px-6 sm:first:pl-0 sm:border-l sm:first:border-l-0 border-bg-elevated">
      {loading ? (
        <div className="h-9 w-14 rounded bg-bg-elevated/70 animate-pulse" />
      ) : (
        <div className={`font-stats text-3xl font-medium leading-9 ${tone}`}>{value}</div>
      )}
      <div className="text-[11px] uppercase tracking-widest text-text-secondary mt-1">{label}</div>
    </div>
  )
}

function OverviewModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Overview video"
    >
      <div className="relative w-full max-w-4xl aspect-video" onClick={e => e.stopPropagation()}>
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
          title="Overview video"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="w-full h-full rounded-lg shadow-2xl"
        />
      </div>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
        aria-label="Close video"
      >
        <X className="w-5 h-5" />
      </button>
    </div>,
    document.body,
  )
}

export default function HomeHero({ summary, loading, act, actIsCurrent, choice, onChoice }: HomeHeroProps) {
  const { href } = useArtSlot(SLOT_KEYS.hero)
  const [videoOpen, setVideoOpen] = useState(false)

  // Only a link saved on the hero's art puts the button there; there is no
  // default video. A YouTube link plays in place, anything else opens in a tab.
  const overviewUrl = href ? normalizeUrl(href) : null
  const overviewVideoId = overviewUrl ? extractYouTubeId(overviewUrl) : null

  const overviewClass = 'group inline-flex items-center gap-3 text-sm font-medium text-text-primary'
  const overviewLabel = (
    <>
      <span className="w-11 h-11 rounded-full border-2 border-val-red flex items-center justify-center group-hover:bg-val-red/20 transition-colors">
        <Play className="w-4 h-4 fill-current translate-x-px" />
      </span>
      Watch Overview
    </>
  )

  const dash = '—'
  const scopeButton = (active: boolean) =>
    `px-3 py-1 text-xs font-medium rounded-md transition-colors ${
      active ? 'bg-val-cyan/20 text-val-cyan' : 'text-text-secondary hover:text-text-primary'
    }`

  return (
    <ArtSlot slotKey={SLOT_KEYS.hero} scrim="left" priority gradientFallback={HERO_GRADIENT} className="border-b border-bg-elevated">
      <div className="relative max-w-7xl mx-auto px-5 sm:px-10 py-10 sm:py-14 min-h-[26rem] flex flex-col justify-center">
        <h1 className="font-display italic font-extrabold uppercase leading-[0.86] text-6xl sm:text-7xl lg:text-8xl">
          <span className="block">Review</span>
          <span className="block text-text-secondary">Learn</span>
          <span className="block text-val-red">Improve</span>
        </h1>
        <p className="mt-4 text-sm sm:text-base uppercase tracking-[0.22em] text-text-secondary">
          Same games. Different you.
        </p>

        <div className="mt-7 flex items-center gap-3 flex-wrap">
          {act && (
            <div className="flex bg-bg-card/80 rounded-lg p-1" role="group" aria-label="Stats period">
              <button
                type="button"
                onClick={() => onChoice('act')}
                aria-pressed={choice === 'act'}
                title={`${act.label} · ${formatActRange(act)}`}
                className={scopeButton(choice === 'act')}
              >
                {/* An earlier act standing in for an empty new one is named, so
                    "This act" never describes last act's numbers. */}
                {actIsCurrent ? 'This act' : act.code}
              </button>
              <button
                type="button"
                onClick={() => onChoice('all')}
                aria-pressed={choice === 'all'}
                className={scopeButton(choice === 'all')}
              >
                All time
              </button>
            </div>
          )}
          {act && choice === 'act' && (
            <span className="font-stats text-[11px] text-text-muted">
              {actIsCurrent ? act.code : `No matches in the current act yet · showing ${act.shortLabel}`}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:gap-0">
          <Stat
            loading={loading}
            value={summary ? String(summary.total) : dash}
            label={
              <>
                Matches
                {summary && summary.draws > 0 && (
                  <span className="normal-case tracking-normal text-text-muted">
                    {' '}· {summary.draws} {summary.draws === 1 ? 'draw' : 'draws'}
                  </span>
                )}
              </>
            }
          />
          <Stat loading={loading} value={summary ? String(summary.wins) : dash} label="Wins" tone="text-val-cyan" />
          <Stat loading={loading} value={summary ? String(summary.losses) : dash} label="Losses" tone="text-val-red" />
          <Stat
            loading={loading}
            value={summary && summary.winRate !== null ? `${summary.winRate}%` : dash}
            label="Win rate"
          />
        </div>

        <div className="mt-8 flex items-center gap-5 flex-wrap">
          <Link
            to="/matches"
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-md bg-val-red text-white text-sm font-medium hover:bg-val-red/90 transition-colors"
          >
            Enter Match Library
            <ArrowRight className="w-4 h-4" />
          </Link>

          {overviewUrl &&
            (overviewVideoId ? (
              <button type="button" onClick={() => setVideoOpen(true)} className={overviewClass}>
                {overviewLabel}
              </button>
            ) : (
              <a href={overviewUrl} target="_blank" rel="noopener noreferrer" className={overviewClass}>
                {overviewLabel}
              </a>
            ))}
        </div>
      </div>

      {videoOpen && overviewVideoId && <OverviewModal videoId={overviewVideoId} onClose={() => setVideoOpen(false)} />}
    </ArtSlot>
  )
}
