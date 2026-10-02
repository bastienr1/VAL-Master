/**
 * The player's numbers on one map, agent by agent.
 *
 * Pure and Supabase-free so the maths can be unit-tested. Every average is the
 * plain mean of a per-match figure the Match Library shows, so each one can be
 * checked by hand with the library filtered to the map and the agent.
 */

import { groupByAgent, pickEdgeAgent, type HomeMatch, type StatGroup } from './homeStats.ts'

export interface AgentMapStats extends StatGroup {
  /** Mean ACS, whole number. */
  avgAcs: number
  /** Mean of each match's (kills + assists) / deaths, two decimals. */
  avgKda: number
  /** Mean headshot percentage, one decimal. */
  avgHsPct: number
}

/**
 * Fewest matches on a map before an agent can be called the best on it. Lower
 * than Home's 5: one map holds a fraction of the history.
 */
export const BEST_AGENT_MIN_MATCHES = 3

const nameKey = (name: string) => name.trim().toLowerCase()

function mean(values: number[], decimals: number): number {
  if (values.length === 0) return 0
  const scale = 10 ** decimals
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * scale) / scale
}

/** One row per agent played on the map, most played first, then by name. */
export function agentStatsForMap(matches: HomeMatch[]): AgentMapStats[] {
  return groupByAgent(matches).map(group => {
    const played = matches.filter(m => nameKey(m.agent) === nameKey(group.name))
    return {
      ...group,
      avgAcs: mean(played.map(m => m.acs), 0),
      avgKda: mean(played.map(m => m.kda), 2),
      avgHsPct: mean(played.map(m => m.headshot_pct), 1),
    }
  })
}

/**
 * The agent to feature: the best win rate among agents with a real sample on
 * the map, ties going to the larger sample. Null when no agent has one.
 */
export function pickBestAgent(agents: AgentMapStats[]): AgentMapStats | null {
  const best = pickEdgeAgent(agents, BEST_AGENT_MIN_MATCHES)
  return best ? (agents.find(agent => agent.name === best.name) ?? null) : null
}
