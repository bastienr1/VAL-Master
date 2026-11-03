/**
 * Unit tests for the Plays editor's undo history (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { canRedo, canUndo, historyOf, pushHistory, redoHistory, undoHistory, HISTORY_CAP } from './playHistory.ts'

test('a fresh history has nothing to undo or redo', () => {
  const h = historyOf('a')
  assert.equal(h.present, 'a')
  assert.equal(canUndo(h), false)
  assert.equal(canRedo(h), false)
})

test('push, undo and redo walk the values', () => {
  let h = historyOf('a')
  h = pushHistory(h, 'b')
  h = pushHistory(h, 'c')
  assert.deepEqual(h.past, ['a', 'b'])
  h = undoHistory(h)
  assert.equal(h.present, 'b')
  h = undoHistory(h)
  assert.equal(h.present, 'a')
  assert.equal(canUndo(h), false)
  h = redoHistory(h)
  assert.equal(h.present, 'b')
  h = redoHistory(h)
  assert.equal(h.present, 'c')
  assert.equal(canRedo(h), false)
})

test('a push after an undo clears the redo side', () => {
  let h = pushHistory(pushHistory(historyOf('a'), 'b'), 'c')
  h = undoHistory(h)
  h = pushHistory(h, 'd')
  assert.equal(h.present, 'd')
  assert.equal(canRedo(h), false)
  assert.deepEqual(h.past, ['a', 'b'])
})

test('pushing the present itself is no change', () => {
  const h = pushHistory(historyOf('a'), 'b')
  assert.equal(pushHistory(h, h.present), h)
})

test('undo and redo with nothing to do give the history back', () => {
  const h = historyOf('a')
  assert.equal(undoHistory(h), h)
  assert.equal(redoHistory(h), h)
})

test('the past is capped, oldest dropped', () => {
  let h = historyOf(0)
  for (let i = 1; i <= HISTORY_CAP + 10; i++) h = pushHistory(h, i)
  assert.equal(h.past.length, HISTORY_CAP)
  assert.equal(h.past[0], 10)
  assert.equal(h.present, HISTORY_CAP + 10)
})

test('pushes with the same key coalesce into one undo step', () => {
  let h = historyOf('')
  h = pushHistory(h, 'S', 'caption:setup')
  h = pushHistory(h, 'Sm', 'caption:setup')
  h = pushHistory(h, 'Smo', 'caption:setup')
  assert.equal(h.present, 'Smo')
  assert.deepEqual(h.past, [''])
  h = undoHistory(h)
  assert.equal(h.present, '')
})

test('a different key, no key, or an undo ends the run', () => {
  let h = historyOf('a')
  h = pushHistory(h, 'b', 'k1')
  h = pushHistory(h, 'c', 'k2')
  assert.deepEqual(h.past, ['a', 'b'])
  h = pushHistory(h, 'd')
  h = pushHistory(h, 'e', 'k2')
  assert.deepEqual(h.past, ['a', 'b', 'c', 'd'])
  h = undoHistory(h)
  h = pushHistory(h, 'f', 'k2')
  assert.deepEqual(h.past, ['a', 'b', 'c', 'd'])
  assert.equal(h.present, 'f')
})
