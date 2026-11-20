/**
 * Unit tests for the match report's numbers (docs/match-report.md): duel facts,
 * trades, round paths, second lives and the rule-based findings (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayKill, type ReplayRound, type ReplayTrackSample } from './replayBundle.ts'
import { buildMatchReport, stanceOf } from './matchReport.ts'

const ME = 'me'
const MATE = 'mate'
const FOE = 'foe'
const FOE2 = 'foe2'

type At = (t: number) => [number, number, number, 0 | 1]

/** A row every 100 ms from 0 to `end`. */
function track(at: At, end = 60000): ReplayTrackSample[] {
  const rows: ReplayTrackSample[] = []
  for (let t = 0; t <= end; t += 100) {
    const [x, y, yaw, alive] = at(t)
    rows.push([t, x, y, yaw, alive, null])
  }
  return rows
}

const still = (x: number, y: number, yaw = 0, diesAt = Infinity): At => t => [x, y, yaw, t < diesAt ? 1 : 0]

const round = (n: number, over: Partial<ReplayRound> = {}): ReplayRound => ({
  n,
  buyStartMs: (n - 1) * 60000,
  barrierMs: (n - 1) * 60000 + 10000,
  endMs: (n - 1) * 60000 + 50000,
  side: 'defender',
  winner: 'ALLY',
  how: 'elimination',
  plant: null,
  defuse: null,
  ...over,
})

const kill = (t: number, killer: string, victim: string, k: [number, number], v: [number, number], n = 1): ReplayKill => ({
  t, round: n, killer, victim, weapon: null, kx: k[0], ky: k[1], vx: v[0], vy: v[1],
})

function bundle(tracks: Partial<Record<string, ReplayTrackSample[]>>, kills: ReplayKill[], rounds: ReplayRound[] = [round(1)], extra: Partial<ReplayBundle> = {}): ReplayBundle {
  const end = rounds.length * 60000
  const fill = (subject: string, x: number) => tracks[subject] ?? track(still(x, 9000), end)
  return {
    schema: REPLAY_BUNDLE_SCHEMA,
    parser: { vrfkit: 'test', reducer: '0.7.0' },
    match: { matchId: 'm-1', mapUuid: 'map', mapUrl: '/Game/Maps/Rook/Rook', build: 'release-13.10', recordedAt: '2026-11-18T04:50:31Z', durationMs: end },
    players: [
      { subject: ME, agentId: 'clove', team: 'ALLY', teamName: 'Blue', body: 1, isMe: true },
      { subject: MATE, agentId: 'jett', team: 'ALLY', teamName: 'Blue', body: 2, isMe: false },
      { subject: FOE, agentId: 'reyna', team: 'ENEMY', teamName: 'Red', body: 3, isMe: false },
      { subject: FOE2, agentId: 'fade', team: 'ENEMY', teamName: 'Red', body: 4, isMe: false },
    ],
    rounds,
    weapons: [],
    tracks: { hz: 10, fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'], byPlayer: { [ME]: fill(ME, 0), [MATE]: fill(MATE, 2000), [FOE]: fill(FOE, 4000), [FOE2]: fill(FOE2, 6000) } },
    kills,
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: [], items: [] },
    ...extra,
  }
}

const CALLOUTS = [
  { name: 'A Site', x: 0, y: 0 },
  { name: 'B Site', x: 1000, y: 0 },
  { name: 'Mid', x: 0, y: 3000 },
]

test('no report without the owner or a played round', () => {
  const b = bundle({}, [])
  assert.equal(buildMatchReport({ ...b, players: b.players.map(p => ({ ...p, isMe: false })) }), null)
  assert.equal(buildMatchReport({ ...b, rounds: [round(1, { barrierMs: null })] }), null)
})

test('stance thresholds are those of the HTML report', () => {
  assert.equal(stanceOf(149), 'standing')
  assert.equal(stanceOf(150), 'moving')
  assert.equal(stanceOf(300), 'moving')
  assert.equal(stanceOf(301), 'running')
})

test('a standing kill: distance, facing, who is alive, the nearest teammate, the places', () => {
  const report = buildMatchReport(
    bundle(
      {
        [ME]: track(still(0, 0, 0)),
        [MATE]: track(still(0, 500)),
        [FOE]: track(still(1000, 0, 180, 30000)),
        [FOE2]: track(still(5000, 5000)),
      },
      [kill(30000, ME, FOE, [0, 0], [1000, 0])],
    ),
    CALLOUTS,
  )
  assert.ok(report)
  assert.equal(report.duels.length, 1)
  const d = report.duels[0]
  assert.equal(d.kind, 'kill')
  assert.equal(d.clockS, 20)
  assert.equal(d.distM, 10)
  assert.equal(d.stance, 'standing')
  assert.equal(d.myOffDeg, 0)
  assert.equal(d.theirOffDeg, 0)
  assert.deepEqual(d.alive, [2, 2])
  assert.equal(d.nearestMateM, 5)
  assert.equal(d.first, true)
  assert.equal(d.where, 'A Site')
  assert.equal(d.theirWhere, 'B Site')
  assert.equal(report.totals.standingKills, 1)
  assert.equal(report.totals.openingKills, 1)
})

test('a death at a run with the killer behind', () => {
  const report = buildMatchReport(
    bundle(
      {
        // 500 units a second along x, looking up the y axis; the killer is below.
        [ME]: track(t => [0.5 * Math.min(t, 30000), 0, 90, t < 30000 ? 1 : 0]),
        [FOE]: track(still(15000, -1000, 90)),
      },
      [kill(30000, FOE, ME, [15000, -1000], [15000, 0])],
    ),
  )
  assert.ok(report)
  const d = report.duels[0]
  assert.equal(d.kind, 'death')
  assert.equal(d.mySpeed, 500)
  assert.equal(d.stance, 'running')
  // 0.15 s before the kill the player is still 75 units short of where they fell, so not exactly 180.
  assert.ok(d.myOffDeg !== null && d.myOffDeg > 170)
  assert.equal(d.where, null)
  assert.equal(report.totals.runningDeaths, 1)
  assert.equal(report.totals.offCrosshairDeaths, 1)
  assert.equal(report.totals.openingDeaths, 1)
  assert.equal(report.rounds[0].deaths, 1)
  assert.deepEqual(report.rounds[0].deathS, [20])
})

test('a death is traded when the killer dies to a teammate within 5 s', () => {
  const death = kill(30000, FOE, ME, [1000, 0], [0, 0])
  const tracks = { [ME]: track(still(0, 0, 0, 30000)) }
  const inTime = buildMatchReport(bundle(tracks, [death, kill(33000, MATE, FOE, [0, 500], [1000, 0])]))
  const late = buildMatchReport(bundle(tracks, [death, kill(36000, MATE, FOE, [0, 500], [1000, 0])]))
  const byNobody = buildMatchReport(bundle(tracks, [death]))
  assert.equal(inTime?.duels[0].traded, true)
  assert.equal(late?.duels[0].traded, false)
  assert.equal(byNobody?.duels[0].traded, false)
  assert.equal(inTime?.totals.tradedDeaths, 1)
})

test('a kill is a trade when the victim killed a teammate in the 5 s before', () => {
  const report = buildMatchReport(
    bundle({}, [kill(28000, FOE, MATE, [1000, 0], [0, 500]), kill(30000, ME, FOE, [0, 0], [1000, 0])]),
  )
  assert.ok(report)
  assert.equal(report.duels[0].traded, true)
  assert.equal(report.duels[0].first, false)
  assert.equal(report.totals.tradeKills, 1)
  assert.equal(report.totals.openingDeaths, 0)
})

test('the round: setup, route, distance walked and the distance to a teammate', () => {
  const report = buildMatchReport(
    bundle(
      {
        // Stands on A Site until 0:10, then walks to Mid at 300 units a second and stops there.
        [ME]: track(t => [0, Math.max(0, Math.min(3000, 0.3 * (t - 20000))), 0, 1]),
        [MATE]: track(still(0, 1000)),
      },
      [],
    ),
    CALLOUTS,
  )
  assert.ok(report)
  const r = report.rounds[0]
  assert.equal(r.setup, 'A Site')
  assert.equal(r.at20, 'Mid')
  assert.deepEqual(r.route, [[0, 'A Site'], [16, 'Mid']])
  assert.equal(r.distM, 30)
  assert.equal(r.durS, 42)
  assert.ok(r.mateM !== null && r.mateM > 10 && r.mateM < 20)
  assert.equal(report.totals.survived, 1)
  assert.equal(report.totals.survivedWon, 1)
  assert.deepEqual(report.dwell.defender.map(([name]) => name).sort(), ['A Site', 'Mid'])
})

test('a second life that runs out is a self death, not a duel', () => {
  const report = buildMatchReport(
    bundle({}, [kill(30000, FOE, ME, [1000, 0], [0, 0]), kill(44000, ME, ME, [0, 0], [0, 0])]),
  )
  assert.ok(report)
  assert.equal(report.duels.length, 1)
  assert.equal(report.rounds[0].deaths, 1)
  assert.equal(report.rounds[0].selfDeaths, 1)
  assert.deepEqual(report.kit.secondLives, [1])
  assert.equal(report.totals.selfDeaths, 1)
})

test('casts are counted by key, and smokes are placed and marked when thrown after a death', () => {
  const report = buildMatchReport(
    bundle({}, [kill(30000, FOE, ME, [1000, 0], [0, 0])], [round(1)], {
      casts: [
        { t: 12000, round: 1, player: ME, slot: 'E', x: 0, y: 0 },
        { t: 13000, round: 1, player: ME, slot: 'E', x: 0, y: 0 },
        { t: 14000, round: 1, player: MATE, slot: 'E', x: 0, y: 0 },
        { t: 15000, round: 1, player: ME, slot: '?7', x: 0, y: 0 },
      ],
      effects: [
        { start: 12000, end: 27000, kind: 'smoke', agent: 'Clove', cls: 'Smoke_C', x: 1000, y: 0, owner: ME },
        { start: 40000, end: 46000, kind: 'smoke', agent: 'Clove', cls: 'Smoke_C', x: 0, y: 3000, owner: ME },
        { start: 20000, end: 30000, kind: 'smoke', agent: 'Omen', cls: 'Smoke_C', x: 0, y: 0, owner: FOE },
      ],
    }),
    CALLOUTS,
  )
  assert.ok(report)
  assert.deepEqual(report.kit.casts, { E: 2 })
  assert.deepEqual(report.kit.smokes.map(s => [s.clockS, s.where, s.afterDeath]), [[2, 'B Site', false], [30, 'Mid', true]])
})

test('findings: eight clean rounds read as survived and never first to die', () => {
  const rounds = Array.from({ length: 8 }, (_, i) => round(i + 1))
  const report = buildMatchReport(bundle({}, [], rounds))
  assert.ok(report)
  const titles = report.findings.map(f => f.title)
  assert.ok(titles.includes('Every round you survived was won'))
  assert.ok(titles.includes('Never the first to die'))
  assert.ok(report.findings.every(f => f.tone === 'works'))
})

test('findings: deaths at a run, untraded, at one place', () => {
  const rounds = Array.from({ length: 4 }, (_, i) => round(i + 1, { winner: 'ENEMY' }))
  const mine = track(t => {
    const inRound = t % 60000
    return [0.5 * Math.min(inRound, 30000) - 15000, 0, 0, inRound < 30000 ? 1 : 0]
  }, 240000)
  const kills = rounds.map(r => kill((r.n - 1) * 60000 + 30000, FOE, ME, [1000, 0], [0, 0], r.n))
  const report = buildMatchReport(bundle({ [ME]: mine }, kills, rounds), CALLOUTS)
  assert.ok(report)
  const byTitle = new Map(report.findings.map(f => [f.title, f]))
  assert.equal(byTitle.get('You die while moving')?.body, '4 of 4 deaths came at more than 1.5 m a second, 4 at a full run (rounds 1, 2, 3 and 4).')
  assert.ok(byTitle.has('4 of 4 deaths went untraded'))
  assert.equal(byTitle.get('4 deaths at A Site')?.body, 'Rounds 1, 2, 3 and 4, 4 of them in rounds lost.')
  assert.ok(byTitle.has('First to die in 4 rounds'))
  assert.deepEqual(byTitle.get('You die while moving')?.jump, { round: 1, t: 30000 })
})
