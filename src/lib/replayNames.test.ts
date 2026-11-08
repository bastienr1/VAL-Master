import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namesFromHenrik } from './replayNames.ts'

test('namesFromHenrik reads the v2 all_players list', () => {
  const names = namesFromHenrik({
    data: { players: { all_players: [{ puuid: 'a', name: 'jo3ast', tag: 'EUW' }, { puuid: 'b', name: ' sakina ' }] } },
  })
  assert.deepEqual([...names], [['a', 'jo3ast'], ['b', 'sakina']])
})

test('namesFromHenrik reads the v4 flat list and the red/blue split', () => {
  assert.deepEqual([...namesFromHenrik({ data: { players: [{ puuid: 'c', name: 'Flat' }] } })], [['c', 'Flat']])
  assert.deepEqual(
    [...namesFromHenrik({ players: { red: [{ puuid: 'r', name: 'Red' }], blue: [{ puuid: 'u', name: 'Blue' }] } })],
    [['r', 'Red'], ['u', 'Blue']],
  )
})

test('namesFromHenrik skips players without a PUUID or a name, and junk payloads', () => {
  assert.equal(namesFromHenrik({ data: { players: [{ name: 'x' }, { puuid: 'y', name: '' }, null] } }).size, 0)
  assert.equal(namesFromHenrik(null).size, 0)
  assert.equal(namesFromHenrik('nope').size, 0)
})
