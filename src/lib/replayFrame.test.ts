/**
 * Unit tests for the replay frame: the match at one instant as a step, and
 * the round helpers of the replay transport (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFrameIds,
  formatRoundClock,
  frameStep,
  roundAt,
  roundSide,
  roundSpan,
  roundTicks,
  throwPairs,
  trackAt,
  type ReplayAgentInfo,
  type ReplayAgentLookup,
} from './replayFrame.ts'
import { REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayTrackSample } from './replayBundle.ts'
import { parsePlayDoc, type AbilityElement, type AgentElement, type MarkerElement, type PlayStep } from './playDoc.ts'

// The fixture of replayToPlay.test.ts, plus one cast that leaves no effect.

// u = y / 10000 + 0.5, v = x / 10000 + 0.5: easy to read back.
const T = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }

const OMEN = 'aaaaaaaa-0000-0000-0000-000000000001'
const SOVA = 'aaaaaaaa-0000-0000-0000-000000000002'
const JETT = 'bbbbbbbb-0000-0000-0000-000000000003'

const AGENTS: Record<string, ReplayAgentInfo> = {
  'omen-uuid': { name: 'Omen', abilities: [{ slot: 'Ability1', name: 'Paranoia' }, { slot: 'Ability2', name: 'Dark Cover' }] },
  'sova-uuid': { name: 'Sova', abilities: [{ slot: 'Ability2', name: 'Recon Bolt' }] },
  'jett-uuid': { name: 'Jett', abilities: [{ slot: 'Grenade', name: 'Cloudburst' }] },
}
const lookup: ReplayAgentLookup = uuid => (uuid ? AGENTS[uuid] ?? null : null)

/** 10 Hz rows from 0 to 160 s; `at` gives position and alive flag per time. */
function track(at: (t: number) => [number, number, 0 | 1]): ReplayTrackSample[] {
  const rows: ReplayTrackSample[] = []
  for (let t = 0; t <= 160000; t += 100) {
    const [x, y, alive] = at(t)
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
      // No barrier measured, no end: barrier = buy + 30 s.
      { n: 2, buyStartMs: 100000, barrierMs: null, endMs: null, side: 'defender', winner: 'ENEMY', how: null, plant: null, defuse: null },
    ],
    weapons: [],
    tracks: {
      hz: 10,
      fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'],
      byPlayer: {
        // Walks from (0, 0) to (4000, 0) between the barrier and the plant.
        [OMEN]: track(t => [t < 30000 ? 0 : t < 60000 ? ((t - 30000) / 30000) * 4000 : 4000, 0, 1]),
        // Holds one spot all round.
        [SOVA]: track(() => [1000, 1000, 1]),
        // Dies at 45 s; back for round 2.
        [JETT]: track(t => [-2000, 0, t > 45000 && t < 100000 ? 0 : 1]),
      },
    },
    kills: [
      { t: 45000, round: 1, killer: SOVA, victim: JETT, weapon: null, kx: 1000, ky: 1000, vx: -2000, vy: 0 },
      { t: 132000, round: 2, killer: JETT, victim: SOVA, weapon: null, kx: null, ky: null, vx: null, vy: null },
      { t: 150000, round: 2, killer: JETT, victim: OMEN, weapon: null, kx: null, ky: null, vx: null, vy: null },
    ],
    casts: [
      { t: 40000, round: 1, player: OMEN, slot: 'E', x: 1500, y: 1500 },
      // No position: nothing to draw.
      { t: 42000, round: 1, player: SOVA, slot: 'Q', x: null, y: null },
      // Positioned, and no effect follows it (a shock dart, a flash): shown for 2.5 s.
      { t: 50000, round: 1, player: SOVA, slot: 'Q', x: 1000, y: 2000 },
    ],
    effects: [
      // Explained by nothing: no cast of its owner.
      { start: 41000, end: null, kind: 'smoke', agent: null, cls: 'Smoke_C', x: -3000, y: 3000, owner: JETT },
      // Explained by Omen's E (1.5 s and 100 cm away).
      { start: 41500, end: 70000, kind: 'smoke', agent: null, cls: 'Smoke_C', x: 1600, y: 1500, owner: OMEN },
    ],
    spike: {
      carriers: [{ from: 0, to: 60000, player: OMEN }],
      plants: [{ t: 60000, round: 1, site: 'A', x: 4000, y: 0, player: OMEN }],
      defuses: [],
    },
    pawns: { fields: ['t', 'x', 'y', 'yaw'], items: [] },
  }
}

const agents = (step: PlayStep) => step.elements.filter((e): e is AgentElement => e.kind === 'agent')
const abilities = (step: PlayStep) => step.elements.filter((e): e is AbilityElement => e.kind === 'ability')
const markers = (step: PlayStep) => step.elements.filter((e): e is MarkerElement => e.kind === 'marker')
const agentNamed = (step: PlayStep, name: string) => agents(step).find(a => a.agent === name)

const frameAt = (t: number) => frameStep(fixture(), t, lookup, T, createFrameIds())

test('the frame at the barrier has both teams, in image units, without moves', () => {
  const frame = frameAt(30000)
  assert.deepEqual(agents(frame).map(a => [a.agent, a.team]), [['Omen', 'ally'], ['Jett', 'enemy'], ['Sova', 'ally']])
  assert.deepEqual(agentNamed(frame, 'Omen')!.at, { u: 0.5, v: 0.5 })
  assert.deepEqual(agentNamed(frame, 'Jett')!.at, { u: 0.5, v: 0.3 })
  for (const a of agents(frame)) {
    assert.equal(a.moveTo, undefined)
    assert.equal(a.note, undefined)
  }
})

test('the frame is a step named by the round clock, with its replay time and no caption', () => {
  const frame = frameAt(43000)
  assert.equal(frame.id, 'frame')
  assert.equal(frame.name, 'R1 · 0:13')
  assert.equal(frame.caption, '')
  assert.equal(frame.replayMs, 43000)
})

test('after the kill the victim is gone', () => {
  assert.ok(agentNamed(frameAt(44900), 'Jett'))
  assert.equal(agentNamed(frameAt(46000), 'Jett'), undefined)
  assert.ok(agentNamed(frameAt(46000), 'Sova'))
})

test('the spike carrier is flagged while carrying', () => {
  assert.equal(agentNamed(frameAt(30000), 'Omen')!.spike, true)
  assert.equal(agentNamed(frameAt(30000), 'Sova')!.spike, undefined)
  assert.equal(agentNamed(frameAt(61000), 'Omen')!.spike, undefined)
})

test('an active smoke is an ability with the slot of the cast that put it down', () => {
  const smoke = abilities(frameAt(45000)).filter(a => a.agent === 'Omen')
  assert.equal(smoke.length, 1)
  assert.deepEqual(
    { slot: smoke[0].slot, shape: smoke[0].shape, radius: smoke[0].radius, label: smoke[0].label, at: smoke[0].at },
    { slot: 'Ability2', shape: 'smoke', radius: 410, label: 'Dark Cover', at: { u: 0.65, v: 0.66 } },
  )
  // Just after it opens, the cast it explains is not drawn a second time.
  assert.equal(abilities(frameAt(41600)).filter(a => a.agent === 'Omen').length, 1)
  // Gone once it closes.
  assert.equal(abilities(frameAt(70500)).filter(a => a.agent === 'Omen').length, 0)
})

test('an effect no cast of its owner explains has no slot', () => {
  const orphan = abilities(frameAt(45000)).filter(a => a.agent === 'Jett')
  assert.deepEqual(orphan.map(a => ({ slot: a.slot, shape: a.shape, at: a.at })), [{ slot: null, shape: 'smoke', at: { u: 0.8, v: 0.2 } }])
  // Never closed: up until the round is over, and not carried into the next round.
  assert.equal(abilities(frameAt(80000)).filter(a => a.agent === 'Jett').length, 1)
  assert.equal(abilities(frameAt(131000)).length, 0)
})

test('on a bundle with no ability actors a cast shows on its agent for 1.5 s', () => {
  const dart = (t: number) => abilities(frameAt(t)).filter(a => a.agent === 'Sova')
  assert.equal(dart(49900).length, 0)
  const shown = dart(51000)
  assert.equal(shown.length, 1)
  assert.deepEqual(
    { slot: shown[0].slot, shape: shown[0].shape, radius: shown[0].radius, label: shown[0].label, at: shown[0].at, family: shown[0].family },
    { slot: 'Ability1', shape: 'molly', radius: 400, label: 'Q', at: { u: 0.6, v: 0.6 }, family: 'self' },
  )
  assert.equal(dart(51600).length, 0)
})

test('the plant marker appears at the plant time, labelled with the site', () => {
  const ids = createFrameIds()
  const bundle = fixture()
  assert.equal(markers(frameStep(bundle, 59900, lookup, T, ids)).length, 0)
  const at = markers(frameStep(bundle, 60000, lookup, T, ids))
  assert.deepEqual(
    at.map(m => ({ id: m.id, type: m.type, label: m.label, at: m.at })),
    [{ id: ids.forPlant(1), type: 'spike', label: 'A', at: { u: 0.5, v: 0.9 } }],
  )
  // Not in the next round, which has no plant.
  assert.equal(markers(frameStep(bundle, 140000, lookup, T, ids)).length, 0)
})

test('ids are stable across frames and match the id table', () => {
  const ids = createFrameIds()
  const bundle = fixture()
  const a = frameStep(bundle, 45000, lookup, T, ids)
  const b = frameStep(bundle, 61000, lookup, T, ids)
  for (const name of ['Omen', 'Sova']) assert.equal(agentNamed(a, name)!.id, agentNamed(b, name)!.id, name)
  assert.equal(agentNamed(a, 'Omen')!.id, ids.forSubject(OMEN))
  const jettSmoke = (s: PlayStep) => abilities(s).find(x => x.agent === 'Jett')!.id
  assert.equal(jettSmoke(a), jettSmoke(b))
  assert.equal(jettSmoke(a), ids.forEffect(0))
  // A cast keeps its id while it is shown.
  const dart = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids)).find(x => x.agent === 'Sova')!.id
  assert.equal(dart(50500), dart(51400))
  assert.equal(dart(50500), ids.forCast(bundle.casts[2]))
  // Every id is unique within a frame, and a fresh table gives fresh ids.
  const all = a.elements.map(e => e.id)
  assert.equal(new Set(all).size, all.length)
  assert.notEqual(createFrameIds().forSubject(OMEN), ids.forSubject(OMEN))
})

test('a doc wrapping a frame passes parsePlayDoc unchanged', () => {
  const bundle = fixture()
  const ids = createFrameIds()
  for (const t of [0, 30000, 41600, 45000, 51000, 60000, 80000, 131000, 150000]) {
    const doc = { version: 2 as const, summary: '', comp: ['Omen', 'Sova'], steps: [frameStep(bundle, t, lookup, T, ids)], assumptions: [] }
    assert.deepEqual(parsePlayDoc(JSON.parse(JSON.stringify(doc))), doc, String(t))
  }
})

test('two players on one agent and team give one element, as the parser keeps them', () => {
  const unknown = frameStep(fixture(), 30000, () => null, T, createFrameIds())
  // Everyone is "Agent": one ally and one enemy remain.
  assert.deepEqual(agents(unknown).map(a => [a.agent, a.team]), [['Agent', 'ally'], ['Agent', 'enemy']])
})

test('roundSpan runs from buy start to the end, else the next buy start, else 120 s past the barrier', () => {
  const bundle = fixture()
  assert.deepEqual(roundSpan(bundle, bundle.rounds[0]), { start: 0, end: 80000 })
  // Last round, no end, no measured barrier: buy + 30 s + 120 s.
  assert.deepEqual(roundSpan(bundle, bundle.rounds[1]), { start: 100000, end: 250000 })
  bundle.rounds[0].endMs = null
  assert.deepEqual(roundSpan(bundle, bundle.rounds[0]), { start: 0, end: 100000 })
  bundle.rounds[1].barrierMs = 145000
  assert.deepEqual(roundSpan(bundle, bundle.rounds[1]), { start: 100000, end: 265000 })
})

test('roundAt switches at the buy start; roundSide is attack unless defending', () => {
  const bundle = fixture()
  assert.equal(roundAt(bundle, 99999).n, 1)
  assert.equal(roundAt(bundle, 100000).n, 2)
  assert.equal(roundSide(bundle.rounds[0]), 'attack')
  assert.equal(roundSide(bundle.rounds[1]), 'defense')
  assert.equal(roundSide({ ...bundle.rounds[1], side: null }), 'attack')
})

test('formatRoundClock counts from the barrier, negative during the buy', () => {
  const round = fixture().rounds[0]
  assert.equal(formatRoundClock(round, 43000), 'R1 · 0:13')
  assert.equal(formatRoundClock(round, 30000), 'R1 · 0:00')
  assert.equal(formatRoundClock(round, 29500), 'R1 · -0:01')
  assert.equal(formatRoundClock(round, 18000), 'R1 · -0:12')
  assert.equal(formatRoundClock(round, 105000), 'R1 · 1:15')
  // Without a measured barrier: buy + 30 s.
  assert.equal(formatRoundClock(fixture().rounds[1], 142000), 'R2 · 0:12')
})

test('roundTicks are the barrier, the kills, the plant and the defuse, in time order', () => {
  const bundle = fixture()
  bundle.rounds[0].defuse = 75000
  const names: Record<string, string> = { [OMEN]: 'Omen', [SOVA]: 'Sova', [JETT]: 'Jett' }
  assert.deepEqual(roundTicks(bundle, bundle.rounds[0], s => names[s]), [
    { t: 30000, kind: 'barrier', label: 'Barrier drop' },
    { t: 45000, kind: 'kill', label: 'Sova ▸ Jett' },
    { t: 60000, kind: 'plant', label: 'Plant A' },
    { t: 75000, kind: 'defuse', label: 'Defuse' },
  ])
  // Round 2: two kills, no plant; without a lookup the labels are the subjects.
  const r2 = roundTicks(bundle, bundle.rounds[1])
  assert.deepEqual(r2.map(t => t.kind), ['barrier', 'kill', 'kill'])
  assert.deepEqual(r2.map(t => t.t), [130000, 132000, 150000])
  assert.equal(r2[1].label, `${JETT} ▸ ${SOVA}`)
})

// ── Utility v2 (§2.10): throws, walls, ignored classes ───────────────────────

/** The fixture with only these effects, and Omen's E cast in his hand at 40 s. */
function utilityFixture(): ReplayBundle {
  const bundle = fixture()
  bundle.casts = [{ t: 40000, round: 1, player: OMEN, slot: 'E', x: 1000, y: 1010 }]
  bundle.effects = [
    // 0: Omen's smoke, thrown from the hand at (1000, 1000)…
    { start: 40000, end: 42500, kind: 'smoke', agent: 'Wraith', cls: 'Projectile_Wraith_4_Smoke_C', x: 1000, y: 1000, owner: OMEN },
    // 1: …lands 500 ms before the projectile closes, 22 m away.
    { start: 42000, end: 58000, kind: 'smoke', agent: 'Wraith', cls: 'Zone_Wraith_4_Smoke_C', x: 3000, y: 2000, owner: OMEN },
    // 2: Breach-like flash with no landing: never drawn.
    { start: 41000, end: 43000, kind: 'wall', agent: 'Breach', cls: 'Projectile_Breach_Q_ThroughWalls_Flash_C', x: -2000, y: 0, owner: JETT },
    // 3: a molly that never lands (no landing of its owner).
    { start: 50000, end: 51400, kind: 'damage_zone', agent: 'Sarge', cls: 'Projectile_Sarge_Q_Molotov_Production_C', x: 1000, y: 1000, owner: SOVA },
    // 4–7: four wall segments of one wall, out of order along it; 6 is broken at 70 s.
    { start: 60000, end: 75000, kind: 'wall', agent: 'Thorne', cls: 'GameObject_Thorne_E_Wall_Segment_Fortifying_C', x: 2000, y: 300, owner: SOVA },
    { start: 60100, end: 75000, kind: 'wall', agent: 'Thorne', cls: 'GameObject_Thorne_E_Wall_Segment_Fortifying_C', x: 2000, y: -900, owner: SOVA },
    { start: 60200, end: 70000, kind: 'wall', agent: 'Thorne', cls: 'GameObject_Thorne_E_Wall_Segment_Fortifying_C', x: 2000, y: 900, owner: SOVA },
    { start: 60300, end: 75000, kind: 'wall', agent: 'Thorne', cls: 'GameObject_Thorne_E_Wall_Segment_Fortifying_C', x: 2000, y: -300, owner: SOVA },
    // 8: the wall's manager, at its middle: ignored.
    { start: 60000, end: 75000, kind: 'wall', agent: 'Thorne', cls: 'GameObject_Thorne_E_Wall_Fortifying_C', x: 2000, y: 0, owner: SOVA },
    // 9: an ult orb: ignored.
    { start: 30000, end: 79000, kind: 'orb', agent: null, cls: 'UltPointOrb_C', x: 0, y: 3000, owner: null },
  ]
  return bundle
}

const near = (actual: number | undefined, expected: number, what: string) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≠ ${expected}`)
const nearPos = (actual: { u?: number; v?: number } | undefined, u: number, v: number, what: string) => {
  near(actual?.u, u, `${what}.u`)
  near(actual?.v, v, `${what}.v`)
}

test('a thrown smoke in flight is one ability at the landing, from the hand, with its progress', () => {
  const bundle = utilityFixture()
  const ids = createFrameIds()
  const omen = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids)).filter(a => a.agent === 'Omen')
  assert.equal(omen(39900).length, 0)
  const flying = omen(41000)
  // The cast in the hand is the throw: no badge of its own.
  assert.equal(flying.length, 1)
  const [el] = flying
  assert.equal(el.id, ids.forEffect(1))
  assert.deepEqual({ slot: el.slot, shape: el.shape, radius: el.radius, label: el.label }, { slot: 'Ability2', shape: 'smoke', radius: 410, label: 'Dark Cover' })
  nearPos(el.at, 0.7, 0.8, 'at')
  nearPos(el.from, 0.6, 0.6, 'from')
  near(el.progress, 0.5, 'progress')
  near(omen(40000)[0].progress, 0, 'progress at the throw')
})

test('once landed the throw keeps its id and loses its progress, and the way it came after 1 s', () => {
  const bundle = utilityFixture()
  const ids = createFrameIds()
  const omen = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids)).filter(a => a.agent === 'Omen')
  const flying = omen(41900)[0]
  for (const t of [42000, 42500, 42900]) {
    const landed = omen(t)
    assert.equal(landed.length, 1, String(t))
    assert.equal(landed[0].id, flying.id, String(t))
    assert.equal('progress' in landed[0], false, String(t))
    nearPos(landed[0].at, 0.7, 0.8, `at ${t}`)
    nearPos(landed[0].from, 0.6, 0.6, `from ${t}`)
  }
  const later = omen(43000)
  assert.equal(later.length, 1)
  assert.equal(later[0].id, flying.id)
  assert.equal('from' in later[0], false)
  assert.equal(omen(58500).length, 0)
})

test('a projectile with no landing draws nothing', () => {
  const bundle = utilityFixture()
  assert.equal(abilities(frameStep(bundle, 42000, lookup, T, createFrameIds())).filter(a => a.agent === 'Jett').length, 0)
  assert.equal(abilities(frameStep(bundle, 50500, lookup, T, createFrameIds())).filter(a => a.agent === 'Sova').length, 0)
})

test('a throw never pairs with the landing of another key, and Sova\'s Shock Bolt lands where it stops', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [
    // Breach's flash (Q) and, 300 ms after it closes, his Aftershock's blast (C): not a pair.
    { start: 40000, end: 40600, kind: 'other', agent: 'Breach', cls: 'Projectile_Breach_Q_ThroughWalls_Flash_C', x: 1000, y: 1000, owner: JETT },
    { start: 40900, end: 45000, kind: 'other', agent: 'Breach', cls: 'GameObject_Breach_4_FusionBlast_C', x: 2000, y: 1000, owner: JETT },
    // Sova's Shock Bolt: 0.8 s of flight, then the blast 20 m away.
    { start: 50000, end: 50800, kind: 'other', agent: 'Hunter', cls: 'Projectile_Hunter_4_ExplosiveBolt_C', x: 1000, y: 1000, owner: SOVA },
    { start: 50800, end: 54800, kind: 'other', agent: 'Hunter', cls: 'GameObject_Hunter_4_ExplosiveBolt_Explosion_C', x: 3000, y: 1000, owner: SOVA },
  ]
  assert.deepEqual([...throwPairs(bundle)], [[2, 3]])
  const ids = createFrameIds()
  const bolt = abilities(frameStep(bundle, 51000, lookup, T, ids)).filter(a => a.agent === 'Sova')
  assert.equal(bolt.length, 1)
  assert.equal(bolt[0].id, ids.forEffect(3))
  assert.deepEqual({ slot: bolt[0].slot, shape: bolt[0].shape, radius: bolt[0].radius }, { slot: 'Ability1', shape: 'molly', radius: 400 })
  nearPos(bolt[0].from, 0.6, 0.6, 'from')
})

test('trackAt interpolates between samples and holds the ends', () => {
  const track: [number, number, number][] = [[100, 0, 0], [200, 1000, 0], [400, 1000, 2000]]
  assert.deepEqual(trackAt(track, 50), [0, 0])
  assert.deepEqual(trackAt(track, 150), [500, 0])
  assert.deepEqual(trackAt(track, 300), [1000, 1000])
  assert.deepEqual(trackAt(track, 900), [1000, 2000])
})

test('a wall built point by point grows with its points, the badge halfway, and counts down its life', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [
    {
      start: 60000, end: 80000, kind: 'other', agent: 'Mage', cls: 'GameObject_Mage_Q_WallManager_C', x: 0, y: 0, owner: null,
      points: [[60300, 0, 0], [60500, 1000, 0], [60700, 2000, 0]],
    },
  ]
  const ids = createFrameIds()
  const wall = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids))[0]
  // One point so far: no line yet, the badge where the wall starts.
  const early = wall(60400)
  assert.equal(early.path, undefined)
  nearPos(early.at, 0.5, 0.5, 'early at')
  const growing = wall(60600)
  assert.equal(growing.path?.length, 2)
  near(growing.life, 0.97, 'life')
  const built = wall(61000)
  assert.equal(built.path?.length, 3)
  nearPos(built.at, 0.5, 0.6, 'badge halfway')
  assert.equal(built.shape, 'wall')
  near(wall(70000).life, 0.5, 'life halfway')
  assert.equal(abilities(frameStep(bundle, 80500, lookup, T, ids)).length, 0)
})

test('Neon\'s Fast Lane is drawn along its runner\'s track', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [
    { start: 60000, end: 66000, kind: 'other', agent: 'Sprinter', cls: 'GameObject_Sprinter_4_Tunnel_C', x: 0, y: 0, owner: JETT },
    {
      start: 60000, end: 60400, kind: 'other', agent: 'Sprinter', cls: 'Projectile_Neon_C_Tunnel_Cosmetic_C', x: 0, y: 0, owner: JETT,
      track: [[60000, 0, 0], [60200, 1000, 0], [60400, 2000, 0]],
    },
  ]
  const lane = abilities(frameStep(bundle, 61000, lookup, T, createFrameIds()))
  // The runner itself is never drawn.
  assert.equal(lane.length, 1)
  assert.equal(lane[0].path?.length, 3)
  nearPos(lane[0].at, 0.5, 0.6, 'badge halfway')
})

test('utility that never closed counts down to the end of the round', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  const { end } = roundSpan(bundle, roundAt(bundle, 60000))
  bundle.effects = [{ start: 60000, end: null, kind: 'smoke', agent: 'Smonk', cls: 'GameObject_Smonk_NewSmoke_C', x: 0, y: 0, owner: SOVA }]
  const halfway = 60000 + (end - 60000) / 2
  near(abilities(frameStep(bundle, halfway, lookup, T, createFrameIds()))[0].life, 0.5, 'life')
})

test('a flash with no landing is drawn where its track ends from the throw on, then goes off there', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [
    {
      start: 50000, end: 53000, kind: 'other', agent: 'Grenadier', cls: 'Projectile_C_Grenadier_Flash_C', x: 0, y: 0, owner: null,
      track: [[50000, 0, 0], [50500, 1000, 0], [51000, 2000, 0], [53000, 2000, 0]],
    },
  ]
  const ids = createFrameIds()
  const flash = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids))
  const flying = flash(50250)[0]
  assert.equal(flying.id, ids.forEffect(0))
  nearPos(flying.at, 0.5, 0.7, 'already where it pops')
  nearPos(flying.flyer, 0.5, 0.55, 'the flyer travels')
  nearPos(flying.from, 0.5, 0.5, 'from')
  near(flying.progress, 0.25, 'progress')
  const popped = flash(51300)[0]
  nearPos(popped.at, 0.5, 0.7, 'popped')
  assert.equal(popped.progress, undefined)
  assert.equal(popped.family, 'burst')
  // Over by its own clock, though the actor lies there two seconds more.
  assert.equal(flash(52300).length, 0)
})

test('a smoke put down far from the agent leaves nothing at the agent', () => {
  const bundle = utilityFixture()
  bundle.casts = [{ t: 40000, round: 1, player: OMEN, slot: 'E', x: 0, y: 0 }]
  bundle.effects = [
    { start: 40500, end: 55000, kind: 'smoke', agent: null, cls: 'GameObject_Sarge_4_Smoke_ProductionNEW_C', x: 2000, y: 0, owner: OMEN },
    { start: 39000, end: 39500, kind: 'other', agent: null, cls: 'Projectile_Wraith_4_Smoke_C', x: 0, y: 0, owner: OMEN },
  ]
  const shown = abilities(frameStep(bundle, 41000, lookup, T, createFrameIds()))
  assert.equal(shown.length, 1)
  nearPos(shown[0].at, 0.5, 0.7, 'at the smoke')
  assert.equal(shown[0].family, 'cloud')
  assert.equal(shown[0].seconds, 14)
})

test('what acts on the agent alone rides on them, and only that', () => {
  const bundle = utilityFixture()
  bundle.effects = [{ start: 1000, end: 1500, kind: 'other', agent: null, cls: 'Projectile_Wraith_4_Smoke_C', x: 0, y: 0, owner: OMEN, track: [[1000, 0, 0], [1500, 100, 0]] }]
  bundle.casts = [
    { t: 40000, round: 1, player: SOVA, slot: 'X', x: 0, y: 0 },
    { t: 40000, round: 1, player: SOVA, slot: 'E', x: 0, y: 0 },
  ]
  const shown = abilities(frameStep(bundle, 40500, lookup, T, createFrameIds())).filter(a => a.agent === 'Sova')
  assert.equal(shown.length, 1)
  assert.equal(shown[0].slot, 'Ultimate')
  assert.equal(shown[0].family, 'self')
  nearPos(shown[0].at, 0.6, 0.6, 'on the agent, not where it was cast')
})

test('a throw with neither a landing nor a track rides on its agent', () => {
  const bundle = utilityFixture()
  bundle.effects = [
    { start: 40000, end: 42000, kind: 'other', agent: null, cls: 'Projectile_Phoenix_E_FlareCurve_Synced_C', x: 1000, y: 1000, owner: SOVA },
    { start: 1000, end: 1500, kind: 'other', agent: null, cls: 'Projectile_Wraith_4_Smoke_C', x: 0, y: 0, owner: OMEN, track: [[1000, 0, 0], [1500, 100, 0]] },
  ]
  bundle.casts = [{ t: 40000, round: 1, player: SOVA, slot: 'E', x: 1000, y: 1000 }]
  const shown = abilities(frameStep(bundle, 40500, lookup, T, createFrameIds())).filter(a => a.agent === 'Sova')
  assert.equal(shown.length, 1)
  assert.equal(shown[0].family, 'self')
})

test('an agent carries what they have left', () => {
  const bundle = utilityFixture()
  bundle.kits = { [SOVA]: { Q: [[10000, 2], [40000, 1]], X: [[5000, 8]], cost: 8 } }
  const sova = frameStep(bundle, 45000, lookup, T, createFrameIds()).elements.find(e => e.kind === 'agent' && e.agent === 'Sova')
  assert.ok(sova && sova.kind === 'agent')
  assert.deepEqual(sova.kit?.map(k => [k.slot, k.n]), [['Ability1', 1], ['Ultimate', 1]])
})

test('an ultimate orb is a marker until it is picked up', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [{ start: 31000, end: 50000, kind: 'other', agent: null, cls: 'UltPointOrb_C', x: 1000, y: 0, owner: null }]
  const orbs = (t: number) => frameStep(bundle, t, lookup, T, createFrameIds()).elements.filter(e => e.kind === 'marker' && e.type === 'orb')
  assert.equal(orbs(30000).length, 0)
  assert.equal(orbs(40000).length, 1)
  assert.equal(orbs(51000).length, 0)
})

test('a burst is over by its own clock while its actor stays', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [{ start: 50000, end: 54000, kind: 'other', agent: null, cls: 'GameObject_Hunter_4_ExplosiveBolt_Explosion_C', x: 0, y: 0, owner: SOVA }]
  const ids = createFrameIds()
  const blast = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids))
  assert.equal(blast(50600)[0].family, 'burst')
  near(blast(50600)[0].life, 0.5, 'life')
  assert.equal(blast(50600)[0].seconds, undefined)
  assert.equal(blast(51300).length, 0)
})

test('a device has no clock; a scout is where it is now, with the way it went', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [
    { start: 50000, end: 70000, kind: 'other', agent: null, cls: 'Pawn_Killjoy_E_Turret_C', x: 3000, y: 0, owner: null },
    { start: 50000, end: 56000, kind: 'other', agent: null, cls: 'Pawn_Hunter_E_Drone_C', x: 0, y: 0, owner: SOVA },
  ]
  bundle.pawns.items = [
    { cls: 'Pawn_Hunter_E_Drone_C', owner: SOVA, from: 50000, to: 54000, samples: [[50000, 0, 0, 0], [52000, 1000, 0, 0], [54000, 2000, 0, 0]] },
    { cls: 'Pawn_Killjoy_E_Turret_C', owner: null, from: 50000, to: 70000, samples: [[50000, 3000, 0, 0], [60000, 3000, 0, 0]] },
  ]
  const ids = createFrameIds()
  const [turret, drone] = abilities(frameStep(bundle, 53000, lookup, T, ids))
  assert.equal(turret.life, undefined)
  nearPos(turret.at, 0.5, 0.8, 'turret')
  assert.equal(drone.family, 'scout')
  nearPos(drone.at, 0.5, 0.65, 'drone now')
  assert.ok((drone.trail?.length ?? 0) >= 2)
  near(drone.life, 0.5, 'drone life')
})

test('a wave runs out along the aim the agent had', () => {
  const bundle = utilityFixture()
  bundle.casts = []
  bundle.effects = [{ start: 50000, end: 56000, kind: 'other', agent: null, cls: 'GameObject_Breach_X_Shockwave_C', x: 0, y: 0, owner: SOVA }]
  const lookBreach: typeof lookup = id => (id === bundle.players.find(p => p.subject === SOVA)?.agentId ? { name: 'Breach', abilities: [] } : lookup(id))
  const at = (t: number) => abilities(frameStep(bundle, t, lookBreach, T, createFrameIds())).find(a => a.agent === 'Breach')
  const early = at(50750)!
  assert.equal(early.family, 'wave')
  assert.ok(early.reach)
  nearPos(early.at, 0.5, 0.5, 'where it started')
  assert.equal(at(52100), undefined)
})

test('four wall segments are one ability with a path along the wall, the badge halfway', () => {
  const bundle = utilityFixture()
  const ids = createFrameIds()
  const wall = (t: number) => abilities(frameStep(bundle, t, lookup, T, ids)).filter(a => a.agent === 'Sova')
  const up = wall(65000)
  assert.equal(up.length, 1)
  const [el] = up
  assert.equal(el.id, ids.forEffect(4))
  assert.deepEqual({ slot: el.slot, shape: el.shape }, { slot: 'Grenade', shape: 'wall' })
  assert.equal(el.path?.length, 4)
  // In order along the wall (y −900, −300, 300, 900 → u 0.41 … 0.59), whichever end comes first.
  const us = el.path!.map(p => p.u!)
  const ordered = us[0] < us[3] ? us : [...us].reverse()
  ordered.forEach((u, k) => near(u, [0.41, 0.47, 0.53, 0.59][k], `path[${k}].u`))
  for (const p of el.path!) near(p.v, 0.7, 'path v')
  nearPos(el.at, 0.5, 0.7, 'at')
  // One segment broken: the rest of the wall, same id.
  const broken = wall(72000)
  assert.equal(broken.length, 1)
  assert.equal(broken[0].id, el.id)
  assert.equal(broken[0].path?.length, 3)
  assert.equal(wall(76000).length, 0)
})

test('an ignore class never appears', () => {
  const bundle = utilityFixture()
  const ids = createFrameIds()
  for (let t = 30000; t <= 80000; t += 500) {
    for (const el of abilities(frameStep(bundle, t, lookup, T, ids))) {
      assert.notEqual(el.id, ids.forEffect(8), `manager at ${t}`)
      assert.notEqual(el.id, ids.forEffect(9), `ult orb at ${t}`)
      assert.notEqual(el.agent, 'Agent', `ownerless at ${t}`)
    }
  }
})

test('a frame with a throw and a wall passes parsePlayDoc unchanged', () => {
  const bundle = utilityFixture()
  const ids = createFrameIds()
  for (const t of [41000, 43000, 65000, 72000]) {
    const doc = { version: 2 as const, summary: '', comp: ['Omen', 'Sova'], steps: [frameStep(bundle, t, lookup, T, ids)], assumptions: [] }
    assert.deepEqual(parsePlayDoc(JSON.parse(JSON.stringify(doc))), doc, String(t))
  }
})
