import type { Match } from './types'

const HENRIK_API_KEY = import.meta.env.VITE_HENRIK_API_KEY
const PLAYER_NAME = 'Jobast'
const PLAYER_TAG = '9537'
const PLAYER_PUUID = 'Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA'
const REGION = 'ap'

const AGENT_ROLES: Record<string, string> = {
  Jett: 'Duelist', Reyna: 'Duelist', Raze: 'Duelist', Phoenix: 'Duelist',
  Neon: 'Duelist', Iso: 'Duelist', Waylay: 'Duelist',
  Sova: 'Initiator', Breach: 'Initiator', Skye: 'Initiator', Fade: 'Initiator',
  Gekko: 'Initiator', KAY_O: 'Initiator', Tejo: 'Initiator',
  Omen: 'Controller', Brimstone: 'Controller', Viper: 'Controller', Astra: 'Controller',
  Harbor: 'Controller', Clove: 'Controller',
  Sage: 'Sentinel', Cypher: 'Sentinel', Killjoy: 'Sentinel', Chamber: 'Sentinel',
  Deadlock: 'Sentinel', Vyse: 'Sentinel', Veto: 'Sentinel',
}

function getAgentRole(agent: string): string | null {
  if (!agent) return null
  const key = agent.replace('/', '_')
  return AGENT_ROLES[key] ?? null
}

export interface HenrikMatchResult {
  match: Omit<Match, 'id' | 'created_at' | 'user_id' | 'match_checkin_id' | 'match_debrief_id'>
  raw: any
}

// ──────────────────────────────────────────────────────────────────────────
// Schema-resilient parser
//
// The Henrik v3 /matches endpoint changed its response shape:
//   OLD: players: { red: [...], blue: [...] }, player.character, player.team,
//        metadata.matchid, metadata.map (string), teams.red.has_won, etc.
//   NEW: players: [...] (flat), player.agent.name, player.team_id,
//        metadata.match_id, metadata.map.name (object), teams may be array,
//        metadata.queue.id (instead of metadata.mode_id).
//
// We accept either shape. New fields are tried first, then fall back to old.
// ──────────────────────────────────────────────────────────────────────────

function normalizePlayers(match: any): any[] {
  // New shape: flat array
  if (Array.isArray(match.players)) return match.players
  // Old shape: { red: [...], blue: [...], all_players: [...] }
  if (match.players && typeof match.players === 'object') {
    if (Array.isArray(match.players.all_players)) return match.players.all_players
    return [
      ...(match.players.red || []),
      ...(match.players.blue || []),
    ]
  }
  return []
}

type SkipReason = 'anonymized' | 'not_found' | null

function findOurPlayer(players: any[]): { player: any | null; reason: SkipReason } {
  if (!players || players.length === 0) {
    return { player: null, reason: 'not_found' }
  }

  // Detect Riot privacy window: all names empty (Riot anonymizes recent matches)
  const allAnonymized = players.every(
    (p: any) => !p?.name || p.name === ''
  )
  if (allAnonymized) {
    return { player: null, reason: 'anonymized' }
  }

  // Prefer PUUID match — most reliable across name changes
  let p = players.find((pl: any) => pl?.puuid === PLAYER_PUUID)
  if (p) return { player: p, reason: null }

  // Fallback: name#tag
  p = players.find(
    (pl: any) =>
      pl?.name?.toLowerCase() === PLAYER_NAME.toLowerCase() &&
      pl?.tag === PLAYER_TAG
  )
  if (p) return { player: p, reason: null }

  return { player: null, reason: 'not_found' }
}

function getAgentName(player: any): string {
  // New shape: agent.name
  if (player?.agent?.name) return player.agent.name
  // Old shape: character
  if (player?.character) return player.character
  return 'Unknown'
}

function getPlayerTeam(player: any): string {
  // Returns lowercase 'red' | 'blue' | '' for safety in lookups
  const raw = player?.team_id || player?.team || ''
  return String(raw).toLowerCase()
}

function getMapName(metadata: any): string {
  if (typeof metadata?.map === 'string') return metadata.map        // old
  if (metadata?.map?.name) return metadata.map.name                  // new
  return 'Unknown'
}

function getMatchId(metadata: any): string {
  return metadata?.match_id || metadata?.matchid || ''               // new || old
}

function getMatchDate(metadata: any): string {
  if (metadata?.started_at) return metadata.started_at               // new (ISO)
  if (metadata?.game_start_patched) return metadata.game_start_patched // old (string)
  if (metadata?.game_start) return new Date(metadata.game_start * 1000).toISOString()
  return new Date().toISOString()
}

function getRoundsPlayed(metadata: any, teams: any): number {
  if (typeof metadata?.rounds_played === 'number') return metadata.rounds_played
  // Derive from teams if missing
  const red = teams?.red?.rounds_won ?? teams?.red?.rounds?.won ?? 0
  const blue = teams?.blue?.rounds_won ?? teams?.blue?.rounds?.won ?? 0
  return red + blue
}

interface TeamScore {
  rounds_won: number
  has_won: boolean | null
}

function getTeamScores(match: any, ourTeam: string): { ours: TeamScore; theirs: TeamScore } {
  const teams = match.teams
  const enemy = ourTeam === 'red' ? 'blue' : ourTeam === 'blue' ? 'red' : ''

  // Shape A: object keyed by side — { red: {...}, blue: {...} }
  if (teams && !Array.isArray(teams) && (teams.red || teams.blue)) {
    const ours = teams[ourTeam] || {}
    const theirs = teams[enemy] || {}
    return {
      ours: {
        rounds_won: ours.rounds_won ?? ours.rounds?.won ?? 0,
        has_won: typeof ours.has_won === 'boolean' ? ours.has_won
              : typeof ours.won === 'boolean' ? ours.won
              : null,
      },
      theirs: {
        rounds_won: theirs.rounds_won ?? theirs.rounds?.won ?? 0,
        has_won: typeof theirs.has_won === 'boolean' ? theirs.has_won
              : typeof theirs.won === 'boolean' ? theirs.won
              : null,
      },
    }
  }

  // Shape B: array — [{ team_id: 'Red', won: true, rounds: {...}}, ...]
  if (Array.isArray(teams)) {
    const findTeam = (sideLower: string) =>
      teams.find((t: any) => String(t?.team_id || t?.id || t?.team || '').toLowerCase() === sideLower) || {}
    const ours = findTeam(ourTeam)
    const theirs = findTeam(enemy)
    return {
      ours: {
        rounds_won: ours.rounds_won ?? ours.rounds?.won ?? 0,
        has_won: typeof ours.has_won === 'boolean' ? ours.has_won
              : typeof ours.won === 'boolean' ? ours.won
              : null,
      },
      theirs: {
        rounds_won: theirs.rounds_won ?? theirs.rounds?.won ?? 0,
        has_won: typeof theirs.has_won === 'boolean' ? theirs.has_won
              : typeof theirs.won === 'boolean' ? theirs.won
              : null,
      },
    }
  }

  return {
    ours: { rounds_won: 0, has_won: null },
    theirs: { rounds_won: 0, has_won: null },
  }
}

function getMatchMode(metadata: any, fallback: string): string {
  // New: metadata.queue.name = "Competitive" | metadata.queue.id = "competitive"
  if (metadata?.queue?.name) return metadata.queue.name
  if (metadata?.queue?.id) {
    return metadata.queue.id.charAt(0).toUpperCase() + metadata.queue.id.slice(1)
  }
  // Old: metadata.mode = "Competitive"
  if (metadata?.mode) return metadata.mode
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export async function fetchRecentMatches(
  size: number = 5,
  mode: string = 'competitive'
): Promise<HenrikMatchResult[]> {
  // v3 size cap is 10 — clamp defensively
  const safeSize = Math.min(Math.max(size, 1), 10)
  const url = `https://api.henrikdev.xyz/valorant/v3/matches/${REGION}/${PLAYER_NAME}/${PLAYER_TAG}?mode=${mode}&size=${safeSize}&api_key=${HENRIK_API_KEY}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Henrik API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const matches = data?.data ?? []

  if (matches.length === 0) {
    console.warn('[henrik] API returned 200 but data array is empty', { url, status: data?.status })
    return []
  }

  const results: HenrikMatchResult[] = []
  let anonymizedSkips = 0
  let parseFailures = 0

  for (const match of matches) {
    const metadata = match?.metadata ?? {}
    const players = normalizePlayers(match)
    const { player: ourPlayer, reason } = findOurPlayer(players)

    if (!ourPlayer) {
      const matchId = metadata?.match_id || metadata?.matchid || 'unknown'
      const matchTime = metadata?.started_at || metadata?.game_start_patched || 'unknown'

      if (reason === 'anonymized') {
        anonymizedSkips++
        console.info(
          `[henrik] Match ${matchId.substring(0, 8)} (${matchTime}) skipped — Riot privacy window. Will retry on next sync.`
        )
      } else {
        parseFailures++
        console.warn(
          `[henrik] Match ${matchId.substring(0, 8)} skipped — player not found. Sample player keys:`,
          players[0] ? Object.keys(players[0]) : 'NO PLAYERS'
        )
      }
      continue
    }

    const stats = ourPlayer.stats ?? {}
    const team = getPlayerTeam(ourPlayer)
    const { ours, theirs } = getTeamScores(match, team)
    const roundsPlayed = getRoundsPlayed(metadata, match.teams) || 1

    const kills = stats.kills ?? 0
    const deaths = stats.deaths ?? 0
    const assists = stats.assists ?? 0
    const totalShots = (stats.headshots ?? 0) + (stats.bodyshots ?? 0) + (stats.legshots ?? 0)

    // Determine outcome — round score is the source of truth.
    // `has_won` cannot be trusted on its own because Henrik returns
    // has_won: false for BOTH teams in a true draw (e.g. 12-12 no OT),
    // which would misclassify draws as losses.
    let result: 'W' | 'L' | 'draw'
    if (ours.rounds_won > theirs.rounds_won) {
      result = 'W'
    } else if (ours.rounds_won < theirs.rounds_won) {
      result = 'L'
    } else {
      // Equal round scores → draw (unless API explicitly says we won/lost)
      if (ours.has_won === true) result = 'W'
      else if (ours.has_won === false && theirs.has_won === true) result = 'L'
      else result = 'draw'
    }

    const agentName = getAgentName(ourPlayer)

    results.push({
      match: {
        match_id: getMatchId(metadata),
        match_date: getMatchDate(metadata),
        map: getMapName(metadata),
        agent: agentName,
        agent_role: getAgentRole(agentName),
        mode: getMatchMode(metadata, mode),
        result,
        score: `${ours.rounds_won}-${theirs.rounds_won}`,
        rounds_won: ours.rounds_won,
        rounds_lost: theirs.rounds_won,
        rounds_played: roundsPlayed,
        kills,
        deaths,
        assists,
        kd: deaths > 0 ? +(kills / deaths).toFixed(2) : kills,
        kda: deaths > 0 ? +((kills + assists) / deaths).toFixed(2) : kills + assists,
        acs: Math.round((stats.score ?? 0) / roundsPlayed),
        headshot_pct: totalShots > 0 ? +(((stats.headshots ?? 0) / totalShots) * 100).toFixed(1) : 0,
        headshots: stats.headshots ?? 0,
        bodyshots: stats.bodyshots ?? 0,
        legshots: stats.legshots ?? 0,
        kpr: +(kills / roundsPlayed).toFixed(2),
        dpr: +(deaths / roundsPlayed).toFixed(2),
        raw_score: stats.score ?? 0,
      },
      raw: match,
    })
  }

  // Loud failure if everything parsed but nothing landed — schema change indicator
  const total = matches.length
  const saved = results.length
  if (saved === 0 && parseFailures > 0) {
    console.error(
      `[henrik] All ${parseFailures} matches failed to parse — likely schema change. ` +
      `Sample player keys: ${JSON.stringify(Object.keys(matches[0]?.players ?? matches[0] ?? {}))}`
    )
  } else if (parseFailures > 0 || anonymizedSkips > 0) {
    console.info(
      `[henrik] Sync complete: ${saved}/${total} saved` +
      (anonymizedSkips > 0 ? ` · ${anonymizedSkips} anonymized (will retry)` : '') +
      (parseFailures > 0 ? ` · ${parseFailures} parse failures` : '')
    )
  }

  return results
}

export async function fetchLastMatch(): Promise<HenrikMatchResult | null> {
  const matches = await fetchRecentMatches(1, 'competitive')
  return matches[0] ?? null
}
