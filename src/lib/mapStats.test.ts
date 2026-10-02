/**
 * Unit tests for the per-agent numbers on a Map Hub.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { agentStatsForMap, pickBestAgent } from './mapStats.ts'
import type { HomeMatch } from './homeStats.ts'

let seq = 0

function match(patch: Partial<HomeMatch>): HomeMatch {
  seq++
  return {
    id: `row-${seq}`,
    match_id: `riot-${seq}`,
    match_date: '2026-07-01T12:00:00Z',
    map: 'Haven',
    map_id: null,
    agent: 'Sova',
    agent_id: null,
    result: 'W',
    score: '13-5',
    acs: 200,
    kills: 15,
    deaths: 10,
    assists: 5,
    kda: 2,
    headshot_pct: 20,
    ...patch,
  }
}

const games = (agent: string, results: string, patch: Partial<HomeMatch> = {}) =>
  [...results].map(c => match({ agent, result: c === 'W' ? 'W' : c === 'L' ? 'L' : 'draw', ...patch }))

test('no matches gives no rows and no best agent', () => {
  assert.deepEqual(agentStatsForMap([]), [])
  assert.equal(pickBestAgent([]), null)
})

test('rows come most played first, then by name', () => {
  const rows = agentStatsForMap([...games('Sova', 'WW'), ...games('Raze', 'WLWL'), ...games('Iso', 'WL')])
  assert.deepEqual(rows.map(r => `${r.name}:${r.total}`), ['Raze:4', 'Iso:2', 'Sova:2'])
})

test('each row carries the record and the win rate, draws left out of the rate', () => {
  const [row] = agentStatsForMap(games('Sova', 'WWLD'))
  assert.equal(row.total, 4)
  assert.equal(row.wins, 2)
  assert.equal(row.losses, 1)
  assert.equal(row.draws, 1)
  assert.equal(row.winRate, 67)
})

test('averages are plain means of the per-match figures', () => {
  const [row] = agentStatsForMap([
    match({ acs: 229, kda: 1.5, headshot_pct: 21.4 }),
    match({ acs: 198, kda: 2.25, headshot_pct: 30 }),
    match({ acs: 250, kda: 0.5, headshot_pct: 12.5 }),
  ])
  assert.equal(row.avgAcs, 226) // 677 / 3 = 225.67
  assert.equal(row.avgKda, 1.42) // 4.25 / 3 = 1.4167
  assert.equal(row.avgHsPct, 21.3) // 63.9 / 3
})

test('an agent is grouped whatever the case or padding of the stored name', () => {
  const rows = agentStatsForMap([match({ agent: 'Sova', acs: 100 }), match({ agent: ' sova ', acs: 300 })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 2)
  assert.equal(rows[0].avgAcs, 200)
})

test('the best agent has the highest win rate among those with three matches', () => {
  const rows = agentStatsForMap([...games('Sova', 'WWW'), ...games('Raze', 'WLWL'), ...games('Iso', 'W')])
  assert.equal(pickBestAgent(rows)?.name, 'Sova')
})

test('a perfect record on fewer than three matches is not the best agent', () => {
  const rows = agentStatsForMap([...games('Iso', 'WW'), ...games('Raze', 'WLWL')])
  assert.equal(pickBestAgent(rows)?.name, 'Raze')
})

test('no agent with three matches means no best agent', () => {
  const rows = agentStatsForMap([...games('Iso', 'WW'), ...games('Raze', 'WL')])
  assert.equal(pickBestAgent(rows), null)
})

test('a tie on win rate goes to the larger sample', () => {
  const rows = agentStatsForMap([...games('Sova', 'WWL'), ...games('Raze', 'WWWWLL')])
  assert.equal(pickBestAgent(rows)?.name, 'Raze')
})

test('the best agent keeps its averages', () => {
  const rows = agentStatsForMap(games('Sova', 'WWW', { acs: 240, kda: 1.8, headshot_pct: 25 }))
  assert.deepEqual(
    (({ avgAcs, avgKda, avgHsPct }) => ({ avgAcs, avgKda, avgHsPct }))(pickBestAgent(rows)!),
    { avgAcs: 240, avgKda: 1.8, avgHsPct: 25 },
  )
})
