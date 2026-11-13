/**
 * The filters of "From a replay" (docs/plays-editor-v2.md §2.7, §2.19): the
 * category (competitive or Deathmatch), then agent, map and win or loss, over
 * the user's matches that have a replay.
 *
 * Pure, so `node --test` can check it.
 */

import { matchCategory, type MatchCategory } from './matchModes.ts'

export type ResultFilter = 'W' | 'L' | null

export interface ReplayFilter {
  /** Which matches are listed at all; competitive unless a Deathmatch is picked. */
  category: MatchCategory
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
  /** `matches.mode`; a row without one is competitive. */
  mode?: string | null
}

export const NO_REPLAY_FILTER: ReplayFilter = { category: 'competitive', agent: '', map: '', result: null }

const key = (name: string) => name.trim().toLowerCase()

/** Whether anything narrows the category's list: the category itself is not a filter, Clear keeps it. */
export const isFiltering = (filter: ReplayFilter) => filter.agent !== '' || filter.map !== '' || filter.result !== null

/** The matches of a category, in the order given. */
export function inCategory<T extends Filterable>(matches: readonly T[], category: MatchCategory): T[] {
  return matches.filter(m => matchCategory(m.mode) === category)
}

/** The matches the filter lets through, in the order given. A draw is neither a win nor a loss. */
export function filterReplayMatches<T extends Filterable>(matches: readonly T[], filter: ReplayFilter): T[] {
  return inCategory(matches, filter.category).filter(
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

/** What the dropdowns offer: only the agents and maps of the category that have a replay, by name. */
export function replayFilterOptions(
  matches: readonly Filterable[],
  category: MatchCategory = 'competitive',
): { agents: string[]; maps: string[] } {
  const shown = inCategory(matches, category)
  return { agents: distinct(shown.map(m => m.agent)), maps: distinct(shown.map(m => m.map)) }
}
