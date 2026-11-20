/**
 * Unit tests for filtering a review by several moment tags (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_TAG_FILTER, isFiltering, looseMoments, matchesTagFilter, momentsKept, toggleTag, withoutTag, type TagFilter } from './tagFilter.ts'

const m = (id: string, tag_id: string, video_ts: number, note_id: string | null = null) => ({ id, tag_id, video_ts, note_id })

test('toggling adds a tag, then takes it out, and keeps the order chosen', () => {
  let filter = toggleTag(NO_TAG_FILTER, 'kill')
  filter = toggleTag(filter, 'b')
  assert.deepEqual(filter.ids, ['kill', 'b'])
  assert.equal(isFiltering(filter), true)
  filter = toggleTag(filter, 'kill')
  assert.deepEqual(filter.ids, ['b'])
  assert.equal(isFiltering(toggleTag(filter, 'b')), false)
  assert.deepEqual(NO_TAG_FILTER.ids, [])
})

test('a deleted tag leaves the filter; anything else leaves it untouched', () => {
  const filter: TagFilter = { ids: ['kill', 'b'], mode: 'any' }
  assert.deepEqual(withoutTag(filter, 'kill'), { ids: ['b'], mode: 'any' })
  assert.equal(withoutTag(filter, 'other'), filter)
})

test('all needs every chosen tag, any needs one, and no choice passes everything', () => {
  const carried = ['kill', 'b', 'defense']
  assert.equal(matchesTagFilter(NO_TAG_FILTER, []), true)
  assert.equal(matchesTagFilter({ ids: ['kill', 'b'], mode: 'all' }, carried), true)
  assert.equal(matchesTagFilter({ ids: ['kill', 'a'], mode: 'all' }, carried), false)
  assert.equal(matchesTagFilter({ ids: ['kill', 'a'], mode: 'any' }, carried), true)
  assert.equal(matchesTagFilter({ ids: ['death', 'a'], mode: 'any' }, carried), false)
  assert.equal(matchesTagFilter({ ids: ['kill'], mode: 'all' }, []), false)
  assert.equal(matchesTagFilter({ ids: ['kill'], mode: 'any' }, new Set(['kill'])), true)
})

test('tags with no note are grouped by their second, in tape order', () => {
  const groups = looseMoments([m('1', 'kill', 95), m('2', 'death', 40), m('3', 'b', 95), m('4', 'death', 70, 'note-1'), m('5', 'a', 40)])
  assert.deepEqual(groups.map(g => [g.videoTs, g.moments.map(x => x.tag_id)]), [[40, ['death', 'a']], [95, ['kill', 'b']]])
  assert.deepEqual(looseMoments([m('4', 'death', 70, 'note-1')]), [])
})

test('the lane keeps every tag of a matching note or second, and only those', () => {
  const moments = [
    m('1', 'kill', 95), m('2', 'b', 95), m('3', 'defense', 95), // a kill on B, no note
    m('4', 'kill', 200), m('5', 'a', 200), // a kill on A, no note
    m('6', 'death', 300, 'n1'), m('7', 'b', 300, 'n1'), // a death on B, on a note
    m('8', 'b', 300), // a loose tag on the same second as that note
  ]
  assert.equal(momentsKept(moments, NO_TAG_FILTER), null)
  assert.deepEqual([...(momentsKept(moments, { ids: ['kill', 'b'], mode: 'all' }) ?? [])].sort(), ['1', '2', '3'])
  assert.deepEqual([...(momentsKept(moments, { ids: ['kill', 'death'], mode: 'any' }) ?? [])].sort(), ['1', '2', '3', '4', '5', '6', '7'])
  assert.deepEqual([...(momentsKept(moments, { ids: ['b'], mode: 'all' }) ?? [])].sort(), ['1', '2', '3', '6', '7', '8'])
})
