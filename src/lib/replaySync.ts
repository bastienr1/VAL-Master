/**
 * Replay clock ↔ video clock, and replay timing for the round timeline.
 *
 * The sync has one anchor: `vod_reviews.barrier_drop_offset`, the video second
 * at which round 1's barriers drop. The bundle knows the same instant on the
 * replay clock (`rounds[0].barrierMs`, measured from the game's own round
 * timer), so every replay event maps to a video time with one subtraction.
 *
 * `applyReplayTiming` is how the existing timeline gets that precision without
 * being rewritten: it returns `MatchRound`-shaped rows whose `round_start_ms`
 * and kill times come from the replay. Everything downstream (the timeline,
 * the notes rail, round resolution) keeps using `getRoundVideoTime` unchanged.
 * Nothing is written back to `match_rounds`; a match without a bundle keeps the
 * rows Henrik gave it.
 *
 * Pure: no Supabase, no DOM. Covered by `replaySync.test.ts`.
 */

import type { MatchRound } from './types'
import type { ReplayBundle, ReplayRound, ReplayWeapon } from './replayBundle'

/** Replay time of the R1 barrier drop — the instant "Sync: Barriers Drop" marks in the video. */
export function replayAnchorMs(bundle: ReplayBundle): number | null {
  return bundle.rounds[0]?.barrierMs ?? null
}

export function replayMsToVideoSeconds(bundle: ReplayBundle, barrierOffset: number, replayMs: number): number {
  return barrierOffset + (replayMs - (replayAnchorMs(bundle) ?? 0)) / 1000
}

export function videoSecondsToReplayMs(bundle: ReplayBundle, barrierOffset: number, videoSeconds: number): number {
  return (videoSeconds - barrierOffset) * 1000 + (replayAnchorMs(bundle) ?? 0)
}

/** The round whose buy phase has started at `replayMs`; round 1 before that. */
export function roundAtReplayMs(bundle: ReplayBundle, replayMs: number): ReplayRound {
  let current = bundle.rounds[0]
  for (const round of bundle.rounds) {
    if (round.buyStartMs > replayMs) break
    current = round
  }
  return current
}

// vrfkit's name table trails the game: it calls the Bandit "Compact Pistol" and
// has no entry for the Warden. The class is the stable identity, so the two
// names it gets wrong are corrected here, next to the code that shows them.
const WEAPON_NAME_BY_CLASS: Record<string, string> = {
  CompactPistol_C: 'Bandit',
  BattleRifle_C: 'Warden',
}

/** A display name for a kill's weapon: the gun's name, or a readable form of an ability class. */
export function weaponLabel(weapon: ReplayWeapon | null | undefined): string {
  if (!weapon) return ''
  const known = WEAPON_NAME_BY_CLASS[weapon.cls] ?? weapon.name
  if (known) return known
  return weapon.cls
    .replace(/_C$/, '')
    .replace(/^(Ability|Projectile|Pawn|AIPawn|GameObject)_/, '')
    .replace(/_(Production|Engineering|New|V\d+)\b/g, '')
    .replace(/_/g, ' ')
}

/**
 * The match's rounds with replay timing.
 *
 * `round_start_ms` becomes the round's barrier time on the replay clock, so
 * `getRoundVideoTime`'s "offset from round 1" is exact. Kill and death times
 * become milliseconds after that barrier. Counts and economy stay Henrik's when
 * Henrik has the round; a round Henrik lacks is built from the replay alone, so
 * the timeline works even for a match Henrik no longer serves.
 *
 * A round with no barrier drop is left out: that is a match surrendered during
 * a buy phase, where nothing was played. Returns `matchRounds` untouched when
 * the bundle cannot drive the timeline at all (no owner, or no barrier for
 * round 1, which is the sync anchor).
 */
export function applyReplayTiming(
  matchRounds: MatchRound[],
  bundle: ReplayBundle,
  agentName: (agentId: string | null) => string | null,
): MatchRound[] {
  const me = bundle.players.find(p => p.isMe)
  if (!me || bundle.rounds.length === 0 || bundle.rounds[0].barrierMs == null) {
    return matchRounds
  }

  const agentOf = new Map(bundle.players.map(p => [p.subject, agentName(p.agentId) ?? 'Unknown']))
  const fromHenrik = new Map(matchRounds.map(r => [r.round_number, r]))
  const first = matchRounds[0]

  return bundle.rounds.filter(round => round.barrierMs != null).map((round): MatchRound => {
    const barrier = round.barrierMs as number
    const inRound = bundle.kills.filter(k => k.round === round.n)
    const kills = inRound.filter(k => k.killer === me.subject && k.victim !== me.subject)
    const deaths = inRound.filter(k => k.victim === me.subject)
    const weaponOf = (index: number | null) => weaponLabel(index == null ? null : bundle.weapons[index])

    const base: MatchRound = fromHenrik.get(round.n) ?? {
      id: `replay-${bundle.match.matchId}-${round.n}`,
      created_at: bundle.match.recordedAt,
      user_id: first?.user_id ?? '',
      match_id: bundle.match.matchId,
      round_number: round.n,
      side: round.side === 'attacker' ? 'attack' : 'defense',
      round_won: round.winner === 'ALLY',
      end_type: round.how,
      kills: kills.length,
      deaths: deaths.length,
      assists: 0,
      damage_dealt: 0,
      damage_received: 0,
      loadout_value: 0,
      spent: 0,
      score: 0,
      kill_events: [],
      death_events: [],
      round_duration_ms: null,
      round_start_ms: null,
    }

    return {
      ...base,
      round_start_ms: barrier,
      round_duration_ms: round.endMs != null ? round.endMs - barrier : base.round_duration_ms,
      kill_events: kills.map(k => ({
        kill_time_ms: k.t - barrier,
        victim: (k.victim && agentOf.get(k.victim)) || 'Unknown',
        weapon: weaponOf(k.weapon),
      })),
      death_events: deaths.map(k => ({
        kill_time_ms: k.t - barrier,
        // A self-death is an ability running out (Clove's ult) or a fall, not an enemy.
        killer: k.killer === me.subject ? 'self' : (k.killer && agentOf.get(k.killer)) || 'Unknown',
        weapon: weaponOf(k.weapon),
      })),
    }
  })
}
