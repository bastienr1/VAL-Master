/**
 * Unit tests for the "From a replay" filters (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { filterReplayMatches, isFiltering, NO_REPLAY_FILTER, replayFilterOptions } from './replayFilters.ts'

const MATCHES = [
  { id: 1, agent: 'Fade', map: 'Sunset', result: 'L' as const },
  { id: 2, agent: 'Fade', map: 'Lotus', result: 'W' as const },
  { id: 3, agent: 'Raze', map: 'Lotus', result: 'W' as const },
  { id: 4, agent: 'Sova', map: 'Abyss', result: 'draw' as const },
]
const ids = (filter: Partial<typeof NO_REPLAY_FILTER>) => filterReplayMatches(MATCHES, { ...NO_REPLAY_FILTER, ...filter }).map(m => m.id)

test('no filter lets every match through, in order', () => {
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

test('the dropdowns offer each agent and map once, by name', () => {
  assert.deepEqual(replayFilterOptions([...MATCHES, { id: 5, agent: 'fade', map: ' Lotus', result: 'L' as const }]), {
    agents: ['Fade', 'Raze', 'Sova'],
    maps: ['Abyss', 'Lotus', 'Sunset'],
  })
})
