/**
 * Unit tests for the Home dashboard maths.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_TIME,
  filterByScope,
  formatScore,
  groupByAgent,
  groupByMap,
  pickEdgeAgent,
  resolveDefaultScope,
  summarize,
  winRate,
  type HomeMatch,
} from './homeStats.ts'
import { getActByCode } from './acts.ts'

let seq = 0

function match(patch: Partial<HomeMatch>): HomeMatch {
  seq++
  return {
    id: `row-${seq}`,
    match_id: `riot-${seq}`,
    match_date: '2026-07-01T12:00:00Z',
    map: 'Ascent',
    map_id: null,
    agent: 'Raze',
    agent_id: null,
    result: 'W',
    score: '13-5',
    acs: 250,
    kills: 20,
    deaths: 12,
    assists: 5,
    ...patch,
  }
}

const results = (spec: string) => [...spec].map(c => (c === 'W' ? 'W' : c === 'L' ? 'L' : 'draw') as HomeMatch['result'])

test('winRate excludes draws from the denominator', () => {
  const summary = summarize(results('WWLD').map(result => match({ result })))
  assert.deepEqual(summary, { total: 4, wins: 2, losses: 1, draws: 1, winRate: 67 })
  // 2 of 3 decisive games, not 2 of 4 played.
  assert.equal(winRate(2, 1), 67)
})

test('winRate is null when there is nothing decisive', () => {
  assert.equal(winRate(0, 0), null)
  assert.equal(summarize([]).winRate, null)
  assert.equal(summarize([match({ result: 'draw' })]).winRate, null)
})

test('a percentage is always one the sample can produce', () => {
  // Six decisive games can only land on multiples of 1/6.
  const possible = new Set([0, 1, 2, 3, 4, 5, 6].map(w => Math.round((w / 6) * 100)))
  assert.equal(winRate(5, 1), 83)
  for (let wins = 0; wins <= 6; wins++) assert.ok(possible.has(winRate(wins, 6 - wins)!))
  assert.deepEqual([...possible], [0, 17, 33, 50, 67, 83, 100])
})

test('wins + losses + draws always equals total', () => {
  const summary = summarize(results('WLDDWWL').map(result => match({ result })))
  assert.equal(summary.wins + summary.losses + summary.draws, summary.total)
})

test('default scope is the running act when it has matches', () => {
  const now = new Date('2026-07-10T00:00:00Z') // inside V26A4
  const scope = resolveDefaultScope([new Date('2026-07-01T12:00:00Z'), new Date('2026-05-01T12:00:00Z')], now)
  assert.equal(scope.kind, 'act')
  assert.equal(scope.kind === 'act' && scope.act.code, 'V26A4')
})

test('default scope falls back to the newest played act when the running one is empty', () => {
  const now = new Date('2026-08-20T00:00:00Z') // first days of V26A5, nothing played yet
  const scope = resolveDefaultScope([new Date('2026-07-01T12:00:00Z'), new Date('2026-05-01T12:00:00Z')], now)
  assert.equal(scope.kind === 'act' && scope.act.code, 'V26A4')
})

test('default scope is all time when nothing has been played', () => {
  assert.deepEqual(resolveDefaultScope([], new Date('2026-07-10T00:00:00Z')), ALL_TIME)
})

test('filterByScope treats the act end as exclusive', () => {
  const act = getActByCode('V26A4')!
  const inside = match({ match_date: '2026-06-24T00:00:00Z' }) // start day
  const lastDay = match({ match_date: '2026-08-18T23:59:59Z' })
  const nextAct = match({ match_date: '2026-08-19T00:00:00Z' }) // end day belongs to V26A5
  const all = [inside, lastDay, nextAct]

  assert.deepEqual(filterByScope(all, { kind: 'act', act }), [inside, lastDay])
  assert.equal(filterByScope(all, ALL_TIME), all)
})

test('groups sort by matches played, then by name', () => {
  const groups = groupByMap([
    match({ map: 'Lotus' }),
    match({ map: 'Ascent' }),
    match({ map: 'Haven' }),
    match({ map: 'Haven' }),
  ])
  assert.deepEqual(groups.map(g => [g.name, g.total]), [['Haven', 2], ['Ascent', 1], ['Lotus', 1]])
})

test('a group carries its own record, id and latest result', () => {
  const [raze] = groupByAgent([
    match({ result: 'W', match_date: '2026-07-01T12:00:00Z' }),
    match({ result: 'L', match_date: '2026-07-03T12:00:00Z', agent_id: 'raze-uuid' }),
    match({ result: 'draw', match_date: '2026-07-02T12:00:00Z' }),
  ])
  assert.equal(raze.name, 'Raze')
  assert.equal(raze.id, 'raze-uuid')
  assert.equal(raze.lastResult, 'L')
  assert.deepEqual([raze.total, raze.wins, raze.losses, raze.draws, raze.winRate], [3, 1, 1, 1, 50])
})

test('group names match case-insensitively', () => {
  const groups = groupByMap([match({ map: 'Ascent' }), match({ map: ' ascent ' })])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].total, 2)
})

test('edge agent needs the minimum sample', () => {
  const small = groupByAgent(results('WWWW').map(result => match({ agent: 'Jett', result })))
  assert.equal(pickEdgeAgent(small), null)

  const enough = groupByAgent([
    ...results('WWWW').map(result => match({ agent: 'Jett', result })), // 100%, 4 games
    ...results('WWWLL').map(result => match({ agent: 'Raze', result })), // 60%, 5 games
    ...results('WLLLL').map(result => match({ agent: 'Sova', result })), // 20%, 5 games
  ])
  assert.equal(pickEdgeAgent(enough)?.name, 'Raze')
  assert.equal(pickEdgeAgent(enough, 4)?.name, 'Jett')
})

test('edge agent ties go to the larger sample, and all-draw agents never qualify', () => {
  const groups = groupByAgent([
    ...results('WWWLLL').map(result => match({ agent: 'Fade', result })),
    ...results('WWWWLLLL').map(result => match({ agent: 'Clove', result })),
    ...results('DDDDD').map(result => match({ agent: 'Sage', result })),
  ])
  assert.equal(pickEdgeAgent(groups)?.name, 'Clove')
  assert.equal(pickEdgeAgent(groupByAgent(results('DDDDD').map(result => match({ agent: 'Sage', result })))), null)
})

test('formatScore spaces the stored score', () => {
  assert.equal(formatScore('13-5'), '13 – 5')
  assert.equal(formatScore('3 - 13'), '3 – 13')
})
