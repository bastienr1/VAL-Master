import { useMemo, useState } from 'react'
import { homeMatchesResource } from '../lib/homeData'
import {
  ALL_TIME,
  filterByScope,
  groupByAgent,
  groupByMap,
  pickEdgeAgent,
  resolveDefaultScope,
  summarize,
  type HomeMatch,
} from '../lib/homeStats'
import { getCurrentAct } from '../lib/acts'
import { useResource } from './useResource'

const NO_MATCHES: HomeMatch[] = []

/** The player's whole match history, newest first. Shared with the Map Hub. */
export function useHomeMatches() {
  const { data, error, loading } = useResource(homeMatchesResource)
  return {
    matches: data ?? NO_MATCHES,
    // First load only: a background refresh keeps showing what it has.
    loading: loading && !data,
    error,
  }
}

/**
 * Everything Home counts, for the scope the player picked.
 *
 * "This act" is the running act when they have played in it, else the newest
 * act they have played in. `scope` is what the numbers are actually over, so
 * with no acts played at all it is all time whatever was picked.
 */
export function useHomeStats() {
  const { matches, loading, error } = useHomeMatches()
  const [choice, setChoice] = useState<'act' | 'all'>('act')

  const actScope = useMemo(
    () => resolveDefaultScope(matches.map(m => new Date(m.match_date))),
    [matches],
  )
  const act = actScope.kind === 'act' ? actScope.act : null
  const scope = choice === 'act' ? actScope : ALL_TIME

  const stats = useMemo(() => {
    const scoped = filterByScope(matches, scope)
    const agents = groupByAgent(scoped)
    return {
      summary: summarize(scoped),
      maps: groupByMap(scoped),
      agents,
      edgeAgent: pickEdgeAgent(agents),
    }
  }, [matches, scope])

  return {
    matches,
    loading,
    error,
    scope,
    choice,
    setChoice,
    /** The act behind "This act", or null when no act has been played. */
    act,
    /** False when `act` is an earlier one standing in for an empty running act. */
    actIsCurrent: act !== null && act.code === getCurrentAct()?.code,
    ...stats,
  }
}
