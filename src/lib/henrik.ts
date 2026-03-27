import type { Match } from './types'

const HENRIK_API_KEY = import.meta.env.VITE_HENRIK_API_KEY
const PLAYER_NAME = 'Jobast'
const PLAYER_TAG = '9537'
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

// Fix for KAY/O key lookup
function getAgentRole(agent: string): string | null {
  const key = agent.replace('/', '_')
  return AGENT_ROLES[key] ?? null
}

export interface HenrikMatchResult {
  match: Omit<Match, 'id' | 'created_at' | 'user_id' | 'match_checkin_id' | 'match_debrief_id'>
  raw: any
}

export async function fetchRecentMatches(
  size: number = 5,
  mode: string = 'competitive'
): Promise<HenrikMatchResult[]> {
  const url = `https://api.henrikdev.xyz/valorant/v3/matches/${REGION}/${PLAYER_NAME}/${PLAYER_TAG}?filter=${mode}&size=${size}&api_key=${HENRIK_API_KEY}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Henrik API error: ${res.status}`)
  }

  const data = await res.json()
  const matches = data.data || []

  return matches
    .map((match: any) => {
      const metadata = match.metadata
      const allPlayers = [
        ...(match.players?.red || []),
        ...(match.players?.blue || []),
      ]
      const player = allPlayers.find(
        (p: any) => p.name === PLAYER_NAME && p.tag === PLAYER_TAG
      )
      if (!player) return null

      const stats = player.stats
      const team = player.team.toLowerCase()
      const roundsPlayed = metadata.rounds_played || 1
      const kills = stats.kills
      const deaths = stats.deaths
      const assists = stats.assists
      const totalShots = stats.headshots + stats.bodyshots + stats.legshots

      const teamData = match.teams[team]
      const enemyTeam = team === 'red' ? 'blue' : 'red'

      const roundsWon = match.teams[team]?.rounds_won ?? 0
      const roundsLost = match.teams[enemyTeam]?.rounds_won ?? 0

      // Determine result
      let result: 'W' | 'L' | 'draw' = 'draw'
      if (teamData?.has_won === true) result = 'W'
      else if (teamData?.has_won === false) result = 'L'

      return {
        match: {
          match_id: metadata.matchid,
          match_date: metadata.game_start_patched || new Date().toISOString(),
          map: metadata.map,
          agent: player.character,
          agent_role: getAgentRole(player.character),
          mode: mode.charAt(0).toUpperCase() + mode.slice(1),
          result,
          score: `${roundsWon}-${roundsLost}`,
          rounds_won: roundsWon,
          rounds_lost: roundsLost,
          rounds_played: roundsPlayed,
          kills,
          deaths,
          assists,
          kd: deaths > 0 ? +(kills / deaths).toFixed(2) : kills,
          kda: deaths > 0 ? +((kills + assists) / deaths).toFixed(2) : kills + assists,
          acs: Math.round(stats.score / roundsPlayed),
          headshot_pct: totalShots > 0 ? +((stats.headshots / totalShots) * 100).toFixed(1) : 0,
          headshots: stats.headshots,
          bodyshots: stats.bodyshots,
          legshots: stats.legshots,
          kpr: +(kills / roundsPlayed).toFixed(2),
          dpr: +(deaths / roundsPlayed).toFixed(2),
          raw_score: stats.score,
        },
        raw: match,
      } as HenrikMatchResult
    })
    .filter(Boolean) as HenrikMatchResult[]
}

export async function fetchLastMatch(): Promise<HenrikMatchResult | null> {
  const matches = await fetchRecentMatches(1, 'competitive')
  return matches[0] ?? null
}
