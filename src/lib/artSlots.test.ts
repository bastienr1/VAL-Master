/**
 * Unit tests for the art slot rules.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STATIC_SLOTS,
  artCandidates,
  artStoragePath,
  bundledArtUrl,
  clamp01,
  focalFromClick,
  mapHeaderSlotSpec,
  mapSlotSpec,
  pickActiveSlots,
  slotRowStatus,
  validateArtFile,
  type ArtSlotRow,
} from './artSlots.ts'

const NOW = new Date('2026-10-02T12:00:00Z')

let seq = 0

function row(patch: Partial<ArtSlotRow>): ArtSlotRow {
  seq++
  return {
    id: `row-${seq}`,
    user_id: 'user-1',
    slot_key: 'hero.background',
    image_url: `https://example.com/${seq}.webp`,
    storage_path: null,
    focal_x: 0.5,
    focal_y: 0.5,
    overlay: 0.55,
    href: null,
    label: null,
    active_from: '2026-10-01T00:00:00Z',
    active_until: null,
    created_at: '2026-10-01T00:00:00Z',
    ...patch,
  }
}

test('the newest row in its window wins the slot', () => {
  const older = row({ active_from: '2026-09-01T00:00:00Z' })
  const newer = row({ active_from: '2026-10-01T00:00:00Z' })
  assert.equal(pickActiveSlots([older, newer], NOW).get('hero.background'), newer)
  assert.equal(pickActiveSlots([newer, older], NOW).get('hero.background'), newer)
})

test('a row scheduled for tomorrow leaves today unchanged', () => {
  const current = row({ active_from: '2026-09-01T00:00:00Z' })
  const tomorrow = row({ active_from: '2026-10-03T12:00:00Z' })
  assert.equal(pickActiveSlots([current, tomorrow], NOW).get('hero.background'), current)

  const dayAfter = new Date('2026-10-03T12:00:01Z')
  assert.equal(pickActiveSlots([current, tomorrow], dayAfter).get('hero.background'), tomorrow)
})

test('an expired row hands the slot back to the one beneath it', () => {
  const base = row({ active_from: '2026-08-01T00:00:00Z' })
  const seasonal = row({ active_from: '2026-09-01T00:00:00Z', active_until: '2026-10-02T12:00:00Z' })
  // active_until is exclusive: at that instant the seasonal row is already gone.
  assert.equal(pickActiveSlots([base, seasonal], NOW).get('hero.background'), base)
  assert.equal(pickActiveSlots([base, seasonal], new Date('2026-10-02T11:59:59Z')).get('hero.background'), seasonal)
})

test('a slot with no row in its window has no override', () => {
  const expired = row({ active_from: '2026-08-01T00:00:00Z', active_until: '2026-09-01T00:00:00Z' })
  assert.equal(pickActiveSlots([expired], NOW).size, 0)
})

test('slots are resolved independently', () => {
  const hero = row({ slot_key: 'hero.background' })
  const tile = row({ slot_key: 'tile.stats' })
  const active = pickActiveSlots([hero, tile], NOW)
  assert.equal(active.get('hero.background'), hero)
  assert.equal(active.get('tile.stats'), tile)
})

test('rows saved for the same instant fall back to created_at', () => {
  const first = row({ created_at: '2026-10-01T00:00:00Z' })
  const second = row({ created_at: '2026-10-01T00:00:05Z' })
  assert.equal(pickActiveSlots([second, first], NOW).get('hero.background'), second)
})

test('slotRowStatus names where each row stands', () => {
  const covered = row({ active_from: '2026-08-01T00:00:00Z' })
  const live = row({ active_from: '2026-10-01T00:00:00Z' })
  const scheduled = row({ active_from: '2026-11-01T00:00:00Z' })
  const expired = row({ active_from: '2026-07-01T00:00:00Z', active_until: '2026-08-01T00:00:00Z' })
  const rows = [covered, live, scheduled, expired]

  assert.equal(slotRowStatus(live, rows, NOW), 'live')
  assert.equal(slotRowStatus(covered, rows, NOW), 'covered')
  assert.equal(slotRowStatus(scheduled, rows, NOW), 'scheduled')
  assert.equal(slotRowStatus(expired, rows, NOW), 'expired')
})

test('candidates run override → api → bundled', () => {
  const override = row({ image_url: 'https://example.com/mine.webp' })
  assert.deepEqual(artCandidates('map.abc', override, 'https://api/map.png'), [
    { src: 'https://example.com/mine.webp', source: 'override' },
    { src: 'https://api/map.png', source: 'api' },
    { src: '/art/map.abc.webp', source: 'bundled' },
  ])
})

test('a slot with no override and no api image starts at the bundled file', () => {
  assert.deepEqual(artCandidates('tile.stats', null, null), [{ src: '/art/tile.stats.webp', source: 'bundled' }])
  assert.deepEqual(artCandidates('tile.stats', undefined), [{ src: '/art/tile.stats.webp', source: 'bundled' }])
})

test('every static slot has a distinct key and a bundled path', () => {
  const keys = STATIC_SLOTS.map(s => s.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(keys, ['hero.background', 'tile.playbook', 'tile.stats', 'tile.provod', 'tile.goals', 'cta.banner', 'improve.hero'])
  assert.equal(bundledArtUrl('hero.background'), '/art/hero.background.webp')
})

test('a map has a card slot and a separate, wide page-header slot', () => {
  const header = mapHeaderSlotSpec('abc', 'Haven')
  assert.equal(header.key, 'mapheader.abc')
  assert.notEqual(header.key, mapSlotSpec('abc', 'Haven').key)
  assert.equal(header.width / header.height, 4)
  assert.equal(header.scrim, 'left')
})

test('validateArtFile enforces type and the 5 MB limit', () => {
  assert.equal(validateArtFile({ size: 300_000, type: 'image/webp' }), null)
  assert.equal(validateArtFile({ size: 5 * 1024 * 1024, type: 'image/png' }), null)
  assert.equal(validateArtFile({ size: 5 * 1024 * 1024 + 1, type: 'image/png' }), 'That image is 5.1 MB. The limit is 5 MB.')
  assert.match(validateArtFile({ size: 12 * 1024 * 1024, type: 'image/png' })!, /12.0 MB/)
  assert.match(validateArtFile({ size: 10, type: 'image/gif' })!, /WebP, PNG or JPEG/)
})

test('storage paths start with the owner, which the bucket policies key on', () => {
  assert.equal(artStoragePath('user-1', 'hero.background', 'image/jpeg', 1700000000000), 'user-1/hero.background/1700000000000.jpg')
  assert.equal(artStoragePath('user-1', 'map.abc', 'image/webp', 5), 'user-1/map.abc/5.webp')
})

test('clamp01 keeps focal points and overlay inside the table check', () => {
  assert.equal(clamp01(-0.2), 0)
  assert.equal(clamp01(1.4), 1)
  assert.equal(clamp01(0.3), 0.3)
})

const near = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} ≠ ${expected.x}`)
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} ≠ ${expected.y}`)
}

test('a click on an uncropped image is its own focal point', () => {
  const frame = { width: 400, height: 200 }
  near(focalFromClick({ x: 0.25, y: 0.75 }, frame, { width: 800, height: 400 }, { x: 0.5, y: 0.5 }), { x: 0.25, y: 0.75 })
})

test('a click on a cropped image accounts for the part outside the frame', () => {
  // A 2:1 image in a 1:1 frame: half of its width is cropped away.
  const frame = { width: 200, height: 200 }
  const image = { width: 400, height: 200 }

  // Centred: the frame shows the image from 25% to 75% across.
  near(focalFromClick({ x: 0, y: 0.5 }, frame, image, { x: 0.5, y: 0.5 }), { x: 0.25, y: 0.5 })
  near(focalFromClick({ x: 1, y: 0.5 }, frame, image, { x: 0.5, y: 0.5 }), { x: 0.75, y: 0.5 })
  // Pinned left: the frame shows 0% to 50%.
  near(focalFromClick({ x: 1, y: 0.5 }, frame, image, { x: 0, y: 0.5 }), { x: 0.5, y: 0.5 })
  // The uncropped axis passes straight through.
  near(focalFromClick({ x: 0.5, y: 0.2 }, frame, image, { x: 0.5, y: 0.5 }), { x: 0.5, y: 0.2 })
})

test('with the image size unknown, the click is used as is', () => {
  near(focalFromClick({ x: 0.3, y: 1.2 }, { width: 200, height: 200 }, null, { x: 0.5, y: 0.5 }), { x: 0.3, y: 1 })
})
