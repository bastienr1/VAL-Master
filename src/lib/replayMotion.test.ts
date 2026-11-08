/**
 * Unit tests for the Plays replay layers (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReplayBundle } from './replayBundle.ts'
import { createFrameIds } from './replayFrame.ts'
import { frameMotion, pawnEffectIds } from './replayMotion.ts'
import type { SightGrid } from './sightGrid.ts'

// World x → v, world y → u, 10 000 cm across the image.
const T = { xMultiplier: 0.0001, yMultiplier: 0.0001, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

const bundle = {
  players: [
    { subject: 'p1', agentId: null, team: 'ALLY', teamName: null, body: 0, isMe: true },
    { subject: 'p2', agentId: null, team: 'ENEMY', teamName: null, body: 0, isMe: false },
  ],
  tracks: {
    hz: 10,
    fields: [],
    byPlayer: {
      p1: [[0, 0, 0, 0, 1, null], [1000, 0, 0, 0, 1, null], [4000, 1000, 0, 0, 1, null], [5000, 2000, 0, 0, 1, null]],
      p2: [],
    },
  },
  effects: [
    { start: 0, end: 10, kind: 'recon', agent: 'Hunter', cls: 'Pawn_Hunter_E_Drone_C', x: 0, y: 0, owner: 'p1' },
    { start: 0, end: 10, kind: 'other', agent: 'Hunter', cls: 'GameObject_Hunter_Q_SonarBolt_C', x: 0, y: 0, owner: 'p1' },
  ],
} as unknown as ReplayBundle

const SIGHT_N = 100
/** A free grid with a vertical wall at u = 0.7. */
const walled = (): SightGrid => {
  const blocked = new Uint8Array(SIGHT_N * SIGHT_N)
  for (let v = 0; v < SIGHT_N; v++) {
    blocked[v * SIGHT_N + 70] = 1
    blocked[v * SIGHT_N + 71] = 1
  }
  return { n: SIGHT_N, blocked }
}

test('without the map\'s walls a cone reaches 9 m, spread either side of the view, and a player with no track has none', () => {
  const ids = createFrameIds()
  const motion = frameMotion(bundle, 1000, T, ids, { cones: true, trails: false })
  assert.deepEqual([...motion.keys()], [ids.forSubject('p1')])
  const m = motion.get(ids.forSubject('p1'))!
  assert.equal(m.trail, null)
  assert.equal(m.cone!.length, 49)
  for (const p of m.cone!) near(Math.hypot(p.u - m.at.u, p.v - m.at.v), 0.09)
  assert.notEqual(m.cone![0].u, m.cone![48].u)
})

test('with the walls every sight line runs until a wall or the edge stops it', () => {
  const ids = createFrameIds()
  // Looking along +y (yaw 90), which is +u in this transform, at the wall at u = 0.7.
  const looking = structuredClone(bundle)
  looking.tracks.byPlayer.p1 = [[0, 0, 0, 90, 1, null], [1000, 0, 0, 90, 1, null]]
  const m = frameMotion(looking, 1000, T, ids, { cones: true, trails: false, sight: walled() }).get(ids.forSubject('p1'))!
  const middle = m.cone![24]
  assert.ok(middle.u < 0.7 && middle.u > 0.68, `stops at the wall, at ${middle.u}`)
  near(middle.v, m.at.v)
  // Past 9 m: 0.2 of the map is 20 m here.
  assert.ok(Math.hypot(middle.u - m.at.u, middle.v - m.at.v) > 0.09)
})

test('a trail holds the last 3 seconds, oldest first', () => {
  const ids = createFrameIds()
  const trail = frameMotion(bundle, 4000, T, ids, { cones: false, trails: true }).get(ids.forSubject('p1'))!.trail!
  assert.equal(trail.length, 2)
  assert.notDeepEqual(trail[0], trail[1])
  assert.equal(frameMotion(bundle, 4000, T, ids, { cones: false, trails: false }).size, 0)
})

test('only pawn classes count as pawns', () => {
  const ids = createFrameIds()
  assert.deepEqual([...pawnEffectIds(bundle, ids)], [ids.forEffect(0)])
})
