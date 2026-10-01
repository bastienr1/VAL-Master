/**
 * Unit tests for replay ↔ video sync and replay-timed rounds (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyReplayTiming,
  replayMsToVideoSeconds,
  roundAtReplayMs,
  videoSecondsToReplayMs,
  weaponLabel,
} from './replaySync.ts'
import { getRoundVideoTime } from './roundResolver.ts'
import type { ReplayBundle } from './replayBundle.ts'
import type { MatchRound } from './types.ts'

const ME = 'me'
const MATE = 'mate'
const FOE = 'foe'

// Round 1 is a pistol round: 45 s of buy phase. Round 2 has the usual 30 s.
function bundle(overrides: Partial<ReplayBundle> = {}): ReplayBundle {
  return {
    schema: 1,
    parser: { vrfkit: null, reducer: 'test' },
    match: { matchId: 'm-1', mapUuid: null, mapUrl: '/Game/Maps/Jam/Jam', build: 'release-13.06', recordedAt: '2026-09-29T04:48:00Z', durationMs: 200000 },
    players: [
      { subject: ME, agentId: 'clove', team: 'ALLY', teamName: 'Red', body: 1, isMe: true },
      { subject: MATE, agentId: 'sage', team: 'ALLY', teamName: 'Red', body: 2, isMe: false },
      { subject: FOE, agentId: 'fade', team: 'ENEMY', teamName: 'Blue', body: 3, isMe: false },
    ],
    rounds: [
      { n: 1, buyStartMs: 0, barrierMs: 45000, endMs: 75000, side: 'attacker', winner: 'ENEMY', how: 'elimination', plant: null, defuse: null },
      { n: 2, buyStartMs: 82000, barrierMs: 112000, endMs: 154000, side: 'attacker', winner: 'ALLY', how: 'elimination', plant: null, defuse: null },
    ],
    weapons: [
      { cls: 'AssaultRifle_AK_C', name: 'Vandal', cat: 'rifle' },
      { cls: 'CompactPistol_C', name: 'Compact Pistol', cat: 'sidearm' },
    ],
    tracks: { hz: 10, fields: [], byPlayer: { [ME]: [], [MATE]: [], [FOE]: [] } },
    kills: [
      { t: 50800, round: 1, killer: FOE, victim: MATE, weapon: 0, kx: 0, ky: 0, vx: 0, vy: 0 },
      { t: 70800, round: 1, killer: FOE, victim: ME, weapon: 1, kx: 0, ky: 0, vx: 0, vy: 0 },
      { t: 120000, round: 2, killer: ME, victim: FOE, weapon: 0, kx: 0, ky: 0, vx: 0, vy: 0 },
      { t: 150000, round: 2, killer: ME, victim: ME, weapon: null, kx: 0, ky: 0, vx: 0, vy: 0 },
    ],
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: [], items: [] },
    ...overrides,
  }
}

const NAMES: Record<string, string> = { clove: 'Clove', sage: 'Sage', fade: 'Fade' }
const agentName = (id: string | null) => (id ? NAMES[id] ?? null : null)

function henrikRound(n: number, firstKillMatchMs: number): MatchRound {
  return {
    id: `h-${n}`, created_at: '', user_id: 'u-1', match_id: 'm-1', round_number: n,
    side: 'attack', round_won: n === 2, end_type: 'Eliminated',
    kills: n === 2 ? 1 : 0, deaths: 1, assists: 0, damage_dealt: 140, damage_received: 100,
    loadout_value: 3900, spent: 2900, score: 250,
    kill_events: [], death_events: [],
    round_duration_ms: 30000,
    // What VAL Master stores today: the round's first kill on the match clock.
    round_start_ms: firstKillMatchMs,
  }
}

test('replay ms ↔ video seconds round-trips through the R1 barrier anchor', () => {
  const b = bundle()
  // The user clicked "Sync" at 42.5 s of video: that instant is replay 45000 ms.
  assert.equal(replayMsToVideoSeconds(b, 42.5, 45000), 42.5)
  assert.equal(replayMsToVideoSeconds(b, 42.5, 112000), 109.5)
  assert.equal(videoSecondsToReplayMs(b, 42.5, 109.5), 112000)
  assert.equal(videoSecondsToReplayMs(b, 42.5, 0), 2500)
})

test('roundAtReplayMs switches at the buy phase start', () => {
  const b = bundle()
  assert.equal(roundAtReplayMs(b, -500).n, 1)
  assert.equal(roundAtReplayMs(b, 81999).n, 1)
  assert.equal(roundAtReplayMs(b, 82000).n, 2)
  assert.equal(roundAtReplayMs(b, 999999).n, 2)
})

test('rounds get the replay barrier as their start, so later rounds land exactly', () => {
  // Henrik-derived starts are first-kill times: R1's first kill came 5.8 s after
  // its barrier, R2's 8 s after. That 2.2 s difference is the error being removed.
  const today = [henrikRound(1, 60800), henrikRound(2, 130000)]
  assert.equal(getRoundVideoTime(today[1], today, 40), 40 + 69.2)

  const timed = applyReplayTiming(today, bundle(), agentName)
  assert.equal(getRoundVideoTime(timed[0], timed, 40), 40)
  assert.equal(getRoundVideoTime(timed[1], timed, 40), 40 + 67) // 112000 − 45000
})

test('kill and death times are measured from the barrier, with names from the bundle', () => {
  const timed = applyReplayTiming([henrikRound(1, 60800), henrikRound(2, 130000)], bundle(), agentName)

  assert.deepEqual(timed[0].kill_events, [])
  assert.deepEqual(timed[0].death_events, [{ kill_time_ms: 25800, killer: 'Fade', weapon: 'Bandit' }])
  assert.deepEqual(timed[1].kill_events, [{ kill_time_ms: 8000, victim: 'Fade', weapon: 'Vandal' }])
  // The self-death is a death, never a kill.
  assert.deepEqual(timed[1].death_events, [{ kill_time_ms: 38000, killer: 'self', weapon: '' }])
})

test('Henrik’s economy and counts survive; only timing is replaced', () => {
  const timed = applyReplayTiming([henrikRound(1, 60800), henrikRound(2, 130000)], bundle(), agentName)
  assert.equal(timed[1].id, 'h-2')
  assert.equal(timed[1].loadout_value, 3900)
  assert.equal(timed[1].end_type, 'Eliminated')
  assert.equal(timed[1].round_start_ms, 112000)
  assert.equal(timed[1].round_duration_ms, 42000)
})

test('with no Henrik rounds at all, the timeline is built from the replay', () => {
  const timed = applyReplayTiming([], bundle(), agentName)
  assert.equal(timed.length, 2)
  assert.equal(timed[0].side, 'attack')
  assert.equal(timed[0].round_won, false)
  assert.equal(timed[1].round_won, true)
  assert.equal(timed[1].kills, 1)
  assert.equal(timed[1].deaths, 1)
  assert.equal(timed[1].end_type, 'elimination')
})

test('a bundle that cannot drive the timeline leaves the rounds untouched', () => {
  const rounds = [henrikRound(1, 60800), henrikRound(2, 130000)]
  const noOwner = bundle({ players: bundle().players.map(p => ({ ...p, isMe: false })) })
  assert.equal(applyReplayTiming(rounds, noOwner, agentName), rounds)

  const noBarrier = bundle({ rounds: bundle().rounds.map(r => (r.n === 2 ? { ...r, barrierMs: null } : r)) })
  assert.equal(applyReplayTiming(rounds, noBarrier, agentName), rounds)
})

test('weaponLabel prefers the corrected gun name and tidies ability classes', () => {
  assert.equal(weaponLabel({ cls: 'AssaultRifle_AK_C', name: 'Vandal', cat: 'rifle' }), 'Vandal')
  assert.equal(weaponLabel({ cls: 'CompactPistol_C', name: 'Compact Pistol', cat: 'sidearm' }), 'Bandit')
  assert.equal(weaponLabel({ cls: 'BattleRifle_C', name: null, cat: null }), 'Warden')
  assert.equal(weaponLabel({ cls: 'Ability_Clay_X_RocketLauncher_C', name: null, cat: null }), 'Clay X RocketLauncher')
  assert.equal(weaponLabel(null), '')
})
