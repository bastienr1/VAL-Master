/**
 * Unit tests for the Analyst layout's panels (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { rosterOf, type RosterPlayer } from './replayPanels.ts'
import type { PlayStep } from './playDoc.ts'

const at = { u: 0.5, v: 0.5 }
const step: PlayStep = {
  id: 'frame',
  name: 'R1',
  caption: '',
  elements: [
    { kind: 'agent', id: 'a1', agent: 'Harbor', team: 'ally', at, spike: true },
    { kind: 'agent', id: 'e1', agent: 'Sage', team: 'enemy', at },
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

test('with no frame everyone reads as down', () => {
  assert.ok(rosterOf(players, null).every(r => !r.alive))
})
