/**
 * Unit tests for the map's sight lines (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { castRay, clipRay, sightGridFromPixels, type SightGrid } from './sightGrid.ts'

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

const FROM = { u: 0.1, v: 0.5 }
const TO = { u: 0.9, v: 0.5 }
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

test('a sight line stops at the near edge of a smoke', () => {
  const end = clipRay(FROM, TO, { circles: [{ u: 0.5, v: 0.5, r: 0.1 }], segments: [] })
  close(end.u, 0.4)
  close(end.v, 0.5)
})

test('a smoke off the line, or behind the viewer, or beyond the end, changes nothing', () => {
  assert.deepEqual(clipRay(FROM, TO, { circles: [{ u: 0.5, v: 0.9, r: 0.1 }], segments: [] }), TO)
  assert.deepEqual(clipRay({ u: 0.5, v: 0.5 }, TO, { circles: [{ u: 0.2, v: 0.5, r: 0.1 }], segments: [] }), TO)
  assert.deepEqual(clipRay(FROM, { u: 0.3, v: 0.5 }, { circles: [{ u: 0.5, v: 0.5, r: 0.1 }], segments: [] }), { u: 0.3, v: 0.5 })
})

test('from inside a smoke the line stops at its edge', () => {
  close(clipRay({ u: 0.5, v: 0.5 }, TO, { circles: [{ u: 0.5, v: 0.5, r: 0.1 }], segments: [] }).u, 0.6)
})

test('a wall stops the line where they cross; the nearest blocker wins', () => {
  const wall: [{ u: number; v: number }, { u: number; v: number }] = [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.8 }]
  close(clipRay(FROM, TO, { circles: [], segments: [wall] }).u, 0.3)
  close(clipRay(FROM, TO, { circles: [{ u: 0.25, v: 0.5, r: 0.05 }], segments: [wall] }).u, 0.2)
  // A wall that ends short of the line does nothing.
  assert.deepEqual(clipRay(FROM, TO, { circles: [], segments: [[{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.4 }]] }), TO)
})
