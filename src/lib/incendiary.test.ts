import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INCENDIARY, incendiaryClock, incendiaryIdle, incendiaryState, incendiaryTotalMs, isIncendiary } from './incendiary.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('a patch actor lives 11.0 s, as the replays record', () => {
  // replay_stats: Patch_Sarge_Q_Molotov_Production_C median 11 003 ms, p90 11 006 ms over 218.
  assert.equal(incendiaryTotalMs(), 11000)
  assert.equal(incendiaryTotalMs(), INCENDIARY.burnMs + INCENDIARY.fadeOutMs)
  assert.ok(Math.abs(incendiaryTotalMs() - 11003) < 20)
})

test('the phases follow the game timings', () => {
  const phase = (ms: number) => incendiaryState(ms).phase
  assert.equal(phase(0), 'impact')
  assert.equal(phase(199), 'impact')
  assert.equal(phase(200), 'spreading')
  assert.equal(phase(949), 'spreading')
  assert.equal(phase(950), 'burning')
  assert.equal(phase(7999), 'burning')
  assert.equal(phase(8000), 'dying')
  assert.equal(phase(8699), 'dying')
  assert.equal(phase(8700), 'tail')
  assert.equal(phase(10999), 'tail')
  assert.equal(phase(11000), 'gone')
  assert.equal(phase(60000), 'gone')
  assert.equal(phase(-1), 'gone')
  assert.equal(phase(Number.NaN), 'gone')
})

test('the fire spreads at 600 cm/s after 200 ms: the whole 450 cm at 950 ms', () => {
  const spread = (ms: number) => incendiaryState(ms).spread
  assert.equal(spread(0), 0)
  assert.equal(spread(200), 0)
  assert.ok(near(spread(300) * INCENDIARY.hurtCm, 60))
  assert.ok(near(spread(575), 0.5))
  assert.ok(spread(949) < 1 && spread(949) > 0.99)
  assert.equal(spread(950), 1)
  assert.equal(spread(5000), 1)
  assert.equal(spread(10999), 1)
  assert.equal(INCENDIARY.spreadDelayMs + (INCENDIARY.hurtCm / INCENDIARY.spreadCmPerS) * 1000, 950)
})

test('it hurts inside the front from 200 ms until the burn ends at 8.0 s', () => {
  const hurting = (ms: number) => incendiaryState(ms).hurting
  assert.equal(hurting(0), false)
  assert.equal(hurting(199), false)
  assert.equal(hurting(200), true)
  assert.equal(hurting(7999), true)
  assert.equal(hurting(8000), false)
  assert.equal(hurting(9000), false)
})

test('the ground glows on the decal curve: in by 1.4 s, out from 7.8 to 8.5 s', () => {
  const at = (ms: number) => incendiaryState(ms)
  assert.equal(at(0).glow, 0)
  assert.equal(at(0).glowScale, 0.5)
  assert.equal(at(0).burn, 0)
  assert.ok(at(600).glow > 0 && at(600).glow < 1)
  // 8.5 s / 32 per table entry: entry 5 (1 328 ms) is the first at full glow.
  assert.ok(near(at((8500 * 5) / 32).glow, 1))
  assert.deepEqual([at(4200).glow, at(4200).glowScale, at(4200).burn], [1, 1, 1])
  assert.ok(near(at(7437).glow, 1, 1e-3))
  assert.ok(at(8000).glow < 1 && at(8000).glow > 0.3)
  assert.ok(at(8400).glow > 0 && at(8400).glow < 0.2)
  assert.equal(at(8500).glow, 0)
  assert.equal(at(9000).glow, 0)
  assert.equal(at(4200).materialTime, 4.2)
})

test('the drawing: an impact burst, spots catching as the front passes, flames while it burns', () => {
  const impact = incendiaryState(60)
  assert.ok(near(impact.impact, 0.7))
  assert.ok(impact.sprites.length > 20)
  // Flash, streaks and sparks are thrown clear of the floor: none is kept inside the patch.
  assert.ok(impact.sprites.every(s => !s.clip))
  assert.equal(incendiaryState(200).impact, 0)

  const spreading = incendiaryState(600)
  assert.ok(near(spreading.front, 0.85 * (1 - 0.6 * spreading.spread)))
  // Only spots the front has reached are alight.
  const reach = spreading.spread * INCENDIARY.hurtCm
  for (const s of spreading.sprites) if (s.clip && s.kind === 1) assert.ok(Math.hypot(s.x, s.y) <= reach + 1e-6)
  assert.equal(incendiaryState(950).front, 0)

  const burning = incendiaryState(4200)
  const flames = burning.sprites.filter(s => s.kind === 0)
  assert.ok(flames.length >= 5)
  for (const s of flames) {
    assert.equal(s.row, 3)
    assert.ok(s.size >= 135 && s.size <= 175)
    assert.ok(s.frame >= 0 && s.frame < 16)
    assert.ok(Math.hypot(s.x, s.y) <= INCENDIARY.hurtCm)
  }
  assert.deepEqual([burning.impact, burning.front, burning.footprint, burning.fade], [0, 0, 0, 0])
  // In drawing order.
  for (let i = 1; i < burning.sprites.length; i++) assert.ok(burning.sprites[i - 1].order <= burning.sprites[i].order)
  // The same age is always the same picture.
  assert.deepEqual(incendiaryState(4200), burning)
})

test('the fire dies after the burn: no flame by 8.7 s, then only the mark of where it was', () => {
  for (let ms = 8700; ms < 11000; ms += 50) assert.equal(incendiaryState(ms).sprites.filter(s => s.kind !== 2).length, 0, `a flame at ${ms}`)
  // The last embers (life up to 1.0 s) are out a second after the burn.
  for (let ms = 9000; ms < 11000; ms += 50) assert.equal(incendiaryState(ms).sprites.length, 0, `a sprite at ${ms}`)
  const dying = incendiaryState(8200)
  assert.ok(near(dying.footprint, 0.55 * 0.5))
  const tail = incendiaryState(9850)
  assert.ok(near(tail.fade, 0.5))
  assert.ok(near(tail.footprint, 0.55 * 0.75))
  assert.equal(tail.glow, 0)
})

test('nothing is drawn once the actor is gone', () => {
  for (const ms of [11000, 11001, 20000, -1, Number.NaN]) {
    const s = incendiaryState(ms)
    assert.deepEqual([s.phase, s.spread, s.hurting, s.glow, s.burn, s.impact, s.front, s.footprint, s.sprites.length], ['gone', 0, false, 0, 0, 0, 0, 0, 0])
  }
})

test('the clock counts the 8.0 s the fire hurts, not the actor', () => {
  assert.deepEqual(incendiaryClock(0), { life: 1, seconds: 8 })
  assert.deepEqual(incendiaryClock(1), { life: 7999 / 8000, seconds: 8 })
  assert.deepEqual(incendiaryClock(4000), { life: 0.5, seconds: 4 })
  assert.deepEqual(incendiaryClock(7000), { life: 0.125, seconds: 1 })
  assert.deepEqual(incendiaryClock(7999), { life: 1 / 8000, seconds: 1 })
  assert.equal(incendiaryClock(8000), null)
  assert.equal(incendiaryClock(9500), null)
  assert.equal(incendiaryClock(11000), null)
  assert.equal(incendiaryClock(-1), null)
  assert.equal(incendiaryClock(Number.NaN), null)
})

test('a placed Incendiary is whole, burning, and only flickers', () => {
  const idle = incendiaryIdle(3.2)
  assert.deepEqual(
    [idle.phase, idle.spread, idle.hurting, idle.glow, idle.glowScale, idle.burn, idle.impact, idle.front, idle.footprint, idle.fade, idle.materialTime],
    ['burning', 1, true, 1, 1, 1, 0, 0, 0, 0, 3.2],
  )
  // Flames and embers only: nothing of the impact or of a spot catching fire.
  assert.ok(idle.sprites.length > 0)
  assert.ok(idle.sprites.every(s => (s.kind === 0 && s.row === 3) || s.kind === 2))
  // It never runs out, and the loop has no seam: the flames just before it wraps carry on after.
  for (const seconds of [0, 5.79, 5.81, 60, 3600]) assert.ok(incendiaryIdle(seconds).sprites.filter(s => s.kind === 0).length >= 5, `flames at ${seconds}`)
  const before = incendiaryIdle(5.8 - 1e-4).sprites.filter(s => s.kind === 0)
  const after = incendiaryIdle(5.8 + 1e-4).sprites.filter(s => s.kind === 0)
  assert.equal(after.length, before.length)
  before.forEach((s, i) => assert.ok(near(s.x, after[i].x) && near(s.y, after[i].y) && near(s.frame, after[i].frame, 0.02)))
  assert.equal(incendiaryIdle(-5).materialTime, 0)
})

test('only Brimstone’s Q is an Incendiary', () => {
  assert.ok(isIncendiary('Brimstone', 'Ability1'))
  assert.ok(isIncendiary(' brimstone ', 'Ability1'))
  assert.ok(!isIncendiary('Brimstone', 'Ability2'))
  assert.ok(!isIncendiary('Brimstone', 'Grenade'))
  assert.ok(!isIncendiary('Phoenix', 'Ability1'))
  assert.ok(!isIncendiary('Brimstone', null))
  assert.equal(INCENDIARY.hurtCm, 450)
})
