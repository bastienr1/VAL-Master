import type { GameContentRegistry } from './gameContent'
import type { ReplayBundle } from './replayBundle'
import type { MapTransform } from './replayScene'
import { createResource } from './resourceStore'
import { roundToPlay, type ReplayAgentLookup, type ReplayPlay } from './replayToPlay'
import { scopeToUser, sessionUserId } from './sessionScope'
import { supabase } from './supabase'
import type { Match } from './types'

/**
 * The user's matches that have a minimap bundle attached: what the Plays
 * editor offers under "From a replay" (docs/plays-editor-v2.md §2.7).
 *
 * `match_replays` says which matches have one; `matches` says what they were.
 * The two are joined here rather than in SQL: there is no foreign key between
 * them to embed on, and both lists are one user's, so small.
 */

export interface ReplayMatch {
  matchId: string
  map: string
  mapId: string | null
  agent: string
  result: Match['result']
  score: string
  /** `matches.match_date`; null when the row has none. */
  playedAt: string | null
}

type MatchRow = Pick<Match, 'match_id' | 'map' | 'map_id' | 'agent' | 'result' | 'score' | 'match_date'>

/**
 * Every match of the signed-in user with a replay, newest first. A replay
 * whose match row is gone is left out: there is nothing to label it with.
 */
export async function listReplayMatches(): Promise<ReplayMatch[]> {
  const userId = await sessionUserId()
  if (!userId) return []

  // RLS already scopes `match_replays` to its owner; the filter says so out loud.
  const { data: replays, error } = await supabase
    .from('match_replays')
    .select('match_id')
    .eq('user_id', userId)
  if (error) throw new Error(`match_replays read failed: ${error.message}`)

  const ids = [...new Set((replays ?? []).map(r => r.match_id as string))]
  if (ids.length === 0) return []

  const { data: rows, error: matchError } = await supabase
    .from('matches')
    .select('match_id, map, map_id, agent, result, score, match_date')
    .eq('user_id', userId)
    .in('match_id', ids)
  if (matchError) throw new Error(`matches read failed: ${matchError.message}`)

  const byId = new Map<string, MatchRow>()
  for (const row of (rows ?? []) as MatchRow[]) byId.set(row.match_id, row)

  const out: ReplayMatch[] = []
  for (const matchId of ids) {
    const row = byId.get(matchId)
    if (!row) continue
    out.push({
      matchId,
      map: row.map,
      mapId: row.map_id,
      agent: row.agent,
      result: row.result,
      score: row.score,
      playedAt: row.match_date || null,
    })
  }
  return out.sort((a, b) => (b.playedAt ?? '').localeCompare(a.playedAt ?? ''))
}

export const replayMatchesResource = scopeToUser(createResource(listReplayMatches))

/** What turns a bundle's players and positions into play elements: the agent lookup and the map transform. */
export interface ReplayContext {
  lookup: ReplayAgentLookup
  transform: MapTransform
}

/**
 * The agent names, abilities and map transform for a bundle, from the
 * registry. Shared by the round import and the replay mode's frames
 * (docs/plays-editor-v2.md §2.8). Throws when the bundle's map has no
 * minimap transform: without one no position can be placed.
 */
export function replayContext(bundle: ReplayBundle, registry: GameContentRegistry): ReplayContext {
  const mapUuid = bundle.match.mapUuid
  const transform = mapUuid ? registry.maps.byId.get(mapUuid)?.transform : null
  if (!transform) throw new Error('This replay’s map has no minimap data right now, so its positions cannot be placed.')

  const lookup: ReplayAgentLookup = uuid => {
    const agent = uuid ? registry.agents.byId.get(uuid) : undefined
    return agent ? { name: agent.name, abilities: agent.abilities.map(({ slot, name }) => ({ slot, name })) } : null
  }
  return { lookup, transform }
}

/**
 * One round of a bundle as a play, with the agent names, abilities and map
 * transform taken from the registry. Shared by the picker and the
 * `?replay=…&mode=steps` deep link. Throws as `replayContext` does.
 */
export function replayRoundToPlay(bundle: ReplayBundle, roundNumber: number, registry: GameContentRegistry): ReplayPlay {
  const { lookup, transform } = replayContext(bundle, registry)
  return roundToPlay(bundle, roundNumber, lookup, transform)
}
