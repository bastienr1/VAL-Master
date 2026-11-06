/**
 * Unit tests for the composer's post-parse steps (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeKeptElements, unifyAgentIds } from './composeMerge.ts'
import type { AgentElement, PlayDoc, PlayElement, PlayStep } from './playDoc.ts'

const ally = (id: string, agent: string, callout = 'A Main'): AgentElement =>
  ({ kind: 'agent', id, agent, team: 'ally', at: { callout } })
const enemy = (id: string, agent: string): AgentElement =>
  ({ kind: 'agent', id, agent, team: 'enemy', at: { callout: 'A Site' } })
const step = (id: string, elements: PlayElement[], name = id): PlayStep => ({ id, name, caption: '', elements })
const doc = (steps: PlayStep[]): PlayDoc =>
  ({ version: 2, summary: '', comp: ['Jett', 'Omen'], steps, assumptions: [] })

const idsOf = (s: PlayStep) => s.elements.map(e => e.id)
const agentId = (s: PlayStep, agent: string, team = 'ally') =>
  s.elements.find(e => e.kind === 'agent' && e.agent === agent && e.team === team)?.id

// ── unifyAgentIds ──────────────────────────────────────────────────────────

test('each ally agent takes the id it has in the first step', () => {
  const play = doc([
    step('setup', [ally('j1', 'Jett'), ally('o1', 'Omen')]),
    step('execute', [ally('o2', 'Omen'), ally('j2', 'Jett')]),
    step('post-plant', [ally('j3', 'Jett'), ally('o3', 'Omen')]),
  ])
  const out = unifyAgentIds(play)
  for (const s of out.steps) {
    assert.equal(agentId(s, 'Jett'), 'j1')
    assert.equal(agentId(s, 'Omen'), 'o1')
  }
})

test('an agent missing from the first step takes the id from the first step that has it', () => {
  const out = unifyAgentIds(doc([
    step('setup', [ally('j1', 'Jett')]),
    step('execute', [ally('j2', 'Jett'), ally('o2', 'Omen')]),
    step('post-plant', [ally('o3', 'Omen')]),
  ]))
  assert.equal(agentId(out.steps[2], 'Omen'), 'o2')
})

test('enemy agents and other elements keep their ids', () => {
  const out = unifyAgentIds(doc([
    step('setup', [ally('j1', 'Jett'), enemy('e1', 'Jett')]),
    step('execute', [ally('j2', 'Jett'), enemy('e2', 'Jett'), { kind: 'marker', id: 'm2', type: 'pin', at: { callout: 'A Site' } }]),
  ]))
  assert.deepEqual(idsOf(out.steps[1]), ['j1', 'e2', 'm2'])
})

test('a shared id already used by another element of the step is not reused there', () => {
  const out = unifyAgentIds(doc([
    step('setup', [ally('x', 'Jett')]),
    step('execute', [{ kind: 'marker', id: 'x', type: 'pin', at: { callout: 'A Site' } }, ally('j2', 'Jett')]),
  ]))
  assert.deepEqual(idsOf(out.steps[1]), ['x', 'j2'])
})

test('unifyAgentIds does not touch its argument', () => {
  const play = doc([step('setup', [ally('j1', 'Jett')]), step('execute', [ally('j2', 'Jett')])])
  const copy = structuredClone(play)
  unifyAgentIds(play)
  assert.deepEqual(play, copy)
})

// ── mergeKeptElements ──────────────────────────────────────────────────────

const PEN: PlayElement = { kind: 'pen', id: 'pen1', points: [{ u: 0.1, v: 0.1 }, { u: 0.2, v: 0.2 }], color: '#FF0000' }
const ARROW: PlayElement = { kind: 'arrow', id: 'arr1', from: { callout: 'A Main' }, to: { callout: 'A Site' }, color: '#FFFFFF' }
const TEXT: PlayElement = { kind: 'text', id: 'txt1', at: { callout: 'A Site' }, text: 'Plant default', color: '#FFFFFF' }
const ABILITY: PlayElement = { kind: 'ability', id: 'ab1', agent: 'Omen', slot: 'Ability2', shape: 'smoke', at: { callout: 'A Heaven' } }

const PREVIOUS = doc([
  step('setup', [ally('j0', 'Jett'), ally('o0', 'Omen')]),
  step('execute', [ally('j0', 'Jett'), ally('o0', 'Omen'), PEN, ARROW, TEXT, enemy('en1', 'Chamber'), ABILITY]),
])

test('a pen stroke on "execute" survives a recompose, with arrows, text and enemies', () => {
  const result = doc([
    step('setup', [ally('j1', 'Jett'), ally('o1', 'Omen')]),
    step('execute', [ally('j1', 'Jett'), ally('o1', 'Omen')]),
  ])
  const out = mergeKeptElements(result, PREVIOUS)
  assert.deepEqual(idsOf(out.steps[1]), ['j1', 'o1', 'pen1', 'arr1', 'txt1', 'en1'])
  assert.deepEqual(out.steps[1].elements[2], PEN)
  // Ally agents and abilities of the previous step are the composer's to redo.
  assert.ok(!idsOf(out.steps[1]).includes('ab1'))
  assert.ok(!idsOf(out.steps[1]).includes('j0'))
  assert.deepEqual(idsOf(out.steps[0]), ['j1', 'o1'])
})

test('a step the composer renamed does not inherit', () => {
  const result = doc([step('fast-execute', [ally('j1', 'Jett')], 'Fast execute')])
  const out = mergeKeptElements(result, PREVIOUS)
  assert.deepEqual(idsOf(out.steps[0]), ['j1'])
})

test('no duplicate ids: an element already in the step is not appended again', () => {
  const result = doc([step('execute', [ally('j1', 'Jett'), structuredClone(PEN)])])
  const out = mergeKeptElements(result, PREVIOUS)
  const ids = idsOf(out.steps[0])
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.filter(id => id === 'pen1').length, 1)
})

test('mergeKeptElements copies, and does not touch its arguments', () => {
  const result = doc([step('execute', [ally('j1', 'Jett')])])
  const resultCopy = structuredClone(result)
  const previousCopy = structuredClone(PREVIOUS)
  const out = mergeKeptElements(result, PREVIOUS)
  assert.deepEqual(result, resultCopy)
  assert.deepEqual(PREVIOUS, previousCopy)
  assert.notEqual(out.steps[0].elements.find(e => e.id === 'pen1'), PEN)
})
