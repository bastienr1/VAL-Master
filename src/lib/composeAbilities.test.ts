/**
 * Unit tests for the composer's abilities list (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { abilitiesForComp } from './composeAbilities.ts'
import type { AbilitySlot } from './playDoc.ts'

type Ability = { slot: AbilitySlot; name: string }

const REGISTRY: Record<string, Ability[]> = {
  omen: [
    // Deliberately out of HUD order.
    { slot: 'Ultimate', name: 'From the Shadows' },
    { slot: 'Ability2', name: 'Dark Cover' },
    { slot: 'Grenade', name: 'Shrouded Step' },
    { slot: 'Ability1', name: 'Paranoia' },
  ],
  sova: [
    { slot: 'Grenade', name: 'Owl Drone' },
    { slot: 'Ability1', name: 'Shock Bolt' },
    { slot: 'Ability2', name: 'Recon Bolt' },
    { slot: 'Ultimate', name: "Hunter's Fury" },
  ],
}

const lookup = (name: string): Ability[] | null => REGISTRY[name.toLowerCase()] ?? null

test('lists every ability in comp order, then C/Q/E/X order, with its board shape', () => {
  const list = abilitiesForComp(['Sova', 'Omen'], lookup)
  assert.deepEqual(list.map(a => `${a.agent}:${a.slot}`), [
    'Sova:Grenade', 'Sova:Ability1', 'Sova:Ability2', 'Sova:Ultimate',
    'Omen:Grenade', 'Omen:Ability1', 'Omen:Ability2', 'Omen:Ultimate',
  ])
  assert.deepEqual(list.find(a => a.name === 'Dark Cover'), {
    agent: 'Omen', slot: 'Ability2', name: 'Dark Cover', shape: 'smoke',
  })
  assert.equal(list.find(a => a.name === 'Recon Bolt')?.shape, 'recon')
  assert.equal(list.find(a => a.name === 'Shock Bolt')?.shape, 'molly')
  assert.equal(list.find(a => a.name === "Hunter's Fury")?.shape, 'wall')
})

test('skips agents the lookup does not know', () => {
  const list = abilitiesForComp(['Nobody', 'Omen'], lookup)
  assert.equal(list.length, 4)
  assert.ok(list.every(a => a.agent === 'Omen'))
})

test('an agent with an empty ability list contributes nothing', () => {
  assert.deepEqual(abilitiesForComp(['Omen'], () => []), [])
})

test('trims and dedupes the comp without regard to case, keeping the first spelling', () => {
  const list = abilitiesForComp(['  omen ', 'OMEN', ''], lookup)
  assert.equal(list.length, 4)
  assert.ok(list.every(a => a.agent === 'omen'))
})

test('drops nameless abilities, unknown slots and repeated slots', () => {
  const messy = (): Ability[] => [
    { slot: 'Grenade', name: '  ' },
    { slot: 'Passive' as AbilitySlot, name: 'Passive thing' },
    { slot: 'Ability1', name: ' Paranoia ' },
    { slot: 'Ability1', name: 'Second Q' },
  ]
  assert.deepEqual(abilitiesForComp(['Omen'], messy), [
    { agent: 'Omen', slot: 'Ability1', name: 'Paranoia', shape: 'flash' },
  ])
})

test('an unknown agent the lookup still answers for falls back to the generic shapes', () => {
  const list = abilitiesForComp(['Newcomer'], () => [
    { slot: 'Ability1', name: 'Mystery' },
    { slot: 'Ultimate', name: 'Big One' },
  ])
  assert.deepEqual(list.map(a => a.shape), ['other', 'ult'])
})

test('an empty comp gives an empty list', () => {
  assert.deepEqual(abilitiesForComp([], lookup), [])
})
