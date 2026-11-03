/**
 * Unit tests for the play templates: the documents they build, the sites a map
 * offers, and the brief scaffold (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPlayDoc, type AgentElement, type MapCallout, type MarkerElement, type PlayDoc, type PlayStep } from './playDoc.ts'
import { PLAY_TEMPLATES, mapSites, templateById, templateDoc, templateScaffold, type PlayTemplate } from './playTemplates.ts'

const COMP = ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy']

const template = (id: string): PlayTemplate => {
  const found = templateById(id)
  assert.ok(found, `template ${id}`)
  return found
}

/** A play with every element id replaced by its position among the step's elements of its kind, for comparing. */
const normalIds = (doc: PlayDoc): PlayDoc => ({
  ...doc,
  steps: doc.steps.map(s => {
    const seen = new Map<string, number>()
    return {
      ...s,
      elements: s.elements.map(e => {
        const n = seen.get(e.kind) ?? 0
        seen.set(e.kind, n + 1)
        return { ...e, id: `${e.kind}-${n}` }
      }),
    }
  }),
})

const agentsOf = (step: PlayStep) => step.elements.filter((e): e is AgentElement => e.kind === 'agent')
const markersOf = (step: PlayStep) =>
  step.elements.filter((e): e is MarkerElement => e.kind === 'marker').map(({ id, ...rest }) => {
    assert.ok(id)
    return rest
  })

const callout = (superRegion: string, region: string): MapCallout => ({
  region,
  superRegion,
  name: `${superRegion} ${region}`,
  x: 0,
  y: 0,
})

test('the four templates, in order, with their steps', () => {
  assert.deepEqual(
    PLAY_TEMPLATES.map(t => [t.id, t.side, t.needsSite, t.steps.map(p => p.name).join(' → ')]),
    [
      ['attack', 'attack', false, 'Setup → Execute → Post-plant'],
      ['defense', 'defense', false, 'Setup → Hold → Retake'],
      ['post-plant', 'attack', true, 'Plant → Hold → Deny'],
      ['retake', 'defense', true, 'Regroup → Retake → Defuse'],
    ],
  )
  assert.equal(templateById('nope'), null)
})

test('Attack and Defense are the blank play', () => {
  // Ids are random: compared by position.
  const same = (a: PlayDoc, b: PlayDoc) => assert.deepEqual(normalIds(a), normalIds(b))
  same(templateDoc(template('attack'), COMP), emptyPlayDoc(COMP, 'attack'))
  same(templateDoc(template('defense'), COMP), emptyPlayDoc(COMP, 'defense'))
  // The comp is cleaned the same way: trimmed, deduped, five at most.
  const messy = ['Omen', ' Sova ', 'sova', 'Jett', 'KAY/O', 'Killjoy', 'Raze']
  same(templateDoc(template('attack'), messy), emptyPlayDoc(messy, 'attack'))
  same(templateDoc(template('defense'), []), emptyPlayDoc([], 'defense'))
})

test('a template play is v2, and each agent keeps one element id across the steps', () => {
  const doc = templateDoc(template('retake'), COMP, 'B')
  assert.equal(doc.version, 2)
  const ids = (step: PlayStep) => agentsOf(step).map(a => a.id)
  assert.equal(new Set(ids(doc.steps[0])).size, 5)
  for (const step of doc.steps) {
    assert.deepEqual(ids(step), ids(doc.steps[0]))
    assert.equal(new Set(step.elements.map(e => e.id)).size, step.elements.length)
  }
})

test('Post-plant on B puts everyone and the spike on B Site in every step', () => {
  const doc = templateDoc(template('post-plant'), COMP, 'B')
  assert.deepEqual(doc.comp, COMP)
  assert.equal(doc.steps.length, 3)
  for (const step of doc.steps) {
    const agents = agentsOf(step)
    assert.deepEqual(agents.map(a => a.agent), COMP)
    for (const agent of agents) {
      assert.equal(agent.team, 'ally')
      assert.deepEqual(agent.at, { callout: 'B Site' })
      assert.equal(agent.moveTo, undefined)
      assert.equal(agent.note, undefined)
    }
    assert.deepEqual(markersOf(step), [{ kind: 'marker', type: 'spike', at: { callout: 'B Site' } }])
  }
  assert.match(doc.steps[0].caption, /^Spike down on B\./)
  // No site given: A.
  assert.deepEqual(agentsOf(templateDoc(template('post-plant'), COMP).steps[0])[0].at, { callout: 'A Site' })
})

test('Retake on A marks the enemies in Regroup only and sends everyone to A Site', () => {
  const doc = templateDoc(template('retake'), COMP, 'A')
  const [regroup, retake, defuse] = doc.steps
  assert.deepEqual(markersOf(regroup), [
    { kind: 'marker', type: 'spike', at: { callout: 'A Site' } },
    { kind: 'marker', type: 'enemy', at: { callout: 'A Site' }, label: 'Post-plant' },
  ])
  assert.deepEqual(markersOf(retake), [{ kind: 'marker', type: 'spike', at: { callout: 'A Site' } }])
  assert.deepEqual(markersOf(defuse), [{ kind: 'marker', type: 'spike', at: { callout: 'A Site' } }])
  for (const agent of agentsOf(regroup)) {
    assert.deepEqual(agent.at, { callout: 'Defender Side Spawn' })
    assert.equal(agent.moveTo, undefined)
  }
  for (const agent of agentsOf(retake)) assert.deepEqual(agent.moveTo, { callout: 'A Site' })
  for (const agent of agentsOf(defuse)) assert.deepEqual(agent.at, { callout: 'A Site' })
})

test('mapSites lists the sites in A, B, C order and skips Mid', () => {
  const haven: MapCallout[] = [
    callout('C', 'Site'),
    callout('Mid', 'Courtyard'),
    callout('A', 'Long'),
    callout('B', 'Site'),
    callout('A', 'Site'),
    callout('Mid', 'Window'),
    callout('C', 'Long'),
    callout('A', 'site'),
    callout('Attacker Side', 'Spawn'),
  ]
  assert.deepEqual(mapSites(haven), ['A', 'B', 'C'])
  assert.deepEqual(mapSites([]), [])
})

test('templateScaffold fills the map and the site', () => {
  assert.equal(
    templateScaffold(template('retake'), 'Haven', 'C'),
    'Haven defense, retake C, comp …\nRegroup: …\nRetake: …\nDefuse: …',
  )
  assert.equal(
    templateScaffold(template('post-plant'), 'Ascent', 'B'),
    'Ascent attack, post-plant on B, comp …\nPlant: …\nHold: …\nDeny: …',
  )
  assert.equal(templateScaffold(template('attack'), 'Bind'), 'Bind attack, comp …\nSetup: …\nExecute: …\nPost-plant: …')
})
