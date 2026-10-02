/**
 * Unit tests for the side a team plays in each round.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { sideForRound } from './roundSides.ts'

const sides = (team: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => sideForRound(team, from + i))

test('Red attacks the first half and defends the second', () => {
  assert.deepEqual(new Set(sides('Red', 1, 12)), new Set(['attack']))
  assert.deepEqual(new Set(sides('Red', 13, 24)), new Set(['defense']))
})

test('Blue defends the first half and attacks the second', () => {
  assert.deepEqual(new Set(sides('Blue', 1, 12)), new Set(['defense']))
  assert.deepEqual(new Set(sides('Blue', 13, 24)), new Set(['attack']))
})

test('the two teams are never on the same side', () => {
  for (let round = 1; round <= 30; round++) {
    assert.notEqual(sideForRound('Red', round), sideForRound('Blue', round), `round ${round}`)
  }
})

test('overtime swaps every round, Red attacking first', () => {
  assert.deepEqual(sides('Red', 25, 28), ['attack', 'defense', 'attack', 'defense'])
  assert.deepEqual(sides('Blue', 25, 28), ['defense', 'attack', 'defense', 'attack'])
})

test('the team name is read whatever its case or padding', () => {
  assert.equal(sideForRound('red', 1), 'attack')
  assert.equal(sideForRound(' RED ', 13), 'defense')
  assert.equal(sideForRound('blue', 1), 'defense')
})

// Who planted in a real 28-round payload: Red in rounds 1–12, 25 and 27, Blue
// in 18–24 and 26. Only attackers plant.
test('matches who planted the spike in a real overtime match', () => {
  const planted: Record<number, string> = {
    1: 'Red', 2: 'Red', 3: 'Red', 5: 'Red', 7: 'Red', 8: 'Red', 10: 'Red', 12: 'Red',
    18: 'Blue', 19: 'Blue', 20: 'Blue', 23: 'Blue', 24: 'Blue',
    25: 'Red', 26: 'Blue', 27: 'Red',
  }
  for (const [round, team] of Object.entries(planted)) {
    assert.equal(sideForRound(team, Number(round)), 'attack', `round ${round}`)
  }
})
