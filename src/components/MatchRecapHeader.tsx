import { useState, useEffect } from 'react'
import { Target, Crosshair, Swords, Percent, ChevronUp, ChevronDown } from 'lucide-react'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { Match } from '../lib/types'

interface MatchRecapHeaderProps {
  match: Match
}

function resultMeta(result: Match['result']) {
  if (result === 'W') return { color: 'text-val-green', label: 'VICTORY' }
  if (result === 'L') return { color: 'text-val-red', label: 'DEFEAT' }
  return { color: 'text-val-yellow', label: 'DRAW' }
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-text-muted shrink-0" />
      <span className="text-[10px] text-text-muted uppercase tracking-wide w-8">{label}</span>
      <span className="font-stats text-sm font-medium text-text-primary">{value}</span>
    </div>
  )
}

export default function MatchRecapHeader({ match }: MatchRecapHeaderProps) {
  const [mode, setMode] = useState<'expanded' | 'collapsed'>('expanded')
  const { color: resultColor, label: resultLabel } = resultMeta(match.result)

  // Auto-collapse on first scroll past 100px
  useEffect(() => {
    if (mode === 'collapsed') return
    const onScroll = () => {
      if (window.scrollY > 100) setMode('collapsed')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [mode])

  const date = new Date(match.match_date)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  if (mode === 'collapsed') {
    return (
      <div className="sticky top-0 z-30 bg-bg-card border-b border-bg-elevated">
        <div className="flex items-center gap-2 px-4 h-8 text-xs">
          <img
            src={getAgentIcon(match.agent)}
            alt={match.agent}
            className="w-6 h-6 rounded-full border border-bg-elevated shrink-0"
          />
          <span className="text-text-primary font-medium">{match.agent}</span>
          <span className="text-text-muted">·</span>
          <span className="text-text-secondary">{match.map}</span>
          <span className="text-text-muted">·</span>
          <span className={`font-stats ${resultColor}`}>{match.score}</span>
          <span className="text-text-muted">·</span>
          <span className={`font-bold tracking-widest text-[10px] ${resultColor}`}>{resultLabel}</span>
          <button
            onClick={() => setMode('expanded')}
            className="ml-auto p-1 text-text-muted hover:text-val-cyan transition-colors"
            title="Expand recap"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sticky top-0 z-30 relative overflow-hidden rounded-xl bg-gradient-to-b from-bg-elevated to-bg-primary border border-bg-elevated">
      <img
        src={getMapSplash(match.map)}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover opacity-10 pointer-events-none"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/40 via-transparent to-bg-primary/40 pointer-events-none" />

      <div className="relative grid items-center gap-x-4" style={{ gridTemplateColumns: 'auto 1fr auto', padding: '14px 18px' }}>
        {/* LEFT — agent + meta */}
        <div className="flex items-center gap-3">
          <img
            src={getAgentIcon(match.agent)}
            alt={match.agent}
            className="w-14 h-14 rounded-full border-2 border-bg-card"
          />
          <div>
            <div className="font-heading text-base font-medium text-text-primary leading-tight">
              {match.agent} on {match.map}
            </div>
            <div className="text-xs text-text-muted">{dateStr} · {timeStr}</div>
          </div>
        </div>

        {/* CENTER — 3x2 stat grid */}
        <div className="grid grid-cols-3 gap-x-5 gap-y-1.5 px-4">
          <StatCell icon={Target} label="ACS" value={match.acs} />
          <StatCell icon={Crosshair} label="K/D" value={match.kd} />
          <StatCell icon={Swords} label="KDA" value={`${match.kills}/${match.deaths}/${match.assists}`} />
          <StatCell icon={Percent} label="HS%" value={`${match.headshot_pct}%`} />
          <StatCell icon={Crosshair} label="KPR" value={match.kpr} />
          <StatCell icon={Target} label="DPR" value={match.dpr} />
        </div>

        {/* RIGHT — score + result */}
        <div className="flex items-center gap-3 pl-4 border-l border-bg-elevated">
          <div className="text-right">
            <div className={`font-stats text-2xl font-medium ${resultColor}`}>{match.score}</div>
            <div className={`text-[10px] font-bold tracking-widest ${resultColor}`}>{resultLabel}</div>
          </div>
        </div>
      </div>

      <button
        onClick={() => setMode('collapsed')}
        className="absolute top-2 right-2 px-1.5 py-0.5 bg-bg-card/80 text-text-muted hover:text-val-cyan rounded transition-colors text-xs flex items-center"
        title="Collapse recap"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
