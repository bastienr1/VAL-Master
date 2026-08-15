import { TRN_MATCH_BASE } from './constants'

// Riot match ids are UUIDs. Henrik's metadata.match_id can come back empty
// (see getMatchId in henrik.ts), so guard before it becomes a live href.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Build the tracker.gg report URL for a match, or null if the id can't be trusted. */
export function trnMatchUrl(matchId?: string | null): string | null {
  if (!matchId) return null
  const id = matchId.trim()
  return UUID_RE.test(id) ? `${TRN_MATCH_BASE}/${id}` : null
}
