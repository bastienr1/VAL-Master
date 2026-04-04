import { supabase } from './supabase'
import type { MatchRound, VodTag } from './types'

const PLAYER_PUUID = 'Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA'
const PLAYER_NAME = 'Jobast'
const PLAYER_TAG = '9537'
const BUY_PHASE_DURATION = 30
const DEFAULT_ROUND_PLAY_TIME = 80
const POST_ROUND_BUFFER = 7

// Weapon ID to display name mapping (common weapons)
const WEAPON_NAMES: Record<string, string> = {
  // Sidearms
  '29A0CFAB-485B-F5D5-779A-B59F85E204A8': 'Classic',
  '42DA8CCE-40A5-043F-4AEC-7A9F2A1600DE': 'Shorty',
  '44D4E95C-4157-0037-81B2-17841BF2E8E3': 'Frenzy',
  '1BAA85B4-4C70-1284-64BB-6481DFC3BB4E': 'Ghost',
  'E336C6B8-418D-9340-D77F-7A9E4CFE0702': 'Sheriff',
  // SMGs
  'F7E1B454-4AD4-1063-EC0A-159E56B58941': 'Stinger',
  '462080D1-4035-2937-7C09-27AA2A5C27A7': 'Spectre',
  // Shotguns
  '910BE174-449B-C412-AB22-D0873436B21B': 'Bucky',
  'EC845BF4-4F79-DDDA-A3DA-0DB3774B2794': 'Judge',
  // Rifles
  'AE3DE142-4D85-2547-DD26-4E90BED35CF7': 'Bulldog',
  '4ADE7FAA-4CF1-8376-95EF-39884480959B': 'Guardian',
  '9C82E19D-4575-0200-1A81-3EACF00CF872': 'Phantom',
  'EE8E8D15-496B-07AC-E5F6-8FAE5D4C7B1A': 'Vandal',
  // Sniper
  'C4883E50-4494-202C-3EC3-6B8A9284F00B': 'Marshal',
  'A03B24D3-4319-996D-0F8C-94BBFBA1DFC7': 'Operator',
  // Heavy
  '55D8A0F4-4274-CA67-FE2C-06AB45AC8543': 'Ares',
  '63E6C3B6-4A8E-869C-3D4C-E38355226584': 'Odin',
  // Melee
  '2F59173C-4BED-B6C3-2191-DDB3EDB14835': 'Melee',
}

function getWeaponName(weaponId: string): string {
  if (!weaponId) return ''
  const upper = weaponId.toUpperCase()
  return WEAPON_NAMES[upper] || weaponId.split('/').pop()?.replace(/_/g, ' ') || 'Unknown'
}

// ==========================================
// Fetch round data from Henrik API
// ==========================================
export async function fetchMatchRoundData(matchId: string, userId: string): Promise<MatchRound[] | null> {
  // Check if we already have round data stored
  const { data: existing } = await supabase
    .from('match_rounds')
    .select('*')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .order('round_number', { ascending: true })

  if (existing && existing.length > 0 && existing[0].round_duration_ms != null) {
    return existing
  }
  if (existing && existing.length > 0) {
    await supabase.from('match_rounds').delete().eq('match_id', matchId).eq('user_id', userId)
  }

  // Fetch from Henrik API
  const apiKey = import.meta.env.VITE_HENRIK_API_KEY
  if (!apiKey) {
    console.error('VITE_HENRIK_API_KEY not set')
    return null
  }

  try {
    const res = await fetch(`https://api.henrikdev.xyz/valorant/v2/match/${matchId}`, {
      headers: { Authorization: apiKey },
    })

    if (!res.ok) {
      console.error('Henrik API error:', res.status)
      return null
    }

    const json = await res.json()
    const matchData = json.data
    if (!matchData?.rounds) return null

    // DEBUG: Log the actual structure of the first round's kill events
    const firstRound = matchData.rounds[0]
    const firstPlayerStats = firstRound?.player_stats?.[0]
    const firstKill = firstPlayerStats?.kill_events?.[0]
    console.log('DEBUG round data structure:', {
      roundKeys: firstRound ? Object.keys(firstRound) : 'no round',
      playerStatsKeys: firstPlayerStats ? Object.keys(firstPlayerStats) : 'no stats',
      killEventKeys: firstKill ? Object.keys(firstKill) : 'no kills',
      firstKillFull: firstKill || 'no kill data',
    })

    // Find our player
    const allPlayers = matchData.players?.all_players || []
    let ourPlayer = allPlayers.find((p: any) => p.puuid === PLAYER_PUUID)
    if (!ourPlayer) {
      // Fallback: match by Riot ID name#tag
      ourPlayer = allPlayers.find((p: any) =>
        p.name?.toLowerCase() === PLAYER_NAME.toLowerCase() && p.tag === PLAYER_TAG
      )
    }
    if (!ourPlayer) {
      console.error('Player not found. Available players:',
        allPlayers.map((p: any) => `${p.name}#${p.tag} (${p.puuid?.substring(0, 20)}...)`)
      )
      return null
    }

    const playerTeam = ourPlayer.team // "Red" or "Blue"
    const firstHalfSide = playerTeam === 'Blue' ? 'attack' : 'defense'
    const secondHalfSide = playerTeam === 'Blue' ? 'defense' : 'attack'

    // Parse rounds
    const rounds: Omit<MatchRound, 'id' | 'created_at'>[] = matchData.rounds.map((round: any, index: number) => {
      const roundNum = index + 1
      const side = roundNum <= 12 ? firstHalfSide : secondHalfSide

      // Find our player's stats in this round
      const ourStats = round.player_stats?.find((ps: any) => ps.player_puuid === ourPlayer.puuid)

      // Extract kill events where we are the killer
      const ourKills = (ourStats?.kill_events || [])
        .filter((ke: any) => ke.killer_puuid === ourPlayer.puuid)
        .map((ke: any) => {
          const victimPlayer = allPlayers.find((p: any) => p.puuid === ke.victim_puuid)
          return {
            kill_time_ms: ke.kill_time_in_round || 0,
            victim: victimPlayer?.character || 'Unknown',
            weapon: getWeaponName(ke.damage_weapon_id || ''),
          }
        })

      // Extract death events where we are the victim
      const allKillEvents = round.player_stats?.flatMap((ps: any) => ps.kill_events || []) || []
      const ourDeaths = allKillEvents
        .filter((ke: any) => ke.victim_puuid === ourPlayer.puuid)
        .map((ke: any) => {
          const killerPlayer = allPlayers.find((p: any) => p.puuid === ke.killer_puuid)
          return {
            kill_time_ms: ke.kill_time_in_round || 0,
            killer: killerPlayer?.character || 'Unknown',
            weapon: getWeaponName(ke.damage_weapon_id || ''),
          }
        })

      // Did our team win this round?
      const roundWon = round.winning_team === playerTeam

      // Damage calculation
      const ourDamage = ourStats?.damage || 0
      const damageReceived = ourStats?.damage_received || 0

      // Actual round play duration from ALL players' kill events (all 10, not just ours)
      const allRoundKillTimes = round.player_stats?.flatMap((ps: any) =>
        (ps.kill_events || []).map((ke: any) => ke.kill_time_in_round || 0)
      ) || []
      const roundDurationMs = allRoundKillTimes.length > 0 ? Math.max(...allRoundKillTimes) : null

      return {
        user_id: userId,
        match_id: matchId,
        round_number: roundNum,
        side,
        round_won: roundWon,
        end_type: round.end_type || null,
        kills: ourStats?.kills || 0,
        deaths: ourDeaths.length,
        assists: ourStats?.assists || 0,
        damage_dealt: ourDamage,
        damage_received: damageReceived,
        loadout_value: ourStats?.economy?.loadout_value || 0,
        spent: ourStats?.economy?.spent || 0,
        score: ourStats?.score || 0,
        kill_events: ourKills,
        death_events: ourDeaths,
        round_duration_ms: roundDurationMs,
      }
    })

    // Upsert to Supabase
    const { data: inserted, error } = await supabase
      .from('match_rounds')
      .upsert(rounds, { onConflict: 'match_id,user_id,round_number' })
      .select()

    if (error) {
      console.error('Failed to store round data:', error)
      return null
    }

    return inserted
  } catch (err) {
    console.error('Failed to fetch match detail:', err)
    return null
  }
}

// ==========================================
// Generate auto-tags from round data
// ==========================================
function estimateRoundDuration(round: MatchRound): number {
  if (round.round_duration_ms && round.round_duration_ms > 0) {
    return BUY_PHASE_DURATION + (round.round_duration_ms / 1000) + POST_ROUND_BUFFER
  }
  return BUY_PHASE_DURATION + DEFAULT_ROUND_PLAY_TIME
}

export function generateAutoTags(
  rounds: MatchRound[],
  barrierOffset: number,
): Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[] {
  const tags: Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[] = []

  // Pre-compute cumulative round start times using actual round durations
  const roundStartTimes: number[] = []
  let cumulativeTime = barrierOffset
  for (const round of rounds) {
    roundStartTimes.push(cumulativeTime)
    cumulativeTime += estimateRoundDuration(round)
  }

  rounds.forEach((round, idx) => {
    const roundStartVideo = roundStartTimes[idx]

    // Round start marker
    tags.push({
      timestamp_seconds: Math.round(roundStartVideo),
      round_number: round.round_number,
      tag_type: 'round',
      label: `R${round.round_number} ${round.side === 'attack' ? 'ATK' : 'DEF'} — ${round.round_won ? 'Won' : 'Lost'}`,
      side: round.side,
      is_auto: true,
    })

    // Half-switch marker at round 13
    if (round.round_number === 13) {
      tags.push({
        timestamp_seconds: Math.max(0, Math.round(roundStartVideo - 15)),
        round_number: 13,
        tag_type: 'half',
        label: `Side switch → ${round.side === 'attack' ? 'ATTACK' : 'DEFENSE'}`,
        side: round.side,
        is_auto: true,
      })
    }
  })

  return tags
}

// ==========================================
// Save auto-tags to Supabase
// ==========================================
export async function saveAutoTags(
  vodReviewId: string,
  userId: string,
  autoTags: Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[],
): Promise<VodTag[]> {
  // Delete existing auto-tags for this review (regenerating fresh)
  await supabase
    .from('vod_tags')
    .delete()
    .eq('vod_review_id', vodReviewId)
    .eq('is_auto', true)

  // Insert new auto-tags
  const rows = autoTags.map(tag => ({
    ...tag,
    user_id: userId,
    vod_review_id: vodReviewId,
  }))

  const { data, error } = await supabase
    .from('vod_tags')
    .insert(rows)
    .select()

  if (error) {
    console.error('Failed to save auto-tags:', error)
    return []
  }

  return data || []
}
