import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WAVEFORM, isWaveform, waveformContract, waveformExpand, waveformIdle, waveformState, waveformTotalMs } from './waveformSmoke.ts'

test('a Waveform actor lives 18.25 s, as the 13.05 to 13.10 replays record', () => {
  assert.equal(waveformTotalMs(), 18250)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => waveformState(ms).phase
  assert.equal(phase(0), 'incoming')
  assert.equal(phase(999), 'incoming')
  assert.equal(phase(1000), 'forming')
  assert.equal(phase(1749), 'forming')
  assert.equal(phase(1750), 'active')
  assert.equal(phase(15749), 'active')
  assert.equal(phase(15750), 'ending')
  assert.equal(phase(17249), 'ending')
  assert.equal(phase(17250), 'dissolving')
  assert.equal(phase(18249), 'dissolving')
  assert.equal(phase(18250), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(Number.NaN), 'gone')
})

test('it blocks sight from 40 % into the expand until 62 % into the contract', () => {
  const vision = (ms: number) => waveformState(ms).vision
  assert.equal(vision(500), 0)
  assert.equal(vision(1299), 0)
  assert.equal(vision(1300), 0)
  assert.ok(Math.abs(vision(1318.75) - 0.5) < 1e-9)
  assert.equal(vision(1337.5), 1)
  assert.equal(vision(1750), 1)
  assert.equal(vision(17250), 1)
  assert.equal(vision(17869), 1)
  assert.equal(vision(17871), 0)
})

test('the expand and contract curves are the game curves', () => {
  assert.equal(waveformExpand(0), 0)
  assert.equal(waveformExpand(0.39), 0)
  assert.ok(Math.abs(waveformExpand(0.425) - 0.5) < 1e-9)
  assert.equal(waveformExpand(0.45), 1)
  assert.equal(waveformExpand(2), 1)
  assert.equal(waveformContract(0.62), 1)
  assert.equal(waveformContract(0.63), 0)
})

test('the drawing: announced, dissolving in, whole, warned, dissolving out, gone', () => {
  const incoming = waveformState(500)
  assert.equal(incoming.scale, 1)
  assert.equal(incoming.dissolve, -1)
  assert.equal(incoming.rings.length, 2)
  const landing = waveformState(1250)
  assert.ok(landing.indA > 0 && landing.shockA > 0 && landing.flash > 0)
  assert.ok(Math.abs(landing.dissolve - (-1 + 2 * 250 / 850)) < 1e-9)
  const active = waveformState(8000)
  assert.deepEqual([active.dissolve, active.linesA, active.bands, active.warn, active.flash, active.wipeR], [1, 1, 1, 0, 0, -1])
  assert.equal(active.materialTime, 8)
  assert.equal(active.triangles.length, 0)
  const ending = waveformState(16500)
  assert.ok(Math.abs(ending.warn - 0.5) < 1e-9)
  assert.ok(ending.triangles.length > 0 && ending.warnGlow > 0)
  const out = waveformState(17750)
  assert.ok(Math.abs(out.dissolve - 0) < 1e-9)
  assert.equal(out.wipeDir, -1)
  assert.equal(waveformState(18250).scale, 0)
})

test('a placed Waveform is whole and only drifts', () => {
  assert.deepEqual(waveformIdle(3), { ...waveformState(8000), materialTime: 3 })
})

test('only Miks’s E is a Waveform', () => {
  assert.ok(isWaveform('Miks', 'Ability2'))
  assert.ok(isWaveform(' miks ', 'Ability2'))
  assert.ok(!isWaveform('Miks', 'Ability1'))
  assert.ok(!isWaveform('Clove', 'Ability2'))
  assert.ok(!isWaveform('Miks', null))
  assert.ok(WAVEFORM.linesCm > WAVEFORM.shellCm && WAVEFORM.shellCm > WAVEFORM.visionCm)
})
