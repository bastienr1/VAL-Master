/**
 * Unit tests for the minimap's per-instant state (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deathTimesBySubject,
  isAliveAt,
  pawnStateAt,
  playedViewport,
  playerStateAt,
  sampleIndex,
  worldToImage,
} from './replayScene.ts'
import type { ReplayBundle, ReplayTrackSample } from './replayBundle.ts'

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
  assert.deepEqual(playerStateAt(rows, 1050), { x: 150, y: 300, yaw: 100, alive: true, weapon: 3 })
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
  assert.deepEqual(playerStateAt(rows, 5000), { x: 100, y: 100, yaw: 0, alive: false, weapon: null })
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
