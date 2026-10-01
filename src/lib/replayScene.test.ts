/**
 * Unit tests for the minimap's per-instant state (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deathTimesBySubject,
  isAliveAt,
  isPresentAt,
  attackersBottomTurns,
  ownSideTurns,
  pawnStateAt,
  playedViewport,
  playerStateAt,
  sampleIndex,
  turnPoint,
  worldToImage,
} from './replayScene.ts'
import type { ReplayBundle, ReplaySide, ReplayTrackSample } from './replayBundle.ts'

const LOTUS = { xMultiplier: 7.2e-5, yMultiplier: -7.2e-5, xScalarToAdd: 0.454789, yScalarToAdd: 0.917752 }

test('sampleIndex finds the last row at or before a time', () => {
  const rows: ReplayTrackSample[] = [[100, 0, 0, 0, 1, null], [200, 0, 0, 0, 1, null], [300, 0, 0, 0, 1, null]]
  assert.equal(sampleIndex(rows, 99), -1)
  assert.equal(sampleIndex(rows, 100), 0)
  assert.equal(sampleIndex(rows, 250), 1)
  assert.equal(sampleIndex(rows, 9999), 2)
  assert.equal(sampleIndex([], 100), -1)
})

test('position interpolates between two 10 Hz samples', () => {
  const rows: ReplayTrackSample[] = [[1000, 100, 200, 90, 1, 3], [1100, 200, 400, 110, 1, 3]]
  assert.deepEqual(playerStateAt(rows, 1050), { x: 150, y: 300, yaw: 100, alive: true, weapon: 3, sampledAt: 1000 })
  assert.equal(playerStateAt(rows, 999), null)
})

test('yaw interpolates the short way across 0°', () => {
  const rows: ReplayTrackSample[] = [[0, 0, 0, 350, 1, null], [100, 0, 0, 10, 1, null]]
  assert.equal(playerStateAt(rows, 50)?.yaw, 0)
  assert.equal(playerStateAt(rows, 25)?.yaw, 355)
})

test('across a gap the last position is held, not interpolated', () => {
  // Dead body's last sample, then the next round's spawn 8 s later on the other side of the map.
  const rows: ReplayTrackSample[] = [[1000, 100, 100, 0, 0, null], [9000, 5000, 5000, 0, 1, null]]
  assert.deepEqual(playerStateAt(rows, 5000), { x: 100, y: 100, yaw: 0, alive: false, weapon: null, sampledAt: 1000 })
  assert.deepEqual(pawnStateAt([[1000, 1, 2, 3], [9000, 50, 60, 70]], 5000), { x: 1, y: 2, yaw: 3 })
})

test('a death shows at its exact time, before the track’s flag catches up', () => {
  // Death at 1040; the 1000 sample still says alive, the 1100 sample says dead.
  const rows: ReplayTrackSample[] = [[1000, 0, 0, 0, 1, null], [1100, 0, 0, 0, 0, null], [1200, 0, 0, 0, 0, null]]
  const deaths = [1040]
  assert.equal(isAliveAt(playerStateAt(rows, 1030), deaths, 1030), true)
  assert.equal(isAliveAt(playerStateAt(rows, 1050), deaths, 1050), false)
  assert.equal(isAliveAt(playerStateAt(rows, 1150), deaths, 1150), false)
})

test('a revive shows once the track says alive again', () => {
  // Died at 1000, revived at 9000 (Sage's resurrection): the flag comes back to 1.
  const rows: ReplayTrackSample[] = [[900, 0, 0, 0, 1, null], [1100, 0, 0, 0, 0, null], [9000, 0, 0, 0, 1, null], [9100, 0, 0, 0, 1, null]]
  const deaths = [1000]
  assert.equal(isAliveAt(playerStateAt(rows, 5000), deaths, 5000), false)
  assert.equal(isAliveAt(playerStateAt(rows, 9050), deaths, 9050), true)
})

test('a player with no deaths, or no track yet, is handled', () => {
  const rows: ReplayTrackSample[] = [[1000, 0, 0, 0, 1, null]]
  assert.equal(isAliveAt(playerStateAt(rows, 1000), undefined, 1000), true)
  assert.equal(isAliveAt(null, [500], 1000), false)
})

test('a player who left the match is off the map; a dead one is not', () => {
  const roundStart = 100000
  const live: ReplayTrackSample[] = [[104900, 0, 0, 0, 1, null], [105000, 0, 0, 0, 1, null]]
  assert.equal(isPresentAt(playerStateAt(live, 105020), 105020, roundStart), true)

  // Disconnected mid-round: last seen alive, then silence.
  assert.equal(isPresentAt(playerStateAt(live, 106000), 106000, roundStart), true)
  assert.equal(isPresentAt(playerStateAt(live, 109000), 109000, roundStart), false)

  // Dead: the body goes quiet after its last "dead" sample, and the marker must stay.
  const dead: ReplayTrackSample[] = [[104900, 0, 0, 0, 1, null], [105000, 0, 0, 0, 0, null]]
  assert.equal(isPresentAt(playerStateAt(dead, 140000), 140000, roundStart), true)

  // Never came back for this round: their last sample is from before it started.
  assert.equal(isPresentAt(playerStateAt(dead, 140000), 140000, 120000), false)
  assert.equal(isPresentAt(null, 140000, roundStart), false)
})

test('deathTimesBySubject groups kills by victim in order', () => {
  const bundle = {
    kills: [
      { t: 10, victim: 'a' }, { t: 20, victim: 'b' }, { t: 30, victim: 'a' }, { t: 40, victim: null },
    ],
  } as unknown as ReplayBundle
  assert.deepEqual([...deathTimesBySubject(bundle)], [['a', [10, 30]], ['b', [20]]])
})

test('worldToImage crosses the axes: world Y is horizontal', () => {
  // Lotus B site plant from the Lotus match: world (6432, 720).
  const [u, v] = worldToImage(LOTUS, 6432, 720)
  assert.ok(Math.abs(u - (720 * 7.2e-5 + 0.454789)) < 1e-9)
  assert.ok(Math.abs(v - (6432 * -7.2e-5 + 0.917752)) < 1e-9)
  assert.ok(u > 0 && u < 1 && v > 0 && v < 1)
})

test('playedViewport is a square around the played area, inside the image', () => {
  const bundle = {
    tracks: { byPlayer: { a: [[0, 1000, -5000, 0, 1, null], [100, 9000, 6000, 0, 1, null]] } },
  } as unknown as ReplayBundle
  const view = playedViewport(bundle, LOTUS)
  const [u0, v0] = worldToImage(LOTUS, 9000, -5000)
  const [u1, v1] = worldToImage(LOTUS, 1000, 6000)
  assert.ok(view.size < 1 && view.size > Math.max(u1 - u0, v1 - v0))
  assert.ok(view.u >= 0 && view.v >= 0 && view.u + view.size <= 1 + 1e-9 && view.v + view.size <= 1 + 1e-9)
  assert.ok(view.u <= u0 && view.u + view.size >= u1)
  assert.ok(view.v <= v0 && view.v + view.size >= v1)
})

test('playedViewport falls back to the whole image when there are no samples', () => {
  const bundle = { tracks: { byPlayer: {} } } as unknown as ReplayBundle
  assert.deepEqual(playedViewport(bundle, LOTUS), { u: 0, v: 0, size: 1 })
})

// Lotus: the attacker spawn is at world x ≈ 1400 (bottom of the image), the defender spawn at x ≈ 9700 (top).
function twoTeams(rounds: Array<{ n: number; buyStartMs: number; side?: ReplaySide; ally: [number, number] | null; enemy: [number, number] | null }>): ReplayBundle {
  const track = (pick: 'ally' | 'enemy'): ReplayTrackSample[] =>
    rounds.flatMap(r => {
      const at = r[pick]
      return at ? ([[r.buyStartMs + 2950, at[0], at[1], 0, 1, null], [r.buyStartMs + 3050, at[0], at[1], 0, 1, null]] as ReplayTrackSample[]) : []
    })
  return {
    players: [
      { subject: 'me', agentId: null, team: 'ALLY', teamName: null, body: 1, isMe: true },
      { subject: 'foe', agentId: null, team: 'ENEMY', teamName: null, body: 2, isMe: false },
    ],
    rounds: rounds.map(r => ({ n: r.n, buyStartMs: r.buyStartMs, side: r.side ?? null })),
    tracks: { byPlayer: { me: track('ally'), foe: track('enemy') } },
  } as unknown as ReplayBundle
}

test('ownSideTurns keeps my team at the bottom when the sides swap', () => {
  const bundle = twoTeams([
    { n: 1, buyStartMs: 0, ally: [1400, 800], enemy: [9700, 1700] }, // I attack: already at the bottom
    { n: 2, buyStartMs: 100000, ally: [9700, 1700], enemy: [1400, 800] }, // I defend: at the top, so turn the map
  ])
  assert.deepEqual([...ownSideTurns(bundle, LOTUS)], [[1, 0], [2, 2]])
})

test('ownSideTurns stands a sideways map upright, my team at the bottom', () => {
  // Same x, so the same height on the image; world y decides left and right.
  const left = twoTeams([{ n: 1, buyStartMs: 0, ally: [5000, -4000], enemy: [5000, 6000] }])
  const right = twoTeams([{ n: 1, buyStartMs: 0, ally: [5000, 6000], enemy: [5000, -4000] }])
  for (const bundle of [left, right]) {
    const turns = ownSideTurns(bundle, LOTUS).get(1)!
    const [, allyY] = turnPoint(...worldToImage(LOTUS, ...bundle.tracks.byPlayer.me[0].slice(1, 3) as [number, number]), 1, turns)
    const [, enemyY] = turnPoint(...worldToImage(LOTUS, ...bundle.tracks.byPlayer.foe[0].slice(1, 3) as [number, number]), 1, turns)
    assert.ok(allyY > enemyY + 0.5, `my team below the enemy after ${turns} quarter turns`)
  }
  assert.equal(ownSideTurns(left, LOTUS).get(1), 3) // enemy on the right: anticlockwise
  assert.equal(ownSideTurns(right, LOTUS).get(1), 1)
})

test('ownSideTurns carries the last orientation through a round it cannot measure', () => {
  const bundle = twoTeams([
    { n: 1, buyStartMs: 0, ally: [9700, 1700], enemy: [1400, 800] },
    { n: 2, buyStartMs: 100000, ally: null, enemy: null },
  ])
  assert.deepEqual([...ownSideTurns(bundle, LOTUS)], [[1, 2], [2, 2]])
})

test('turnPoint turns a square clockwise about its centre', () => {
  assert.deepEqual(turnPoint(100, 50, 100, 0), [100, 50])
  assert.deepEqual(turnPoint(100, 50, 100, 1), [50, 100]) // right edge to the bottom
  assert.deepEqual(turnPoint(100, 50, 100, 2), [0, 50])
  assert.deepEqual(turnPoint(100, 50, 100, 3), [50, 0]) // right edge to the top
})

test('the fixed orientation puts attackers at the bottom whichever side I start on', () => {
  const attackFirst = twoTeams([{ n: 1, buyStartMs: 0, side: 'attacker', ally: [5000, -4000], enemy: [5000, 6000] }])
  const defendFirst = twoTeams([{ n: 1, buyStartMs: 0, side: 'defender', ally: [5000, 6000], enemy: [5000, -4000] }])
  // The same map and the same spawns: attackers at world y = -4000 both times.
  assert.equal(attackersBottomTurns(attackFirst, ownSideTurns(attackFirst, LOTUS)), 3)
  assert.equal(attackersBottomTurns(defendFirst, ownSideTurns(defendFirst, LOTUS)), 3)
})
