/**
 * Unit tests for the play templates: the documents they build, the sites a map
 * offers, and the brief scaffold (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPlayDoc, type MapCallout } from './playDoc.ts'
import { PLAY_TEMPLATES, mapSites, templateById, templateDoc, templateScaffold, type PlayTemplate } from './playTemplates.ts'

const COMP = ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy']

const template = (id: string): PlayTemplate => {
  const found = templateById(id)
  assert.ok(found, `template ${id}`)
  return found
}

const callout = (superRegion: string, region: string): MapCallout => ({
  region,
  superRegion,
  name: `${superRegion} ${region}`,
  x: 0,
  y: 0,
})

test('the four templates, in order, with their phases', () => {
  assert.deepEqual(
    PLAY_TEMPLATES.map(t => [t.id, t.side, t.needsSite, t.phases.map(p => p.name).join(' → ')]),
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
  assert.deepEqual(templateDoc(template('attack'), COMP), emptyPlayDoc(COMP, 'attack'))
  assert.deepEqual(templateDoc(template('defense'), COMP), emptyPlayDoc(COMP, 'defense'))
  // The comp is cleaned the same way: trimmed, deduped, five at most.
  const messy = ['Omen', ' Sova ', 'sova', 'Jett', 'KAY/O', 'Killjoy', 'Raze']
  assert.deepEqual(templateDoc(template('attack'), messy), emptyPlayDoc(messy, 'attack'))
  assert.deepEqual(templateDoc(template('defense'), []), emptyPlayDoc([], 'defense'))
})

test('Post-plant on B puts everyone and the spike on B Site in every phase', () => {
  const doc = templateDoc(template('post-plant'), COMP, 'B')
  assert.deepEqual(doc.comp, COMP)
  assert.equal(doc.phases.length, 3)
  for (const phase of doc.phases) {
    assert.equal(phase.actors.length, 5)
    for (const actor of phase.actors) {
      assert.deepEqual(actor.at, { callout: 'B Site' })
      assert.equal(actor.moveTo, undefined)
      assert.equal(actor.note, '')
    }
    assert.deepEqual(phase.markers, [{ kind: 'spike', at: { callout: 'B Site' } }])
  }
  assert.match(doc.phases[0].caption, /^Spike down on B\./)
  // No site given: A.
  assert.deepEqual(templateDoc(template('post-plant'), COMP).phases[0].actors[0].at, { callout: 'A Site' })
})

test('Retake on A marks the enemies in Regroup only and sends everyone to A Site', () => {
  const doc = templateDoc(template('retake'), COMP, 'A')
  const [regroup, retake, defuse] = doc.phases
  assert.deepEqual(regroup.markers, [
    { kind: 'spike', at: { callout: 'A Site' } },
    { kind: 'enemy', at: { callout: 'A Site' }, label: 'Post-plant' },
  ])
  assert.deepEqual(retake.markers, [{ kind: 'spike', at: { callout: 'A Site' } }])
  assert.deepEqual(defuse.markers, [{ kind: 'spike', at: { callout: 'A Site' } }])
  for (const actor of regroup.actors) {
    assert.deepEqual(actor.at, { callout: 'Defender Side Spawn' })
    assert.equal(actor.moveTo, undefined)
  }
  for (const actor of retake.actors) assert.deepEqual(actor.moveTo, { callout: 'A Site' })
  for (const actor of defuse.actors) assert.deepEqual(actor.at, { callout: 'A Site' })
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
