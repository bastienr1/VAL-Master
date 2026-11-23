import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SHOCK,
  SHOCK_FLIGHT,
  SHOCK_SHOWN_MS,
  isShockDart,
  sampleCurve,
  shockFlightShown,
  shockHeadAgo,
  shockIdle,
  shockRandom,
  shockSeed,
  shockState,
  shockWay,
  shockWayAt,
  type ShockWayPoint,
} from './shockDart.ts'

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

const nearly = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`)

/**
 * A bolt thrown at (3, 1) cm/ms that meets a wall at x = 900 after 300 ms and
 * leaves it at 60 % of its speed, sampled where a replay would: never at the
 * wall. `now` is how long after the throw the frame is.
 */
function bounced(now: number): ShockWayPoint[] {
  const at = (t: number): [number, number] => (t <= 300 ? [3 * t, t] : [900 - 1.8 * (t - 300), 300 + 0.6 * (t - 300)])
  return [0, 100, 200, 400, 500, 600].map(t => ({ x: at(t)[0], y: at(t)[1], ago: now - t }))
}

test('the flight’s figures are the effects’', () => {
  assert.deepEqual([SHOCK_FLIGHT.trailMs, SHOCK_FLIGHT.trailCm, SHOCK_FLIGHT.ricochetMs, SHOCK_FLIGHT.ricochetCm], [400, 20, 450, 250])
})

test('a bounce between two samples is put back at the wall, at the moment it happened', () => {
  const way = shockWay(bounced(600))
  assert.equal(way.points.length, 7)
  assert.equal(way.bounces.length, 1)
  const [bounce] = way.bounces
  nearly(bounce.x, 900, 'x')
  nearly(bounce.y, 300, 'y')
  nearly(bounce.ago, 300, 'ago')
  // Off the wall: back the way of −x.
  nearly(Math.abs(bounce.off), Math.PI, 'off')
  // The way goes through the corner, not across it.
  const corner = shockWayAt(way, 300)!
  nearly(corner.x, 900, 'corner x')
  nearly(corner.y, 300, 'corner y')
  const before = shockWayAt(way, 350)!
  nearly(before.x, 750, 'before x')
  nearly(before.y, 250, 'before y')
  nearly(before.heading, Math.atan2(1, 3), 'heading in')
  const after = shockWayAt(way, 250)!
  nearly(after.x, 810, 'after x')
  nearly(after.y, 330, 'after y')
  nearly(after.heading, Math.atan2(0.6, -1.8), 'heading out')
})

test('the corner is the same before the bolt gets there: the way does not jump as the replay plays', () => {
  // 250 ms after the throw: the wall is 50 ms ahead.
  const way = shockWay(bounced(250))
  nearly(way.bounces[0].ago, -50, 'ago')
  const head = shockWayAt(way, 0)!
  nearly(head.x, 750, 'x')
  nearly(head.y, 250, 'y')
  assert.equal(shockHeadAgo(way), 0)
  assert.ok(shockFlightShown(way))
})

test('a single turn is a bounce at the sample itself', () => {
  const way = shockWay([
    { x: 0, y: 0, ago: 300 },
    { x: 300, y: 0, ago: 200 },
    { x: 300, y: 300, ago: 100 },
    { x: 300, y: 600, ago: 0 },
  ])
  assert.equal(way.points.length, 4)
  assert.deepEqual(way.bounces.map(b => [b.x, b.y, b.ago]), [[300, 0, 200]])
  nearly(way.bounces[0].off, (3 * Math.PI) / 4, 'off')
})

test('a straight throw has no bounce, and junk in a track is dropped', () => {
  const way = shockWay([
    { x: 0, y: 0, ago: 200 },
    { x: Number.NaN, y: 0, ago: 150 },
    { x: 100, y: 0, ago: 100 },
    { x: 100, y: 0, ago: 50 },
    { x: 150, y: 0, ago: 120 },
    { x: 200, y: 0, ago: 0 },
  ])
  assert.deepEqual(way.points.map(p => p.x), [0, 100, 200])
  assert.deepEqual(way.bounces, [])
  assert.equal(shockWayAt(shockWay([{ x: 0, y: 0, ago: 0 }]), 0), null)
  // Before the throw and after the landing it holds its ends.
  nearly(shockWayAt(way, 900)!.x, 0, 'start')
  nearly(shockWayAt(way, -900)!.x, 200, 'end')
})

test('after it lands the ribbon dies in 0.4 s and a late bounce’s flash in 0.45 s', () => {
  const landed = (since: number) => shockWay([{ x: 0, y: 0, ago: since + 500 }, { x: 1500, y: 0, ago: since }])
  assert.equal(shockHeadAgo(landed(120)), 120)
  assert.ok(shockFlightShown(landed(399)))
  assert.ok(!shockFlightShown(landed(400)))
  // It bounced 20 ms before it landed.
  const late = (since: number) =>
    shockWay([
      { x: 0, y: 0, ago: since + 320 },
      { x: 900, y: 0, ago: since + 20 },
      { x: 900, y: 30, ago: since },
    ])
  assert.equal(late(410).bounces.length, 1)
  assert.ok(shockFlightShown(late(410)))
  assert.ok(!shockFlightShown(late(430)))
})
