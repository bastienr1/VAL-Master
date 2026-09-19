import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { getAllReviews } from '../lib/referenceReviews'
import { agentImageFor, mapImageFor } from '../lib/gameContent'
import { useGameContent } from '../hooks/useGameContent'
import GameImage from '../components/GameImage'
import type { ReferenceReview } from '../lib/types'

/**
 * Seeded rows carry map/agent names only — no ids — so the registry resolves
 * them by name, exactly as it does for pre-registry match rows. A name it does
 * not know returns null and `GameImage` shows its placeholder.
 */
function mapSrcFor(review: ReferenceReview): string | null {
  return review.map ? mapImageFor({ map: review.map }) : null
}

function agentSrcFor(review: ReferenceReview): string | null {
  return review.agent ? agentImageFor({ agent: review.agent }) : null
}

/** "12 Mar 2026", or a dash when the Notion row carried no date. */
function formatPlayedAt(played: string | null): string {
  if (!played) return '—'
  const date = new Date(`${played}T00:00:00`)
  if (Number.isNaN(date.getTime())) return played
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface FilterRowProps {
  label: string
  options: string[]
  selected: string | null
  onSelect: (value: string | null) => void
  /** Optional per-option thumbnail — agents are quicker to spot by face. */
  iconFor?: (option: string) => string | null
}

function FilterRow({ label, options, selected, onSelect, iconFor }: FilterRowProps) {
  if (options.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-text-muted w-12 shrink-0">{label}</span>
      {options.map(option => {
        const active = selected === option
        return (
          <button
            key={option}
            type="button"
            // Clicking the active chip clears it — no separate "All" chip needed.
            onClick={() => onSelect(active ? null : option)}
            className={`pl-1 pr-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
              active
                ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
                : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
            }`}
          >
            {iconFor && (
              <GameImage
                kind="agent"
                src={iconFor(option)}
                alt=""
                className="w-4 h-4 rounded-full shrink-0"
              />
            )}
            <span className={iconFor ? '' : 'pl-1.5'}>{option}</span>
          </button>
        )
      })}
    </div>
  )
}

function ReviewCard({ review }: { review: ReferenceReview }) {
  // Only 5 of 70 seeded rows carry a date and none carry an event, so neither
  // gets a permanent slot — they sit over the splash when they exist, and the
  // card keeps one height either way.
  const stamp = review.played_at ? formatPlayedAt(review.played_at) : review.event

  return (
    <Link
      to={`/study/${review.id}`}
      className="group block bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all"
    >
      <div className="relative h-28">
        <GameImage
          kind="map"
          src={mapSrcFor(review)}
          alt={review.map ?? 'Unknown map'}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

        {review.team && (
          <span className="absolute top-2 left-3 px-1.5 py-0.5 rounded bg-bg-primary/70 text-text-secondary text-[10px] font-medium">
            {review.team}
          </span>
        )}
        {stamp && (
          <span className="absolute top-2 right-3 font-stats text-[10px] text-text-secondary">
            {stamp}
          </span>
        )}

        <div className="absolute bottom-2 left-3 right-3 flex items-center gap-2 min-w-0">
          <GameImage
            kind="agent"
            src={agentSrcFor(review)}
            alt={review.agent ?? 'Unknown agent'}
            className="w-10 h-10 rounded-full border-2 border-bg-card shrink-0"
          />
          <div className="min-w-0">
            <div className="font-heading font-bold text-base leading-tight text-text-primary truncate">
              {review.player}
            </div>
            <div className="text-[11px] text-text-secondary truncate">
              {[review.agent, review.map].filter(Boolean).join(' · ') || 'Pro VOD'}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function ProStudyLibrary() {
  const [reviews, setReviews] = useState<ReferenceReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mounted so the grid re-renders once the registry lands; resolution itself
  // is synchronous against the shared cache.
  useGameContent()

  const [player, setPlayer] = useState<string | null>(null)
  const [map, setMap] = useState<string | null>(null)
  const [agent, setAgent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getAllReviews()
      .then(data => {
        if (!cancelled) setReviews(data)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The whole library is a couple of dozen rows — filtering stays client-side.
  const options = useMemo(() => {
    const unique = (values: Array<string | null>) =>
      [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))

    return {
      players: unique(reviews.map(r => r.player)),
      maps: unique(reviews.map(r => r.map)),
      agents: unique(reviews.map(r => r.agent)),
    }
  }, [reviews])

  const filtered = useMemo(
    () =>
      reviews.filter(
        r =>
          (!player || r.player === player) &&
          (!map || r.map === map) &&
          (!agent || r.agent === agent),
      ),
    [reviews, player, map, agent],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-val-cyan" />
        <h1 className="font-heading text-xl font-bold tracking-wide">Pro Study</h1>
        <span className="text-text-muted text-xs ml-1">
          {filtered.length === reviews.length
            ? `${reviews.length} VOD${reviews.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${reviews.length}`}
        </span>
      </div>

      {error && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          Couldn't load pro VODs — {error}
        </div>
      )}

      {reviews.length === 0 && !error ? (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 flex flex-col items-center text-center">
          <GraduationCap className="w-12 h-12 text-text-muted mb-3" />
          <h2 className="text-lg font-heading font-bold mb-1">No pro VODs yet</h2>
          <p className="text-text-secondary text-sm">
            No pro VODs yet — run <code className="font-stats text-val-cyan">npm run seed:prostudy</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <FilterRow label="Player" options={options.players} selected={player} onSelect={setPlayer} />
            <FilterRow label="Map" options={options.maps} selected={map} onSelect={setMap} />
            <FilterRow
              label="Agent"
              options={options.agents}
              selected={agent}
              onSelect={setAgent}
              iconFor={name => agentImageFor({ agent: name })}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-text-muted text-sm py-8 text-center">
              No pro VODs match those filters.
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map(review => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
