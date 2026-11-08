/**
 * Who played in a replayed match (docs/plays-editor-v2.md §2.8): the replay
 * bundle names players only by PUUID, so their Riot names come from Henrik's
 * match endpoint, the one `matchSync.ts` already uses, joined on the PUUID.
 * Fetched once per match and kept per device; a failure leaves the names out.
 */

/** PUUID → Riot name (no tag), from a Henrik match payload, v2 (`players.all_players`) or v4 (flat `players`). */
export function namesFromHenrik(payload: unknown): Map<string, string> {
  const names = new Map<string, string>()
  const data = (payload as { data?: unknown } | null)?.data ?? payload
  const players = (data as { players?: unknown } | null)?.players
  let list: unknown[] = []
  if (Array.isArray(players)) list = players
  else if (players && typeof players === 'object') {
    const grouped = players as { all_players?: unknown; red?: unknown; blue?: unknown }
    if (Array.isArray(grouped.all_players)) list = grouped.all_players
    else list = [...(Array.isArray(grouped.red) ? grouped.red : []), ...(Array.isArray(grouped.blue) ? grouped.blue : [])]
  }
  for (const p of list) {
    const { puuid, name } = (p ?? {}) as { puuid?: unknown; name?: unknown }
    if (typeof puuid === 'string' && typeof name === 'string' && name.trim()) names.set(puuid, name.trim())
  }
  return names
}

const STORE_PREFIX = 'plays.names.'
const pending = new Map<string, Promise<Map<string, string>>>()

function readStored(matchId: string): Map<string, string> | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + matchId)
    if (!raw) return null
    const entries = JSON.parse(raw) as unknown
    if (!Array.isArray(entries)) return null
    return new Map(entries.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string'))
  } catch {
    return null
  }
}

function writeStored(matchId: string, names: Map<string, string>) {
  try {
    localStorage.setItem(STORE_PREFIX + matchId, JSON.stringify([...names]))
  } catch {
    // Storage full or blocked: the names are fetched again next time.
  }
}

/** The players' names of a match by PUUID; empty when Henrik has no key, no match or fails. */
export function fetchPlayerNames(matchId: string, apiKey: string | undefined): Promise<Map<string, string>> {
  const stored = readStored(matchId)
  if (stored && stored.size > 0) return Promise.resolve(stored)
  const inFlight = pending.get(matchId)
  if (inFlight) return inFlight
  const request = (async () => {
    if (!apiKey) return new Map<string, string>()
    try {
      const res = await fetch(`https://api.henrikdev.xyz/valorant/v2/match/${encodeURIComponent(matchId)}`, {
        headers: { Authorization: apiKey },
      })
      if (!res.ok) return new Map<string, string>()
      const names = namesFromHenrik(await res.json())
      if (names.size > 0) writeStored(matchId, names)
      return names
    } catch {
      return new Map<string, string>()
    } finally {
      pending.delete(matchId)
    }
  })()
  pending.set(matchId, request)
  return request
}
