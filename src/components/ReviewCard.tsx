import { Link } from 'react-router-dom'
import { agentImageFor, mapImageFor } from '../lib/gameContent'
import { reviewHeading, shortCreator } from '../lib/guideDisplay'
import type { GuideCounts } from '../lib/referenceReviews'
import type { ReferenceReview } from '../lib/types'
import GameImage from './GameImage'

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
 * A Pro Study row — pro VOD or vault guide — as a card that opens its review.
 * One component for the Pro Study library and the Map Hub shelves, so a VOD
 * looks the same wherever it is listed.
 */
export default function ReviewCard({ review, counts }: { review: ReferenceReview; counts?: GuideCounts }) {
  // Only 5 of 70 seeded rows carry a date and none carry an event, so neither
  // gets a permanent slot — they sit over the splash when they exist, and the
  // card keeps one height either way.
  const stamp = review.played_at ? formatPlayedAt(review.played_at) : review.event

  const isGuide = review.source === 'vault'
  const agentSrc = agentSrcFor(review)

  // A guide puts its creator and structure beneath the title, where a pro VOD
  // puts the agent · map beneath the player.
  const heading = reviewHeading(review)
  const subLine = isGuide
    ? [
        shortCreator(review.creator),
        `${counts?.chapters ?? 0} chapter${counts?.chapters === 1 ? '' : 's'}`,
        `${counts?.drills ?? 0} drill${counts?.drills === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : [review.agent, review.map].filter(Boolean).join(' · ') || 'Pro VOD'

  return (
    <Link
      to={`/study/${review.id}`}
      // Titles truncate to one line; the full one stays in the tooltip.
      title={heading}
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
