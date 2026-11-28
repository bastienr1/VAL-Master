import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addTag,
  hasTags,
  isEmptyCard,
  normalizeTag,
  parseStratCard,
  removeTag,
  STARTER_TAGS,
  TAG_LENGTH,
  TAG_MAX,
  tagCounts,
  tagSuggestions,
  WHEN_MAX,
} from './stratCard.ts'

test('a tag is trimmed, its spaces collapsed and cut to its length', () => {
  assert.equal(normalizeTag('  A   execute '), 'A execute')
  assert.equal(normalizeTag('   '), '')
  assert.equal(normalizeTag('x'.repeat(50)).length, TAG_LENGTH)
})

test('adding a tag skips empty ones, repeats ignoring case, and a full card', () => {
  assert.deepEqual(addTag(['Retake'], ' a execute '), ['Retake', 'a execute'])
  assert.deepEqual(addTag(['Retake'], 'retake'), ['Retake'])
  assert.deepEqual(addTag(['Retake'], '  '), ['Retake'])
  const full = Array.from({ length: TAG_MAX }, (_, i) => `t${i}`)
  assert.equal(addTag(full, 'more'), full)
})

test('removing a tag ignores case', () => {
  assert.deepEqual(removeTag(['Retake', 'Lurk'], 'RETAKE'), ['Lurk'])
})

test('a stored card keeps its sound parts and is null when it holds nothing', () => {
  assert.deepEqual(parseStratCard({ tags: ['Retake', 'retake', 3, ' Lurk '], when: ' Two on B ', read: 'Jett peeks early' }), {
    tags: ['Retake', 'Lurk'],
    when: 'Two on B',
    read: 'Jett peeks early',
  })
  assert.equal(parseStratCard({ tags: [], when: ' ', read: '' }), null)
  for (const bad of [null, undefined, 'card', [], 7]) assert.equal(parseStratCard(bad), null, String(bad))
  assert.equal(parseStratCard({ when: 'x'.repeat(400) })?.when.length, WHEN_MAX)
  assert.deepEqual(parseStratCard({ when: 'Stack A' }), { tags: [], when: 'Stack A', read: '' })
})

test('an empty card is one with no tags and blank lines', () => {
  assert.equal(isEmptyCard({ tags: [], when: '  ', read: '' }), true)
  assert.equal(isEmptyCard({ tags: ['Eco'], when: '', read: '' }), false)
})

test('tags in use are counted ignoring case, most used first then by name', () => {
  const cards = [
    { tags: ['Retake', 'Lurk'], when: '', read: '' },
    { tags: ['retake'], when: '', read: '' },
    null,
    { tags: ['Anti-eco'], when: '', read: '' },
  ]
  assert.deepEqual(tagCounts(cards), [
    { tag: 'Retake', count: 2 },
    { tag: 'Anti-eco', count: 1 },
    { tag: 'Lurk', count: 1 },
  ])
})

test('suggestions put the user’s tags before the starters, match what is typed and skip the card’s own', () => {
  assert.deepEqual(tagSuggestions(['B hit', 'Retake'], '', ['Retake'], 3), ['B hit', STARTER_TAGS[0], STARTER_TAGS[1]])
  assert.deepEqual(tagSuggestions(['B hit'], 'eco', []), ['Eco', 'Anti-eco'])
  assert.deepEqual(tagSuggestions(['Retake'], 'RET', []), ['Retake'])
  assert.deepEqual(tagSuggestions([], 'zzz', []), [])
})

test('a card has the tags asked when it carries every one of them', () => {
  const card = { tags: ['Retake', 'B site'], when: '', read: '' }
  assert.equal(hasTags(card, []), true)
  assert.equal(hasTags(null, []), true)
  assert.equal(hasTags(card, ['retake']), true)
  assert.equal(hasTags(card, ['Retake', 'Lurk']), false)
  assert.equal(hasTags(null, ['Retake']), false)
})
