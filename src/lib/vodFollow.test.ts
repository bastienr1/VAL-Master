/**
 * Unit tests for how a video follows the replay (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldSeekVideo, videoRateFor } from './vodFollow.ts'

test('the video runs at the replay speeds YouTube has, and waits at 4x', () => {
  for (const speed of [0.25, 0.5, 1, 2]) assert.equal(videoRateFor(speed), speed)
  assert.equal(videoRateFor(4), null)
})

test('running, a small drift is left alone and a large one is corrected at most once a second', () => {
  assert.equal(shouldSeekVideo(0.4, true, 5000), false)
  assert.equal(shouldSeekVideo(-0.9, true, 5000), true)
  assert.equal(shouldSeekVideo(0.9, true, 500), false)
})

test('still, the video goes to the very frame, throttled while scrubbing', () => {
  assert.equal(shouldSeekVideo(0.1, false, 5000), false)
  assert.equal(shouldSeekVideo(0.3, false, 200), true)
  assert.equal(shouldSeekVideo(0.3, false, 50), false)
})
