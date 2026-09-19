import test from 'node:test'
import assert from 'node:assert/strict'
import { extractYouTubeId } from './youtubeId.ts'

const ID = 'dQw4w9WgXcQ'

test('extractYouTubeId reads the standard watch URL', () => {
  assert.equal(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}`), ID)
})

test('extractYouTubeId strips share and tracking params', () => {
  // The two shapes that actually arrive from the Notion database.
  assert.equal(extractYouTubeId(`https://youtu.be/${ID}?si=Ab3dEfGhIjKlMnOp`), ID)
  assert.equal(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=42s`), ID)
})

test('extractYouTubeId finds v= when it is not the first query param', () => {
  assert.equal(extractYouTubeId(`https://www.youtube.com/watch?app=desktop&v=${ID}`), ID)
})

test('extractYouTubeId handles embed, shorts and live paths', () => {
  assert.equal(extractYouTubeId(`https://www.youtube.com/embed/${ID}`), ID)
  assert.equal(extractYouTubeId(`https://www.youtube.com/shorts/${ID}`), ID)
  assert.equal(extractYouTubeId(`https://www.youtube.com/live/${ID}`), ID)
})

test('extractYouTubeId returns null for links with no video', () => {
  assert.equal(extractYouTubeId(''), null)
  assert.equal(extractYouTubeId('https://vlr.gg/12345'), null)
  assert.equal(extractYouTubeId('https://www.youtube.com/@channel'), null)
})

test('a bare id is only accepted when the caller opts in', () => {
  // The seeder opts in (a Notion cell may hold just the id); the app does not,
  // so an arbitrary 11-character word never looks like a valid video.
  assert.equal(extractYouTubeId(ID), null)
  assert.equal(extractYouTubeId(ID, { allowBareId: true }), ID)
  assert.equal(extractYouTubeId('hello world', { allowBareId: true }), null)
})
