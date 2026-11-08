/**
 * The filters of "From a replay" (docs/plays-editor-v2.md §2.7): agent, map and
 * win or loss, over the user's matches that have a replay.
 *
 * Pure, no imports, so `node --test` can check it.
 */

export type ResultFilter = 'W' | 'L' | null

export interface ReplayFilter {
  /** An agent's name, '' for any. */
  agent: string
  /** A map's name, '' for any. */
  map: string
  result: ResultFilter
}

interface Filterable {
  agent: string
  map: string
  result: 'W' | 'L' | 'draw'
}

export const NO_REPLAY_FILTER: ReplayFilter = { agent: '', map: '', result: null }

const key = (name: string) => name.trim().toLowerCase()

export const isFiltering = (filter: ReplayFilter) => filter.agent !== '' || filter.map !== '' || filter.result !== null

/** The matches the filter lets through, in the order given. A draw is neither a win nor a loss. */
export function filterReplayMatches<T extends Filterable>(matches: readonly T[], filter: ReplayFilter): T[] {
  return matches.filter(
    m =>
      (filter.agent === '' || key(m.agent) === key(filter.agent)) &&
      (filter.map === '' || key(m.map) === key(filter.map)) &&
      (filter.result === null || m.result === filter.result),
  )
}

function distinct(names: string[]): string[] {
  const byKey = new Map<string, string>()
  for (const name of names) {
    if (name.trim() && !byKey.has(key(name))) byKey.set(key(name), name.trim())
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

/** What the dropdowns offer: only the agents and maps that have a replay, by name. */
export function replayFilterOptions(matches: readonly Filterable[]): { agents: string[]; maps: string[] } {
  return { agents: distinct(matches.map(m => m.agent)), maps: distinct(matches.map(m => m.map)) }
}
