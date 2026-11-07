/**
 * Unit tests for the map-control grid (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  averageShare,
  baselineFor,
  baselineForSide,
  CONTROL_N,
  DEFAULT_CONTROL_SIGMA,
  controlShare,
  controlTimeline,
  emptyGrid,
  influence,
  instantControl,
  presencesOf,
  sigmaFor,
  simulateControl,
  stepControl,
  type ControlGrid,
  type Presence,
} from './mapControl.ts'
import { REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayTrackSample } from './replayBundle.ts'
import type { MapCallout, PlayStep } from './playDoc.ts'

const N = 16
const SIGMA = 0.1

const fullMask = (n = N) => new Uint8Array(n * n).fill(1)
/** The cell holding the image point (u, v). */
const at = (grid: ControlGrid, u: number, v: number) =>
  grid.values[Math.floor(v * grid.n) * grid.n + Math.floor(u * grid.n)]
/** The centre of cell (i, j) of an N grid, in image units. */
const centre = (i: number, n = N) => (i + 0.5) / n

const ally = (u: number, v: number): Presence => ({ u, v, team: 'ally' })
const enemy = (u: number, v: number): Presence => ({ u, v, team: 'enemy' })

test('one ally makes the cells near it positive and the far ones exactly zero', () => {
  const grid = instantControl(fullMask(), [ally(centre(8), centre(8))], SIGMA)
  assert.equal(at(grid, centre(8), centre(8)), 1)
  assert.ok(at(grid, centre(9), centre(8)) > 0.5)
  assert.ok(at(grid, centre(8), centre(10)) > 0.05)
  assert.equal(at(grid, centre(0), centre(0)), 0)
  assert.equal(at(grid, centre(15), centre(8)), 0)
  for (const v of grid.values) assert.ok(v >= 0 && v <= 1)
})

test('influence sums team-signed Gaussians in image units', () => {
  assert.equal(influence([ally(0.5, 0.5)], 0.5, 0.5, SIGMA), 1)
  assert.ok(Math.abs(influence([ally(0.5, 0.5)], 0.6, 0.5, SIGMA) - Math.exp(-1)) < 1e-12)
  assert.ok(Math.abs(influence([enemy(0.5, 0.5), enemy(0.5, 0.5)], 0.5, 0.5, SIGMA) + 2) < 1e-12)
  assert.equal(influence([ally(0.5, 0.5)], 0.5, 0.5, 0), 0)
})

test('an enemy next to an ally cancels it to near zero', () => {
  const pair = [ally(0.5, 0.5), enemy(0.504, 0.5)]
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) assert.ok(Math.abs(influence(pair, centre(i), centre(j), SIGMA)) < 0.05)
  }
  const grid = instantControl(fullMask(), pair, SIGMA)
  for (const v of grid.values) assert.equal(v, 0)
})

test('instantControl is the clamped target, zero where the influence is weak', () => {
  const presences = [ally(0.3, 0.3), ally(0.32, 0.3), enemy(0.7, 0.6)]
  const grid = instantControl(fullMask(), presences, SIGMA)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const I = influence(presences, centre(i), centre(j), SIGMA)
      const want = Math.abs(I) > 0.05 ? Math.sign(I) * Math.min(1, Math.abs(I)) : 0
      // Float32 storage, and the 3σ cutoff drops tails below exp(−9).
      assert.ok(Math.abs(grid.values[j * N + i] - want) < 1e-3, `cell ${i},${j}`)
    }
  }
  assert.equal(at(grid, 0.3, 0.3), 1)
  assert.ok(at(grid, 0.7, 0.6) < -0.5)
})

test('stepControl moves toward the target with a 2.5 s time constant', () => {
  const u = centre(8)
  const once = emptyGrid(fullMask())
  stepControl(once, [ally(u, u)], 2500, SIGMA)
  assert.ok(Math.abs(at(once, u, u) - (1 - Math.exp(-1))) < 1e-6)

  // 25 ticks of 100 ms land on the same value.
  const ticked = emptyGrid(fullMask())
  for (let k = 0; k < 25; k++) stepControl(ticked, [ally(u, u)], 100, SIGMA)
  assert.ok(Math.abs(at(ticked, u, u) - at(once, u, u)) < 1e-5)

  // Long enough, it reaches the target.
  stepControl(once, [ally(u, u)], 60000, SIGMA)
  assert.ok(Math.abs(at(once, u, u) - 1) < 1e-6)
})

test('stepControl decays toward zero with a 25 s time constant where nobody is near', () => {
  const grid = emptyGrid(fullMask())
  grid.values.fill(1)
  grid.touched.fill(1)
  stepControl(grid, [ally(centre(0), centre(0))], 25000, SIGMA)
  assert.ok(Math.abs(at(grid, 0.9, 0.9) - Math.exp(-1)) < 1e-6)
  // Near the ally the cell was already at the target: it stays.
  assert.ok(Math.abs(at(grid, 0.05, 0.05) - 1) < 1e-6)

  const negative = emptyGrid(fullMask())
  negative.values.fill(-0.8)
  negative.touched.fill(1)
  stepControl(negative, [], 50000, SIGMA)
  assert.ok(Math.abs(at(negative, 0.5, 0.5) + 0.8 * Math.exp(-2)) < 1e-6)
})

test('masked-out cells stay 0', () => {
  // Top half playable, bottom half not.
  const mask = new Uint8Array(N * N)
  mask.fill(1, 0, (N / 2) * N)
  const presences = [ally(0.5, 0.5), enemy(0.2, 0.55)]
  const grid = emptyGrid(mask)
  for (let k = 0; k < 50; k++) stepControl(grid, presences, 100, SIGMA)
  const instant = instantControl(mask, presences, SIGMA)
  for (let k = 0; k < N * N; k++) {
    if (mask[k]) continue
    assert.equal(grid.values[k], 0)
    assert.equal(instant.values[k], 0)
  }
  assert.ok(at(grid, 0.5, 0.45) > 0)
})

test('controlShare: claimed + contested cover the playable cells, ally + enemy the claimed ones', () => {
  const mask = fullMask()
  mask[0] = 0
  mask[1] = 0
  const grid = emptyGrid(mask)
  for (let k = 0; k < N * N; k++) grid.values[k] = Math.sin(k * 1.7)
  const share = controlShare(grid)
  assert.ok(share.claimed > 0 && share.contested > 0)
  assert.ok(Math.abs(share.claimed + share.contested - 1) < 1e-12)
  assert.ok(Math.abs(share.ally + share.enemy - 1) < 1e-12)

  // Exact counts: 3 ally (one at the edge), 2 enemy, the rest contested, masked cells ignored.
  const exact = emptyGrid(mask)
  exact.values[0] = 1 // masked out
  exact.values[2] = 0.25
  exact.values[3] = 0.9
  exact.values[4] = 1
  exact.values[5] = -0.25
  exact.values[6] = -1
  exact.values[7] = 0.2
  const playable = N * N - 2
  assert.deepEqual(controlShare(exact), { ally: 3 / 5, enemy: 2 / 5, contested: (playable - 5) / playable, claimed: 5 / playable })

  // Nothing claimed: no team share, all contested.
  assert.deepEqual(controlShare(emptyGrid(mask)), { ally: 0, enemy: 0, contested: 1, claimed: 0 })
  // Nothing playable: all zero.
  assert.deepEqual(controlShare(emptyGrid(new Uint8Array(N * N))), { ally: 0, enemy: 0, contested: 0, claimed: 0 })
})

test('a baseline grid starts every playable cell at the defenders’ value, nothing touched', () => {
  const mask = fullMask()
  mask[3] = 0
  const grid = emptyGrid(mask, -1)
  assert.equal(grid.baseline, -1)
  for (let k = 0; k < N * N; k++) {
    assert.equal(grid.values[k], mask[k] ? -1 : 0)
    assert.equal(grid.touched[k], 0)
  }
  assert.deepEqual(controlShare(grid), { ally: 0, enemy: 1, contested: 0, claimed: 1 })
  assert.equal(emptyGrid(mask).baseline, 0)
  assert.ok(emptyGrid(mask).values.every(v => v === 0))
})

test('an ally cuts a positive, touched region through a baseline; after it leaves the region fades and the rest stays', () => {
  const grid = emptyGrid(fullMask(), -1)
  const u = centre(8)
  for (let k = 0; k < 100; k++) stepControl(grid, [ally(u, u)], 100, SIGMA)
  assert.ok(at(grid, u, u) > 0.9)
  assert.equal(grid.touched[8 * N + 8], 1)
  assert.equal(grid.touched[0], 0, 'a far corner was never reached')
  assert.equal(at(grid, 0.02, 0.02), -1)

  const held = at(grid, u, u)
  stepControl(grid, [], 25000, SIGMA)
  assert.ok(Math.abs(at(grid, u, u) - held * Math.exp(-1)) < 1e-5, 'touched cells decay toward 0')
  assert.equal(at(grid, 0.02, 0.02), -1, 'untouched cells keep the baseline')
  stepControl(grid, [], 600000, SIGMA)
  assert.ok(Math.abs(at(grid, u, u)) < 1e-6)
  assert.equal(at(grid, 0.02, 0.02), -1)
})

test('instantControl with a baseline is the target near presences and the baseline elsewhere', () => {
  const u = centre(8)
  const grid = instantControl(fullMask(), [ally(u, u)], SIGMA, -1)
  assert.equal(grid.baseline, -1)
  assert.equal(at(grid, u, u), 1)
  assert.equal(grid.touched[8 * N + 8], 1)
  assert.equal(at(grid, 0.02, 0.02), -1)
  assert.equal(grid.touched[0], 0)
  assert.equal(at(instantControl(fullMask(), [], SIGMA, 1), 0.5, 0.5), 1)
})

test('baselineFor and baselineForSide give the defenders’ sign', () => {
  const round = fixture().rounds[0]
  assert.equal(baselineFor({ ...round, side: 'attacker' }), -1)
  assert.equal(baselineFor({ ...round, side: 'defender' }), 1)
  assert.equal(baselineFor({ ...round, side: null }), 0)
  assert.equal(baselineForSide('attack'), -1)
  assert.equal(baselineForSide('defense'), 1)
})

test('version starts at 0 and every mutation bumps it', () => {
  const grid = emptyGrid(fullMask())
  assert.equal(grid.version, 0)
  stepControl(grid, [ally(0.5, 0.5)], 100, SIGMA)
  assert.equal(grid.version, 1)
  stepControl(grid, [], 100, SIGMA)
  assert.equal(grid.version, 2)
  stepControl(grid, [], 0, SIGMA)
  assert.equal(grid.version, 2, 'no time, no change')
  assert.equal(instantControl(fullMask(), [], SIGMA).version, 1)
})

test('emptyGrid reads n from a square mask and refuses others', () => {
  const grid = emptyGrid(new Uint8Array(CONTROL_N * CONTROL_N))
  assert.equal(grid.n, CONTROL_N)
  assert.equal(grid.values.length, CONTROL_N * CONTROL_N)
  assert.throws(() => emptyGrid(new Uint8Array(10)))
})

test('sigmaFor is 1400 world cm in image units', () => {
  assert.ok(Math.abs(sigmaFor({ xMultiplier: -7e-5, yMultiplier: 7e-5, xScalarToAdd: 0, yScalarToAdd: 0 }) - 0.098) < 1e-12)
  assert.equal(DEFAULT_CONTROL_SIGMA, sigmaFor({ xMultiplier: 7e-5, yMultiplier: 7e-5, xScalarToAdd: 0, yScalarToAdd: 0 }))
})

test('presencesOf takes every placeable agent element of a step', () => {
  const transform = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
  const callouts: MapCallout[] = [{ region: 'Main', superRegion: 'A', name: 'A Main', x: 1000, y: 2000 }]
  const step: PlayStep = {
    id: 'setup',
    name: 'Setup',
    caption: '',
    elements: [
      { kind: 'agent', id: 'a', agent: 'Omen', team: 'ally', at: { u: 0.2, v: 0.4 } },
      { kind: 'agent', id: 'b', agent: 'Jett', team: 'enemy', at: { callout: 'A Main' } },
      { kind: 'agent', id: 'c', agent: 'Sova', team: 'ally', at: { callout: 'Nowhere' } },
      { kind: 'ability', id: 'd', agent: 'Omen', slot: null, shape: 'smoke', at: { u: 0.5, v: 0.5 } },
      { kind: 'marker', id: 'e', type: 'enemy', at: { u: 0.6, v: 0.6 } },
    ],
  }
  assert.deepEqual(presencesOf(step, callouts, transform), [
    { u: 0.2, v: 0.4, team: 'ally' },
    { u: 0.7, v: 0.6, team: 'enemy' },
  ])
})

// A tiny bundle in the shape of replayFrame.test.ts: u = y / 10000 + 0.5, v = x / 10000 + 0.5.
const T = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
const OMEN = 'aaaaaaaa-0000-0000-0000-000000000001'
const SOVA = 'aaaaaaaa-0000-0000-0000-000000000002'
const JETT = 'bbbbbbbb-0000-0000-0000-000000000003'

function track(pos: (t: number) => [number, number, 0 | 1]): ReplayTrackSample[] {
  const rows: ReplayTrackSample[] = []
  for (let t = 0; t <= 160000; t += 100) {
    const [x, y, alive] = pos(t)
    rows.push([t, x, y, 0, alive, null])
  }
  return rows
}

function fixture(): ReplayBundle {
  return {
    schema: REPLAY_BUNDLE_SCHEMA,
    parser: { vrfkit: 'v0.4.0', reducer: '0.1.0' },
    match: { matchId: 'm-1', mapUuid: 'lotus-uuid', mapUrl: '/Game/Maps/Jam/Jam', build: 'release-13.09', recordedAt: '2026-09-29T04:48:00Z', durationMs: 160000 },
    players: [
      { subject: OMEN, agentId: 'omen-uuid', team: 'ALLY', teamName: 'Red', body: 1, isMe: true },
      { subject: JETT, agentId: 'jett-uuid', team: 'ENEMY', teamName: 'Blue', body: 3, isMe: false },
      { subject: SOVA, agentId: 'sova-uuid', team: 'ALLY', teamName: 'Red', body: 2, isMe: false },
    ],
    rounds: [
      { n: 1, buyStartMs: 0, barrierMs: 30000, endMs: 80000, side: 'attacker', winner: 'ALLY', how: 'elimination', plant: 60000, defuse: null },
      { n: 2, buyStartMs: 100000, barrierMs: null, endMs: null, side: 'defender', winner: 'ENEMY', how: null, plant: null, defuse: null },
    ],
    weapons: [],
    tracks: {
      hz: 10,
      fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'],
      byPlayer: {
        // Ally spawn at (0.5, 0.5); walks to v = 0.9 between the barrier and the plant.
        [OMEN]: track(t => [t < 30000 ? 0 : t < 60000 ? ((t - 30000) / 30000) * 4000 : 4000, 0, 1]),
        [SOVA]: track(() => [1000, 1000, 1]),
        // Enemy spawn at (0.5, 0.3); dies at 45 s, back for round 2.
        [JETT]: track(t => [-2000, 0, t > 45000 && t < 100000 ? 0 : 1]),
      },
    },
    kills: [{ t: 45000, round: 1, killer: SOVA, victim: JETT, weapon: null, kx: 1000, ky: 1000, vx: -2000, vy: 0 }],
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: ['t', 'x', 'y', 'yaw'], items: [] },
  }
}

test('simulateControl colours the ally spawn cyan and the enemy spawn red at the barrier', () => {
  const bundle = fixture()
  const round = bundle.rounds[0]
  const grid = emptyGrid(fullMask())
  simulateControl(bundle, round, round.buyStartMs, 30000, grid, T)
  assert.equal(grid.version, 300, 'one step per 100 ms tick')
  assert.ok(at(grid, 0.5, 0.5) > 0.5)
  assert.ok(at(grid, 0.5, 0.3) < -0.5)
  assert.equal(at(grid, 0.05, 0.95), 0)
})

test('simulateControl composes: (a, b] then (b, c] equals (a, c]', () => {
  const bundle = fixture()
  const round = bundle.rounds[0]
  const whole = emptyGrid(fullMask())
  simulateControl(bundle, round, 0, 50000, whole, T)
  const parts = emptyGrid(fullMask())
  for (let t = 0; t < 50000; t += 16) simulateControl(bundle, round, t, Math.min(50000, t + 16), parts, T)
  assert.equal(parts.version, whole.version)
  assert.deepEqual(parts.values, whole.values)
})

test('after the enemy dies its ground fades and the ally takes the walked ground', () => {
  const bundle = fixture()
  const round = bundle.rounds[0]
  const grid = emptyGrid(fullMask())
  simulateControl(bundle, round, 0, 45000, grid, T)
  const held = at(grid, 0.5, 0.3)
  simulateControl(bundle, round, 45000, 80000, grid, T)
  assert.ok(held < -0.5)
  assert.ok(at(grid, 0.5, 0.3) > held, 'the dead enemy holds nothing new')
  assert.ok(at(grid, 0.5, 0.9) > 0.5, 'Omen stands at v = 0.9 after the plant')
  // Ticks past the round's end change nothing.
  const version = grid.version
  simulateControl(bundle, round, 80000, 95000, grid, T)
  assert.equal(grid.version, version)
})

test('controlTimeline samples once a second from the barrier to the end', () => {
  const bundle = fixture()
  const round = bundle.rounds[0]
  const timeline = controlTimeline(bundle, round, fullMask(), T)
  assert.equal(timeline.length, 51)
  assert.equal(timeline[0].t, 30000)
  assert.equal(timeline[timeline.length - 1].t, 80000)
  for (let i = 1; i < timeline.length; i++) assert.equal(timeline[i].t - timeline[i - 1].t, 1000)
  for (const { share } of timeline) {
    for (const f of [share.ally, share.enemy, share.contested, share.claimed]) assert.ok(f >= 0 && f <= 1)
    assert.ok(Math.abs(share.claimed + share.contested - 1) < 1e-9)
    if (share.claimed > 0) assert.ok(Math.abs(share.ally + share.enemy - 1) < 1e-9)
  }
  const grid = emptyGrid(fullMask(), -1)
  simulateControl(bundle, round, round.buyStartMs, 30000, grid, T)
  assert.deepEqual(timeline[0].share, controlShare(grid))
  // The owner attacks round 1: the enemy defends and holds all but what the allies stand in.
  // (In this 16-cell fixture σ is a seventh of the map, so the allies' ground and its contested rim are large.)
  const first = timeline[0].share
  assert.ok(first.ally > 0)
  assert.ok(first.enemy > 0.8, `enemy ${first.enemy}`)
  assert.ok(first.claimed > 0.8, `claimed ${first.claimed}`)
  const neutral = emptyGrid(fullMask(), 0)
  simulateControl(bundle, round, round.buyStartMs, 30000, neutral, T)
  assert.ok(controlShare(neutral).enemy < first.enemy - 0.3, 'without a baseline the enemy holds only its spawn')
  // Round 2 has no measured barrier or end: buy + 30 s, then 120 s past it.
  const second = controlTimeline(bundle, bundle.rounds[1], fullMask(), T)
  assert.equal(second[0].t, 130000)
  assert.equal(second.length, 121)
})

test('averageShare averages each fraction', () => {
  assert.deepEqual(
    averageShare([
      { share: { ally: 0.75, enemy: 0.25, contested: 0.25, claimed: 0.75 } },
      { share: { ally: 0.25, enemy: 0.75, contested: 0.5, claimed: 0.5 } },
    ]),
    { ally: 0.5, enemy: 0.5, contested: 0.375, claimed: 0.625 },
  )
  assert.deepEqual(averageShare([]), { ally: 0, enemy: 0, contested: 0, claimed: 0 })
})

test('one stepControl over 96 × 96 with 10 presences is fast', t => {
  const grid = emptyGrid(fullMask(CONTROL_N))
  const presences: Presence[] = []
  for (let i = 0; i < 10; i++) presences.push({ u: 0.2 + 0.06 * i, v: 0.3 + 0.04 * i, team: i < 5 ? 'ally' : 'enemy' })
  const sigma = sigmaFor({ xMultiplier: 7e-5, yMultiplier: -7e-5, xScalarToAdd: 0, yScalarToAdd: 0 })
  for (let k = 0; k < 50; k++) stepControl(grid, presences, 100, sigma)
  const runs = 500
  const t0 = performance.now()
  for (let k = 0; k < runs; k++) stepControl(grid, presences, 100, sigma)
  const ms = (performance.now() - t0) / runs
  t.diagnostic(`stepControl 96x96, 10 presences: ${ms.toFixed(3)} ms`)
  assert.ok(ms < 20, `${ms} ms per step`)
})
