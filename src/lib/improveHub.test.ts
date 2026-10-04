import test from 'node:test'
import assert from 'node:assert/strict'
import { HUB_MAX, blockIcon, metaLine, pickGuides, pickPlaybooks, pickProVods, youtubeThumbnail } from './improveHub.ts'
import { SEED_BLOCKS } from './weeklyPlan.ts'
import type { ReferenceReview } from './types.ts'

// --------------------------------------------------------------------- fixtures

let seq = 0
function review(patch: Partial<ReferenceReview>): ReferenceReview {
  seq += 1
  return {
    id: `rr-${seq}`,
    title: null,
    player: 'TenZ',
    map: 'Ascent',
    agent: null,
    played_at: null,
    source: 'notion',
    content_type: null,
    ...patch,
  } as ReferenceReview
}

const guide = (patch: Partial<ReferenceReview> = {}) =>
  review({ source: 'vault', content_type: 'map-guide', player: 'Guide', ...patch })

// -------------------------------------------------------------------- playbooks

test('pickPlaybooks runs newest update first, then by name', () => {
  const all = [
    { name: 'Old', updated_at: '2026-09-01T10:00:00Z' },
    { name: 'Bravo', updated_at: '2026-10-01T10:00:00Z' },
    { name: 'Alpha', updated_at: '2026-10-01T10:00:00Z' },
    { name: 'Newest', updated_at: '2026-10-03T10:00:00Z' },
    { name: 'Undated', updated_at: null },
    { name: 'Middle', updated_at: '2026-09-15T10:00:00Z' },
  ]
  const picked = pickPlaybooks(all)
  assert.deepEqual(
    picked.map(p => p.name),
    ['Newest', 'Alpha', 'Bravo', 'Middle', 'Old', 'Undated'],
  )
  // The input is left as it was.
  assert.equal(all[0].name, 'Old')
})

test('pickPlaybooks puts a playbook with no date last', () => {
  const picked = pickPlaybooks([{ name: 'Undated' }, { name: 'Dated', updated_at: '2026-01-01T00:00:00Z' }])
  assert.deepEqual(
    picked.map(p => p.name),
    ['Dated', 'Undated'],
  )
})

// ---------------------------------------------------------------- guides, VODs

test('pickGuides holds vault guides only, newest first', () => {
  const reviews = [
    review({ id: 'notion', played_at: '2026-10-04' }), // a pro VOD, however new
    guide({ id: 'g-sep', played_at: '2026-09-10' }),
    guide({ id: 'g-oct', played_at: '2026-10-02' }),
    guide({ id: 'g-pro-review', content_type: 'pro-review', played_at: '2026-09-20' }),
    guide({ id: 'mechanics', content_type: 'mechanics', played_at: '2026-10-03' }), // stays in Pro Study
    guide({ id: 'g-aug', played_at: '2026-08-01' }),
    guide({ id: 'g-jul', played_at: '2026-07-01' }),
  ]
  assert.deepEqual(
    pickGuides(reviews).map(r => r.id),
    ['g-oct', 'g-pro-review', 'g-sep', 'g-aug', 'g-jul'],
  )
})

test('pickProVods holds Notion rows only, newest first', () => {
  const reviews = [
    guide({ id: 'vault', played_at: '2026-10-04' }), // a guide, however new
    review({ id: 'p-may', played_at: '2026-05-01' }),
    review({ id: 'p-sep', played_at: '2026-09-01' }),
    review({ id: 'p-jun', played_at: '2026-06-01' }),
    review({ id: 'p-jul', played_at: '2026-07-01' }),
    review({ id: 'p-apr', played_at: '2026-04-01' }),
  ]
  assert.deepEqual(
    pickProVods(reviews).map(r => r.id),
    ['p-sep', 'p-jul', 'p-jun', 'p-may', 'p-apr'],
  )
})

test('rows with no date sort last, by player', () => {
  const reviews = [
    review({ id: 'zekken', player: 'zekken' }),
    review({ id: 'dated', player: 'yay', played_at: '2026-03-01' }),
    review({ id: 'aspas', player: 'aspas' }),
  ]
  assert.deepEqual(
    pickProVods(reviews).map(r => r.id),
    ['dated', 'aspas', 'zekken'],
  )
  assert.deepEqual(
    pickGuides([guide({ id: 'undated' }), guide({ id: 'dated', played_at: '2026-01-01' })]).map(r => r.id),
    ['dated', 'undated'],
  )
})

test('every row stops at the carousel size', () => {
  const days = Array.from({ length: HUB_MAX + 3 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
  assert.equal(pickPlaybooks(days.map(day => ({ name: day, updated_at: day }))).length, HUB_MAX)
  assert.equal(pickGuides(days.map(day => guide({ played_at: day }))).length, HUB_MAX)
  const vods = pickProVods(days.map(day => review({ played_at: day })))
  assert.equal(vods.length, HUB_MAX)
  // The newest are the ones kept.
  assert.equal(vods[0].played_at, days[days.length - 1])
})

test('an empty library gives empty rows', () => {
  assert.deepEqual(pickGuides([]), [])
  assert.deepEqual(pickProVods([]), [])
  assert.deepEqual(pickPlaybooks([]), [])
})

// ------------------------------------------------------------------- block icon

test('blockIcon reads the five starter blocks', () => {
  assert.deepEqual(
    SEED_BLOCKS.map(seed => blockIcon(seed.name)),
    ['crosshair', 'skull', 'bars', 'rank', 'play'],
  )
})

test('blockIcon ignores case and knows the short names', () => {
  assert.equal(blockIcon('DEATHMATCH'), 'skull')
  assert.equal(blockIcon('dm'), 'skull')
  assert.equal(blockIcon('Team DM'), 'skull')
  assert.equal(blockIcon('Comp'), 'rank')
  assert.equal(blockIcon('Pro VOD'), 'play')
  assert.equal(blockIcon('KovaaK aim'), 'bars')
})

test('blockIcon falls back to the target', () => {
  assert.equal(blockIcon('Stretching'), 'target')
  assert.equal(blockIcon('Admin'), 'target') // "dm" inside a word is not a deathmatch
  assert.equal(blockIcon(''), 'target')
})

// ------------------------------------------------------------------ card pieces

test('youtubeThumbnail needs an id', () => {
  assert.equal(youtubeThumbnail('abc123DEF45'), 'https://i.ytimg.com/vi/abc123DEF45/mqdefault.jpg')
  assert.equal(youtubeThumbnail(null), null)
  assert.equal(youtubeThumbnail('  '), null)
})

test('metaLine skips the parts that are missing', () => {
  assert.equal(metaLine(['Dopai', 'Ascent', 'Clove']), 'Dopai · Ascent · Clove')
  assert.equal(metaLine(['Dopai', null, ' ', 'Clove']), 'Dopai · Clove')
  assert.equal(metaLine([null, undefined]), '')
})
