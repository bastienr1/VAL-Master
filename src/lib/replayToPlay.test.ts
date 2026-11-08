/**
 * Unit tests for turning a replay round into a play (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { replayStepTimes, roundToPlay, type ReplayAgentInfo, type ReplayAgentLookup } from './replayToPlay.ts'
import { REPLAY_BUNDLE_SCHEMA, type ReplayBundle, type ReplayTrackSample } from './replayBundle.ts'
import { parsePlayDoc, type AbilityElement, type AgentElement, type MarkerElement, type PlayStep } from './playDoc.ts'

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
      // No barrier measured, no end: barrier = buy + 30 s, end = the last kill.
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
    ],
    effects: [
      // Explained by nothing: far from the only cast.
      { start: 41000, end: null, kind: 'smoke', agent: null, cls: 'Smoke_C', x: -3000, y: 3000, owner: JETT },
      // Explained by Omen's E (1.5 s and 100 cm away): not drawn twice.
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

test('the round becomes barrier drop, first contact, plant and end', () => {
  const bundle = fixture()
  assert.deepEqual(replayStepTimes(bundle, bundle.rounds[0]), [
    { t: 30000, name: 'Barrier drop' },
    { t: 45000, name: 'First contact' },
    { t: 60000, name: 'Plant' },
    { t: 80000, name: 'End' },
  ])
  const { doc } = roundToPlay(bundle, 1, lookup, T)
  assert.deepEqual(doc.steps.map(s => s.name), ['Barrier drop', 'First contact', 'Plant', 'End'])
  assert.equal(doc.steps[1].caption.startsWith('0:15 after barrier'), true)
  assert.equal(doc.steps[3].caption.startsWith('0:50 after barrier'), true)
})

test('a moment within 4 s of the previous one is dropped; barrier and end stay', () => {
  const bundle = fixture()
  // Barrier 130 s (buy + 30), first kill 132 s (too close), end = last kill 150 s.
  assert.deepEqual(replayStepTimes(bundle, bundle.rounds[1]), [
    { t: 130000, name: 'Barrier drop' },
    { t: 150000, name: 'End' },
  ])
  // An end too close to the barrier still leaves both.
  const short = { ...bundle.rounds[1], endMs: 131000 }
  assert.deepEqual(replayStepTimes(bundle, short).map(s => s.name), ['Barrier drop', 'End'])
})

test('a player killed is missing from that step on', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  assert.ok(agentNamed(doc.steps[0], 'Jett'))
  for (const step of doc.steps.slice(1)) assert.equal(agentNamed(step, 'Jett'), undefined, step.name)
  const jett = agentNamed(doc.steps[0], 'Jett')!
  assert.equal(jett.team, 'enemy')
  assert.deepEqual(jett.at, { u: 0.5, v: 0.3 })
})

test('the spike carrier is flagged while carrying', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  assert.equal(agentNamed(doc.steps[0], 'Omen')!.spike, true)
  assert.equal(agentNamed(doc.steps[1], 'Omen')!.spike, true)
  assert.equal(agentNamed(doc.steps[2], 'Omen')!.spike, undefined)
  assert.equal(agentNamed(doc.steps[0], 'Sova')!.spike, undefined)
})

test('a player keeps one element id across steps', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  for (const name of ['Omen', 'Sova']) {
    const ids = new Set(doc.steps.map(s => agentNamed(s, name)!.id))
    assert.equal(ids.size, 1, name)
  }
  assert.notEqual(agentNamed(doc.steps[0], 'Omen')!.id, agentNamed(doc.steps[0], 'Sova')!.id)
})

test('a mover gets moveTo, a camper and the last step do not', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  const omen = agentNamed(doc.steps[0], 'Omen')!
  assert.deepEqual(omen.at, { u: 0.5, v: 0.5 })
  assert.deepEqual(omen.moveTo, { u: 0.5, v: 0.7 })
  for (const step of doc.steps) assert.equal(agentNamed(step, 'Sova')!.moveTo, undefined, step.name)
  for (const a of agents(doc.steps[3])) assert.equal(a.moveTo, undefined)
})

test('a cast becomes its ability where its smoke stands, while the smoke is up', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  assert.equal(abilities(doc.steps[0]).length, 0)
  const cast = abilities(doc.steps[1]).filter(a => a.slot !== null)
  assert.equal(cast.length, 1)
  assert.deepEqual(
    { agent: cast[0].agent, slot: cast[0].slot, shape: cast[0].shape, radius: cast[0].radius, label: cast[0].label, at: cast[0].at },
    { agent: 'Omen', slot: 'Ability2', shape: 'smoke', radius: 410, label: 'Dark Cover', at: { u: 0.65, v: 0.66 } },
  )
  // Carried while the smoke is up (to 70 s), gone after.
  assert.equal(abilities(doc.steps[2]).filter(a => a.slot !== null).length, 1)
  assert.equal(abilities(doc.steps[3]).filter(a => a.slot !== null).length, 0)
})

test('a cast by an unknown agent is labelled by its key', () => {
  const { doc } = roundToPlay(fixture(), 1, () => null, T)
  const cast = abilities(doc.steps[1]).find(a => a.slot !== null)!
  assert.equal(cast.agent, 'Agent')
  assert.equal(cast.slot, 'Ability2')
  assert.equal(cast.label, 'E')
})

test('an effect no cast explains becomes an ability without a slot', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  for (const step of doc.steps.slice(1)) {
    const orphans = abilities(step).filter(a => a.slot === null)
    assert.equal(orphans.length, 1, step.name)
    assert.equal(orphans[0].shape, 'smoke')
    assert.equal(orphans[0].agent, 'Jett')
    assert.deepEqual(orphans[0].at, { u: 0.8, v: 0.2 })
  }
  // Not up yet at the barrier.
  assert.equal(abilities(doc.steps[0]).length, 0)
  // One id for the effect across steps.
  assert.equal(new Set(doc.steps.slice(1).map(s => abilities(s).find(a => a.slot === null)!.id)).size, 1)
})

test('the spike marker appears from the plant step on, labelled with the site', () => {
  const { doc } = roundToPlay(fixture(), 1, lookup, T)
  assert.equal(markers(doc.steps[0]).length, 0)
  assert.equal(markers(doc.steps[1]).length, 0)
  for (const step of doc.steps.slice(2)) {
    assert.deepEqual(
      markers(step).map(m => ({ type: m.type, label: m.label, at: m.at })),
      [{ type: 'spike', label: 'A', at: { u: 0.5, v: 0.9 } }],
      step.name,
    )
  }
})

test('comp is the allies in player order; side, map and texts come from the round', () => {
  const bundle = fixture()
  const play = roundToPlay(bundle, 1, lookup, T)
  assert.deepEqual(play.doc.comp, ['Omen', 'Sova'])
  assert.equal(play.side, 'attack')
  assert.equal(play.mapUuid, 'lotus-uuid')
  assert.equal(play.title, 'Round 1 · Lotus · 2026-09-29')
  assert.equal(play.doc.summary, 'Round 1 from the replay: your team won by elimination')
  assert.equal(roundToPlay(bundle, 2, lookup, T).side, 'defense')
  bundle.rounds[0].side = null
  assert.equal(roundToPlay(bundle, 1, lookup, T).side, 'attack')
})

test('a round the replay does not have throws a readable error', () => {
  assert.throws(() => roundToPlay(fixture(), 9, lookup, T), { message: 'Round 9 is not in this replay (it has rounds 1 to 2).' })
})

test('the document is already normalized', () => {
  const bundle = fixture()
  for (const n of [1, 2]) {
    const { doc } = roundToPlay(bundle, n, lookup, T)
    assert.deepEqual(parsePlayDoc(doc), doc)
    assert.deepEqual(parsePlayDoc(JSON.parse(JSON.stringify(doc))), doc)
  }
})
