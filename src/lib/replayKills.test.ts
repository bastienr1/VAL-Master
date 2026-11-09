/**
 * Unit tests for who killed whom (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { KILL_FEED_MS, killMarks } from './replayKills.ts'
import type { ReplayBundle, ReplayRound } from './replayBundle.ts'
import { createFrameIds, type ReplayAgentLookup } from './replayFrame.ts'

const round = { n: 1, buyStartMs: 0, barrierMs: 30000, endMs: 90000 } as ReplayRound
const lookup: ReplayAgentLookup = id => (id === 'a' ? { name: 'Raze', abilities: [{ slot: 'Ability1', name: 'Blast Pack' }] } : id === 'b' ? { name: 'Omen', abilities: [] } : null)
const T = { xMultiplier: 1e-4, yMultiplier: 0, xScalarToAdd: 0.5, yMultiplier2: 0 } as never

function bundle(): ReplayBundle {
  return {
    players: [
      { subject: 'me', agentId: 'a', team: 'ALLY' },
      { subject: 'foe', agentId: 'b', team: 'ENEMY' },
    ],
    weapons: [
      { cls: 'AssaultRifle_AK_C', name: 'Vandal', cat: 'rifle' },
      { cls: 'GameObject_Clay_Q_Explosion_C', name: null, cat: null },
      { cls: 'Something_Unknown_C', name: null, cat: null },
    ],
    kills: [
      { t: 50000, round: 1, killer: 'me', victim: 'foe', weapon: 0, kx: 0, ky: 0, vx: 1000, vy: 0 },
      { t: 60000, round: 1, killer: 'foe', victim: 'foe', weapon: null, kx: 0, ky: 0, vx: 500, vy: 0 },
      { t: 70000, round: 1, killer: 'me', victim: 'foe', weapon: 1, kx: 0, ky: 0, vx: 200, vy: 0 },
      { t: 75000, round: 1, killer: 'me', victim: 'foe', weapon: 2, kx: null, ky: null, vx: 300, vy: 0 },
      { t: 150000, round: 2, killer: 'me', victim: 'foe', weapon: 0, kx: 0, ky: 0, vx: 1000, vy: 0 },
    ],
  } as unknown as ReplayBundle
}

const marks = (t: number) => killMarks(bundle(), t, round, T, createFrameIds(), lookup, s => (s === 'me' ? 'Jo3ast' : undefined))

test('a kill says who killed whom, with what, from where to where', () => {
  assert.equal(marks(49000).length, 0)
  const [kill] = marks(50000)
  assert.equal(kill.killer?.name, 'Jo3ast')
  assert.equal(kill.killer?.team, 'ally')
  assert.equal(kill.victim.name, 'Omen')
  assert.equal(kill.victim.team, 'enemy')
  assert.equal(kill.weapon, 'Vandal')
  assert.ok(kill.from && kill.to)
  assert.ok(kill.killerId)
})

test('a kill knows its age, leaves the feed in time, and the death stays for the round', () => {
  assert.equal(marks(50000)[0].age, 0)
  assert.equal(marks(50300)[0].age, 300)
  assert.ok(marks(50000 + KILL_FEED_MS / 2)[0].feed > 0)
  assert.equal(marks(50000 + KILL_FEED_MS)[0].feed, 0)
  assert.equal(marks(89000).length, 4)
})

test('a self-death has no killer and no line', () => {
  const kill = marks(60000)[1]
  assert.equal(kill.killer, null)
  assert.equal(kill.killerId, null)
  assert.equal(kill.from, null)
})

test('an ability kill is named from its class, and an unknown one just says so', () => {
  assert.equal(marks(70000)[2].weapon, 'Blast Pack')
  assert.equal(marks(75000)[3].weapon, 'Ability')
  assert.equal(marks(75000)[3].from, null)
})
