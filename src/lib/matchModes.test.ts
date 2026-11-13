/**
 * Unit tests for the match modes (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEATHMATCH_MODE, deathmatchPlacement, isDeathmatchMode, matchCategory, ordinal, placementLabel } from './matchModes.ts'

test('a Deathmatch is known whatever its case or spacing', () => {
  assert.equal(isDeathmatchMode(DEATHMATCH_MODE), true)
  assert.equal(isDeathmatchMode(' deathmatch '), true)
  assert.equal(isDeathmatchMode('DEATHMATCH'), true)
  assert.equal(isDeathmatchMode('Competitive'), false)
  assert.equal(isDeathmatchMode('Team Deathmatch'), false)
  assert.equal(isDeathmatchMode(''), false)
  assert.equal(isDeathmatchMode(null), false)
  assert.equal(isDeathmatchMode(undefined), false)
})

test('everything that is not a Deathmatch is competitive', () => {
  assert.equal(matchCategory('Deathmatch'), 'deathmatch')
  assert.equal(matchCategory('Competitive'), 'competitive')
  assert.equal(matchCategory(null), 'competitive')
  assert.equal(matchCategory(undefined), 'competitive')
})

test('a placement reads from the "1/12" score, nothing else', () => {
  assert.deepEqual(deathmatchPlacement('1/12'), { place: 1, players: 12 })
  assert.deepEqual(deathmatchPlacement(' 7 / 12 '), { place: 7, players: 12 })
  assert.equal(deathmatchPlacement('13-7'), null)
  assert.equal(deathmatchPlacement('13 - 7'), null)
  assert.equal(deathmatchPlacement('0/12'), null)
  assert.equal(deathmatchPlacement('13/12'), null)
  assert.equal(deathmatchPlacement(''), null)
})

test('ordinals take st, nd, rd and th, the teens th', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 12, 13, 14, 21, 22, 23, 101, 111, 112].map(ordinal), [
    '1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th', '21st', '22nd', '23rd', '101st', '111th', '112th',
  ])
})

test('a placement label reads "1st of 12"', () => {
  assert.equal(placementLabel('1/12'), '1st of 12')
  assert.equal(placementLabel('11/12'), '11th of 12')
  assert.equal(placementLabel('13 - 7'), null)
})
