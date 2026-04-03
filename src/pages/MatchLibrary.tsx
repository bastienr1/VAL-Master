import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchRecentMatches } from '../lib/henrik'
import { getMapSplash, getAgentIcon, MAPS, AGENTS } from '../lib/constants'
import type { Match } from '../lib/types'
import { RefreshCw, Swords, Filter, ChevronDown, Crosshair, Target, Percent } from 'lucide-react'

function StatChip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="w-3 h-3 text-text-muted" />
      <span className="text-[10px] text-text-muted uppercase">{label}</span>
      <span className="text-xs font-stats font-medium text-text-primary">{value}</span>
    </span>
  )
}

function MatchCard({ match, onClick }: { match: Match; onClick: () => void }) {
  const resultColor = match.result === 'W' ? 'val-green' : match.result === 'L' ? 'val-red' : 'val-yellow'
  const resultLabel = match.result === 'W' ? 'W' : match.result === 'L' ? 'L' : 'DRAW'
  const date = new Date(match.match_date)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all"
    >
      <div className="relative h-28">
        <img
          src={getMapSplash(match.map)}
          alt={match.map}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

        {/* Result badge */}
        <div className={`absolute top-2 right-2 px-2 py-0.5 text-xs font-bold rounded border bg-${resultColor}/20 text-${resultColor} border-${resultColor}/30`}>
          {resultLabel}
        </div>

        {/* Agent + Map */}
        <div className="absolute bottom-2 left-3 flex items-center gap-2">
          <img
            src={getAgentIcon(match.agent)}
            alt={match.agent}
            className="w-10 h-10 rounded-full border-2 border-bg-card"
          />
          <div>
            <div className="text-sm font-medium text-text-primary">{match.agent}</div>
            <div className="text-xs text-text-secondary">{match.map}</div>
          </div>
        </div>

        {/* Score */}
        <div className={`absolute bottom-2 right-3 text-xl font-stats font-bold text-${resultColor}`}>
          {match.score}
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <StatChip icon={Target} label="ACS" value={match.acs} />
          <StatChip icon={Crosshair} label="K/D" value={match.kd} />
          <StatChip icon={Swords} label="KDA" value={`${match.kills}/${match.deaths}/${match.assists}`} />
          <StatChip icon={Percent} label="HS" value={`${match.headshot_pct}%`} />
        </div>
        <div className="text-[10px] text-text-muted whitespace-nowrap">
          {dateStr} {timeStr}
        </div>
      </div>
    </button>
  )
}

export default function MatchLibrary() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [resultFilter, setResultFilter] = useState<'all' | 'W' | 'L'>('all')
  const [mapFilter, setMapFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [showMapDropdown, setShowMapDropdown] = useState(false)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)

  const loadMatches = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('user_id', user.id)
        .order('match_date', { ascending: false })
        .limit(50)
      if (error) throw error
      setMatches(data || [])
    } catch (err) {
      console.error('Failed to load matches:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMatches()
  }, [loadMatches])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const results = await fetchRecentMatches(5, 'competitive')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      for (const r of results) {
        await supabase
          .from('matches')
          .upsert({ ...r.match, user_id: user.id }, { onConflict: 'match_id' })
      }
      await loadMatches()
    } catch (err) {
      console.error('Failed to sync matches:', err)
    } finally {
      setSyncing(false)
    }
  }

  const filtered = matches.filter((m) => {
    if (resultFilter !== 'all' && m.result !== resultFilter) return false
    if (mapFilter !== 'all' && m.map !== mapFilter) return false
    if (agentFilter !== 'all' && m.agent !== agentFilter) return false
    return true
  })

  const wins = matches.filter((m) => m.result === 'W').length
  const losses = matches.filter((m) => m.result === 'L').length
  const winRate = matches.length > 0 ? Math.round((wins / matches.length) * 100) : 0

  const playedMaps = [...new Set(matches.map((m) => m.map))].sort()
  const playedAgents = [...new Set(matches.map((m) => m.agent))].sort()
  const filteredMaps = MAPS.filter((m) => playedMaps.includes(m))
  const filteredAgents = AGENTS.filter((a) => playedAgents.includes(a))

  const hasFilters = resultFilter !== 'all' || mapFilter !== 'all' || agentFilter !== 'all'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Match Library</h1>
          <p className="text-text-secondary text-sm">
            {matches.length} matches &middot; {wins}W {losses}L &middot; {winRate}% WR
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Load Latest</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Result pills */}
        <div className="flex bg-bg-card rounded-lg p-1">
          <button
            onClick={() => setResultFilter('all')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              resultFilter === 'all' ? 'bg-val-cyan/20 text-val-cyan' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setResultFilter('W')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              resultFilter === 'W' ? 'bg-val-green/20 text-val-green' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Wins
          </button>
          <button
            onClick={() => setResultFilter('L')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              resultFilter === 'L' ? 'bg-val-red/20 text-val-red' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Losses
          </button>
        </div>

        {/* Map dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowMapDropdown(!showMapDropdown); setShowAgentDropdown(false) }}
            className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-bg-elevated rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            <Filter className="w-3 h-3" />
            <span>{mapFilter === 'all' ? 'Map' : mapFilter}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showMapDropdown && (
            <div className="absolute top-full mt-1 z-50 bg-bg-elevated border border-bg-card rounded-lg shadow-xl max-h-60 overflow-y-auto min-w-[140px]">
              <button
                onClick={() => { setMapFilter('all'); setShowMapDropdown(false) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors text-text-secondary"
              >
                All Maps
              </button>
              {filteredMaps.map((map) => (
                <button
                  key={map}
                  onClick={() => { setMapFilter(map); setShowMapDropdown(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors ${
                    mapFilter === map ? 'text-val-cyan' : 'text-text-primary'
                  }`}
                >
                  {map}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Agent dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowAgentDropdown(!showAgentDropdown); setShowMapDropdown(false) }}
            className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-bg-elevated rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            <Filter className="w-3 h-3" />
            <span>{agentFilter === 'all' ? 'Agent' : agentFilter}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showAgentDropdown && (
            <div className="absolute top-full mt-1 z-50 bg-bg-elevated border border-bg-card rounded-lg shadow-xl max-h-60 overflow-y-auto min-w-[160px]">
              <button
                onClick={() => { setAgentFilter('all'); setShowAgentDropdown(false) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors text-text-secondary"
              >
                All Agents
              </button>
              {filteredAgents.map((agent) => (
                <button
                  key={agent}
                  onClick={() => { setAgentFilter(agent); setShowAgentDropdown(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors flex items-center gap-2 ${
                    agentFilter === agent ? 'text-val-cyan' : 'text-text-primary'
                  }`}
                >
                  <img src={getAgentIcon(agent)} alt={agent} className="w-4 h-4 rounded-full" />
                  {agent}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={() => { setResultFilter('all'); setMapFilter('all'); setAgentFilter('all') }}
            className="text-xs text-val-red hover:text-val-red/80 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Match grid or empty states */}
      {matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Swords className="w-16 h-16 text-text-muted mb-4" />
          <h2 className="text-xl font-heading font-bold mb-2">No matches yet</h2>
          <p className="text-text-secondary text-sm mb-6">Hit Load Latest to sync your recent competitive matches.</p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">Load Latest</span>
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Filter className="w-12 h-12 text-text-muted mb-4" />
          <h2 className="text-lg font-heading font-bold mb-2">No matches match your filters</h2>
          <p className="text-text-secondary text-sm">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((match) => (
            <MatchCard
              key={match.match_id}
              match={match}
              onClick={() => navigate(`/review/${match.match_id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
