import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { getAllReviews } from '../lib/referenceReviews'
import type { ReferenceReview } from '../lib/types'

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
}

function FilterRow({ label, options, selected, onSelect }: FilterRowProps) {
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
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              active
                ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
                : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function ReviewCard({ review }: { review: ReferenceReview }) {
  return (
    <Link
      to={`/study/${review.id}`}
      className="block bg-bg-card border border-bg-elevated rounded-xl p-4 hover:border-val-cyan/40 transition-colors"
    >
      <div className="flex items-start gap-2 mb-2">
        <h3 className="font-heading font-bold text-lg leading-tight text-text-primary min-w-0 truncate">
          {review.player}
        </h3>
        {review.team && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px] font-medium">
            {review.team}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {review.agent && (
          <span className="px-2 py-0.5 rounded-full bg-val-cyan/10 text-val-cyan border border-val-cyan/20 text-[10px] font-medium">
            {review.agent}
          </span>
        )}
        {review.map && (
          <span className="px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary text-[10px] font-medium">
            {review.map}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="font-stats text-[10px] text-text-muted">{formatPlayedAt(review.played_at)}</span>
        {review.event && (
          <span className="text-[10px] text-text-muted truncate min-w-0">· {review.event}</span>
        )}
      </div>
    </Link>
  )
}

export default function ProStudyLibrary() {
  const [reviews, setReviews] = useState<ReferenceReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
            <FilterRow label="Agent" options={options.agents} selected={agent} onSelect={setAgent} />
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
