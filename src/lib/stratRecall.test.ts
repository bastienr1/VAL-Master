import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayDoc, PlayStep } from './playDoc.ts'
import { defaultRecallStep, recallOverlay, recallStrats, roundLinkBack, roundsOf, type RecallAt, type StratRound } from './stratRecall.ts'
import type { Play } from './types.ts'

const doc = (extra: Partial<PlayDoc> = {}): PlayDoc => ({ version: 2, summary: '', comp: [], steps: [], assumptions: [], ...extra })

const play = (id: string, extra: Partial<Play> = {}, docExtra: Partial<PlayDoc> = {}): Play => ({
  id,
  user_id: 'u',
  title: id,
  map: 'Bind',
  map_uuid: 'bind-uuid',
  side: 'attack',
  comp: [],
  brief: '',
  play: doc(docExtra),
  composed_with: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
})

const link = (play_id: string, match_id: string, round: number): StratRound => ({
  id: `${play_id}:${match_id}:${round}`,
  play_id,
  match_id,
  round,
  replay_ms: 1000,
  page: 'review',
  created_at: '2026-11-28T00:00:00Z',
})

const AT: RecallAt = { matchId: 'm1', round: 9, side: 'attack', map: 'Bind', mapUuid: 'bind-uuid' }

test('only the strats of the same map and side come up', () => {
  const plays = [
    play('a'),
    play('b', { side: 'defense' }),
    play('c', { map: 'Lotus', map_uuid: 'lotus-uuid' }),
    play('d', { map: 'bind', map_uuid: null }),
  ]
  assert.deepEqual(recallStrats(plays, [], AT).map(i => i.play.id).sort(), ['a', 'd'])
})

test('seen here first, then from this round, then this match, then most seen, then latest edited', () => {
  const plays = [
    play('latest', { updated_at: '2026-11-27T00:00:00Z' }),
    play('often'),
    play('match', {}, { replay: { matchId: 'm1', round: 3 } }),
    play('round', {}, { replay: { matchId: 'm1', round: 9 } }),
    play('seen'),
  ]
  const links = [link('seen', 'm1', 9), link('often', 'm2', 1), link('often', 'm3', 4)]
  const items = recallStrats(plays, links, AT)
  assert.deepEqual(items.map(i => i.play.id), ['seen', 'round', 'match', 'often', 'latest'])
  assert.equal(items[0].link?.id, 'seen:m1:9')
  assert.equal(items[3].rounds, 2)
  assert.equal(items[1].fromRound, true)
  assert.equal(items[2].fromMatch, true)
  assert.equal(items[2].fromRound, false)
})

test('picked tags narrow the strats to those carrying all of them', () => {
  const plays = [
    play('both', {}, { card: { tags: ['Retake', 'B site'], when: '', read: '' } }),
    play('one', {}, { card: { tags: ['Retake'], when: '', read: '' } }),
    play('none'),
  ]
  assert.deepEqual(recallStrats(plays, [], AT, ['retake']).map(i => i.play.id).sort(), ['both', 'one'])
  assert.deepEqual(recallStrats(plays, [], AT, ['Retake', 'B site']).map(i => i.play.id), ['both'])
})

test('a strat shows its last step unless another is picked', () => {
  const step = (id: string): PlayStep => ({ id, name: id, caption: '', elements: [] })
  assert.equal(defaultRecallStep(doc({ steps: [step('a'), step('b')] })), 1)
  assert.equal(defaultRecallStep(doc({ steps: [step('a')] })), 0)
  assert.equal(defaultRecallStep(null), 0)
})

test('the overlay leaves out the agents kept where another match had them', () => {
  const step: PlayStep = {
    id: 's',
    name: 'The plan',
    caption: '',
    elements: [
      { kind: 'agent', id: 'ally', agent: 'Sova', team: 'ally', at: { u: 0.5, v: 0.5 } },
      { kind: 'agent', id: 'seen', agent: 'Omen', team: 'enemy', at: { u: 0.2, v: 0.2 }, seen: true },
      { kind: 'agent', id: 'enemy', agent: 'Jett', team: 'enemy', at: { u: 0.3, v: 0.3 } },
    ],
  }
  assert.deepEqual(recallOverlay(step).elements.map(e => e.id), ['ally', 'enemy'])
})

test('a strat’s rounds are its own links in the order they were made', () => {
  const links = [link('a', 'm1', 1), link('b', 'm1', 2), link('a', 'm2', 5)]
  assert.deepEqual(roundsOf(links, 'a').map(l => l.round), [1, 5])
})

test('a seen-here link leads back to its page at its moment, named by its match when known', () => {
  const l = { ...link('a', 'm 1', 9), replay_ms: 935949, page: 'report' as const }
  assert.deepEqual(roundLinkBack(l, { map: 'Bind', playedAt: '2026-11-17T12:00:00Z' }), {
    to: '/report/m%201?at=935949',
    label: 'Bind · Nov 17 · R9',
    title: 'Round 9 on its report, at the moment it was marked',
  })
  assert.equal(roundLinkBack({ ...l, replay_ms: null }, null).to, '/report/m%201')
  assert.equal(roundLinkBack(l, null).label, 'R9')
})
