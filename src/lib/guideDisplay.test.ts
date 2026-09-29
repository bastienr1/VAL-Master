/**
 * Unit tests for the Pro Study heading rules (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewHeading, shortCreator } from './guideDisplay.ts'

test('a guide leads with its title', () => {
  assert.equal(
    reviewHeading({ source: 'vault', title: 'How To Fight Like An Immortal', creator: 'zasko III', player: 'zasko III' }),
    'How To Fight Like An Immortal',
  )
})

test('a guide without a title falls back to the creator, then a generic label', () => {
  assert.equal(reviewHeading({ source: 'vault', title: null, creator: 'Dopai', player: 'Dopai' }), 'Dopai')
  assert.equal(reviewHeading({ source: 'vault', title: null, creator: null, player: 'Unknown' }), 'Study guide')
})

test('a pro VOD leads with the player regardless of title', () => {
  assert.equal(
    reviewHeading({ source: 'notion', title: 'mada — Ascent', creator: null, player: 'mada' }),
    'mada',
  )
})

test('shortCreator trims the parenthetical qualifier', () => {
  assert.equal(shortCreator('This Valorant Life (coach: Adam — surname not given)'), 'This Valorant Life')
  assert.equal(shortCreator('ZOWIE Esports Academy (presented by mada)'), 'ZOWIE Esports Academy')
  assert.equal(shortCreator('zasko III'), 'zasko III')
})

test('shortCreator drops unknown and empty creators', () => {
  assert.equal(shortCreator('Unknown (dojo coaching lecture)'), null)
  assert.equal(shortCreator('unknown'), null)
  assert.equal(shortCreator(''), null)
  assert.equal(shortCreator(null), null)
})
