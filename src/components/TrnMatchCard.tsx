import { ExternalLink } from 'lucide-react'
import { getAgentIcon } from '../lib/constants'
import { trnMatchUrl } from '../lib/trn'
import type { Match } from '../lib/types'

interface TrnMatchCardProps {
  match: Match
  /** e.g. "Jo3ast#9537" — from the profile, optional. */
  playerId?: string
  /** Per-match override; falls back to the id-derived URL when absent. */
  trackerUrl?: string | null
  className?: string
}

function resultMeta(result: Match['result']) {
  if (result === 'W') return { color: 'text-val-green', border: 'border-val-green/30', bg: 'bg-val-green/10', label: 'WIN' }
  if (result === 'L') return { color: 'text-val-red', border: 'border-val-red/30', bg: 'bg-val-red/10', label: 'LOSS' }
  return { color: 'text-val-yellow', border: 'border-val-yellow/30', bg: 'bg-val-yellow/10', label: 'DRAW' }
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="bg-bg-elevated rounded-lg px-3 py-2 min-w-0">
      <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
      <div
        className={`font-stats text-sm font-medium tabular-nums truncate ${accent ? 'text-val-green' : 'text-text-primary'}`}
      >
        {value}
      </div>
    </div>
  )
}

export default function TrnMatchCard({ match, playerId, trackerUrl, className = '' }: TrnMatchCardProps) {
  const url = trackerUrl ?? trnMatchUrl(match.match_id)
  const { color, border, bg, label } = resultMeta(match.result)
  const agentIcon = getAgentIcon(match.agent)

  const date = new Date(match.match_date)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const title = `${match.agent} on ${match.map}`

  return (
    <div className={`bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3 ${className}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 min-w-0">
        {agentIcon ? (
          <img
            src={agentIcon}
            alt={match.agent}
            className="w-10 h-10 rounded-full border border-bg-elevated shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full border border-bg-elevated bg-bg-elevated shrink-0" aria-hidden />
        )}

        <div className="min-w-0">
          <div className="font-heading text-sm font-bold text-text-primary truncate" title={title}>
            {title}
          </div>
          <div className="text-xs text-text-muted truncate" title={playerId}>
            {dateStr}
            {playerId ? ` · ${playerId}` : ''}
          </div>
        </div>

        <div className={`ml-auto shrink-0 flex items-center gap-2 px-2.5 py-1 rounded-md border ${border} ${bg}`}>
          <span className={`font-stats text-sm font-medium tabular-nums ${color}`}>{match.score}</span>
          <span className={`text-[10px] font-bold tracking-widest ${color}`}>{label}</span>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatTile label="ACS" value={match.acs} />
        <StatTile label="K/D/A" value={`${match.kills}/${match.deaths}/${match.assists}`} />
        <StatTile label="K/D" value={match.kd} accent={match.kd > 1} />
        <StatTile label="HS%" value={`${match.headshot_pct}%`} />
        <StatTile label="KPR" value={match.kpr} />
        <StatTile label="DPR" value={match.dpr} />
      </div>

      {/* CTA */}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-val-cyan/10 border border-val-cyan/20 text-val-cyan hover:bg-val-cyan/20 transition-colors font-heading text-sm font-bold"
        >
          View full report on tracker.gg
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : (
        <div className="text-center text-xs text-text-muted py-2">
          TRN report unavailable for this match
        </div>
      )}
    </div>
  )
}
