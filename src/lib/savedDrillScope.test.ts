import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultScope,
  drillsForMap,
  groupSaved,
  sameScope,
  scopeLabel,
  scopeOptions,
  snapshotChanged,
} from './savedDrillScope.ts'
import type { SavedDrill } from './types.ts'

// --------------------------------------------------------------------- fixtures

const guide = (overrides: Partial<Parameters<typeof defaultScope>[0]> = {}) => ({
  map: null,
  maps: null,
  agent: null,
  agents: null,
  skill: null,
  ...overrides,
})

let nextId = 0
function saved(overrides: Partial<SavedDrill> = {}): SavedDrill {
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
    source_start_seconds: 371,
    source_end_seconds: 439,
    source_title: 'How to Entry Better',
    note: null,
    category: null,
    created_at: `2026-10-03T10:00:${String(nextId).padStart(2, '0')}Z`,
    ...overrides,
  }
}

// ----------------------------------------------------------------- defaultScope

test('one map wins, and carries the sole agent', () => {
  assert.deepEqual(defaultScope(guide({ map: 'Ascent', agents: ['Clove'] })), {
    type: 'map',
    value: 'Ascent',
    agent: 'Clove',
  })
})

test('an empty maps array falls back to the single map field', () => {
  assert.deepEqual(defaultScope(guide({ maps: [], map: 'Ascent' })), { type: 'map', value: 'Ascent', agent: null })
})

test('two maps: no map default, so the single agent is used', () => {
  assert.deepEqual(defaultScope(guide({ maps: ['Lotus', 'Abyss'], agents: ['Jett'] })), {
    type: 'agent',
    value: 'Jett',
    agent: null,
  })
})

test('two agents and no map falls through to a known skill', () => {
  assert.deepEqual(defaultScope(guide({ agents: ['Jett', 'Clove'], skill: 'peeking' })), {
    type: 'concept',
    value: 'peeking',
    agent: null,
  })
})

test('an unknown skill is no default at all', () => {
  assert.equal(defaultScope(guide({ agents: ['Jett', 'Clove'], skill: 'site-hits' })), null)
  assert.equal(defaultScope(guide()), null)
})

test('mixed-case duplicates and blanks collapse before counting', () => {
  assert.deepEqual(defaultScope(guide({ maps: ['Ascent', 'ascent', ' '], agents: ['Clove', 'CLOVE'] })), {
    type: 'map',
    value: 'Ascent',
    agent: 'Clove',
  })
  // A map on the sole-agent rule still needs exactly one agent after cleaning.
  assert.deepEqual(defaultScope(guide({ map: 'Bind', agents: ['Jett', 'Reyna'] })), {
    type: 'map',
    value: 'Bind',
    agent: null,
  })
})

// ----------------------------------------------------------------- scopeOptions

test('scopeOptions lists guide maps, agents, skill, then the rest of the pool, without repeats', () => {
  const options = scopeOptions(
    guide({ map: 'Ascent', agents: ['Clove'], skill: 'entry' }),
    ['Abyss', 'Ascent', 'Bind'],
  )
  assert.deepEqual(options, [
    { type: 'map', value: 'Ascent', agent: 'Clove' },
    { type: 'agent', value: 'Clove', agent: null },
    { type: 'concept', value: 'entry', agent: null },
    { type: 'map', value: 'Abyss', agent: 'Clove' },
    { type: 'map', value: 'Bind', agent: 'Clove' },
  ])
})

test('scopeOptions skips an unknown skill and works with an empty pool', () => {
  assert.deepEqual(scopeOptions(guide({ agents: ['Jett', 'Clove'], skill: 'typo' }), []), [
    { type: 'agent', value: 'Jett', agent: null },
    { type: 'agent', value: 'Clove', agent: null },
  ])
})

// ---------------------------------------------------------- labels and equality

test('scopeLabel shows names as is and a skill by its label', () => {
  assert.equal(scopeLabel({ type: 'map', value: 'Ascent' }), 'Ascent')
  assert.equal(scopeLabel({ type: 'agent', value: 'Clove' }), 'Clove')
  assert.equal(scopeLabel({ type: 'concept', value: 'entry' }), 'Entry and site hits')
})

test('sameScope ignores case but not type', () => {
  assert.ok(sameScope({ type: 'map', value: 'Ascent' }, { type: 'map', value: 'ASCENT ' }))
  assert.ok(!sameScope({ type: 'map', value: 'Clove' }, { type: 'agent', value: 'Clove' }))
})

// ------------------------------------------------------------------ drillsForMap

test('drillsForMap keeps map saves on that map, newest first', () => {
  const older = saved({ scope_value: 'ascent' })
  const newer = saved({ scope_value: 'Ascent' })
  const other = saved({ scope_value: 'Bind' })
  const agentSave = saved({ scope_type: 'agent', scope_value: 'Clove' })
  assert.deepEqual(
    drillsForMap([older, other, agentSave, newer], 'Ascent', null).map(r => r.id),
    [newer.id, older.id],
  )
})

test('drillsForMap with an agent keeps untagged saves and that agent only', () => {
  const untagged = saved()
  const clove = saved({ agent: 'clove' })
  const jett = saved({ agent: 'Jett' })
  assert.deepEqual(
    drillsForMap([untagged, clove, jett], 'Ascent', 'Clove').map(r => r.id).sort(),
    [untagged.id, clove.id].sort(),
  )
})

// -------------------------------------------------------------------- groupSaved

test('groupSaved buckets by type and value, names sorted, drills newest first', () => {
  const a1 = saved({ scope_value: 'Bind' })
  const a2 = saved({ scope_value: 'Ascent' })
  const a3 = saved({ scope_value: 'ascent' })
  const b1 = saved({ scope_type: 'agent', scope_value: 'Clove' })
  const c1 = saved({ scope_type: 'concept', scope_value: 'pacing' })
  const c2 = saved({ scope_type: 'concept', scope_value: 'entry' })

  const groups = groupSaved([a1, a2, a3, b1, c1, c2])
  assert.deepEqual(groups.map.map(([value, rows]) => [value, rows.map(r => r.id)]), [
    ['Ascent', [a3.id, a2.id]],
    ['Bind', [a1.id]],
  ])
  assert.deepEqual(groups.agent.map(([value]) => value), ['Clove'])
  // Sorted by label: "Entry and site hits" before "Pacing and timing".
  assert.deepEqual(groups.concept.map(([value]) => value), ['entry', 'pacing'])
})

test('groupSaved on nothing is three empty lists', () => {
  assert.deepEqual(groupSaved([]), { map: [], agent: [], concept: [] })
})

// --------------------------------------------------------------- snapshotChanged

test('snapshotChanged is true only for a different, non-empty live title', () => {
  const row = saved({ title: 'Cover-to-cover entry' })
  assert.equal(snapshotChanged(row, null), false)
  assert.equal(snapshotChanged(row, ' Cover-to-cover entry '), false)
  assert.equal(snapshotChanged(row, ''), false)
  assert.equal(snapshotChanged(row, 'Cat split through gen'), true)
})
