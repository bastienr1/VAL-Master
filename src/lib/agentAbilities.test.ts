/**
 * Unit tests for the ability → board shape table (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { abilityShape, hasAbilityShape, SLOT_KEYS, SLOT_ORDER } from './agentAbilities.ts'

test('Omen Dark Cover is a 380 smoke', () => {
  assert.deepEqual(abilityShape('Omen', 'Ability2'), { shape: 'smoke', radius: 380 })
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
