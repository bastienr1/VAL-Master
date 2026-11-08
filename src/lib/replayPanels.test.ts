/**
 * Unit tests for the Analyst layout's panels (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { rosterOf, utilityUp, type RosterPlayer } from './replayPanels.ts'
import type { PlayStep } from './playDoc.ts'

const at = { u: 0.5, v: 0.5 }
const step: PlayStep = {
  id: 'frame',
  name: 'R1',
  caption: '',
  elements: [
    { kind: 'agent', id: 'a1', agent: 'Harbor', team: 'ally', at, spike: true },
    { kind: 'agent', id: 'e1', agent: 'Sage', team: 'enemy', at },
    { kind: 'ability', id: 'u1', agent: 'Harbor', slot: 'Ability1', shape: 'wall', at, label: 'High Tide', life: 0.79 },
    { kind: 'ability', id: 'u2', agent: 'Clove', slot: 'Ability2', shape: 'smoke', at, label: 'Ruse', life: 0.88 },
    // In flight: not up yet.
    { kind: 'ability', id: 'u3', agent: 'Sova', slot: 'Ability1', shape: 'molly', at, life: 1, progress: 0.4 },
    // A bare cast badge: no life.
    { kind: 'ability', id: 'u4', agent: 'Jett', slot: 'Ability2', shape: 'other', at, label: 'Tailwind' },
    // No label: the agent's name stands in.
    { kind: 'ability', id: 'u5', agent: 'Cypher', slot: 'Grenade', shape: 'trap', at, life: 0.38 },
  ],
}

const players: RosterPlayer[] = [
  { subject: 's1', elementId: 'a1', agent: 'Harbor', team: 'ally', playerName: 'One' },
  { subject: 's2', elementId: 'a2', agent: 'Sova', team: 'ally' },
  { subject: 's3', elementId: 'e1', agent: 'Sage', team: 'enemy' },
]

test('the roster marks who has an agent in the frame, and the spike carrier', () => {
  assert.deepEqual(
    rosterOf(players, step).map(r => [r.agent, r.alive, r.spike, r.playerName]),
    [['Harbor', true, true, 'One'], ['Sova', false, false, undefined], ['Sage', true, false, undefined]],
  )
})

test('with no frame everyone reads as down, and nothing is up', () => {
  assert.ok(rosterOf(players, null).every(r => !r.alive))
  assert.deepEqual(utilityUp(undefined), [])
})

test('utility up: landed with a known life, the longest left first', () => {
  assert.deepEqual(
    utilityUp(step).map(u => [u.name, u.life]),
    [['Ruse', 0.88], ['High Tide', 0.79], ['Cypher', 0.38]],
  )
})
