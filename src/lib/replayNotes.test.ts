/**
 * Unit tests for placing a match's notes on the replay's clock (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { replayNoteMarks } from './replayNotes.ts'
import type { ReplayBundle } from './replayBundle.ts'
import type { MomentTag, ReviewTag, VodComment } from './types.ts'

// Round 1's barrier drops at 45 s on the replay's clock.
const bundle = { rounds: [{ n: 1, barrierMs: 45000 }] } as unknown as ReplayBundle
// ...and at 100 s on the video's.
const OFFSET = 100

const note = (over: Partial<VodComment>) => ({ id: 'n', timestamp_seconds: 100, free_text: null, tags: [], ...over }) as VodComment
const moment = (over: Partial<MomentTag>) => ({ id: 'm', tag_id: 't', video_ts: 100, note_id: null, ...over }) as MomentTag
const TAGS = [{ id: 't', name: 'retake', color: '#FF4655' }] as ReviewTag[]

test('a note lands on the replay moment its video second shows', () => {
  const [mark] = replayNoteMarks(bundle, OFFSET, [note({ timestamp_seconds: 112, free_text: 'too slow' })], [], [])
  assert.equal(mark.t, 57000)
  assert.equal(mark.label, 'too slow')
  assert.equal(mark.color, null)
})

test("a long or multi-line note is named by a short first line", () => {
  const [multi, long] = replayNoteMarks(bundle, OFFSET, [note({ id: 'a', free_text: 'first\nsecond' }), note({ id: 'b', free_text: 'x'.repeat(200) })], [], [])
  assert.equal(multi.label, 'first')
  assert.equal(long.label.length, 80)
  assert.ok(long.label.endsWith('…'))
})

test('a note with no text is named by its tags', () => {
  const [tagged, bare] = replayNoteMarks(bundle, OFFSET, [note({ id: 'a', tags: ['strength', 'timing'] }), note({ id: 'b' })], [], [])
  assert.equal(tagged.label, 'strength, timing')
  assert.equal(bare.label, 'Note')
})

test('a quick-dropped moment gets a mark in its tag colour', () => {
  const [mark] = replayNoteMarks(bundle, OFFSET, [], [moment({ video_ts: 90 })], TAGS)
  assert.deepEqual(mark, { id: 'm', t: 35000, label: 'retake', color: '#FF4655' })
})

test('a moment tag on a note adds no second mark', () => {
  assert.equal(replayNoteMarks(bundle, OFFSET, [], [moment({ note_id: 'n' })], TAGS).length, 0)
})
