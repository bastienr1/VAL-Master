/**
 * Unit tests for a Deathmatch replay (docs/plays-editor-v2.md §2.19): one
 * round over the whole match, players on the same agent, respawns, and the
 * death marks that fade (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeathmatchBundle, isDeathmatchRound, REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayRound, type ReplayTrackSample } from './replayBundle.ts'
import { createFrameIds, formatRoundClock, frameStep, roundLabel, roundSpan, roundTicks, type ReplayAgentLookup } from './replayFrame.ts'
import { DEATHMATCH_MARK_MS, KILL_FEED_MS, KILL_FRESH_MS, killMarks } from './replayKills.ts'
import { frameMotion, lifeStart } from './replayMotion.ts'
import { controlShare, controlTimeline, CONTROL_N, emptyGrid, simulateControl } from './mapControl.ts'
import type { AgentElement, PlayStep } from './playDoc.ts'

// u = y / 10000 + 0.5, v = x / 10000 + 0.5: easy to read back.
const T = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

const ME = 'me'
/** Two enemies on the same agent, as a Deathmatch allows. */
const JETT_1 = 'jett-1'
const JETT_2 = 'jett-2'

const lookup: ReplayAgentLookup = uuid =>
  uuid === 'raze-uuid' ? { name: 'Raze', abilities: [] } : uuid === 'jett-uuid' ? { name: 'Jett', abilities: [] } : null

/** 10 Hz rows from the timer's start to the end; `at` gives [x, y, alive] at a time, or null for no row (a gap). */
function track(at: (t: number) => [number, number, 0 | 1] | null): ReplayTrackSample[] {
  const rows: ReplayTrackSample[] = []
  for (let t = 10000; t <= 60000; t += 100) {
    const row = at(t)
    if (row) rows.push([t, row[0], row[1], 0, row[2], null])
  }
  return rows
}

const ROUND: ReplayRound = { n: 1, buyStartMs: 0, barrierMs: 10000, endMs: 60000, side: null, winner: 'ALLY', how: 'deathmatch', plant: null, defuse: null }

function fixture(): ReplayBundle {
  return {
    schema: REPLAY_BUNDLE_SCHEMA,
    parser: { vrfkit: null, reducer: 'henrik-dm 1.0.0' },
    match: { matchId: 'dm-1', mapUuid: 'lotus-uuid', mapUrl: '/Game/Maps/Jam/Jam', build: 'release-13.10', recordedAt: '2026-11-13T04:14:14Z', durationMs: 60000, mode: 'deathmatch' },
    players: [
      { subject: ME, agentId: 'raze-uuid', team: 'ALLY', teamName: null, body: 0, isMe: true },
      { subject: JETT_1, agentId: 'jett-uuid', team: 'ENEMY', teamName: null, body: 0, isMe: false },
      { subject: JETT_2, agentId: 'jett-uuid', team: 'ENEMY', teamName: null, body: 0, isMe: false },
    ],
    rounds: [ROUND],
    weapons: [{ cls: 'AssaultRifle_AK_C', name: 'Vandal', cat: 'rifle' }],
    tracks: {
      hz: 10,
      fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'],
      byPlayer: {
        // Walks from (0, 0) along x, never dies.
        [ME]: track(t => [(t - 10000) / 10, 0, 1]),
        // Falls at 20 s on (2000, 2000), lies there 2.5 s and is back at once at (-3000, -3000),
        // as the real bundle has it: the respawn row straight after the dead ones. Falls again at 45 s.
        [JETT_1]: track(t =>
          t <= 20000 ? [2000, 2000, 1] : t <= 22500 ? [2000, 2000, 0] : t <= 45000 ? [-3000, -3000, 1] : t <= 47000 ? [-3000, -3000, 0] : [3000, -3000, 1],
        ),
        // Falls at 30 s on (-2000, 2000); after 1 s of dead rows, nothing until it respawns at (4000, -4000) at 33 s.
        [JETT_2]: track(t => (t <= 30000 ? [-2000, 2000, 1] : t <= 31000 ? [-2000, 2000, 0] : t < 33000 ? null : [4000, -4000, 1])),
      },
    },
    kills: [
      { t: 20000, round: 1, killer: ME, victim: JETT_1, weapon: 0, kx: 1000, ky: 0, vx: 2000, vy: 2000 },
      { t: 30000, round: 1, killer: JETT_1, victim: JETT_2, weapon: 0, kx: -3000, ky: -3000, vx: -2000, vy: 2000 },
      { t: 45000, round: 1, killer: JETT_2, victim: JETT_1, weapon: 0, kx: 4000, ky: -4000, vx: -3000, vy: -3000 },
    ],
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: ['t', 'x', 'y', 'yaw'], items: [] },
  }
}

/** The same match as a competitive bundle would read: no mode, a round won by elimination. */
function competitive(): ReplayBundle {
  const bundle = fixture()
  delete bundle.match.mode
  bundle.rounds = [{ ...ROUND, how: 'elimination', side: 'attacker' }]
  return bundle
}

const agents = (step: PlayStep) => step.elements.filter((e): e is AgentElement => e.kind === 'agent')

test('a Deathmatch bundle and its round are known as such; a competitive one is not', () => {
  assert.equal(isDeathmatchBundle(fixture()), true)
  assert.equal(isDeathmatchRound(fixture().rounds[0]), true)
  assert.equal(isDeathmatchBundle(competitive()), false)
  assert.equal(isDeathmatchRound(competitive().rounds[0]), false)
})

test('the round is labelled DM, its clock the time since the timer started', () => {
  assert.equal(roundLabel(ROUND), 'DM')
  assert.equal(formatRoundClock(ROUND, 10000), 'DM · 0:00')
  assert.equal(formatRoundClock(ROUND, 255000), 'DM · 4:05')
  assert.equal(formatRoundClock(ROUND, 5000), 'DM · -0:05')
  // A competitive round keeps its number.
  assert.equal(roundLabel({ ...ROUND, n: 3, how: 'elimination' }), 'R3')
  assert.equal(formatRoundClock({ ...ROUND, n: 3, how: 'elimination' }, 23000), 'R3 · 0:13')
  assert.equal(frameStep(fixture(), 15000, lookup, T, createFrameIds()).name, 'DM · 0:05')
})

test('the scrubber spans the whole match, with a tick per kill', () => {
  const bundle = fixture()
  assert.deepEqual(roundSpan(bundle, ROUND), { start: 0, end: 60000 })
  const ticks = roundTicks(bundle, ROUND)
  assert.equal(ticks.length, 1 + bundle.kills.length)
  assert.deepEqual(ticks.map(t => t.kind), ['barrier', 'kill', 'kill', 'kill'])
})

test('every player is on the map, two on the same agent included', () => {
  const ids = createFrameIds()
  const shown = agents(frameStep(fixture(), 15000, lookup, T, ids))
  assert.equal(shown.length, 3)
  assert.deepEqual(shown.map(a => `${a.team}:${a.agent}`).sort(), ['ally:Raze', 'enemy:Jett', 'enemy:Jett'])
  assert.equal(new Set(shown.map(a => a.id)).size, 3)
  // A competitive frame keeps one element per agent and team, as the play parser does.
  assert.equal(agents(frameStep(competitive(), 15000, lookup, T, createFrameIds())).length, 2)
})

test('a player who falls is off the map, then back where they respawned', () => {
  const ids = createFrameIds()
  const at = (t: number) => agents(frameStep(fixture(), t, lookup, T, ids))
  const of = (t: number, subject: string) => at(t).find(a => a.id === ids.forSubject(subject))

  assert.equal(of(21000, JETT_1), undefined)
  // Straight after the dead rows: back, at the spawn, not on the way there.
  const back = of(23000, JETT_1)
  near(back?.at.u, 0.2)
  near(back?.at.v, 0.2)

  // Gone quiet after its dead rows: still down, until the respawn row.
  assert.equal(of(32000, JETT_2), undefined)
  const again = of(33500, JETT_2)
  near(again?.at.u, 0.1)
  near(again?.at.v, 0.9)

  // And again after the second death.
  assert.equal(of(46000, JETT_1), undefined)
  near(of(48000, JETT_1)?.at.v, 0.8)
})

const marks = (bundle: ReplayBundle, t: number) =>
  killMarks(bundle, t, bundle.rounds[0], T, createFrameIds(), lookup, () => undefined)

test('a Deathmatch death mark fades out by 5 s, and the kill is gone once its feed row is', () => {
  const bundle = fixture()
  const first = (t: number) => marks(bundle, t).find(m => m.key.endsWith(':0'))
  assert.equal(first(20000)?.mark, 1)
  assert.equal(first(20000 + KILL_FRESH_MS - 1)?.mark, 1)
  near(first(20000 + (KILL_FRESH_MS + DEATHMATCH_MARK_MS) / 2)?.mark, 0.5)
  assert.equal(first(20000 + DEATHMATCH_MARK_MS)?.mark, 0)
  // The feed outlasts the mark: the kill is listed, its mark is not drawn.
  assert.ok((first(20000 + DEATHMATCH_MARK_MS + 1000)?.feed ?? 0) > 0)
  assert.equal(first(20000 + KILL_FEED_MS), undefined)
  // Only the kills with something left to draw: at 46 s, the one of 45 s.
  assert.deepEqual(marks(bundle, 46000).map(m => m.key), ['45000:2'])
})

test('a competitive death mark stays for the round', () => {
  const all = marks(competitive(), 59000)
  assert.equal(all.length, 3)
  assert.ok(all.every(m => m.mark === 1))
})

test('a trail starts at the respawn, never at the place they fell', () => {
  const bundle = fixture()
  const ids = createFrameIds()
  const trail = (b: ReplayBundle, t: number, subject: string) =>
    frameMotion(b, t, T, ids, { cones: false, trails: true }).get(ids.forSubject(subject))?.trail ?? []

  // Respawned straight after the dead rows.
  const right = trail(bundle, 23500, JETT_1)
  assert.ok(right.length > 0)
  assert.ok(right.every(p => Math.abs(p.u - 0.2) < 1e-9 && Math.abs(p.v - 0.2) < 1e-9))
  // Respawned after a gap.
  const later = trail(bundle, 34000, JETT_2)
  assert.ok(later.length > 0)
  assert.ok(later.every(p => Math.abs(p.u - 0.1) < 1e-9 && Math.abs(p.v - 0.9) < 1e-9))
  // A dead player has no trail left.
  assert.deepEqual(trail(bundle, 21000, JETT_1), [])

  // A competitive bundle draws its trails as before.
  assert.ok(trail(competitive(), 23500, JETT_1).some(p => Math.abs(p.u - 0.7) < 1e-9))
})

test('a life starts after the last dead row or gap, else where the window does', () => {
  const rows: ReplayTrackSample[] = [
    [0, 0, 0, 0, 1, null],
    [100, 0, 0, 0, 0, null],
    [200, 5, 5, 0, 1, null],
    [300, 5, 5, 0, 1, null],
    [900, 9, 9, 0, 1, null],
    [1000, 9, 9, 0, 1, null],
  ]
  assert.equal(lifeStart(rows, 0, 3), 2)
  assert.equal(lifeStart(rows, 0, 5), 4)
  assert.equal(lifeStart(rows, 2, 3), 2)
  assert.equal(lifeStart(rows, 0, 1), 2)
  assert.equal(lifeStart(rows, 0, 0), 0)
})

test('map control runs through the match with one ally against the lobby', () => {
  const bundle = fixture()
  const mask = new Uint8Array(CONTROL_N * CONTROL_N).fill(1)
  const grid = emptyGrid(mask)
  simulateControl(bundle, ROUND, 0, 60000, grid, T)
  const share = controlShare(grid)
  assert.ok(Number.isFinite(share.ally) && Number.isFinite(share.enemy))
  assert.ok(share.claimed > 0)
  const timeline = controlTimeline(bundle, ROUND, mask, T)
  assert.equal(timeline.length, 51)
})
