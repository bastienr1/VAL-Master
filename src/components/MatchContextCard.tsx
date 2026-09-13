import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { agentImageFor } from '../lib/gameContent'
import { useMatchSearchPanel } from '../hooks/useMatchSearchPanel'
import GameImage from './GameImage'
import type { Match } from '../lib/types'

interface MatchContextCardProps {
  playbookMap: string
}

/**
 * Sprint 6 scaffolding: shows the most recent match on this playbook's map
 * (or the most recent match overall). Sprint 7 makes the pick meaningful.
 */
export default function MatchContextCard({ playbookMap }: MatchContextCardProps) {
  const { open } = useMatchSearchPanel()
  const [match, setMatch] = useState<Match | null>(null)
  const [onMap, setOnMap] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const latest = (map?: string) => {
        let q = supabase.from('matches').select('*').eq('user_id', user.id)
        if (map) q = q.eq('map', map)
        return q.order('match_date', { ascending: false }).limit(1).maybeSingle()
      }

      const { data: mapMatch } = await latest(playbookMap)
      const fallback = mapMatch ? null : (await latest()).data
      if (cancelled) return
      setMatch(mapMatch ?? fallback ?? null)
      setOnMap(Boolean(mapMatch))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [playbookMap])

  const resultColor = match?.result === 'W' ? 'text-val-green' : match?.result === 'L' ? 'text-val-red' : 'text-val-yellow'

  return (
    <div className="w-full sm:w-72 bg-bg-card border border-bg-elevated rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-text-muted">Match Context</span>
        {match && !onMap && <span className="text-[10px] text-val-yellow/70">No {playbookMap} matches</span>}
      </div>

      {loading ? (
        <div className="h-10 rounded-md bg-bg-elevated/50 animate-pulse" />
      ) : match ? (
        <div className="flex items-center gap-2.5">
          <GameImage kind="agent" src={agentImageFor(match)} alt={match.agent} className="w-9 h-9 rounded-full border border-bg-elevated" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary truncate">
              {match.agent} <span className="text-text-muted">· {match.map}</span>
            </div>
            <div className="text-xs text-text-muted">
              {new Date(match.match_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
          <span className={`font-stats text-sm font-bold ${resultColor}`}>{match.score}</span>
        </div>
      ) : (
        <p className="text-xs text-text-muted">No matches synced yet.</p>
      )}

      <button
        type="button"
        onClick={() => open(playbookMap)}
        className="mt-3 w-full text-xs text-val-cyan border border-val-cyan/25 bg-val-cyan/10 rounded-md py-1.5 hover:bg-val-cyan/20 transition-colors"
      >
        Change Match
      </button>
    </div>
  )
}
