/**
 * Unit tests for the per-map content grouping.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_MAP_CONTENT,
  contentForMap,
  filterContentByAgent,
  groupContentByMap,
  isMapGuide,
  isProVod,
  isVideoGuide,
  mapFromSlug,
  mapSlug,
  sameMap,
  sortMapsForPortal,
  studyMaterialCount,
} from './mapContent.ts'
import type { HomeMatch } from './homeStats.ts'
import type { PlaybookWithCount, ReferenceReview } from './types.ts'

let seq = 0

function playbook(map: string | null, patch: Partial<PlaybookWithCount> = {}): PlaybookWithCount {
  seq++
  return { id: `pb-${seq}`, name: `Playbook ${seq}`, slug: `pb-${seq}`, map, chapter_count: 3, ...patch } as PlaybookWithCount
}

function review(patch: Partial<ReferenceReview>): ReferenceReview {
  seq++
  return { id: `rr-${seq}`, player: 'TenZ', map: 'Ascent', agent: null, source: 'notion', content_type: null, ...patch } as ReferenceReview
}

function match(patch: Partial<HomeMatch>): HomeMatch {
  seq++
  return {
    id: `row-${seq}`,
    match_id: `riot-${seq}`,
    match_date: '2026-07-01T12:00:00Z',
    map: 'Ascent',
    map_id: null,
    agent: 'Raze',
    agent_id: null,
    result: 'W',
    score: '13-5',
    acs: 250,
    kills: 20,
    deaths: 12,
    assists: 5,
    kda: 2.08,
    headshot_pct: 25,
    ...patch,
  }
}

function registryOf(...names: string[]) {
  const maps = names.map(name => ({ uuid: `uuid-${name}`, name }))
  return {
    maps: {
      byId: new Map(maps.map(m => [m.uuid, m])),
      byName: new Map(maps.map(m => [m.name.trim().toLowerCase(), m])),
    },
  }
}

test('sameMap ignores case and whitespace', () => {
  assert.equal(sameMap('Ascent', 'ascent'), true)
  assert.equal(sameMap('  ASCENT ', 'Ascent'), true)
  assert.equal(sameMap('Ascent', 'Haven'), false)
})

test('sameMap never matches a missing map', () => {
  assert.equal(sameMap(null, null), false)
  assert.equal(sameMap(null, 'Ascent'), false)
  assert.equal(sameMap('Ascent', undefined), false)
  assert.equal(sameMap('', ''), false)
  assert.equal(sameMap('   ', '   '), false)
})

test('isProVod and isMapGuide never both claim a row', () => {
  const sources = ['notion', 'vault'] as const
  const types = [null, 'map-guide', 'pro-review', 'agent-guide', 'mechanics', 'mindset'] as const
  for (const source of sources) {
    for (const content_type of types) {
      const row = { source, content_type }
      assert.equal(isProVod(row) && isMapGuide(row), false, `${source}/${content_type}`)
    }
  }
  assert.equal(isProVod({ source: 'notion', content_type: null }), true)
  // A vault pro review is a coaching breakdown, not a match: a video guide.
  assert.equal(isProVod({ source: 'vault', content_type: 'pro-review' }), false)
  assert.equal(isVideoGuide({ source: 'vault', content_type: 'pro-review' }), true)
  assert.equal(isVideoGuide({ source: 'vault', content_type: 'map-guide' }), true)
  assert.equal(isVideoGuide({ source: 'notion', content_type: null }), false)
  assert.equal(isMapGuide({ source: 'vault', content_type: 'map-guide' }), true)
  assert.equal(isMapGuide({ source: 'vault', content_type: 'mechanics' }), false)
})

test('slugs resolve through the registry in any letter case', () => {
  const registry = registryOf('Ascent', 'Haven')
  assert.equal(mapSlug('Ascent'), 'ascent')
  assert.equal(mapFromSlug('ascent', registry)?.name, 'Ascent')
  assert.equal(mapFromSlug('HAVEN', registry)?.name, 'Haven')
  assert.equal(mapFromSlug('nowhere', registry), null)
  assert.equal(mapFromSlug('', registry), null)
})

test('a map name with a space still round-trips through its slug', () => {
  const registry = registryOf('Ascent', 'New Map')
  assert.equal(mapSlug('New Map'), 'new-map')
  assert.equal(mapFromSlug(mapSlug('New Map'), registry)?.name, 'New Map')
})

test('content is grouped onto its map across all three tables', () => {
  const reviewed = match({ match_id: 'riot-a' })
  const grouped = groupContentByMap({
    playbooks: [playbook('Ascent'), playbook('ascent'), playbook('Haven')],
    reviews: [
      review({ map: 'Ascent', source: 'notion' }),
      review({ map: ' ascent ', source: 'vault', content_type: 'map-guide' }),
      review({ map: 'Haven', source: 'vault', content_type: 'pro-review' }),
    ],
    matches: [reviewed, match({ map: 'ASCENT' }), match({ map: 'Haven' })],
    reviewedMatchIds: new Set(['riot-a']),
  })

  const ascent = contentForMap(grouped, 'Ascent')
  assert.equal(ascent.playbooks.length, 2)
  assert.equal(ascent.guides.length, 1)
  assert.equal(ascent.proVods.length, 1)
  assert.equal(ascent.myVods.length, 2)

  // Haven's pro review is a video guide: the playbook and it make two.
  const haven = contentForMap(grouped, 'haven')
  assert.equal(haven.proVods.length, 0)
  assert.deepEqual(haven.counts, { guides: 2, proVods: 0, myVods: 1 })
})

test('the agent chip keeps map guides whatever they name, and narrows pro reviews', () => {
  const grouped = groupContentByMap({
    playbooks: [],
    reviews: [
      review({ source: 'vault', content_type: 'map-guide', agent: 'Sova' }),
      review({ source: 'vault', content_type: 'pro-review', agent: 'Clove' }),
      review({ source: 'vault', content_type: 'pro-review', agent: 'Jett' }),
      review({ source: 'vault', content_type: 'pro-review', agent: null }),
    ],
    matches: [],
    reviewedMatchIds: new Set(),
  })
  const all = contentForMap(grouped, 'Ascent')
  assert.equal(all.guides.length, 4)

  const clove = filterContentByAgent(all, 'clove')
  assert.deepEqual(
    clove.guides.map(r => [r.content_type, r.agent]),
    [
      ['map-guide', 'Sova'],
      ['pro-review', 'Clove'],
      ['pro-review', null],
    ],
  )
  assert.equal(clove.counts.guides, 3)
})

test('counts equal the list lengths', () => {
  const grouped = groupContentByMap({
    playbooks: [playbook('Ascent'), playbook('Ascent')],
    reviews: [
      review({ source: 'vault', content_type: 'map-guide' }),
      review({ source: 'notion' }),
      review({ source: 'notion' }),
      review({ source: 'notion' }),
    ],
    matches: [match({}), match({}), match({}), match({})],
    reviewedMatchIds: new Set(),
  })
  const ascent = contentForMap(grouped, 'Ascent')
  assert.equal(ascent.counts.guides, ascent.playbooks.length + ascent.guides.length)
  assert.equal(ascent.counts.proVods, ascent.proVods.length)
  assert.equal(ascent.counts.myVods, ascent.myVods.length)
  assert.deepEqual(ascent.counts, { guides: 3, proVods: 3, myVods: 4 })
})

test('a row with no map lands on no map', () => {
  const grouped = groupContentByMap({
    playbooks: [playbook(null), playbook('  ')],
    reviews: [review({ map: null }), review({ map: '' })],
    matches: [],
    reviewedMatchIds: new Set(),
  })
  assert.equal(grouped.size, 0)
})

test('vault notes that are not map guides or pro reviews stay off the hub', () => {
  const grouped = groupContentByMap({
    playbooks: [],
    reviews: [
      review({ source: 'vault', content_type: 'mechanics' }),
      review({ source: 'vault', content_type: 'agent-guide' }),
      review({ source: 'vault', content_type: null }),
    ],
    matches: [],
    reviewedMatchIds: new Set(),
  })
  assert.deepEqual(contentForMap(grouped, 'Ascent').counts, { guides: 0, proVods: 0, myVods: 0 })
})

test('a map with nothing reads as empty rather than missing', () => {
  assert.equal(contentForMap(new Map(), 'Pearl'), EMPTY_MAP_CONTENT)
})

test('your VODs put reviewed matches first, then newest first', () => {
  const oldReviewed = match({ match_id: 'old-reviewed', match_date: '2026-06-01T12:00:00Z' })
  const newPlain = match({ match_id: 'new-plain', match_date: '2026-07-10T12:00:00Z' })
  const newReviewed = match({ match_id: 'new-reviewed', match_date: '2026-07-05T12:00:00Z' })
  const oldPlain = match({ match_id: 'old-plain', match_date: '2026-05-01T12:00:00Z' })

  const grouped = groupContentByMap({
    playbooks: [],
    reviews: [],
    matches: [oldPlain, oldReviewed, newPlain, newReviewed],
    reviewedMatchIds: new Set(['old-reviewed', 'new-reviewed']),
  })
  assert.deepEqual(
    contentForMap(grouped, 'Ascent').myVods.map(v => v.match.match_id),
    ['new-reviewed', 'old-reviewed', 'new-plain', 'old-plain'],
  )
})

test('maps sort by study material, then matches played, then name', () => {
  const grouped = groupContentByMap({
    playbooks: [playbook('Lotus'), playbook('Lotus')],
    reviews: [review({ map: 'Haven', source: 'notion' })],
    matches: [
      // Ascent: played most, studied least.
      match({ map: 'Ascent' }),
      match({ map: 'Ascent' }),
      match({ map: 'Ascent' }),
      match({ map: 'Haven', match_id: 'haven-reviewed' }),
      match({ map: 'Bind' }),
    ],
    reviewedMatchIds: new Set(['haven-reviewed']),
  })
  const maps = ['Ascent', 'Bind', 'Breeze', 'Haven', 'Lotus', 'Abyss'].map(name => ({ name }))

  assert.equal(studyMaterialCount(contentForMap(grouped, 'Ascent')), 0)
  assert.equal(studyMaterialCount(contentForMap(grouped, 'Haven')), 2)
  assert.deepEqual(
    sortMapsForPortal(maps, grouped).map(m => m.name),
    ['Haven', 'Lotus', 'Ascent', 'Bind', 'Abyss', 'Breeze'],
  )
})

test('the agent filter narrows pro VODs and your VODs only', () => {
  const grouped = groupContentByMap({
    playbooks: [playbook('Ascent', { agent: 'Sova' })],
    reviews: [
      review({ source: 'vault', content_type: 'map-guide', agent: 'Sova' }),
      review({ source: 'notion', agent: 'Raze' }),
      review({ source: 'notion', agent: 'Jett' }),
      review({ source: 'notion', agent: null }),
    ],
    matches: [match({ agent: 'Raze' }), match({ agent: 'raze' }), match({ agent: 'Fade' })],
    reviewedMatchIds: new Set(),
  })
  const ascent = contentForMap(grouped, 'Ascent')
  const raze = filterContentByAgent(ascent, 'Raze')

  assert.equal(raze.playbooks.length, 1)
  assert.equal(raze.guides.length, 1)
  assert.equal(raze.proVods.length, 1)
  assert.equal(raze.myVods.length, 2)
  assert.deepEqual(raze.counts, { guides: 2, proVods: 1, myVods: 2 })
  assert.equal(filterContentByAgent(ascent, null), ascent)
})
