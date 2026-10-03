import test from 'node:test'
import assert from 'node:assert/strict'
import { buildShelves, formatDuration, readingOrder, type ShelfBlock } from './libraryShelves.ts'
import type { GuideCounts, ReferenceReview } from './types.ts'

// --------------------------------------------------------------------- fixtures

let nextId = 0

function review(overrides: Partial<ReferenceReview> = {}): ReferenceReview {
  nextId += 1
  return {
    id: `r${nextId}`,
    title: `Guide ${nextId}`,
    player: 'Dopai',
    team: null,
    agent: null,
    map: null,
    event: null,
    video_id: null,
    youtube_url: null,
    played_at: null,
    notes: null,
    notion_page_id: null,
    created_at: '2026-10-03T00:00:00Z',
    updated_at: null,
    source: 'vault',
    content_type: 'pro-review',
    creator: 'Dopai',
    vault_path: `Pro-Reviews/${nextId}.md`,
    series_order: null,
    duration_seconds: 600,
    focus: null,
    maps: null,
    agents: null,
    ...overrides,
  }
}

const DOPAI = 'Dopai · Zasko Coaching'
const ZASKO = 'zasko III · Coaching'

function corpus(): ReferenceReview[] {
  return [
    // Dopai: two entry (newest first in the playlist), one pacing
    review({ series: DOPAI, skill: 'entry', playlist_index: 13, published: '2024-09-17', map: 'Bind' }),
    review({ series: DOPAI, skill: 'entry', playlist_index: 12, published: '2024-09-25', map: 'Lotus' }),
    review({ series: DOPAI, skill: 'pacing', playlist_index: 11, published: '2024-10-06', map: 'Lotus' }),
    // zasko: two peeking, one entry (so entry spans two series in the skill view)
    review({ series: ZASKO, skill: 'peeking', playlist_index: 1, published: '2026-09-08', creator: 'zasko III' }),
    review({ series: ZASKO, skill: 'peeking', playlist_index: 3, published: '2026-08-17', creator: 'zasko III' }),
    review({ series: ZASKO, skill: 'entry', playlist_index: 7, published: '2026-04-05', creator: 'zasko III' }),
    // one zasko note with a skill the list does not know
    review({ series: ZASKO, skill: 'site-hits', playlist_index: 8, published: '2026-02-07', creator: 'zasko III' }),
    // a map guide, a standalone mechanics note with no skill, a pro VOD
    review({ content_type: 'map-guide', map: 'Abyss', creator: 'Slayer Key', skill: null }),
    review({ content_type: 'mechanics', creator: 'Viscose', skill: null, title: 'Perfect aim' }),
    review({ source: 'notion', content_type: null, creator: null, vault_path: null, player: 'TenZ', map: 'Abyss' }),
  ]
}

function countsFor(reviews: ReferenceReview[], drills = 2): Map<string, GuideCounts> {
  return new Map(reviews.map(r => [r.id, { chapters: 5, drills, activeDrills: 0 }]))
}

function titles(blocks: ShelfBlock[]): string[] {
  return blocks.map(block => block.title)
}

function sectionTitles(block: ShelfBlock): Array<string | null> {
  return block.sections.map(section => section.title)
}

function total(blocks: ShelfBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.stats.videos, 0)
}

// ----------------------------------------------------------------------- order

test('readingOrder is oldest upload first, then playlist position descending, then title', () => {
  const a = review({ published: '2024-09-17', playlist_index: 13 })
  const b = review({ published: '2024-09-25', playlist_index: 12 })
  const noDateHigh = review({ published: null, playlist_index: 9 })
  const noDateLow = review({ published: null, playlist_index: 2 })
  const bare1 = review({ published: null, playlist_index: null, title: 'Alpha' })
  const bare2 = review({ published: null, playlist_index: null, title: 'Beta' })

  const sorted = [bare2, noDateLow, b, bare1, noDateHigh, a].sort(readingOrder)
  assert.deepEqual(
    sorted.map(r => r.id),
    [a.id, b.id, noDateHigh.id, noDateLow.id, bare1.id, bare2.id],
  )
})

test('formatDuration rounds to minutes and leaves zero empty', () => {
  assert.equal(formatDuration(0), '')
  assert.equal(formatDuration(59 * 60 + 40), '1h')
  assert.equal(formatDuration(47 * 60), '47m')
  assert.equal(formatDuration(8 * 3600 + 32 * 60), '8h 32m')
})

// ---------------------------------------------------------------------- series

test('series view: one block per series, fullest first, then map playbooks, standalone and pro VODs', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'series')!

  assert.deepEqual(titles(blocks), [ZASKO, DOPAI, 'Map playbooks', 'Standalone', 'Pro VODs'])
  assert.equal(total(blocks), reviews.length)
})

test('series view: a series opens into skill sections, Mechanics first, with Unsorted last', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'series')!

  const zasko = blocks.find(b => b.title === ZASKO)!
  assert.deepEqual(sectionTitles(zasko), ['Peeking', 'Entry and site hits', 'Unsorted'])
  assert.equal(zasko.stats.videos, 4)
  assert.equal(zasko.stats.drills, 8)
  assert.equal(zasko.stats.durationSeconds, 2400)

  const dopai = blocks.find(b => b.title === DOPAI)!
  assert.deepEqual(sectionTitles(dopai), ['Entry and site hits', 'Pacing and timing'])
  // Reading order inside a section: #13 (2024-09-17) before #12 (2024-09-25).
  assert.deepEqual(dopai.sections[0].reviews.map(r => r.playlist_index), [13, 12])
})

test('series view: map playbooks group by map and standalone has no heading', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'series')!

  const playbooks = blocks.find(b => b.title === 'Map playbooks')!
  assert.deepEqual(sectionTitles(playbooks), ['Abyss'])

  const standalone = blocks.find(b => b.title === 'Standalone')!
  assert.deepEqual(sectionTitles(standalone), [null])
  assert.equal(standalone.sections[0].reviews[0].title, 'Perfect aim')
})

// ----------------------------------------------------------------------- skill

test('skill view: Mechanics and Game sense blocks, a skill followed across series, then the tails', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'skill')!

  assert.deepEqual(titles(blocks), ['Mechanics', 'Game sense', 'Map playbooks', 'Unsorted', 'Pro VODs'])
  assert.equal(total(blocks), reviews.length)

  const mechanics = blocks.find(b => b.title === 'Mechanics')!
  assert.deepEqual(sectionTitles(mechanics), ['Peeking'])

  const gameSense = blocks.find(b => b.title === 'Game sense')!
  assert.deepEqual(sectionTitles(gameSense), ['Entry and site hits', 'Pacing and timing'])
  // Entry: Dopai's two (series sorts first alphabetically) in reading order, then zasko's one.
  const entry = gameSense.sections[0].reviews
  assert.deepEqual(entry.map(r => `${r.series}#${r.playlist_index}`), [`${DOPAI}#13`, `${DOPAI}#12`, `${ZASKO}#7`])

  // The unknown value and the skill-less note both land in Unsorted, the typo named.
  const unsorted = blocks.find(b => b.title === 'Unsorted')!
  assert.deepEqual(sectionTitles(unsorted), ['site-hits', 'Unsorted'])
})

// ------------------------------------------------------------------------- map

test('map view: every source, fullest map first, No map last', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'map')!

  assert.deepEqual(titles(blocks), ['No map', 'Abyss', 'Lotus', 'Bind'].sort((a, b) => {
    // expected: Lotus 2, Abyss 2 (alphabetical tie), Bind 1, No map last
    const order = ['Abyss', 'Lotus', 'Bind', 'No map']
    return order.indexOf(a) - order.indexOf(b)
  }))
  assert.equal(total(blocks), reviews.length)
  assert.equal(blocks.find(b => b.title === 'Abyss')!.stats.videos, 2)
})

// --------------------------------------------------------------------- watched

test('a series with nothing watched counts 0 and points at its first episode', () => {
  const reviews = corpus()
  const blocks = buildShelves(reviews, countsFor(reviews), 'series')!
  const dopai = blocks.find(b => b.title === DOPAI)!

  assert.equal(dopai.watched, 0)
  // #13 is the oldest upload, whatever section it sits in.
  assert.equal(dopai.upNextId, reviews.find(r => r.playlist_index === 13)!.id)
  // Not a series: no progress fields at all.
  assert.equal(blocks.find(b => b.title === 'Map playbooks')!.upNextId, undefined)
})

test('a half-watched series skips watched episodes in reading order', () => {
  const reviews = corpus()
  const byIndex = (n: number) => reviews.find(r => r.series === DOPAI && r.playlist_index === n)!.id
  const watched = new Set([byIndex(13), byIndex(11)]) // first and third episodes
  const blocks = buildShelves(reviews, countsFor(reviews), 'series', watched)!
  const dopai = blocks.find(b => b.title === DOPAI)!

  assert.equal(dopai.watched, 2)
  assert.equal(dopai.upNextId, byIndex(12))
})

test('a fully watched series has no up next', () => {
  const reviews = corpus()
  const watched = new Set(reviews.filter(r => r.series === DOPAI).map(r => r.id))
  const blocks = buildShelves(reviews, countsFor(reviews), 'series', watched)!
  const dopai = blocks.find(b => b.title === DOPAI)!

  assert.equal(dopai.watched, 3)
  assert.equal(dopai.upNextId, null)
})

// ------------------------------------------------------------------------ date

test('date view is the flat grid: null', () => {
  const reviews = corpus()
  assert.equal(buildShelves(reviews, countsFor(reviews), 'date'), null)
})

test('an empty library gives no blocks, and a filtered-out block disappears', () => {
  assert.deepEqual(buildShelves([], new Map(), 'series'), [])
  const onlyNotion = [review({ source: 'notion', vault_path: null })]
  assert.deepEqual(titles(buildShelves(onlyNotion, countsFor(onlyNotion), 'skill')!), ['Pro VODs'])
})
