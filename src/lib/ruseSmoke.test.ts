import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RUSE, isRuse, ruseContract, ruseExpand, ruseIdle, ruseState, ruseTotalMs } from './ruseSmoke.ts'

test('a Ruse actor lives 15 s, 7 s when cast after death, as the replays record', () => {
  assert.equal(ruseTotalMs('alive'), 15000)
  assert.equal(ruseTotalMs('afterDeath'), 7000)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number, cast: 'alive' | 'afterDeath' = 'alive') => ruseState(ms, cast).phase
  assert.equal(phase(0), 'incoming')
  assert.equal(phase(999), 'incoming')
  assert.equal(phase(1000), 'forming')
  assert.equal(phase(1749), 'forming')
  assert.equal(phase(1750), 'active')
  assert.equal(phase(12999), 'active')
  assert.equal(phase(13000), 'ending')
  assert.equal(phase(14500), 'dissolving')
  assert.equal(phase(15000), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(4999, 'afterDeath'), 'active')
  assert.equal(phase(5000, 'afterDeath'), 'ending')
  assert.equal(phase(6500, 'afterDeath'), 'dissolving')
  assert.equal(phase(7000, 'afterDeath'), 'gone')
})

test('it blocks sight from a third into the expand until four fifths into the contract', () => {
  const vision = (ms: number) => ruseState(ms, 'alive').vision
  assert.equal(vision(500), 0)
  assert.equal(vision(1250), 0)
  assert.ok(Math.abs(vision(1270) - 0.5) < 1e-9)
  assert.equal(vision(1750), 1)
  assert.equal(vision(14500), 1)
  assert.equal(vision(14899), 1)
  assert.equal(vision(14901), 0)
})

test('the expand and contract curves are the game curves', () => {
  assert.equal(ruseExpand(0), 0)
  assert.equal(ruseExpand(0.34), 0)
  assert.ok(Math.abs(ruseExpand(0.5) - 0.95) < 1e-9)
  assert.equal(ruseExpand(1), 1)
  assert.equal(ruseExpand(2), 1)
  assert.equal(ruseContract(0.8), 1)
  assert.equal(ruseContract(0.81), 0)
})

test('the drawing: an orb while incoming, whole while active, eaten away at the end', () => {
  const incoming = ruseState(500, 'alive')
  assert.ok(incoming.scale > 0.1 && incoming.scale < 0.36)
  assert.ok(incoming.ripple > 0 && incoming.ripple < 1)
  const forming = ruseState(1000, 'alive')
  assert.ok(Math.abs(forming.scale - 1.1) < 1e-9)
  assert.ok(forming.dissolve > 1)
  assert.equal(forming.flash, 1)
  const active = ruseState(8000, 'alive')
  assert.deepEqual([active.scale, active.mode, active.warn, active.ripple, active.flash], [1, 0, 0, -1, 0])
  assert.ok(active.dissolve < -0.4)
  assert.equal(active.materialTime, 7)
  const ending = ruseState(13750, 'alive')
  assert.ok(Math.abs(ending.warn - 0.5) < 1e-9)
  const out = ruseState(14750, 'alive')
  assert.equal(out.mode, 1)
  assert.ok(Math.abs(out.dissolve - 0.3) < 1e-9)
  assert.equal(ruseState(15000, 'alive').scale, 0)
})

test('a placed Ruse is whole and only drifts', () => {
  assert.deepEqual(ruseIdle(3), { ...ruseState(8000, 'alive'), dissolve: -1, materialTime: 3 })
})

test('only Clove’s E is a Ruse', () => {
  assert.ok(isRuse('Clove', 'Ability2'))
  assert.ok(isRuse(' clove ', 'Ability2'))
  assert.ok(!isRuse('Clove', 'Ability1'))
  assert.ok(!isRuse('Omen', 'Ability2'))
  assert.ok(!isRuse('Clove', null))
  assert.ok(RUSE.shellCm > RUSE.visionCm)
})
