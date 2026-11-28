import test from 'node:test'
import assert from 'node:assert/strict'
import type { Lineup } from './lineupModel.ts'
import { lineupCounts, lineupsForStrat, onMap, placeLineup, purposesOf } from './lineupRecall.ts'
import { parsePlayDoc, type AgentElement, type PlayStep } from './playDoc.ts'

const BIND = '2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba'

function lineup(over: Partial<Lineup> = {}): Lineup {
  return {
    id: 'l1', user_id: 'u', title: 'Hookah molly', map: 'Bind', map_uuid: BIND, side: 'attack',
    agent: 'Viper', slot: 'Ability2', stand: { u: 0.2, v: 0.3 }, land: { u: 0.5, v: 0.6 }, via: [], curved: false,
    line_color: null, stand_callout: null, land_callout: null, purpose: 'post-plant', stance: null, movement: null,
    click: null, bounces: null, charge: null, note: '', stand_image: null, aim_image: null, result_image: null,
    video_url: null, video_start: null, video_end: null, patch: null, verified_on: null, source: null,
    created_at: '', updated_at: '', ...over,
  }
}

const step = (elements: PlayStep['elements']): PlayStep => ({ id: 's', name: 'The plan', caption: '', elements })

test('onMap: by Riot id when both have one, else by name', () => {
  assert.equal(onMap({ map: 'Bind', map_uuid: BIND }, { map: 'Haven', mapUuid: BIND }), true)
  assert.equal(onMap({ map: 'Bind', map_uuid: 'other' }, { map: 'Bind', mapUuid: BIND }), false)
  assert.equal(onMap({ map: 'bind ', map_uuid: null }, { map: 'Bind', mapUuid: BIND }), true)
})

test('lineupsForStrat: same map and side, comp agents first, purpose filter', () => {
  const rows = [
    lineup({ id: 'a', agent: 'Sova', title: 'B' }),
    lineup({ id: 'b', agent: 'Viper', title: 'Z' }),
    lineup({ id: 'c', agent: 'Viper', title: 'A', purpose: 'execute' }),
    lineup({ id: 'd', agent: 'Brimstone', side: 'defense' }),
    lineup({ id: 'e', agent: 'KAY/O', map: 'Haven', map_uuid: 'haven' }),
    lineup({ id: 'f', agent: 'Brimstone', title: 'Q' }),
  ]
  const at = { map: 'Bind', mapUuid: BIND, side: 'attack' as const }
  assert.deepEqual(lineupsForStrat(rows, at, ['viper', 'Jett']).map(r => r.id), ['c', 'b', 'f', 'a'])
  assert.deepEqual(lineupsForStrat(rows, at, [], 'execute').map(r => r.id), ['c'])
  assert.deepEqual(purposesOf(lineupsForStrat(rows, at, []), ['execute', 'post-plant']), [
    { purpose: 'execute', count: 1 },
    { purpose: 'post-plant', count: 3 },
  ])
})

test('placeLineup moves the ally already there and keeps their move', () => {
  const viper: AgentElement = { kind: 'agent', id: 'v', agent: 'Viper', team: 'ally', at: { callout: 'A Short' }, moveTo: { u: 0.9, v: 0.9 } }
  const enemy: AgentElement = { kind: 'agent', id: 'x', agent: 'Viper', team: 'enemy', at: { u: 0.1, v: 0.1 } }
  const out = placeLineup(step([viper, enemy]), ['Viper'], lineup({ via: [{ u: 0.3, v: 0.4 }], line_color: '#FF0000' }), { ability: 'n1', agent: 'n2' })
  assert.equal(out.agent, 'moved')
  const moved = out.step.elements.find(e => e.id === 'v') as AgentElement
  assert.deepEqual(moved.at, { u: 0.2, v: 0.3 })
  assert.deepEqual(moved.moveTo, { u: 0.9, v: 0.9 })
  assert.deepEqual((out.step.elements.find(e => e.id === 'x') as AgentElement).at, { u: 0.1, v: 0.1 })
  assert.equal(out.ability.id, 'n1')
  assert.equal(out.ability.lineup, 'l1')
  assert.deepEqual(out.ability.from, { u: 0.2, v: 0.3 })
  assert.deepEqual(out.ability.at, { u: 0.5, v: 0.6 })
  assert.deepEqual(out.ability.via, [{ u: 0.3, v: 0.4 }])
  assert.equal(out.ability.lineColor, '#FF0000')
  assert.deepEqual(out.comp, ['Viper'])
})

test('placeLineup adds the ally, joining the comp while it has room', () => {
  const added = placeLineup(step([]), ['Jett'], lineup(), { ability: 'n1', agent: 'n2' })
  assert.equal(added.agent, 'added')
  assert.deepEqual(added.comp, ['Jett', 'Viper'])
  assert.deepEqual(added.step.elements.map(e => e.id), ['n2', 'n1'])

  const inComp = placeLineup(step([]), ['viper'], lineup(), { ability: 'n1', agent: 'n2' })
  assert.equal((inComp.step.elements[0] as AgentElement).agent, 'viper')
  assert.deepEqual(inComp.comp, ['viper'])

  const full = placeLineup(step([]), ['A', 'B', 'C', 'D', 'E'], lineup(), { ability: 'n1', agent: 'n2' })
  assert.equal(full.agent, null)
  assert.deepEqual(full.step.elements.map(e => e.id), ['n1'])
  assert.deepEqual(full.comp, ['A', 'B', 'C', 'D', 'E'])
})

test('lineupCounts and the lineup link survive a save', () => {
  const placed = placeLineup(step([]), [], lineup(), { ability: 'n1', agent: 'n2' })
  assert.deepEqual([...lineupCounts(placed.step)], [['l1', 1]])
  const doc = parsePlayDoc({ version: 2, map: 'Bind', side: 'attack', comp: placed.comp, steps: [placed.step] })
  const ability = doc.steps[0].elements.find(e => e.kind === 'ability')
  assert.equal(ability?.kind === 'ability' && ability.lineup, 'l1')
})
