/**
 * Unit tests for the Pro Study heading rules (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseActionItems, proStudyLink, reviewHeading, shortCreator } from './guideDisplay.ts'

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

test('proStudyLink carries the moment as whole seconds', () => {
  assert.equal(proStudyLink('abc', 754.9), '/study/abc?t=754')
  assert.equal(proStudyLink('abc', 90), '/study/abc?t=90')
})

test('proStudyLink is the plain page when nothing has played', () => {
  assert.equal(proStudyLink('abc'), '/study/abc')
  assert.equal(proStudyLink('abc', null), '/study/abc')
  assert.equal(proStudyLink('abc', 0), '/study/abc')
  assert.equal(proStudyLink('abc', 0.6), '/study/abc')
  assert.equal(proStudyLink('abc', Number.NaN), '/study/abc')
  assert.equal(proStudyLink('abc', -5), '/study/abc')
})

test('action items keep their order and their ticks', () => {
  assert.deepEqual(
    parseActionItems('- [ ] Run drill #1 for 3 sessions\n- [x] Add the note to the MOC\n* [X] Starred bullet'),
    [
      { done: false, text: 'Run drill #1 for 3 sessions' },
      { done: true, text: 'Add the note to the MOC' },
      { done: true, text: 'Starred bullet' },
    ],
  )
})

test('action items ignore anything that is not a task line', () => {
  assert.deepEqual(parseActionItems('Some prose\n- a plain bullet\n- [ ]   \n'), [])
  assert.deepEqual(parseActionItems(null), [])
  assert.deepEqual(parseActionItems(undefined), [])
})
