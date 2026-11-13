/**
 * Unit tests for the "From a replay" filters (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { filterReplayMatches, inCategory, isFiltering, NO_REPLAY_FILTER, replayFilterOptions } from './replayFilters.ts'

const MATCHES = [
  { id: 1, agent: 'Fade', map: 'Sunset', result: 'L' as const, mode: 'Competitive' },
  { id: 2, agent: 'Fade', map: 'Lotus', result: 'W' as const, mode: 'Competitive' },
  { id: 3, agent: 'Raze', map: 'Lotus', result: 'W' as const, mode: 'Competitive' },
  { id: 4, agent: 'Sova', map: 'Abyss', result: 'draw' as const, mode: 'Competitive' },
  // Deathmatches: listed in their own category only.
  { id: 5, agent: 'Jett', map: 'Lotus', result: 'W' as const, mode: 'Deathmatch' },
  { id: 6, agent: 'Fade', map: 'Haven', result: 'L' as const, mode: 'deathmatch' },
]
const ids = (filter: Partial<typeof NO_REPLAY_FILTER>) => filterReplayMatches(MATCHES, { ...NO_REPLAY_FILTER, ...filter }).map(m => m.id)

test('no filter lets every competitive match through, in order', () => {
  assert.deepEqual(ids({}), [1, 2, 3, 4])
  assert.equal(isFiltering(NO_REPLAY_FILTER), false)
})

test('agent, map and result each narrow the list, and combine', () => {
  assert.deepEqual(ids({ agent: 'Fade' }), [1, 2])
  assert.deepEqual(ids({ map: 'Lotus' }), [2, 3])
  assert.deepEqual(ids({ result: 'W' }), [2, 3])
  assert.deepEqual(ids({ agent: 'Fade', map: 'Lotus', result: 'W' }), [2])
  assert.deepEqual(ids({ agent: 'Fade', result: 'draw' as never }), [])
  assert.equal(isFiltering({ ...NO_REPLAY_FILTER, result: 'L' }), true)
})

test('a draw is neither a win nor a loss', () => {
  assert.equal(ids({ result: 'W' }).includes(4), false)
  assert.equal(ids({ result: 'L' }).includes(4), false)
})

test('names match whatever their case or spacing', () => {
  assert.deepEqual(ids({ agent: ' fade ' }), [1, 2])
})

test('the Deathmatch category lists the Deathmatches only, and the other filters apply inside it', () => {
  assert.deepEqual(ids({ category: 'deathmatch' }), [5, 6])
  assert.deepEqual(ids({ category: 'deathmatch', agent: 'Fade' }), [6])
  assert.deepEqual(ids({ category: 'deathmatch', map: 'Lotus' }), [5])
  // The category is a view, not a filter: Clear keeps it.
  assert.equal(isFiltering({ ...NO_REPLAY_FILTER, category: 'deathmatch' }), false)
})

test('a row with no mode is competitive', () => {
  const rows = [{ agent: 'Omen', map: 'Bind', result: 'W' as const }, { agent: 'Omen', map: 'Bind', result: 'W' as const, mode: null }]
  assert.equal(inCategory(rows, 'competitive').length, 2)
  assert.equal(inCategory(rows, 'deathmatch').length, 0)
})

test('the dropdowns offer each agent and map of the category once, by name', () => {
  const more = [...MATCHES, { id: 7, agent: 'fade', map: ' Lotus', result: 'L' as const, mode: 'Competitive' }]
  assert.deepEqual(replayFilterOptions(more), {
    agents: ['Fade', 'Raze', 'Sova'],
    maps: ['Abyss', 'Lotus', 'Sunset'],
  })
  assert.deepEqual(replayFilterOptions(more, 'deathmatch'), { agents: ['Fade', 'Jett'], maps: ['Haven', 'Lotus'] })
})
