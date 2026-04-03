import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { Match } from '../lib/types'
import { ArrowLeft, Film, Crosshair, Target, Swords, Percent } from 'lucide-react'

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-text-muted" />
      <span className="text-xs text-text-muted uppercase">{label}</span>
      <span className="text-sm font-stats font-medium text-text-primary">{value}</span>
    </div>
  )
}

export default function VodReview() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function loadMatch() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .eq('match_id', matchId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (error) throw error
        if (!data) {
          setNotFound(true)
        } else {
          setMatch(data)
        }
      } catch (err) {
        console.error('Failed to load match:', err)
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    loadMatch()
  }, [matchId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !match) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-heading font-bold mb-4">Match not found</h2>
        <Link to="/" className="flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to Matches
        </Link>
      </div>
    )
  }

  const resultColor = match.result === 'W' ? 'val-green' : match.result === 'L' ? 'val-red' : 'val-yellow'
  const resultLabel = match.result === 'W' ? 'VICTORY' : match.result === 'L' ? 'DEFEAT' : 'DRAW'
  const date = new Date(match.match_date)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>

      {/* Match header card */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
        <div className="relative h-40">
          <img
            src={getMapSplash(match.map)}
            alt={match.map}
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

          {/* Agent + Map info */}
          <div className="absolute bottom-3 left-4 flex items-center gap-3">
            <img
              src={getAgentIcon(match.agent)}
              alt={match.agent}
              className="w-14 h-14 rounded-full border-2 border-bg-card"
            />
            <div>
              <h1 className="text-lg font-heading font-bold">{match.agent} on {match.map}</h1>
              <p className="text-xs text-text-secondary">{dateStr} &middot; {timeStr} &middot; {match.mode}</p>
            </div>
          </div>

          {/* Score + Result */}
          <div className="absolute bottom-3 right-4 text-right">
            <div className={`text-3xl font-stats font-bold text-${resultColor}`}>{match.score}</div>
            <div className={`text-xs font-bold text-${resultColor}`}>{resultLabel}</div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-4 py-3 border-t border-bg-elevated flex items-center gap-6 flex-wrap">
          <Stat icon={Target} label="ACS" value={match.acs} />
          <Stat icon={Crosshair} label="K/D" value={match.kd} />
          <Stat icon={Swords} label="KDA" value={`${match.kills}/${match.deaths}/${match.assists}`} />
          <Stat icon={Percent} label="HS" value={`${match.headshot_pct}%`} />
          <Stat icon={Crosshair} label="KPR" value={match.kpr} />
          <Stat icon={Target} label="DPR" value={match.dpr} />
        </div>
      </div>

      {/* Sprint 2 placeholder */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl p-12 flex flex-col items-center text-center">
        <Film className="w-16 h-16 text-text-muted mb-4" />
        <h2 className="text-xl font-heading font-bold mb-2">VOD Review — Coming in Sprint 2</h2>
        <p className="text-text-secondary text-sm max-w-md">
          This is where you'll be able to review your gameplay footage, tag key moments,
          add round-by-round notes, and track patterns across your matches.
        </p>
      </div>
    </div>
  )
}
