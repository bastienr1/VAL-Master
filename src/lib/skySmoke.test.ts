import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SKY_PUFFS, SKY_SMOKE, isSkySmoke, skySmokeContract, skySmokeExpand, skySmokeIdle, skySmokeState, skySmokeTotalMs } from './skySmoke.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('a Sky Smoke actor lives 20.75 s, as the replays record', () => {
  assert.equal(skySmokeTotalMs(), 20750)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => skySmokeState(ms).phase
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(0), 'incoming')
  assert.equal(phase(999), 'incoming')
  assert.equal(phase(1000), 'forming')
  assert.equal(phase(1749), 'forming')
  assert.equal(phase(1750), 'active')
  assert.equal(phase(18749), 'active')
  assert.equal(phase(18750), 'ending')
  assert.equal(phase(20249), 'ending')
  assert.equal(phase(20250), 'dissolving')
  assert.equal(phase(20749), 'dissolving')
  assert.equal(phase(20750), 'gone')
  assert.equal(phase(25000), 'gone')
})

test('the expand and contract curves are the game curves', () => {
  assert.ok(near(skySmokeExpand(0), 0.1))
  assert.ok(near(skySmokeExpand(0.33), 0.3))
  assert.ok(near(skySmokeExpand(0.38), 0.6))
  assert.ok(near(skySmokeExpand(1), 1))
  assert.equal(skySmokeExpand(2), 1)
  for (let x = 0; x < 1; x += 0.01) assert.ok(skySmokeExpand(x + 0.01) >= skySmokeExpand(x) - 1e-9, `rises at ${x}`)
  assert.equal(skySmokeContract(0.43), 1)
  assert.equal(skySmokeContract(0.431), 0)
})

test('it blocks sight from the landing until 43 % into the contract', () => {
  const vision = (ms: number) => skySmokeState(ms).vision
  assert.equal(vision(999), 0)
  assert.ok(near(vision(1000), 0.1))
  assert.ok(near(vision(1000 + 0.33 * 750), 0.3))
  assert.equal(vision(1750), 1)
  assert.equal(vision(20250), 1)
  assert.equal(vision(20250 + 215), 1)
  assert.equal(vision(20250 + 216), 0)
  assert.equal(vision(20750), 0)
})

test('the drawing: marker while incoming, impact, body grown by 0.77 s after the landing', () => {
  const incoming = skySmokeState(500)
  assert.ok(incoming.markerA > 0 && incoming.growCm > 0)
  assert.equal(incoming.scale, 0)
  assert.equal(incoming.puffs.length, 0)
  const impact = skySmokeState(1000)
  assert.equal(impact.flash, 1)
  assert.equal(impact.puffs.length, 5)
  assert.ok(impact.shockCm > 0 && impact.shockA === 1)
  assert.equal(impact.scale, 0)
  assert.ok(skySmokeState(1400).scale > 0.5 && skySmokeState(1400).scale < 1)
  assert.equal(skySmokeState(1000 + 350 + 418).scale, 1)
  const active = skySmokeState(8000)
  assert.deepEqual([active.scale, active.bodyA, active.bodyHeat, active.dissolve, active.warn, active.flash, active.markerA, active.puffs.length], [1, 1, 1, 0, 0, 0, 0, 0])
  assert.equal(active.materialTime, 8)
  assert.ok(skySmokeState(19500).warn > 0)
  assert.ok(SKY_PUFFS >= skySmokeState(1300).puffs.length)
})

test('the last frame a replay shows is nearly gone', () => {
  const last = skySmokeState(20749)
  assert.ok(last.dissolve > 0.85, `dissolve ${last.dissolve}`)
  assert.ok(last.bodyDark < 0.35)
  assert.ok(last.warn < 0.01)
  assert.ok(skySmokeState(20300).dissolve < skySmokeState(20600).dissolve)
  assert.equal(skySmokeState(20750).scale, 0)
})

test('a placed Sky Smoke is whole and only drifts', () => {
  const idle = skySmokeIdle(3)
  const active = skySmokeState(8000)
  assert.deepEqual(idle, { ...active, materialTime: 3 })
})

test('only Brimstone’s E is a Sky Smoke', () => {
  assert.ok(isSkySmoke('Brimstone', 'Ability2'))
  assert.ok(isSkySmoke(' brimstone ', 'Ability2'))
  assert.ok(!isSkySmoke('Brimstone', 'Ability1'))
  assert.ok(!isSkySmoke('Omen', 'Ability2'))
  assert.ok(!isSkySmoke('Brimstone', null))
  assert.ok(SKY_SMOKE.shellCm > SKY_SMOKE.visionCm)
})
