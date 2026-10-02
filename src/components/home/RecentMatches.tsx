import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import GameImage from '../GameImage'
import SectionHeader from './SectionHeader'
import { agentImageFor, mapImageFor } from '../../lib/gameContent'
import { formatScore, type HomeMatch } from '../../lib/homeStats'

const RESULT = {
  W: { label: 'Victory', text: 'text-val-cyan', chip: 'bg-val-cyan/15 text-val-cyan border-val-cyan/30' },
  L: { label: 'Defeat', text: 'text-val-red', chip: 'bg-val-red/15 text-val-red border-val-red/30' },
  draw: { label: 'Draw', text: 'text-val-yellow', chip: 'bg-val-yellow/15 text-val-yellow border-val-yellow/30' },
} as const

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function FeaturedMatch({ match }: { match: HomeMatch }) {
  const result = RESULT[match.result]
  return (
    <Link
      // The Riot match id, the same key the Match Library and search open.
      to={`/review/${match.match_id}`}
      className="group relative flex items-end min-h-[14rem] rounded-xl overflow-hidden border border-val-red/40 hover:border-val-red transition-colors"
    >
      <GameImage
        kind="map"
        src={mapImageFor(match)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-70 transition-opacity"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg-primary via-bg-primary/70 to-transparent" />

      <div className="relative w-full p-5 flex flex-col">
        <div className="text-[11px] text-text-secondary">{shortDate(match.match_date)}</div>
        <div className="font-display italic font-bold uppercase text-4xl leading-none tracking-wide">{match.map}</div>
        <div className={`mt-2 font-stats text-4xl font-medium leading-none ${result.text}`}>{formatScore(match.score)}</div>
        <span className={`mt-3 self-start px-2.5 py-0.5 rounded border text-[11px] font-medium uppercase tracking-widest ${result.chip}`}>
          {result.label}
        </span>
        <div className="mt-4 flex items-center gap-2.5">
          <GameImage
            kind="agent"
            src={agentImageFor(match)}
            alt=""
            className="w-9 h-9 rounded-full border-2 border-bg-card"
          />
          <span className="text-sm font-medium">{match.agent}</span>
        </div>
      </div>

      <span
        aria-hidden="true"
        className="absolute bottom-5 right-5 w-11 h-11 rounded-full border-2 border-val-red flex items-center justify-center bg-bg-primary/60 group-hover:bg-val-red/25 transition-colors"
      >
        <Play className="w-4 h-4 fill-current translate-x-px" />
      </span>
      <span className="sr-only">
        Review {match.agent} on {match.map}, {result.label} {formatScore(match.score)}
      </span>
    </Link>
  )
}

function MatchRow({ match }: { match: HomeMatch }) {
  const result = RESULT[match.result]
  return (
    <Link
      to={`/review/${match.match_id}`}
      className="group relative flex items-center gap-4 flex-1 min-h-[4.25rem] px-4 rounded-xl overflow-hidden border border-bg-elevated hover:border-val-cyan/40 transition-colors"
    >
      <GameImage
        kind="map"
        src={mapImageFor(match)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-25 group-hover:opacity-35 transition-opacity"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 via-bg-primary/50 to-bg-primary/80" />

      <div className="relative w-24 sm:w-28 shrink-0">
        <div className="font-heading font-bold uppercase tracking-wide leading-tight truncate">{match.map}</div>
        <div className={`font-stats text-lg leading-tight ${result.text}`}>{formatScore(match.score)}</div>
      </div>

      <div className="relative flex items-center gap-2.5 min-w-0 flex-1">
        <GameImage
          kind="agent"
          src={agentImageFor(match)}
          alt=""
          className="w-9 h-9 rounded-full border-2 border-bg-card shrink-0"
        />
        <span className="text-sm font-medium truncate">{match.agent}</span>
      </div>

      <div className="relative text-right shrink-0">
        <div className="font-stats text-lg leading-tight text-text-primary">
          {match.acs} <span className="text-[10px] uppercase tracking-wider text-text-muted">ACS</span>
        </div>
        <div className="font-stats text-[11px] text-text-secondary">
          {match.kills}/{match.deaths}/{match.assists} <span className="text-text-muted">K/D/A</span>
        </div>
      </div>
    </Link>
  )
}

/** The latest match as a featured card, the three before it as rows. */
export default function RecentMatches({ matches }: { matches: HomeMatch[] }) {
  const [latest, ...rest] = matches
  if (!latest) return null
  const rows = rest.slice(0, 3)

  return (
    <section className="space-y-5">
      <SectionHeader
        title="Recent Matches"
        subtitle="Pick up where you left off."
        link={{ to: '/matches', label: 'View All Matches' }}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <FeaturedMatch match={latest} />
        {rows.length > 0 && (
          <div className="flex flex-col gap-3">
            {rows.map(match => (
              <MatchRow key={match.match_id} match={match} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
