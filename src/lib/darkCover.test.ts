import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DARK_COVER, darkCoverContract, darkCoverExpand, darkCoverIdle, darkCoverState, darkCoverTotalMs, isDarkCover } from './darkCover.ts'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

test('a Dark Cover Zone lives 16.0 s, as the replays record (InitialLifeSpan)', () => {
  assert.equal(darkCoverTotalMs(), 16000)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => darkCoverState(ms).phase
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(0), 'bursting')
  assert.equal(phase(299), 'bursting')
  assert.equal(phase(300), 'forming')
  assert.equal(phase(799), 'forming')
  assert.equal(phase(800), 'active')
  assert.equal(phase(13499), 'active')
  assert.equal(phase(13500), 'ending')
  assert.equal(phase(14999), 'ending')
  assert.equal(phase(15000), 'dissolving')
  assert.equal(phase(15999), 'dissolving')
  assert.equal(phase(16000), 'gone')
})

test('it blocks sight from 1 % into the expand until a quarter into the contract', () => {
  const vision = (ms: number) => darkCoverState(ms).vision
  assert.equal(vision(299), 0)
  assert.ok(near(vision(302.5), 0.5))
  assert.equal(vision(305), 1)
  assert.equal(vision(8000), 1)
  assert.equal(vision(15000), 1)
  assert.equal(vision(15249), 1)
  assert.equal(vision(15251), 0)
  assert.equal(vision(16000), 0)
})

test('the expand and contract curves are the game curves', () => {
  assert.equal(darkCoverExpand(0), 0)
  assert.ok(near(darkCoverExpand(0.005), 0.5))
  assert.equal(darkCoverExpand(0.01), 1)
  assert.equal(darkCoverExpand(2), 1)
  assert.equal(darkCoverContract(0), 1)
  assert.equal(darkCoverContract(0.249), 1)
  assert.equal(darkCoverContract(0.25), 0)
})

test('the drawing: rings at the burst, the dome pops 0.2 → 0.3 s, whole while active, eaten at the end', () => {
  const early = darkCoverState(100)
  assert.equal(early.scale, 0)
  assert.equal(early.rings.zone.alpha, 0)
  const burst = darkCoverState(200)
  assert.ok(near(burst.scale, 0.2))
  assert.equal(burst.flash, 1)
  assert.equal(burst.rings.orb.alpha, 1)
  assert.ok(darkCoverState(280).scale > 1)
  const formed = darkCoverState(300)
  assert.equal(formed.scale, 1)
  assert.ok(formed.alpha > 0 && formed.alpha < 1)
  const active = darkCoverState(8000)
  assert.deepEqual([active.scale, active.fill, active.alpha, active.dissolve, active.emissive, active.warn, active.flash], [1, 1, 1, 1, 1, 0, 0])
  assert.deepEqual([active.wisp.alpha, active.overlay.alpha, active.decal.alpha], [1, 1, 1])
  assert.equal(active.materialTime, 8)
  assert.ok(near(darkCoverState(13500 + 875).warn, 0.5))
  assert.ok(near(darkCoverState(15000).warn, 1500 / 1750))
  assert.equal(darkCoverState(15250).warn, 0)
  assert.equal(darkCoverState(15000).dissolve, 1)
  assert.ok(darkCoverState(15140).dissolve < 0)
  assert.equal(darkCoverState(16000).scale, 0)
})

test('the enemy outro fades its wisps without the white flash', () => {
  assert.ok(darkCoverState(15100).wisp.glow > 3)
  assert.ok(darkCoverState(15100, true).wisp.glow < 1)
  assert.deepEqual(darkCoverState(8000, true), darkCoverState(8000))
})

test('a placed Dark Cover is whole and only drifts', () => {
  assert.deepEqual(darkCoverIdle(3), { ...darkCoverState(8000), materialTime: 3 })
})

test('only Omen’s E is a Dark Cover', () => {
  assert.ok(isDarkCover('Omen', 'Ability2'))
  assert.ok(isDarkCover(' omen ', 'Ability2'))
  assert.ok(!isDarkCover('Omen', 'Ability1'))
  assert.ok(!isDarkCover('Clove', 'Ability2'))
  assert.ok(!isDarkCover('Omen', null))
  assert.ok(DARK_COVER.overlayCm > DARK_COVER.visionCm && DARK_COVER.visionCm > DARK_COVER.shellCm)
})
