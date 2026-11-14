/**
 * Unit tests for a player's best angles in a Deathmatch replay
 * (docs/plays-editor-v2.md §2.20): spots, facings, held kills and the ranking
 * (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayKill, type ReplayTrackSample } from './replayBundle.ts'
import { bestAngles } from './replayAngles.ts'

const ME = 'me'
const FOE = 'foe'

/** A row every 100 ms from 0 to 60 s; `at` gives [x, y, yaw, alive] at a time, or null for no row. */
function track(at: (t: number) => [number, number, number, 0 | 1] | null): ReplayTrackSample[] {
  const rows: ReplayTrackSample[] = []
  for (let t = 0; t <= 60000; t += 100) {
    const row = at(t)
    if (row) rows.push([t, row[0], row[1], row[2], row[3], null])
  }
  return rows
}

/** My kill at `t` from (x, y) on a victim at (vx, vy). */
const kill = (t: number, x: number, y: number, vx: number, vy: number): ReplayKill => ({ t, round: 1, killer: ME, victim: FOE, weapon: null, kx: x, ky: y, vx, vy })
/** Someone else's kill, far away: a moment at which everyone alive is seen. */
const elsewhere = (t: number): ReplayKill => ({ t, round: 1, killer: FOE, victim: 'third', weapon: null, kx: 9000, ky: 9000, vx: 9500, vy: 9000 })
/** My death at `t` on (x, y). */
const death = (t: number, x: number, y: number): ReplayKill => ({ t, round: 1, killer: FOE, victim: ME, weapon: null, kx: 9000, ky: 9000, vx: x, vy: y })

function bundle(mine: ReplayTrackSample[], kills: ReplayKill[]): ReplayBundle {
  return {
    schema: REPLAY_BUNDLE_SCHEMA,
    parser: { vrfkit: null, reducer: 'henrik-dm 1.0.0' },
    match: { matchId: 'dm-1', mapUuid: 'lotus-uuid', mapUrl: '/Game/Maps/Jam/Jam', build: 'release-13.10', recordedAt: '2026-11-13T04:14:14Z', durationMs: 60000, mode: 'deathmatch' },
    players: [
      { subject: ME, agentId: 'raze-uuid', team: 'ALLY', teamName: null, body: 0, isMe: true },
      { subject: FOE, agentId: 'jett-uuid', team: 'ENEMY', teamName: null, body: 0, isMe: false },
    ],
    rounds: [{ n: 1, buyStartMs: 0, barrierMs: 0, endMs: 60000, side: null, winner: 'ALLY', how: 'deathmatch', plant: null, defuse: null }],
    weapons: [],
    tracks: { hz: 10, fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'], byPlayer: { [ME]: mine, [FOE]: [] } },
    kills: [...kills].sort((a, b) => a.t - b.t),
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: ['t', 'x', 'y', 'yaw'], items: [] },
  }
}

/** Standing on the origin, looking along +x (yaw 0). */
const still = track(() => [0, 0, 0, 1])

test('kills from one spot, looking one way, are one angle', () => {
  const angles = bestAngles(bundle(still, [kill(10000, 0, 0, 2000, 0), kill(12000, 100, 50, 2100, 100), kill(14000, -100, 0, 1900, -100)]), ME)
  assert.equal(angles.length, 1)
  assert.equal(angles[0].rank, 1)
  assert.deepEqual(angles[0].kills.map(k => k.t), [10000, 12000, 14000])
  assert.ok(Math.abs(angles[0].x) < 1e-9)
  assert.ok(Math.abs(angles[0].y - 50 / 3) < 1e-9)
  assert.equal(Math.round(angles[0].tx), 2000)
})

test('a kill further than 350 units from the others is another spot, ranked after', () => {
  const angles = bestAngles(bundle(still, [kill(10000, 0, 0, 2000, 0), kill(12000, 100, 0, 2000, 0), kill(14000, 3000, 0, 5000, 0)]), ME)
  assert.deepEqual(angles.map(a => a.kills.length), [2, 1])
  assert.equal(angles[1].x, 3000)
})

test('one spot looked out of both ways is two angles', () => {
  // Yaw 0 for the first half, 180 for the second: the same corner, held towards two sites.
  const turning = track(t => [0, 0, t < 20000 ? 0 : 180, 1])
  const angles = bestAngles(bundle(turning, [kill(10000, 0, 0, 2000, 0), kill(12000, 0, 0, 2000, 0), kill(30000, 0, 0, -2000, 0)]), ME)
  assert.deepEqual(angles.map(a => a.kills.length), [2, 1])
  assert.ok(Math.abs(angles[0].facingDeg) < 1e-6 || Math.abs(angles[0].facingDeg - 360) < 1e-6)
  assert.ok(Math.abs(angles[1].facingDeg - 180) < 1e-6)
})

test('the facing is the line to the victim when the track has nothing at the kill', () => {
  const angles = bestAngles(bundle([], [kill(10000, 0, 0, 0, 2000)]), ME)
  assert.ok(Math.abs(angles[0].facingDeg - 90) < 1e-6)
})

test('a kill is held when the player barely moved since the event before it', () => {
  // Still until 20 s, then 500 units a second along x.
  const walking = track(t => [t < 20000 ? 0 : (t - 20000) / 2, 0, 0, 1])
  const angles = bestAngles(
    bundle(walking, [
      kill(5000, 0, 0, 2000, 0), // nothing before it
      elsewhere(9000),
      kill(10000, 0, 0, 2000, 0), // still since 9 s
      kill(18000, 0, 0, 2000, 0), // the event before is 8 s old
      elsewhere(24000),
      kill(25000, 2500, 0, 4500, 0), // 500 units in the last second
    ]),
    ME,
  )
  const stances = Object.fromEntries(angles.flatMap(a => a.kills).map(k => [k.t, k.stance]))
  assert.deepEqual(stances, { 5000: 'unknown', 10000: 'held', 18000: 'unknown', 25000: 'moving' })
  assert.equal(angles[0].held, 1)
})

test('a kill straight after a respawn is of unknown stance', () => {
  // Dead from 10 s, back at 13 s with no row in between but the body's.
  const respawned = track(t => (t < 10000 ? [0, 0, 0, 1] : t < 12700 ? [0, 0, 0, 0] : t < 13000 ? null : [0, 0, 0, 1]))
  const angles = bestAngles(bundle(respawned, [death(10000, 0, 0), elsewhere(12000), kill(13000, 0, 0, 2000, 0)]), ME)
  assert.equal(angles[0].kills[0].stance, 'unknown')
})

test('with as many kills, the angle with fewer deaths nearby ranks first, then the one with more held kills', () => {
  const kills = [
    // A, on the origin: two kills, one death on the spot.
    kill(10000, 0, 0, 2000, 0),
    kill(11000, 0, 0, 2000, 0),
    death(40000, 100, 100),
    // B, 5000 away: two kills, no death.
    kill(20000, 5000, 0, 7000, 0),
    kill(21000, 5000, 0, 7000, 0),
  ]
  const angles = bestAngles(bundle(track(t => [t < 15000 ? 0 : 5000, 0, 0, 1]), kills), ME)
  assert.deepEqual(angles.map(a => [a.x, a.deathsNear]), [[5000, 0], [0, 1]])
  assert.equal(angles[0].rank, 1)
  assert.equal(angles[1].rank, 2)
})

test('an angle is named by the callout nearest the spot and the one nearest the victims', () => {
  const callouts = [
    { name: 'B Main', x: 100, y: 0 },
    { name: 'B Site', x: 2100, y: 0 },
    { name: 'A Site', x: -9000, y: 0 },
  ]
  const kills = [kill(10000, 0, 0, 2000, 0), kill(12000, 0, 0, 2000, 400)]
  const [named] = bestAngles(bundle(still, kills), ME, callouts)
  assert.equal(named.from, 'B Main')
  assert.equal(named.toward, 'B Site')
  const [bare] = bestAngles(bundle(still, kills), ME)
  assert.equal(bare.from, null)
  assert.equal(bare.toward, null)
})

test('the distance is in metres, and an angle gives the median', () => {
  const [angle] = bestAngles(bundle(still, [kill(10000, 0, 0, 1000, 0), kill(11000, 0, 0, 2000, 0), kill(12000, 0, 0, 4000, 0), kill(13000, 0, 0, 3000, 0)]), ME)
  assert.deepEqual(angle.kills.map(k => k.distanceM), [10, 20, 40, 30])
  assert.equal(angle.medianDistanceM, 25)
})

test("someone else's kills, self-deaths and kills with no position are left out", () => {
  const kills: ReplayKill[] = [
    elsewhere(5000),
    { t: 6000, round: 1, killer: ME, victim: ME, weapon: null, kx: 0, ky: 0, vx: 0, vy: 0 },
    { t: 7000, round: 1, killer: ME, victim: FOE, weapon: null, kx: null, ky: null, vx: 2000, vy: 0 },
  ]
  assert.deepEqual(bestAngles(bundle(still, kills), ME), [])
})
