/**
 * The numbers on the Home dashboard.
 *
 * Pure and Supabase-free so the maths can be unit-tested: every figure on Home
 * is a count over rows of `matches`, and each one has to be reproducible by hand
 * against the Match Library with the same filter.
 */

import { getActForDate, getLatestPlayedAct, type ValorantAct } from './acts.ts'
import type { Match } from './types.ts'

/** The columns Home reads. A subset, so the query stays light with no row cap. */
export type HomeMatch = Pick<
  Match,
  | 'id'
  | 'match_id'
  | 'match_date'
  | 'map'
  | 'map_id'
  | 'agent'
  | 'agent_id'
  | 'result'
  | 'score'
  | 'acs'
  | 'kills'
  | 'deaths'
  | 'assists'
>

/**
 * Win rate as a whole percentage, or null when there is nothing to divide by.
 *
 * Draws are excluded from the denominator: they're neither a win nor a loss.
 * This is the one win-rate rule in the app; the Match Library calls it too.
 */
export function winRate(wins: number, losses: number): number | null {
  const decisive = wins + losses
  return decisive > 0 ? Math.round((wins / decisive) * 100) : null
}

export type HomeScope = { kind: 'act'; act: ValorantAct } | { kind: 'all' }

export const ALL_TIME: HomeScope = { kind: 'all' }

/**
 * What "This act" means for this player: the running act if they have played in
 * it, else the newest act they have played in (the first days of a new act),
 * else everything.
 */
export function resolveDefaultScope(matchDates: Date[], now: Date = new Date()): HomeScope {
  const current = getActForDate(now)
  if (current && matchDates.some(d => getActForDate(d)?.code === current.code)) {
    return { kind: 'act', act: current }
  }
  const latest = getLatestPlayedAct(matchDates)
  return latest ? { kind: 'act', act: latest } : ALL_TIME
}

export function filterByScope<T extends Pick<Match, 'match_date'>>(matches: T[], scope: HomeScope): T[] {
  if (scope.kind === 'all') return matches
  const start = scope.act.start.getTime()
  const end = scope.act.end.getTime()
  return matches.filter(m => {
    const t = new Date(m.match_date).getTime()
    return t >= start && t < end // end is exclusive, as in acts.ts
  })
}

export interface StatSummary {
  /** wins + losses + draws, always. */
  total: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
}

export function summarize(matches: Pick<Match, 'result'>[]): StatSummary {
  let wins = 0
  let losses = 0
  let draws = 0
  for (const m of matches) {
    if (m.result === 'W') wins++
    else if (m.result === 'L') losses++
    else draws++
  }
  return { total: matches.length, wins, losses, draws, winRate: winRate(wins, losses) }
}

export interface StatGroup extends StatSummary {
  name: string
  /** Riot UUID from the newest row that carries one; older rows may have none. */
  id: string | null
  /** Result of the most recent match in the group. */
  lastResult: Match['result'] | null
}

const groupKey = (name: string) => name.trim().toLowerCase()

function groupBy(
  matches: HomeMatch[],
  nameOf: (m: HomeMatch) => string,
  idOf: (m: HomeMatch) => string | null,
): StatGroup[] {
  const buckets = new Map<string, HomeMatch[]>()
  for (const m of matches) {
    const key = groupKey(nameOf(m))
    const bucket = buckets.get(key)
    if (bucket) bucket.push(m)
    else buckets.set(key, [m])
  }

  const groups: StatGroup[] = []
  for (const bucket of buckets.values()) {
    const newestFirst = [...bucket].sort(
      (a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime(),
    )
    groups.push({
      ...summarize(bucket),
      name: nameOf(newestFirst[0]).trim(),
      id: newestFirst.map(idOf).find((id): id is string => !!id) ?? null,
      lastResult: newestFirst[0].result,
    })
  }

  return groups.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** One entry per map played, most played first, then by name. */
export function groupByMap(matches: HomeMatch[]): StatGroup[] {
  return groupBy(matches, m => m.map, m => m.map_id)
}

/** One entry per agent played, most played first, then by name. */
export function groupByAgent(matches: HomeMatch[]): StatGroup[] {
  return groupBy(matches, m => m.agent, m => m.agent_id)
}

/**
 * The agent to outline as the player's edge: the best win rate among agents with
 * a real sample. Below `minMatches` nothing qualifies, because a 2–0 record
 * shouldn't be praised. Ties go to the larger sample.
 */
export function pickEdgeAgent(groups: StatGroup[], minMatches = 5): StatGroup | null {
  let best: StatGroup | null = null
  for (const group of groups) {
    if (group.total < minMatches || group.winRate === null) continue
    if (
      !best ||
      group.winRate > (best.winRate ?? -1) ||
      (group.winRate === best.winRate && group.total > best.total)
    ) {
      best = group
    }
  }
  return best
}

/** `13-5` as stored → `13 – 5` as shown. */
export function formatScore(score: string): string {
  return score.replace(/\s*-\s*/, ' – ')
}
