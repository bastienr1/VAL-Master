import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOT_HANDS, HOT_HANDS_SITES, hotHandsClock, hotHandsIdle, hotHandsState, hotHandsTotalMs, isHotHands } from './hotHands.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('the patch actor lives 7.2 s, as the replays record', () => {
  // 297 replays: median 7.20 s (burn 4.2 + fade 3.0).
  assert.equal(hotHandsTotalMs(), 7200)
  assert.equal(hotHandsTotalMs(), HOT_HANDS.burnMs + HOT_HANDS.fadeMs)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => hotHandsState(ms).phase
  assert.equal(phase(0), 'spreading')
  assert.equal(phase(791), 'spreading')
  assert.equal(phase(792), 'burning')
  assert.equal(phase(3571), 'burning')
  assert.equal(phase(3572), 'ending')
  assert.equal(phase(4199), 'ending')
  assert.equal(phase(4200), 'dying')
  assert.equal(phase(5699), 'dying')
  assert.equal(phase(5700), 'out')
  assert.equal(phase(7199), 'out')
  assert.equal(phase(7200), 'gone')
  assert.equal(phase(9000), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(Number.NaN), 'gone')
})

test('it spreads 6 m a second from the landing: the full 4.75 m at 792 ms, with no delay', () => {
  const at = (ms: number) => hotHandsState(ms)
  assert.equal(at(0).spread, 0)
  assert.ok(near(at(100).frontCm, 60))
  assert.ok(near(at(500).frontCm, 300))
  assert.ok(near(at(500).spread, 300 / 475))
  assert.ok(at(791).spread < 1 && at(791).spread > 0.99)
  assert.equal(at(792).spread, 1)
  assert.equal(at(792).frontCm, 475)
  assert.equal(at(4000).spread, 1)
  assert.equal(at(7199).spread, 1)
  // 475 / 600 s.
  assert.ok(near((HOT_HANDS.radiusCm / HOT_HANDS.spreadCmS) * 1000, 791.6667, 1e-3))
})

test('it burns for 4.2 s, then fades for 3 s', () => {
  const at = (ms: number) => hotHandsState(ms)
  assert.deepEqual([at(0).burning, at(0).burn, at(0).fade], [true, 1, 0])
  assert.ok(near(at(2100).burn, 0.5))
  assert.equal(at(4199).burning, true)
  assert.deepEqual([at(4200).burning, at(4200).burn, at(4200).fade], [false, 0, 0])
  assert.ok(near(at(5700).fade, 0.5))
  assert.ok(at(7199).fade > 0.999)
  assert.equal(at(3000).materialTime, 3)
})

test('the ground fire dims from 3.57 s and is gone at 5 s; it is born hot', () => {
  const at = (ms: number) => hotHandsState(ms)
  assert.equal(at(0).decal, 1)
  assert.equal(at(2800).decal, 1)
  assert.ok(at(3571).decal > 0.99)
  assert.ok(near(at((5000 * 6) / 7).decal, 0.477 / 0.7))
  assert.ok(at(4999).decal > 0 && at(4999).decal < 0.01)
  assert.equal(at(5000).decal, 0)
  assert.ok(near(HOT_HANDS.decalDimFromMs, 3571.43, 0.01))
  assert.ok(near(at(0).heat, 6.107))
  assert.equal(at(5000).heat, 1)
  assert.equal(at(6000).heat, 1)
  // The landing flash: 0.4 s.
  assert.equal(at(0).flash, 0)
  assert.ok(near(at(200).flash, 0.5))
  assert.equal(at(400).flash, -1)
})

test('the flames: lit as the spread reaches them, looping while it burns, out by 5.7 s', () => {
  const at = (ms: number) => hotHandsState(ms)
  assert.equal(at(0).flames.length, 0)
  // The middle lights first: the birth flames.
  const early = at(150).flames
  assert.ok(early.length >= 1 && early.every(f => f.birth === 1 && Math.hypot(f.x, f.y) <= 90))
  // Every site is lit by the end of the spread, and never more than two flames burn at one.
  assert.equal(at(792).flames.length, HOT_HANDS_SITES)
  for (let ms = 0; ms < 7200; ms += 37) {
    const s = at(ms)
    assert.ok(s.flames.length <= HOT_HANDS_SITES * 2)
    for (const f of s.flames) {
      // Each stays inside the burning area and is well formed.
      assert.ok(f.len >= 24 && f.len <= 175 * 1.15 + 1e-9)
      assert.ok(Math.hypot(f.x, f.y) + 0.85 * f.len <= s.frontCm - 12 + 1e-6)
      assert.ok(f.alpha >= 0 && f.alpha <= 1 && f.outro >= 0 && f.outro <= 1 && f.intro >= 0 && f.intro <= 1)
      assert.ok(near(f.wid, f.len * (f.birth ? 0.62 : 0.5)))
    }
  }
  // Looping flames while it burns; no new one after 4.2 s, the last (1.5 s at most) gone by 5.7 s.
  assert.ok(at(2500).flames.length >= HOT_HANDS_SITES && at(2500).flames.every(f => f.birth === 0))
  assert.ok(at(4300).flames.length > 0)
  assert.ok(at(5400).flames.length < at(4300).flames.length)
  assert.equal(at(5700).flames.length, 0)
  assert.equal(at(6500).flames.length, 0)
  // The same age is always the same picture.
  assert.deepEqual(at(2345), at(2345))
})

test('nothing is drawn after the actor is gone, or before it', () => {
  for (const ms of [7200, 7201, 10000, -1, Number.NaN]) {
    const s = hotHandsState(ms)
    assert.deepEqual([s.phase, s.spread, s.frontCm, s.burning, s.burn, s.decal, s.flash, s.flames.length, s.fade], ['gone', 0, 0, false, 0, 0, -1, 0, 0])
  }
  // The fade's tail has nothing left to draw either: the ground glow went at 5 s, the flames at 5.7 s.
  const tail = hotHandsState(7000)
  assert.deepEqual([tail.phase, tail.decal, tail.flash, tail.flames.length], ['out', 0, -1, 0])
})

test('the clock counts the 4.2 s it hurts, not the actor’s 7.2 s', () => {
  assert.deepEqual(hotHandsClock(0), { life: 1, seconds: 5 })
  assert.deepEqual(hotHandsClock(2100), { life: 0.5, seconds: 3 })
  assert.deepEqual(hotHandsClock(200), { life: 4000 / 4200, seconds: 4 })
  assert.deepEqual(hotHandsClock(3200), { life: 1000 / 4200, seconds: 1 })
  assert.equal(hotHandsClock(4199)?.seconds, 1)
  assert.ok((hotHandsClock(4199)?.life ?? 1) < 0.001)
  assert.equal(hotHandsClock(4200), null)
  assert.equal(hotHandsClock(5000), null)
  assert.equal(hotHandsClock(7200), null)
  assert.equal(hotHandsClock(-1), null)
  assert.equal(hotHandsClock(Number.NaN), null)
})

test('a placed Hot Hands is whole and only flickers', () => {
  const idle = hotHandsIdle(3.2)
  assert.deepEqual([idle.phase, idle.spread, idle.frontCm, idle.burning, idle.burn, idle.decal, idle.flash, idle.fade, idle.materialTime], ['burning', 1, 475, true, 1, 1, -1, 0, 3.2])
  // It looks like the fire half-way through its burn…
  assert.deepEqual(hotHandsIdle(0).flames, hotHandsState(2100).flames)
  assert.equal(hotHandsIdle(0).heat, hotHandsState(2100).heat)
  // …and never burns down: flames at every moment, well past the 4.2 s.
  for (const s of [0, 1.7, 6, 30, 600.4]) {
    const flames = hotHandsIdle(s).flames
    assert.ok(flames.length >= HOT_HANDS_SITES / 2 && flames.length <= HOT_HANDS_SITES * 2)
    assert.ok(flames.every(f => f.birth === 0))
  }
  assert.equal(hotHandsIdle(-5).materialTime, 0)
})

test('only Phoenix’s Q is Hot Hands', () => {
  assert.ok(isHotHands('Phoenix', 'Ability1'))
  assert.ok(isHotHands(' phoenix ', 'Ability1'))
  assert.ok(isHotHands('PHOENIX', 'Ability1'))
  assert.ok(!isHotHands('Phoenix', 'Ability2'))
  assert.ok(!isHotHands('Phoenix', 'Grenade'))
  assert.ok(!isHotHands('Phoenix', 'Ultimate'))
  assert.ok(!isHotHands('Brimstone', 'Ability1'))
  assert.ok(!isHotHands('Phoenix', null))
  assert.equal(HOT_HANDS.radiusCm, 475)
})
