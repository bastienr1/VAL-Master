/**
 * Unit tests for the note-edit tag diff (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { diffNoteTags, seedTagIds } from './noteTagDiff.ts'
import type { MomentTag } from './types.ts'

function moment(id: string, tagId: string): MomentTag {
  return {
    id,
    tag_id: tagId,
    review_type: 'vod',
    review_id: 'match-1',
    video_ts: 90,
    note_id: 'note-1',
  } as MomentTag
}

test('no change → nothing to write', () => {
  const current = [moment('m1', 'attack'), moment('m2', 'b-site')]
  assert.deepEqual(diffNoteTags(current, ['b-site', 'attack']), { toAdd: [], toRemove: [] })
})

test('adding a tag to an untagged note', () => {
  assert.deepEqual(diffNoteTags([], ['rush']), { toAdd: ['rush'], toRemove: [] })
})

test('swap one tag for another', () => {
  const current = [moment('m1', 'attack'), moment('m2', 'rush')]
  const diff = diffNoteTags(current, ['attack', 'default'])
  assert.deepEqual(diff.toAdd, ['default'])
  assert.deepEqual(diff.toRemove.map(m => m.id), ['m2'])
})

test('clearing every tag removes every row, never the note', () => {
  const current = [moment('m1', 'attack'), moment('m2', 'rush')]
  const diff = diffNoteTags(current, [])
  assert.deepEqual(diff.toAdd, [])
  assert.deepEqual(diff.toRemove.map(m => m.id), ['m1', 'm2'])
})

test('duplicate selections collapse to one add', () => {
  assert.deepEqual(diffNoteTags([], ['rush', 'rush']).toAdd, ['rush'])
})

test('seed dedupes by tag', () => {
  assert.deepEqual(seedTagIds([moment('m1', 'a'), moment('m2', 'b'), moment('m3', 'a')]), ['a', 'b'])
})
