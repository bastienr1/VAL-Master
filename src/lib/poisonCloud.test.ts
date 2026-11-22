import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  POISON_CLOUD, isPoisonCloud, poisonCloudContract, poisonCloudExpand, poisonCloudIdle, poisonCloudOffMs, poisonCloudState, poisonCloudTotalMs,
} from './poisonCloud.ts'

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

test('a full tank lives 14.25 s and the shortest toggle 4.25 s, as the replays record', () => {
  assert.equal(poisonCloudTotalMs(null), 14250)
  assert.equal(POISON_CLOUD.fullLifeMs, 14250)
  assert.equal(poisonCloudOffMs(null), 12500)
  assert.equal(poisonCloudTotalMs(4250), 4250)
  assert.equal(poisonCloudOffMs(4250), POISON_CLOUD.drainDelayMs + POISON_CLOUD.lockMs)
  assert.equal(poisonCloudOffMs(9000), 7250)
})

test('the fuel: drains 1/12 a second after 0.5 s, a full tank is dry at 12.5 s', () => {
  assert.equal(poisonCloudState(400, null).fuel, 1)
  assert.ok(near(poisonCloudState(6500, null).fuel, 0.5))
  assert.ok(near(poisonCloudState(12500, null).fuel, 0, 1e-9))
  assert.ok(near(poisonCloudState(2500, 4250).fuel, 1 - 2 / 12))
  // Refills at 1/30 a second once it is off.
  assert.ok(near(poisonCloudState(4000, 4250).fuel, 1 - 2 / 12 + 1.5 / 30))
})

test('the phases follow the game timings', () => {
  const phase = (ms: number, life: number | null = null) => poisonCloudState(ms, life).phase
  assert.equal(phase(0), 'opening')
  assert.equal(phase(599), 'opening')
  assert.equal(phase(600), 'rising')
  assert.equal(phase(2099), 'rising')
  assert.equal(phase(2100), 'up')
  assert.equal(phase(8800), 'up')
  assert.equal(phase(9000), 'lowfuel') // below 30 % from 8.9 s
  assert.equal(phase(12499), 'lowfuel')
  assert.equal(phase(12500), 'fading')
  assert.equal(phase(13499), 'fading')
  assert.equal(phase(13500), 'clearing')
  assert.equal(phase(14249), 'clearing')
  assert.equal(phase(14250), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(2400, 4250), 'up')
  assert.equal(phase(2500, 4250), 'fading')
  assert.equal(phase(4249, 4250), 'clearing')
  assert.equal(phase(4250, 4250), 'gone')
})

test('sight: the hidden sphere grows on the files’ cubic, holds, puffs out, then lets go 0.8 s after off', () => {
  const vision = (ms: number, life: number | null = null) => poisonCloudState(ms, life).vision
  assert.equal(vision(599), 0)
  assert.equal(vision(600), 0)
  assert.ok(near(vision(1250), poisonCloudExpand(0.5)))
  assert.ok(near(poisonCloudExpand(0.5), 0.5 + 0.125 * 0.2509162 - 0.125 * 2.8354373))
  assert.ok(vision(1250) < 0.2) // slow to start
  assert.ok(near(vision(1900), 1))
  assert.equal(vision(8000), 1)
  assert.equal(vision(12500), 1)
  assert.ok(near(vision(12500 + 660), poisonCloudContract(0.66)))
  assert.ok(vision(13299) > 1)
  assert.equal(vision(13300), 0)
  assert.equal(vision(3300, 4250), 0)
  assert.equal(poisonCloudContract(0.36), 1)
  assert.ok(near(poisonCloudContract(0.96), 1.1))
})

test('the drawing: puffs and a dissolving shell as it rises, whole while up, eaten and grown as it fades', () => {
  const opening = poisonCloudState(300, null)
  assert.equal(opening.dome, false)
  assert.ok(opening.flash > 0.4)
  const rising = poisonCloudState(900, null)
  assert.ok(rising.dome && rising.scale > 0 && rising.scale < 1)
  assert.ok(rising.disIn > 0 && rising.disIn < 1)
  assert.ok(rising.puffs.length > 0)
  assert.ok(near(rising.boost, 1.8))
  const up = poisonCloudState(6000, null)
  assert.deepEqual([up.scale, up.disIn, up.dissolve, up.outro, up.halo, up.puffs.length, up.glow, up.boost, up.gem], [1, 1, 0, 0, 1, 0, 0, 1, 1])
  assert.ok(near(up.materialTime, 5.4))
  const fading = poisonCloudState(13000, null)
  assert.ok(near(fading.outro, 0.5) && near(fading.scale, 1.05))
  assert.ok(fading.outroDis < 1 && fading.dissolve > 0)
  const clearing = poisonCloudState(13600, null)
  assert.equal(clearing.dome, false)
  assert.equal(clearing.scale, 0)
  assert.ok(clearing.gem < 0.2)
  assert.equal(poisonCloudState(14250, null).scale, 0)
})

test('a placed cloud is up, whole and only drifts', () => {
  const idle = poisonCloudIdle(3)
  const up = poisonCloudState(6000, null)
  assert.deepEqual(idle, { ...up, fuel: 1, materialTime: 3, flash: 0 })
})

test('only Viper’s Q is a Poison Cloud', () => {
  assert.ok(isPoisonCloud('Viper', 'Ability1'))
  assert.ok(isPoisonCloud(' viper ', 'Ability1'))
  assert.ok(!isPoisonCloud('Viper', 'Ability2'))
  assert.ok(!isPoisonCloud('Omen', 'Ability1'))
  assert.ok(!isPoisonCloud('Viper', null))
  assert.ok(POISON_CLOUD.visionCm > POISON_CLOUD.shellCm)
})
