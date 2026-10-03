import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS,
  SKILL_GROUPS,
  skillDef,
  skillGroupFor,
  skillLabel,
  skillOrder,
} from './skillTaxonomy.ts'

test('every skill value is unique and lower-case kebab', () => {
  const values = SKILLS.map(skill => skill.value)
  assert.equal(new Set(values).size, values.length)
  for (const value of values) assert.match(value, /^[a-z]+(-[a-z]+)*$/)
})

test('the list runs Mechanics first, then Game sense, with no interleaving', () => {
  const groups = SKILLS.map(skill => skill.group)
  const firstGameSense = groups.indexOf('game-sense')
  assert.ok(firstGameSense > 0)
  assert.ok(groups.slice(firstGameSense).every(group => group === 'game-sense'))
  assert.deepEqual(SKILL_GROUPS, ['mechanics', 'game-sense'])
})

test('skillDef looks up a value case-insensitively and trimmed', () => {
  assert.equal(skillDef('peeking')?.label, 'Peeking')
  assert.equal(skillDef('  Entry ')?.group, 'game-sense')
  assert.equal(skillDef('site-hits'), null)
  assert.equal(skillDef(null), null)
  assert.equal(skillDef(undefined), null)
})

test('skillLabel shows the label, the raw value for a stranger, or Unsorted for none', () => {
  assert.equal(skillLabel('crosshair-placement'), 'Crosshair placement')
  assert.equal(skillLabel('entries'), 'entries')
  assert.equal(skillLabel(''), 'Unsorted')
  assert.equal(skillLabel(null), 'Unsorted')
})

test('skillGroupFor is null for an unknown value', () => {
  assert.equal(skillGroupFor('aim'), 'mechanics')
  assert.equal(skillGroupFor('pacing'), 'game-sense')
  assert.equal(skillGroupFor('typo'), null)
})

test('skillOrder puts unknown values after every known one', () => {
  assert.ok(skillOrder('aim') < skillOrder('entry'))
  assert.equal(skillOrder('typo'), SKILLS.length)
  assert.equal(skillOrder(null), SKILLS.length)
})
