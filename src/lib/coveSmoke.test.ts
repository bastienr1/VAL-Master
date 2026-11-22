import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COVE, coveIdle, coveState, coveTotalMs, isCove } from './coveSmoke.ts'

test('a Cove actor lives 20.25 s, as the replays record', () => {
  assert.equal(coveTotalMs(), 20250)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => coveState(ms).phase
  assert.equal(phase(0), 'landing')
  assert.equal(phase(499), 'landing')
  assert.equal(phase(500), 'forming')
  assert.equal(phase(999), 'forming')
  assert.equal(phase(1000), 'active')
  assert.equal(phase(18249), 'active')
  assert.equal(phase(18250), 'ending')
  assert.equal(phase(19749), 'ending')
  assert.equal(phase(19750), 'dissolving')
  assert.equal(phase(20249), 'dissolving')
  assert.equal(phase(20250), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(Number.NaN), 'gone')
})

test('it blocks sight in full from the end of the delay until the contract starts (instant curves)', () => {
  const vision = (ms: number) => coveState(ms).vision
  assert.equal(vision(0), 0)
  assert.equal(vision(499), 0)
  assert.equal(vision(500), 1)
  assert.equal(vision(10000), 1)
  assert.equal(vision(19749), 1)
  assert.equal(vision(19750), 0)
  assert.equal(vision(20250), 0)
})

test('the drawing: dissolves in over 0.6 s, whole while up, out over 0.4 s', () => {
  const landing = coveState(0)
  assert.equal(landing.dissolve, 1)
  assert.equal(landing.ring, 0)
  assert.ok(coveState(300).dissolve > 0 && coveState(300).dissolve < 1)
  assert.equal(coveState(600).dissolve, 0)
  const active = coveState(8000)
  assert.deepEqual([active.scale, active.dissolve, active.warn, active.flash], [1, 0, 0, 0])
  assert.ok(Math.abs(active.ring - 0.993) < 1e-9)
  assert.equal(active.materialTime, 8)
  assert.ok(Math.abs(coveState(19000).warn - 0.5) < 1e-9)
  const out = coveState(19750)
  assert.equal(out.dissolve, 0)
  assert.equal(out.warn, 1)
  assert.equal(coveState(20150).dissolve, 1)
  assert.equal(coveState(20250).scale, 0)
})

test('a placed Cove is whole and only drifts', () => {
  assert.deepEqual(coveIdle(3), { ...coveState(8000), materialTime: 3 })
})

test('only Harbor’s E is a Cove', () => {
  assert.ok(isCove('Harbor', 'Ability2'))
  assert.ok(isCove(' harbor ', 'Ability2'))
  assert.ok(!isCove('Harbor', 'Ability1'))
  assert.ok(!isCove('Clove', 'Ability2'))
  assert.ok(!isCove('Harbor', null))
  assert.ok(COVE.shellCm > COVE.visionCm)
})
