import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchRecentMatches } from '../lib/henrik'
import { getMapSplash, getAgentIcon, MAPS, AGENTS } from '../lib/constants'
import type { Match } from '../lib/types'
import { RefreshCw, Swords, Filter, ChevronDown, Crosshair, Target, Percent, Trophy, Calendar, TrendingUp, FileDown, Star } from 'lucide-react'
import {
  VALORANT_ACTS,
  getActForDate,
  getCurrentAct,
  isActComplete,
  formatActRange,
  type ValorantAct,
} from '../lib/acts'

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

function ActRecapCard({
  act,
  matches,
  onMatchClick,
}: {
  act: ValorantAct
  matches: Match[]
  onMatchClick: (matchId: string) => void
}) {
  if (matches.length === 0) return null

  const wins = matches.filter((m) => m.result === 'W').length
  const losses = matches.filter((m) => m.result === 'L').length
  const draws = matches.filter((m) => m.result === 'draw').length
  // Draws excluded from win-rate denominator
  const decisive = wins + losses
  const winRate = decisive > 0 ? Math.round((wins / decisive) * 100) : 0
  const avgAcs = Math.round(matches.reduce((s, m) => s + m.acs, 0) / matches.length)
  const avgKd = (matches.reduce((s, m) => s + m.kd, 0) / matches.length).toFixed(2)
  const avgHs = (matches.reduce((s, m) => s + m.headshot_pct, 0) / matches.length).toFixed(1)

  const mapCounts = matches.reduce<Record<string, number>>((acc, m) => {
    acc[m.map] = (acc[m.map] || 0) + 1
    return acc
  }, {})
  const topMap = Object.entries(mapCounts).sort((a, b) => b[1] - a[1])[0]

  const agentCounts = matches.reduce<Record<string, number>>((acc, m) => {
    acc[m.agent] = (acc[m.agent] || 0) + 1
    return acc
  }, {})
  const topAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]

  const bestMatch = [...matches].sort((a, b) => b.acs - a.acs)[0]

  return (
    <div className="bg-gradient-to-br from-val-cyan/10 via-bg-card to-bg-card border border-val-cyan/20 rounded-xl p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-val-cyan text-xs font-stats uppercase tracking-wider">
            <Trophy className="w-3.5 h-3.5" />
            <span>Act Recap</span>
            <span className="text-text-muted">·</span>
            <span>{act.code}</span>
          </div>
          <h2 className="text-2xl font-heading font-bold mt-1">{act.label}</h2>
          <p className="text-text-secondary text-sm">{formatActRange(act)}</p>
        </div>
        <button
          disabled
          title="Coming in Sprint 6"
          className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated border border-bg-elevated rounded-lg text-xs text-text-muted cursor-not-allowed opacity-60"
        >
          <FileDown className="w-3 h-3" />
          <span>Export PPTX</span>
          <span className="text-[10px] text-val-yellow ml-1">soon</span>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Matches" value={matches.length.toString()} />
        <KpiTile
          label="Win Rate"
          value={`${winRate}%`}
          sub={draws > 0 ? `${wins}W ${losses}L ${draws}D` : `${wins}W ${losses}L`}
          tone={winRate >= 55 ? 'good' : winRate >= 45 ? 'neutral' : 'bad'}
        />
        <KpiTile label="Avg ACS" value={avgAcs.toString()} />
        <KpiTile label="Avg K/D" value={avgKd} sub={`${avgHs}% HS`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {topMap && (
          <HighlightTile
            icon={Calendar}
            label="Most Played Map"
            value={topMap[0]}
            sub={`${topMap[1]} matches`}
          />
        )}
        {topAgent && (
          <HighlightTile
            icon={Star}
            label="Most Played Agent"
            value={topAgent[0]}
            sub={`${topAgent[1]} matches`}
          />
        )}
        {bestMatch && (
          <button
            onClick={() => onMatchClick(bestMatch.match_id)}
            className="text-left bg-bg-elevated/40 border border-bg-elevated rounded-lg p-3 hover:border-val-cyan/30 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider">
              <TrendingUp className="w-3 h-3" />
              <span>Peak Performance</span>
            </div>
            <div className="text-sm font-medium text-text-primary mt-1">
              {bestMatch.agent} on {bestMatch.map}
            </div>
            <div className="text-xs font-stats text-val-cyan">
              {bestMatch.acs} ACS · {bestMatch.kills}/{bestMatch.deaths}/{bestMatch.assists}
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'neutral' | 'bad'
}) {
  const toneClass =
    tone === 'good' ? 'text-val-green' : tone === 'bad' ? 'text-val-red' : 'text-text-primary'
  return (
    <div className="bg-bg-elevated/40 border border-bg-elevated rounded-lg p-3">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-stats font-bold ${toneClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  )
}

function HighlightTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="bg-bg-elevated/40 border border-bg-elevated rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider">
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-text-primary mt-1">{value}</div>
      <div className="text-xs text-text-secondary">{sub}</div>
    </div>
  )
}

export default function MatchLibrary() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [resultFilter, setResultFilter] = useState<'all' | 'W' | 'L' | 'draw'>('all')
  const [mapFilter, setMapFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [showMapDropdown, setShowMapDropdown] = useState(false)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [actFilter, setActFilter] = useState<string>('all')
  const [showActDropdown, setShowActDropdown] = useState(false)

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
    if (actFilter !== 'all') {
      const act = getActForDate(new Date(m.match_date))
      if (!act || act.code !== actFilter) return false
    }
    return true
  })

  const filteredWins = filtered.filter((m) => m.result === 'W').length
  const filteredLosses = filtered.filter((m) => m.result === 'L').length
  const filteredDraws = filtered.filter((m) => m.result === 'draw').length
  // Draws excluded from win-rate denominator — they're neither a win nor a loss
  const decisive = filteredWins + filteredLosses
  const filteredWinRate = decisive > 0 ? Math.round((filteredWins / decisive) * 100) : 0

  const playedMaps = [...new Set(matches.map((m) => m.map))].sort()
  const playedAgents = [...new Set(matches.map((m) => m.agent))].sort()
  const filteredMaps = MAPS.filter((m) => playedMaps.includes(m))
  const filteredAgents = AGENTS.filter((a) => playedAgents.includes(a))

  const playedActCodes = new Set(
    matches
      .map((m) => getActForDate(new Date(m.match_date))?.code)
      .filter((c): c is string => Boolean(c))
  )
  const playableActs = VALORANT_ACTS.filter((a) => playedActCodes.has(a.code))
  const currentAct = getCurrentAct()
  const selectedAct: ValorantAct | null =
    actFilter === 'all' ? null : VALORANT_ACTS.find((a) => a.code === actFilter) ?? null
  const showRecap = selectedAct !== null && isActComplete(selectedAct)

  const hasFilters =
    resultFilter !== 'all' || mapFilter !== 'all' || agentFilter !== 'all' || actFilter !== 'all'

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
            {actFilter !== 'all' && (
              <span className="text-val-cyan font-medium mr-1">{actFilter} ·</span>
            )}
            {filtered.length} matches &middot; {filteredWins}W {filteredLosses}L
            {filteredDraws > 0 && <> {filteredDraws}D</>}
            {' '}&middot; {filteredWinRate}% WR
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
          <button
            onClick={() => setResultFilter('draw')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              resultFilter === 'draw' ? 'bg-val-yellow/20 text-val-yellow' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Draws
          </button>
        </div>

        {/* Act dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowActDropdown(!showActDropdown)
              setShowMapDropdown(false)
              setShowAgentDropdown(false)
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-bg-elevated rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            <Calendar className="w-3 h-3" />
            <span>{actFilter === 'all' ? 'Act' : actFilter}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showActDropdown && (
            <div className="absolute top-full mt-1 z-50 bg-bg-elevated border border-bg-card rounded-lg shadow-xl max-h-72 overflow-y-auto min-w-[200px]">
              <button
                onClick={() => {
                  setActFilter('all')
                  setShowActDropdown(false)
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors text-text-secondary"
              >
                All Acts
              </button>
              {playableActs.map((act) => {
                const complete = isActComplete(act)
                const isCurrent = currentAct?.code === act.code
                return (
                  <button
                    key={act.code}
                    onClick={() => {
                      setActFilter(act.code)
                      setShowActDropdown(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-bg-card transition-colors flex items-center justify-between gap-2 ${
                      actFilter === act.code ? 'text-val-cyan' : 'text-text-primary'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {complete && <span className="text-val-green text-[10px]">✓</span>}
                      {isCurrent && (
                        <span className="w-1.5 h-1.5 rounded-full bg-val-yellow animate-pulse" />
                      )}
                      <span className="font-stats">{act.code}</span>
                      <span className="text-text-muted">{act.shortLabel}</span>
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] text-val-yellow uppercase">Live</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Map dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowMapDropdown(!showMapDropdown); setShowAgentDropdown(false); setShowActDropdown(false) }}
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
            onClick={() => { setShowAgentDropdown(!showAgentDropdown); setShowMapDropdown(false); setShowActDropdown(false) }}
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
            onClick={() => { setResultFilter('all'); setMapFilter('all'); setAgentFilter('all'); setActFilter('all') }}
            className="text-xs text-val-red hover:text-val-red/80 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Act Recap (only for completed acts with matches) */}
      {showRecap && selectedAct && filtered.length > 0 && (
        <ActRecapCard
          act={selectedAct}
          matches={filtered}
          onMatchClick={(matchId) => navigate(`/review/${matchId}`)}
        />
      )}

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
