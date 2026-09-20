import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { getGuideCounts, listReviews, type GuideCounts } from '../lib/referenceReviews'
import { agentImageFor, mapImageFor } from '../lib/gameContent'
import { useGameContent } from '../hooks/useGameContent'
import GameImage from '../components/GameImage'
import type { GuideContentType, ReferenceReview } from '../lib/types'

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

/**
 * The two capture surfaces, as the chip row spells them.
 *
 * There is no "All" chip: `FilterRow` clears on a click of the active chip, so
 * no selection already means everything — one convention across all five rows.
 */
const SOURCE_LABELS = { 'Pro VODs': 'notion', Guides: 'vault' } as const
type SourceLabel = keyof typeof SOURCE_LABELS

const CONTENT_TYPES: GuideContentType[] = [
  'map-guide',
  'pro-review',
  'agent-guide',
  'mechanics',
  'mindset',
]

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
            // Vault creators can be a sentence ("Unknown (coaching dojo VOD —
            // names in chat: …)"); the full value stays in the tooltip.
            title={option}
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
            <span className={`truncate max-w-[14rem] ${iconFor ? '' : 'pl-1.5'}`}>{option}</span>
          </button>
        )
      })}
    </div>
  )
}

function ReviewCard({ review, counts }: { review: ReferenceReview; counts?: GuideCounts }) {
  // Only 5 of 70 seeded rows carry a date and none carry an event, so neither
  // gets a permanent slot — they sit over the splash when they exist, and the
  // card keeps one height either way.
  const stamp = review.played_at ? formatPlayedAt(review.played_at) : review.event

  const isGuide = review.source === 'vault'
  const agentSrc = agentSrcFor(review)

  // A guide answers "what is this" with its creator and its structure, where a
  // pro VOD answers with the player and the agent · map they played.
  const heading = isGuide ? review.creator ?? review.player : review.player
  const subLine = isGuide
    ? [
        `${counts?.chapters ?? 0} chapter${counts?.chapters === 1 ? '' : 's'}`,
        `${counts?.drills ?? 0} drill${counts?.drills === 1 ? '' : 's'}`,
      ].join(' · ')
    : [review.agent, review.map].filter(Boolean).join(' · ') || 'Pro VOD'

  return (
    <Link
      to={`/study/${review.id}`}
      className="group block bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all"
    >
      <div className="relative h-28">
        <GameImage
          kind="map"
          // A guide covering several maps has no single splash; the first one is
          // the closest thing, and the placeholder covers the rest.
          src={mapSrcFor(review)}
          alt={review.map ?? 'Unknown map'}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

        {isGuide && review.content_type ? (
          <span className="absolute top-2 left-3 px-1.5 py-0.5 rounded bg-val-yellow/15 text-val-yellow text-[10px] font-medium">
            {review.content_type}
          </span>
        ) : (
          review.team && (
            <span className="absolute top-2 left-3 px-1.5 py-0.5 rounded bg-bg-primary/70 text-text-secondary text-[10px] font-medium">
              {review.team}
            </span>
          )
        )}
        {stamp && (
          <span className="absolute top-2 right-3 font-stats text-[10px] text-text-secondary">
            {stamp}
          </span>
        )}

        <div className="absolute bottom-2 left-3 right-3 flex items-center gap-2 min-w-0">
          {/* Most guides name no agent; the portrait slot is skipped rather than
              filled with an empty circle, and the card keeps its height. */}
          {(!isGuide || agentSrc) && (
            <GameImage
              kind="agent"
              src={agentSrc}
              alt={review.agent ?? 'Unknown agent'}
              className="w-10 h-10 rounded-full border-2 border-bg-card shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="font-heading font-bold text-base leading-tight text-text-primary truncate">
              {heading}
            </div>
            <div className="text-[11px] text-text-secondary truncate">{subLine}</div>
          </div>
          {counts && counts.activeDrills > 0 && (
            <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-val-cyan/15 text-val-cyan text-[10px] font-medium">
              {counts.activeDrills} active
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function ProStudyLibrary() {
  const [reviews, setReviews] = useState<ReferenceReview[]>([])
  const [counts, setCounts] = useState<Map<string, GuideCounts>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mounted so the grid re-renders once the registry lands; resolution itself
  // is synchronous against the shared cache.
  useGameContent()

  const [source, setSource] = useState<SourceLabel | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [creator, setCreator] = useState<string | null>(null)
  const [player, setPlayer] = useState<string | null>(null)
  const [map, setMap] = useState<string | null>(null)
  const [agent, setAgent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([listReviews(), getGuideCounts()])
      .then(([data, guideCounts]) => {
        if (cancelled) return
        setReviews(data)
        setCounts(guideCounts)
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

  // The whole library is a couple of hundred rows — filtering stays client-side.
  const options = useMemo(() => {
    const unique = (values: Array<string | null>) =>
      [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))

    // Every row the source chip lets through, so the remaining rows offer only
    // chips that can actually match. A guide's `player` column holds its creator
    // as a NOT NULL fallback, which would otherwise put sentence-long coaching
    // credits in the Player row.
    const inScope = source ? reviews.filter(r => r.source === SOURCE_LABELS[source]) : reviews
    const proVods = inScope.filter(r => r.source === 'notion')
    const guides = inScope.filter(r => r.source === 'vault')

    return {
      sources: Object.keys(SOURCE_LABELS).filter(label =>
        reviews.some(r => r.source === SOURCE_LABELS[label as SourceLabel]),
      ),
      // Only the content types actually present, in the skill's own order.
      contentTypes: CONTENT_TYPES.filter(type => inScope.some(r => r.content_type === type)),
      creators: unique(guides.map(r => r.creator)),
      players: unique(proVods.map(r => r.player)),
      maps: unique(inScope.map(r => r.map)),
      agents: unique(inScope.map(r => r.agent)),
    }
  }, [reviews, source])

  const filtered = useMemo(
    () =>
      reviews.filter(
        r =>
          (!source || r.source === SOURCE_LABELS[source]) &&
          (!contentType || r.content_type === contentType) &&
          (!creator || r.creator === creator) &&
          (!player || r.player === player) &&
          (!map || r.map === map) &&
          (!agent || r.agent === agent),
      ),
    [reviews, source, contentType, creator, player, map, agent],
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
            Run <code className="font-stats text-val-cyan">npm run seed:prostudy</code> for pro VODs, or{' '}
            <code className="font-stats text-val-cyan">npm run import:guides</code> for study guides.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <FilterRow
              label="Source"
              options={options.sources}
              selected={source}
              onSelect={value => {
                setSource(value as SourceLabel | null)
                // Content type and creator only mean something inside Guides;
                // a stale one would silently empty the grid.
                if (value !== 'Guides') {
                  setContentType(null)
                  setCreator(null)
                }
                if (value === 'Guides') setPlayer(null)
              }}
            />
            {source === 'Guides' && (
              <>
                <FilterRow
                  label="Type"
                  options={options.contentTypes}
                  selected={contentType}
                  onSelect={setContentType}
                />
                <FilterRow
                  label="Creator"
                  options={options.creators}
                  selected={creator}
                  onSelect={setCreator}
                />
              </>
            )}
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
                <ReviewCard key={review.id} review={review} counts={counts.get(review.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
