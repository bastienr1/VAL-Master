/**
 * Unit tests for the baked map grounds (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { GROUND_LOOKS, GROUND_MAPS, mapGroundUrl } from './mapGround.ts'

const LOTUS = GROUND_MAPS.Lotus
/** District, a Team Deathmatch map: it has no minimap transform, so no bake. */
const DISTRICT = '690b3ed2-4dff-945b-8223-6da834e30d24'

test('a map with a bake resolves to its picture, whatever the case of the id', () => {
  assert.equal(mapGroundUrl(LOTUS), `/maps/ground/${LOTUS}-lit.webp`)
  assert.equal(mapGroundUrl(LOTUS.toUpperCase()), `/maps/ground/${LOTUS}-lit.webp`)
})

test('each look has its own picture', () => {
  assert.equal(mapGroundUrl(LOTUS, 'lit'), `/maps/ground/${LOTUS}-lit.webp`)
  assert.equal(mapGroundUrl(LOTUS, 'unlit'), `/maps/ground/${LOTUS}-unlit.webp`)
})

test('a map with no bake, or no map, has no ground in any look', () => {
  for (const look of GROUND_LOOKS) {
    assert.equal(mapGroundUrl(DISTRICT, look), null)
    assert.equal(mapGroundUrl('', look), null)
    assert.equal(mapGroundUrl(null, look), null)
    assert.equal(mapGroundUrl(undefined, look), null)
  }
})

test('the listed maps are distinct lower-case uuids', () => {
  const ids = Object.values(GROUND_MAPS)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
})

test('every listed ground has its file in public/, in every look', () => {
  for (const [name, id] of Object.entries(GROUND_MAPS)) {
    for (const look of GROUND_LOOKS) {
      const url = mapGroundUrl(id, look)
      assert.ok(url && existsSync(new URL(`../../public${url}`, import.meta.url)), `${name} ${look}: ${url ?? 'no url'}`)
    }
  }
})
