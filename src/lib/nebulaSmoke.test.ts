import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NEBULA, isNebula, nebulaContract, nebulaExpand, nebulaIdle, nebulaState, nebulaTotalMs } from './nebulaSmoke.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('a Nebula actor lives 15.5 s, a Dissipate 2.25 s, as the replays record', () => {
  // replay_stats: GameObject_Rift_E_SmokeZone_C median 15 496 ms, _Fake_C median 2 244 ms.
  assert.equal(nebulaTotalMs('nebula'), 15500)
  assert.equal(nebulaTotalMs('dissipate'), 2250)
  assert.ok(Math.abs(nebulaTotalMs('nebula') - 15496) < 20)
  assert.ok(Math.abs(nebulaTotalMs('dissipate') - 2244) < 20)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number, cast: 'nebula' | 'dissipate' = 'nebula') => nebulaState(ms, cast).phase
  assert.equal(phase(0), 'burst')
  assert.equal(phase(249), 'burst')
  assert.equal(phase(250), 'forming')
  assert.equal(phase(749), 'forming')
  assert.equal(phase(750), 'active')
  assert.equal(phase(13499), 'active')
  assert.equal(phase(13500), 'ending')
  assert.equal(phase(14999), 'ending')
  assert.equal(phase(15000), 'out')
  assert.equal(phase(15499), 'out')
  assert.equal(phase(15500), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(Number.NaN), 'gone')
  // Dissipate: no ending warning (SmokeEndTelegraphDuration 0).
  assert.equal(phase(750, 'dissipate'), 'active')
  assert.equal(phase(1749, 'dissipate'), 'active')
  assert.equal(phase(1750, 'dissipate'), 'out')
  assert.equal(phase(2249, 'dissipate'), 'out')
  assert.equal(phase(2250, 'dissipate'), 'gone')
  assert.equal(nebulaState(1600, 'dissipate').warn, 0)
})

test('it blocks sight from 32.5 % into the expand until 71.1 % into the contract', () => {
  const vision = (ms: number, cast: 'nebula' | 'dissipate' = 'nebula') => nebulaState(ms, cast).vision
  assert.equal(vision(0), 0)
  assert.equal(vision(243), 0)
  assert.ok(vision(250) > 0.05 && vision(250) < 0.15)
  assert.ok(near(vision(300), 0.35))
  assert.ok(near(vision(0.53462887 * 750), 0.95))
  assert.equal(vision(750), 1)
  assert.equal(vision(8000), 1)
  assert.equal(vision(15000), 1)
  assert.ok(near(vision(15050), 1))
  assert.ok(vision(15200) < 1 && vision(15200) > 0.78)
  assert.ok(near(vision(15354), 0.78, 1e-4))
  assert.ok(vision(15356) < 1e-6)
  assert.ok(vision(1750 + 356, 'dissipate') < 1e-6)
  assert.ok(near(vision(1750 + 354, 'dissipate'), 0.78, 1e-4))
})

test('the expand and contract curves are the game curves', () => {
  assert.equal(nebulaExpand(0), 0)
  assert.equal(nebulaExpand(0.325), 0)
  assert.ok(near(nebulaExpand(0.4), 0.35))
  assert.ok(near(nebulaExpand(0.53462887), 0.95))
  assert.equal(nebulaExpand(1), 1)
  assert.equal(nebulaExpand(2), 1)
  assert.equal(nebulaContract(0), 1)
  assert.ok(near(nebulaContract(0.1), 1))
  assert.ok(near(nebulaContract(0.71), 0.78))
  assert.ok(near(nebulaContract(0.7105), 0.78))
  assert.ok(nebulaContract(0.75) < 1e-6)
})

test('the drawing: a burst, a splash that overshoots and settles, whole while active, broken up at the end', () => {
  const burst = nebulaState(50, 'nebula')
  assert.equal(burst.scale, 0)
  assert.ok(burst.flash[1] > 0 && burst.flash[3] > 0)
  const landing = nebulaState(250, 'nebula')
  assert.ok(near(landing.scale, 0.2))
  assert.ok(near(landing.twirl, -16.3394))
  const splash = nebulaState(250 + (8 / 15) * 500, 'nebula')
  assert.ok(near(splash.scale, 1.2834))
  const active = nebulaState(8000, 'nebula')
  assert.deepEqual([active.scale, active.glow, active.fresnel, active.twirl, active.dissolve, active.out, active.warn, active.baseRing], [1, 1, 1, 1, 0, 0, 0, 1])
  assert.equal(active.materialTime, 8)
  assert.ok(active.orbits.length >= 1 && active.orbits.length <= 2)
  for (const o of active.orbits) assert.ok(near(Math.hypot(...o.n), 1))
  const ending = nebulaState(14250, 'nebula')
  assert.ok(near(ending.warn, 0.5))
  const out = nebulaState(15175, 'nebula')
  assert.equal(out.out, 1)
  assert.ok(near(out.dissolve, 0.5))
  assert.equal(nebulaState(15400, 'nebula').scale, 0)
  assert.equal(nebulaState(15500, 'nebula').scale, 0)
})

test('a placed Nebula is whole and only drifts', () => {
  const idle = nebulaIdle(3.2)
  assert.deepEqual([idle.phase, idle.vision, idle.scale, idle.dissolve, idle.warn, idle.out, idle.materialTime], ['active', 1, 1, 0, 0, 0, 3.2])
  assert.deepEqual(idle.orbits, nebulaState(3200, 'nebula').orbits)
})

test('only Astra’s E is a Nebula', () => {
  assert.ok(isNebula('Astra', 'Ability2'))
  assert.ok(isNebula(' astra ', 'Ability2'))
  assert.ok(!isNebula('Astra', 'Ability1'))
  assert.ok(!isNebula('Omen', 'Ability2'))
  assert.ok(!isNebula('Astra', null))
  assert.ok(NEBULA.shellCm > NEBULA.zoneCm && NEBULA.zoneCm > NEBULA.visionCm)
})
