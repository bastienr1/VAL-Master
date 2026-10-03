import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEED_CATEGORIES,
  UNCATEGORISED,
  categoryOptions,
  groupByCategory,
  inCategory,
  matchCategory,
  normaliseCategory,
  resolveCategoryParam,
  usedCategories,
} from './drillCategories.ts'
import type { SavedDrill } from './types.ts'

let nextId = 0
function saved(category: string | null, overrides: Partial<SavedDrill> = {}): SavedDrill {
  nextId += 1
  return {
    id: `s${nextId}`,
    drill_id: `d${nextId}`,
    reference_review_id: 'r1',
    scope_type: 'map',
    scope_value: 'Ascent',
    agent: null,
    title: `Drill ${nextId}`,
    venue: null,
    cue: null,
    success_signal: null,
    source_start_seconds: null,
    source_end_seconds: null,
    source_title: null,
    note: null,
    category,
    created_at: `2026-10-03T10:00:${String(nextId).padStart(2, '0')}Z`,
    ...overrides,
  }
}

test('normaliseCategory trims, collapses spaces and returns null for blank', () => {
  assert.equal(normaliseCategory('  Routing  '), 'Routing')
  assert.equal(normaliseCategory('Info   and\treads'), 'Info and reads')
  assert.equal(normaliseCategory('   '), null)
  assert.equal(normaliseCategory(null), null)
  assert.equal(normaliseCategory(undefined), null)
})

test('matchCategory returns the existing spelling ignoring case, else the name', () => {
  assert.equal(matchCategory('routing', ['Routing', 'Aim']), 'Routing')
  assert.equal(matchCategory(' AIM ', ['Routing', 'Aim']), 'Aim')
  assert.equal(matchCategory('Site hits', ['Routing']), 'Site hits')
})

test('usedCategories is case-folded distinct, first spelling kept, nulls skipped', () => {
  const rows = [saved('Routing'), saved(null), saved('routing'), saved('Utility'), saved(' ')]
  assert.deepEqual(usedCategories(rows), ['Routing', 'Utility'])
})

test('categoryOptions keeps seed order, appends unknown used ones alphabetically, with counts', () => {
  const rows = [saved('routing'), saved('Routing'), saved('Site hits'), saved('Comms'), saved('Anchoring')]
  const options = categoryOptions(rows)

  assert.deepEqual(options.slice(0, SEED_CATEGORIES.length).map(o => o.name), SEED_CATEGORIES)
  assert.equal(options.find(o => o.name === 'Routing')?.count, 2)
  assert.equal(options.find(o => o.name === 'Comms')?.count, 1)
  assert.equal(options.find(o => o.name === 'Aim')?.count, 0)
  assert.deepEqual(
    options.slice(SEED_CATEGORIES.length).map(o => [o.name, o.count, o.seed]),
    [
      ['Anchoring', 1, false],
      ['Site hits', 1, false],
    ],
  )
})

test('groupByCategory is fullest first, ties by name, uncategorised last and only when present', () => {
  const a = saved('Utility')
  const b = saved('Routing')
  const c = saved(null)
  const d = saved('routing')
  const e = saved('Aim')
  const groups = groupByCategory([a, b, c, d, e])

  assert.deepEqual(
    groups.map(([name, rows]) => [name, rows.map(r => r.id)]),
    [
      ['Routing', [b.id, d.id]],
      ['Aim', [e.id]],
      ['Utility', [a.id]],
      [null, [c.id]],
    ],
  )
  assert.deepEqual(groupByCategory([a, e]).map(([name]) => name), ['Aim', 'Utility'])
  assert.deepEqual(groupByCategory([]), [])
})

test('resolveCategoryParam maps the URL value to a stored spelling, the literal, or null', () => {
  const rows = [saved('Routing'), saved(null)]
  assert.equal(resolveCategoryParam('routing', rows), 'Routing')
  assert.equal(resolveCategoryParam('uncategorised', rows), UNCATEGORISED)
  assert.equal(resolveCategoryParam('Peeking', rows), null)
  assert.equal(resolveCategoryParam(null, rows), null)
  assert.equal(resolveCategoryParam('  ', rows), null)
})

test('inCategory matches ignoring case and treats the literal as "no category"', () => {
  assert.ok(inCategory(saved('routing'), 'Routing'))
  assert.ok(!inCategory(saved('Aim'), 'Routing'))
  assert.ok(inCategory(saved(null), UNCATEGORISED))
  assert.ok(!inCategory(saved('Aim'), UNCATEGORISED))
})
