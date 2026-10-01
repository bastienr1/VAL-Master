/**
 * Unit tests for the minimap bundle decode/validate step (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REPLAY_BUNDLE_SCHEMA,
  ReplayBundleError,
  assertBundleForMatch,
  parseReplayBundle,
  replayStoragePath,
  summarizeReplayBundle,
} from './replayBundle.ts'

const MATCH = '00931947-d697-48fb-99e6-2f73620e41ab'
const ME = 'aaaaaaaa-0000-0000-0000-000000000001'
const FOE = 'bbbbbbbb-0000-0000-0000-000000000002'

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    schema: REPLAY_BUNDLE_SCHEMA,
    parser: { vrfkit: 'v13.06.0', reducer: '0.1.0' },
    match: { matchId: MATCH, mapUuid: null, mapUrl: '/Game/Maps/Jam/Jam', build: 'release-13.06', recordedAt: '2026-09-29T04:48:00Z', durationMs: 1000 },
    players: [
      { subject: ME, agentId: null, team: 'ALLY', teamName: 'Red', body: 1, isMe: true },
      { subject: FOE, agentId: null, team: 'ENEMY', teamName: 'Blue', body: 2, isMe: false },
    ],
    rounds: [
      { n: 1, buyStartMs: 0, barrierMs: 45000, endMs: 70000, side: 'attacker', winner: 'ENEMY', how: 'elimination', plant: null, defuse: null },
      { n: 2, buyStartMs: 80000, barrierMs: 110000, endMs: 150000, side: 'attacker', winner: 'ALLY', how: 'elimination', plant: null, defuse: null },
      { n: 3, buyStartMs: 160000, barrierMs: 190000, endMs: 230000, side: 'attacker', winner: 'ALLY', how: 'defuse', plant: 200000, defuse: 225000 },
    ],
    weapons: [{ cls: 'AssaultRifle_AK_C', name: 'Vandal', cat: 'rifle' }],
    tracks: { hz: 10, fields: ['t', 'x', 'y', 'yaw', 'alive', 'weapon'], byPlayer: { [ME]: [[0, 1, 2, 90, 1, 0]], [FOE]: [[0, 3, 4, 270, 1, null]] } },
    kills: [{ t: 60000, round: 1, killer: FOE, victim: ME, weapon: 0, kx: 3, ky: 4, vx: 1, vy: 2 }],
    casts: [],
    effects: [],
    spike: { carriers: [], plants: [], defuses: [] },
    pawns: { fields: ['t', 'x', 'y', 'yaw'], items: [] },
    ...overrides,
  }
}

async function gzip(value: unknown): Promise<Blob> {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
}

async function rejection(file: Blob): Promise<Error> {
  try {
    await parseReplayBundle(file)
  } catch (err) {
    assert.ok(err instanceof ReplayBundleError, `expected a ReplayBundleError, got ${String(err)}`)
    return err
  }
  assert.fail('expected parseReplayBundle to reject')
}

test('a gzipped schema-1 bundle parses', async () => {
  const parsed = await parseReplayBundle(await gzip(bundle()))
  assert.equal(parsed.match.matchId, MATCH)
  assert.equal(parsed.players.length, 2)
  assert.deepEqual(parsed.tracks.byPlayer[ME][0], [0, 1, 2, 90, 1, 0])
})

test('summary counts rounds from the owner’s side', async () => {
  const parsed = await parseReplayBundle(await gzip(bundle()))
  assert.deepEqual(summarizeReplayBundle(parsed), {
    players: 2,
    rounds: 3,
    kills: 1,
    score: [2, 1],
    build: 'release-13.06',
  })
})

test('a file that is not gzip is refused with a hint', async () => {
  const err = await rejection(new Blob([JSON.stringify(bundle())]))
  assert.match(err.message, /Not a gzip file/)
})

test('gzip that is not JSON is refused', async () => {
  const err = await rejection(await gzip('not json at all'))
  assert.match(err.message, /not JSON/)
})

test('another schema version is refused, naming both versions', async () => {
  const err = await rejection(await gzip(bundle({ schema: 2 })))
  assert.match(err.message, /schema 1/)
  assert.match(err.message, /schema 2/)
})

test('a bundle missing a section is refused', async () => {
  const withoutKills = bundle()
  delete (withoutKills as Record<string, unknown>).kills
  const err = await rejection(await gzip(withoutKills))
  assert.match(err.message, /"kills"/)
})

test('a player without a track is refused', async () => {
  const noTrack = bundle({ tracks: { hz: 10, fields: [], byPlayer: { [ME]: [] } } })
  const err = await rejection(await gzip(noTrack))
  assert.match(err.message, /no track for 1/)
})

test('assertBundleForMatch accepts the same match and refuses another', async () => {
  const parsed = await parseReplayBundle(await gzip(bundle()))
  assert.doesNotThrow(() => assertBundleForMatch(parsed, MATCH))
  assert.throws(
    () => assertBundleForMatch(parsed, '0f3f6aa8-aa67-4a94-9298-864bd43b2106'),
    (err: unknown) => err instanceof ReplayBundleError && /00931947/.test(err.message) && /0f3f6aa8/.test(err.message),
  )
})

test('storage path puts the owner first', () => {
  assert.equal(replayStoragePath('user-1', MATCH), `user-1/${MATCH}/minimap.v1.json.gz`)
})
