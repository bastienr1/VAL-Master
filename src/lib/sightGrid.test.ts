/**
 * Unit tests for the map's sight lines (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { castRay, sightGridFromPixels, type SightGrid } from './sightGrid.ts'

const N = 100

/** An empty grid with these columns (u cells) solid, top to bottom. */
function withWalls(columns: number[]): SightGrid {
  const blocked = new Uint8Array(N * N)
  for (const c of columns) for (let v = 0; v < N; v++) blocked[v * N + c] = 1
  return { n: N, blocked }
}

test('off the map and bright lines block; the floor does not', () => {
  const rgba = new Uint8Array([
    0, 0, 0, 0, // transparent
    255, 255, 255, 255, // wall line
    120, 120, 120, 255, // floor
    190, 190, 190, 255, // lighter floor
  ])
  assert.deepEqual([...sightGridFromPixels(rgba, 2).blocked], [1, 1, 0, 0])
})

test('a ray stops just before the first wall', () => {
  const end = castRay(withWalls([60, 61]), 0.2, 0.5, 1, 0)
  assert.ok(end.u < 0.6 && end.u > 0.59, String(end.u))
  assert.equal(end.v, 0.5)
})

test('a ray with no wall runs to the edge of the map', () => {
  const end = castRay(withWalls([]), 0.5, 0.5, 0, -1)
  assert.ok(end.v < 0.01, String(end.v))
})

test('a diagonal ray does not slip through a wall two cells thick', () => {
  const end = castRay(withWalls([50, 51]), 0.2, 0.2, 1, 1)
  assert.ok(end.u < 0.5, String(end.u))
})

test('a ray starting on a wall line reaches the free side nearby; deep in a wall it stays put', () => {
  const thin = castRay(withWalls([50, 51]), 0.505, 0.5, 1, 0)
  assert.ok(thin.u > 0.9, String(thin.u))
  const thick = withWalls(Array.from({ length: 30 }, (_, i) => 40 + i))
  assert.deepEqual(castRay(thick, 0.5, 0.5, 1, 0), { u: 0.5, v: 0.5 })
})

test('a zero direction stays where it is', () => {
  assert.deepEqual(castRay(withWalls([]), 0.3, 0.4, 0, 0), { u: 0.3, v: 0.4 })
})
