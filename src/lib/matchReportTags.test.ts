/**
 * Unit tests for turning a report's duels into moment tags
 * (docs/match-report.md §5): names, seconds, notes and what is skipped (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReportDuel } from './matchReport.ts'
import { duelTagNames, planDuelTags } from './matchReportTags.ts'

const duel = (over: Partial<ReportDuel>): ReportDuel => ({
  round: 1, side: 'defender', kind: 'kill', t: 100000, clockS: 20, other: 'foe', weapon: null, distM: 10, myHp: 100, theirHp: 100,
  mySpeed: 0, theirSpeed: 0, stance: 'standing', myOffDeg: 0, theirOffDeg: 0, alive: [5, 5], nearestMateM: 5, first: false, won: true,
  where: 'B Link', theirWhere: 'B Site', traded: false, blinded: false, ...over,
})

const TAGS = [
  { id: 'kill', name: 'KILL' }, { id: 'death', name: 'Death' }, { id: 'atk', name: 'ATTACK' }, { id: 'def', name: 'DEFENSE' },
  { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'mid', name: 'MID' }, { id: 'ashort', name: 'A SHORT' },
]
/** Replay ms to video seconds: the video is one second behind per second of replay, from 0. */
const videoSecond = (ms: number) => ms / 1000

test('the names a duel calls for', () => {
  assert.deepEqual(duelTagNames(duel({})), ['KILL', 'DEFENSE', 'B', 'B LINK'])
  assert.deepEqual(duelTagNames(duel({ kind: 'death', side: 'attacker', where: 'Mid Bottom' })), ['DEATH', 'ATTACK', 'MID', 'MID BOTTOM'])
  assert.deepEqual(duelTagNames(duel({ side: null, where: null })), ['KILL'])
  assert.deepEqual(duelTagNames(duel({ where: 'Attacker Side Spawn' })), ['KILL', 'DEFENSE', 'ATTACKER SIDE SPAWN'])
})

test('a kill is tagged five seconds before it, by the names the vocabulary has', () => {
  const plan = planDuelTags({ duels: [duel({ where: 'A Short' })], videoSecond, tags: TAGS, notes: [], existing: [] })
  assert.deepEqual(plan.rows, [
    { tagId: 'kill', videoTs: 95, noteId: null },
    { tagId: 'def', videoTs: 95, noteId: null },
    { tagId: 'a', videoTs: 95, noteId: null },
    { tagId: 'ashort', videoTs: 95, noteId: null },
  ])
  assert.equal(plan.kills, 1)
  assert.equal(plan.deaths, 0)
  assert.deepEqual(plan.missing, [])
})

test('a death lands on the note at its second; a kill moves off a note', () => {
  const notes = [{ id: 'note-1', timestamp_seconds: 95 }]
  const death = planDuelTags({ duels: [duel({ kind: 'death' })], videoSecond, tags: TAGS, notes, existing: [] })
  assert.deepEqual(death.rows.map(r => [r.tagId, r.videoTs, r.noteId]), [['death', 95, 'note-1'], ['def', 95, 'note-1'], ['b', 95, 'note-1']])
  const kill = planDuelTags({ duels: [duel({})], videoSecond, tags: TAGS, notes, existing: [] })
  assert.deepEqual(kill.rows.map(r => [r.tagId, r.videoTs, r.noteId]), [['kill', 96, null], ['def', 96, null], ['b', 96, null]])
})

test('what is on the review already is counted, not added again', () => {
  const first = planDuelTags({ duels: [duel({})], videoSecond, tags: TAGS, notes: [], existing: [] })
  const again = planDuelTags({
    duels: [duel({})], videoSecond, tags: TAGS, notes: [],
    existing: first.rows.map(r => ({ tag_id: r.tagId, video_ts: r.videoTs })),
  })
  assert.deepEqual(again.rows, [])
  assert.equal(again.already, 3)
  assert.equal(again.kills, 0)
})

test('a tag a second to either side is the same moment; two seconds away is another', () => {
  const near = planDuelTags({ duels: [duel({})], videoSecond, tags: TAGS, notes: [], existing: [{ tag_id: 'kill', video_ts: 94 }, { tag_id: 'def', video_ts: 96 }, { tag_id: 'b', video_ts: 97 }] })
  assert.deepEqual(near.rows.map(r => r.tagId), ['b'])
  assert.equal(near.already, 2)
  // Two kills a second apart are both tagged: the allowance is for what the review holds, not for the plan itself.
  const pair = planDuelTags({ duels: [duel({ t: 100000 }), duel({ t: 101000 })], videoSecond, tags: TAGS.filter(t => t.id === 'kill'), notes: [], existing: [] })
  assert.deepEqual(pair.rows.map(r => r.videoTs), [95, 96])
})

test('two duels in the same second share their side and site tags', () => {
  const plan = planDuelTags({ duels: [duel({ t: 100000 }), duel({ t: 100400, kind: 'death' })], videoSecond, tags: TAGS, notes: [], existing: [] })
  assert.deepEqual(plan.rows.map(r => r.tagId), ['kill', 'def', 'b', 'death'])
  assert.equal(plan.already, 2)
  assert.equal(plan.kills, 1)
  assert.equal(plan.deaths, 1)
})

test('a name the vocabulary lacks is reported, a callout without a tag is not', () => {
  const plan = planDuelTags({
    duels: [duel({ where: 'C Site' }), duel({ t: 200000, kind: 'death', where: 'C Site' })],
    videoSecond,
    tags: TAGS.filter(t => t.id !== 'def'),
    notes: [],
    existing: [],
  })
  assert.deepEqual(plan.missing, ['C', 'DEFENSE'])
  assert.deepEqual(plan.rows.map(r => r.tagId), ['kill', 'death'])
})

test('a tag never sits before the start of the video', () => {
  const plan = planDuelTags({ duels: [duel({ t: 2000 })], videoSecond, tags: TAGS, notes: [], existing: [] })
  assert.ok(plan.rows.every(r => r.videoTs === 0))
})
