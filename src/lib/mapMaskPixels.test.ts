/**
 * Unit tests for pooling minimap pixels into the mask and walls grids (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { poolPixels } from './mapMaskPixels.ts'

type RGBA = [number, number, number, number]
const CLEAR: RGBA = [0, 0, 0, 0]
const FLOOR: RGBA = [118, 118, 118, 255]
const RAISED: RGBA = [152, 152, 152, 255]
const WALL: RGBA = [255, 255, 255, 255]
const HALF_WALL: RGBA = [255, 255, 255, 125]

/** A w x h image from a pixel function. */
function image(w: number, h: number, at: (x: number, y: number) => RGBA): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4)
  return data
}

test('floor greys are playable, transparent cells are not', () => {
  // 4 x 4 image, 2 x 2 grid: left half floor/raised, right half transparent.
  const data = image(4, 4, x => (x < 1 ? FLOOR : x < 2 ? RAISED : CLEAR))
  const { mask } = poolPixels(data, 4, 4, 2, 2)
  assert.deepEqual([...mask], [1, 0, 1, 0])
})

test('a cell is playable only with a strict majority of floor pixels', () => {
  // 2 x 2 image, 1 x 1 grid.
  const half = image(2, 2, x => (x === 0 ? FLOOR : CLEAR))
  assert.deepEqual([...poolPixels(half, 2, 2, 1, 1).mask], [0])
  const three = image(2, 2, (x, y) => (x === 1 && y === 1 ? CLEAR : FLOOR))
  assert.deepEqual([...poolPixels(three, 2, 2, 1, 1).mask], [1])
})

test('white wall pixels are not floor', () => {
  const data = image(2, 2, (x, y) => (x === 0 && y === 0 ? FLOOR : WALL))
  assert.deepEqual([...poolPixels(data, 2, 2, 1, 1).mask], [0])
})

test('walls max-pool: one thin line marks every cell it crosses', () => {
  // 8 x 8 image, 4 x 4 wall grid; a one-pixel line in column 3 on floor.
  const data = image(8, 8, x => (x === 3 ? WALL : FLOOR))
  const { walls, mask } = poolPixels(data, 8, 8, 1, 4)
  for (let v = 0; v < 4; v++) assert.deepEqual([...walls.slice(v * 4, v * 4 + 4)], [0, 1, 0, 0])
  assert.deepEqual([...mask], [1])
})

test('half-transparent white is wall, grey floor is not, and cells with nothing opaque are outside (wall)', () => {
  const data = image(4, 1, x => [HALF_WALL, [255, 255, 255, 40] as RGBA, RAISED, CLEAR][x])
  const { walls } = poolPixels(data, 4, 1, 1, 4)
  assert.deepEqual([...walls.slice(0, 4)], [1, 1, 0, 1])
})

test('non-integer pooling covers every source pixel once', () => {
  // 10 x 10 floor over a 3 x 3 grid: uneven cells, all playable.
  const data = image(10, 10, () => FLOOR)
  assert.deepEqual([...poolPixels(data, 10, 10, 3, 3).mask], new Array(9).fill(1))
})

test('bad input gives empty grids', () => {
  const { mask, walls } = poolPixels(new Uint8ClampedArray(3), 4, 4, 2, 3)
  assert.equal(mask.length, 4)
  assert.equal(walls.length, 9)
  assert.equal(mask.some(Boolean) || walls.some(Boolean), false)
})

test('a fully transparent region is wall, so a path cannot leave the map', () => {
  // 4×4 image: left half opaque floor, right half transparent; 2×2 grids.
  const w = 4, h = 4
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < 2; x++) { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 118; data[o + 3] = 255 }
  const { mask, walls } = poolPixels(data, w, h, 2, 2)
  assert.deepEqual([...mask], [1, 0, 1, 0])
  assert.deepEqual([...walls], [0, 1, 0, 1])
})
