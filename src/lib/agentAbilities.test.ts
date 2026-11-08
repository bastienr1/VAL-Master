/**
 * Unit tests for the ability → board shape table (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { abilityLook, abilityShape, agentInk, CATALOG_AGENTS, hasAbilityShape, SLOT_KEYS, SLOT_ORDER } from './agentAbilities.ts'

test('Omen Dark Cover is a 410 smoke', () => {
  assert.deepEqual(abilityShape('Omen', 'Ability2'), { shape: 'smoke', radius: 410 })
})

test('Sova Recon Bolt is a recon', () => {
  assert.equal(abilityShape('Sova', 'Ability2').shape, 'recon')
})

test('Viper Toxic Screen is a wall', () => {
  assert.equal(abilityShape('Viper', 'Ability2').shape, 'wall')
})

test('agent names match case-insensitively', () => {
  assert.deepEqual(abilityShape('oMeN', 'Ability2'), abilityShape('Omen', 'Ability2'))
  assert.deepEqual(abilityShape('  KAY/O ', 'Ability1'), { shape: 'flash', radius: 120 })
})

test('an unknown agent falls back to other 120', () => {
  assert.deepEqual(abilityShape('Nobody', 'Grenade'), { shape: 'other', radius: 120 })
})

test('an unlisted ultimate falls back to ult', () => {
  assert.equal(abilityShape('Nobody', 'Ultimate').shape, 'ult')
})

test('slots run C Q E X', () => {
  assert.deepEqual(SLOT_ORDER.map(slot => SLOT_KEYS[slot]), ['C', 'Q', 'E', 'X'])
})

test('the current pool has an explicit entry for every slot', () => {
  for (const agent of ['Astra', 'Brimstone', 'Omen', 'Viper', 'Sova', 'Killjoy', 'Cypher', 'Sage', 'Jett']) {
    for (const slot of SLOT_ORDER) {
      assert.ok(hasAbilityShape(agent, slot), `${agent} ${slot} falls to the default`)
    }
  }
  assert.equal(hasAbilityShape('Nobody', 'Grenade'), false)
})

test('every agent has a family for each key and its own colour', () => {
  const inks = CATALOG_AGENTS.map(agent => agentInk(agent))
  for (const ink of inks) assert.match(ink ?? '', /^#[0-9A-F]{6}$/)
  assert.equal(new Set(inks).size, inks.length)
  assert.equal(CATALOG_AGENTS.length, 30)
  for (const agent of CATALOG_AGENTS) for (const slot of SLOT_ORDER) assert.ok(abilityLook(agent, slot, 'other').family, `${agent} ${slot}`)
})

test('alike abilities share a family across agents', () => {
  const smokes: [string, 'Grenade' | 'Ability1' | 'Ability2'][] = [['Omen', 'Ability2'], ['Brimstone', 'Ability2'], ['Viper', 'Ability1'], ['Astra', 'Ability2'], ['Jett', 'Grenade'], ['Clove', 'Ability2'], ['Harbor', 'Ability2']]
  for (const [agent, slot] of smokes) assert.equal(abilityLook(agent, slot, 'other').family, 'cloud', agent)
  const flashes: [string, 'Grenade' | 'Ability1' | 'Ability2'][] = [['Breach', 'Ability1'], ['Phoenix', 'Ability2'], ['KAY/O', 'Ability1'], ['Yoru', 'Ability1'], ['Skye', 'Ability2'], ['Omen', 'Ability1']]
  for (const [agent, slot] of flashes) assert.equal(abilityLook(agent, slot, 'other').family, 'burst', agent)
})

test('an agent the catalogue does not know goes by the shape', () => {
  assert.equal(abilityLook('Nobody', 'Grenade', 'smoke').family, 'cloud')
  assert.equal(abilityLook('Omen', null, 'trap').family, 'device')
  assert.equal(agentInk('Nobody'), null)
})
