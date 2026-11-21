import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHOCK, SHOCK_SHOWN_MS, isShockDart, sampleCurve, shockIdle, shockRandom, shockSeed, shockState } from './shockDart.ts'

test('the figures are the game files’', () => {
  assert.deepEqual([SHOCK.outerCm, SHOCK.innerCm, SHOCK.maxDamage, SHOCK.minDamage], [400, 150, 75, 30])
  assert.deepEqual([SHOCK.armMs, SHOCK.actorMs], [400, 4000])
  assert.equal(SHOCK_SHOWN_MS, 850)
})

test('it lands, arms for 0.4 s, goes off, and its actor idles to 4 s', () => {
  const phase = (ms: number) => shockState(ms).phase
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(0), 'armed')
  assert.equal(phase(399), 'armed')
  assert.equal(phase(400), 'blast')
  assert.equal(phase(849), 'blast')
  assert.equal(phase(850), 'spent')
  assert.equal(phase(3999), 'spent')
  assert.equal(phase(4000), 'gone')
})

test('the arming and the blast each run on their own clock', () => {
  const armed = shockState(200)
  assert.deepEqual([armed.arm, armed.blast], [0.5, -1])
  assert.ok(Math.abs(armed.spark - 0.4) < 1e-9)
  const blast = shockState(650)
  assert.equal(blast.arm, 1)
  assert.ok(Math.abs(blast.blast - 0.25) < 1e-9)
})

test('a placed dart is armed and only its spark moves', () => {
  const a = shockIdle(0.2)
  const b = shockIdle(0.7)
  assert.deepEqual([a.phase, a.arm, a.blast], ['armed', 0.75, -1])
  assert.equal(b.arm, a.arm)
  assert.notEqual(b.spark, a.spark)
  for (const s of [a, b, shockIdle(123.4)]) assert.ok(s.spark >= 0 && s.spark < 0.75)
})

test('the same bolt has the same lightning on every frame', () => {
  assert.equal(shockSeed('fx-12'), shockSeed('fx-12'))
  assert.notEqual(shockSeed('fx-12'), shockSeed('fx-13'))
  assert.ok(shockSeed('') >= 1)
  const seed = shockSeed('fx-12')
  assert.equal(shockRandom(seed, 3), shockRandom(seed, 3))
  for (let i = 0; i < 20; i++) {
    const v = shockRandom(seed, i)
    assert.ok(v >= 0 && v < 1)
  }
})

test('a curve is read between its samples', () => {
  assert.equal(sampleCurve([0, 1], 0.25), 0.25)
  assert.equal(sampleCurve([1, 0.5, 0], 0.5), 0.5)
  assert.equal(sampleCurve([1, 0.5, 0], 2), 0)
  assert.equal(sampleCurve([1, 0.5, 0], -1), 1)
})

test('only Sova’s Q is a Shock Dart', () => {
  assert.ok(isShockDart('Sova', 'Ability1'))
  assert.ok(isShockDart(' sova ', 'Ability1'))
  assert.ok(!isShockDart('Sova', 'Ability2'))
  assert.ok(!isShockDart('Clove', 'Ability1'))
  assert.ok(!isShockDart('Sova', null))
})
