/**
 * Unit tests for what an agent has left at an instant (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { blindAt, KIT_GLOW_MS, kitAt, vitalsAt } from './replayKit.ts'
import type { ReplayKit } from './replayBundle.ts'

const kit: ReplayKit = {
  // Bought in the buy phase (live from 30 s), one used at 40 s, one back at 60 s.
  Q: [[10000, 1], [12000, 2], [40000, 1], [60000, 2]],
  C: [[10000, 1], [41000, 0]],
  X: [[5000, 6], [50000, 7], [70000, 0]],
  cost: 7,
}

const at = (t: number) => Object.fromEntries(kitAt(kit, t, 30000).map(s => [s.slot, s]))

test('charges are what the replay held at that moment', () => {
  assert.equal(at(20000).Ability1.n, 2)
  assert.equal(at(45000).Ability1.n, 1)
  assert.equal(at(45000).Grenade.n, 0)
  assert.equal(at(45000).Ability1.max, 2)
  assert.equal(at(5000).Ability1.n, 0)
})

test('buying in the buy phase does not glow', () => {
  assert.equal(at(12500).Ability1.glow, 0)
})

test('a charge coming back in the round glows, then fades', () => {
  assert.equal(at(59000).Ability1.glow, 0)
  assert.ok(Math.abs(at(60000).Ability1.glow - 1) < 1e-9)
  assert.ok(Math.abs(at(60000 + KIT_GLOW_MS / 2).Ability1.glow - 0.5) < 1e-9)
  assert.equal(at(60000 + KIT_GLOW_MS).Ability1.glow, 0)
})

test('spending a charge never glows', () => {
  assert.equal(at(40500).Ability1.glow, 0)
  assert.equal(at(41500).Grenade.glow, 0)
})

test('the ultimate is ready at its cost, glows when it gets there, and is spent by using it', () => {
  assert.equal(at(45000).Ultimate.n, 0)
  assert.equal(at(50100).Ultimate.n, 1)
  assert.ok(at(50100).Ultimate.glow > 0.9)
  assert.equal(at(69000).Ultimate.glow, 0)
  assert.equal(at(70500).Ultimate.n, 0)
  assert.equal(at(70500).Ultimate.glow, 0)
})

test('an unmeasured agent is ready at the most points it held', () => {
  const x = kitAt({ X: [[1000, 3], [2000, 8]] }, 3000, 0)[0]
  assert.equal(x.n, 1)
})

test('a player is blinded only inside a window, and it runs out', () => {
  const windows: [number, number][] = [[1000, 3000], [5000, 6000]]
  assert.equal(blindAt(windows, 900), null)
  assert.equal(blindAt(windows, 1000), 1)
  assert.equal(blindAt(windows, 2000), 0.5)
  assert.equal(blindAt(windows, 3000), null)
  assert.equal(blindAt(windows, 5500), 0.5)
  assert.equal(blindAt(windows, 7000), null)
})

test('a key with no record is left out', () => {
  assert.deepEqual(kitAt({ Q: [[1000, 1]] }, 2000, 0).map(s => s.slot), ['Ability1'])
})

test('health and armour are the last the game reported, a full 100 before that', () => {
  const rows: [number, number, number][] = [[10000, 100, 50], [40000, 74, 12], [41000, 39, 0]]
  assert.deepEqual(vitalsAt(rows, 5000), { hp: 100, armor: 0 })
  assert.deepEqual(vitalsAt(rows, 10000), { hp: 100, armor: 50 })
  assert.deepEqual(vitalsAt(rows, 40500), { hp: 74, armor: 12 })
  assert.deepEqual(vitalsAt(rows, 90000), { hp: 39, armor: 0 })
  assert.deepEqual(vitalsAt([], 90000), { hp: 100, armor: 0 })
})
