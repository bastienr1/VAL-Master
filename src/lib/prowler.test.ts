import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PROWLER,
  PROWLER_FAR_REACH,
  PROWLER_SPRITE,
  isProwler,
  prowlerAge,
  prowlerAt,
  prowlerCurve,
  prowlerFrame,
  prowlerLook,
  prowlerRandom,
  prowlerRow,
  prowlerWay,
} from './prowler.ts'

const nearly = (actual: number, expected: number, what: string, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${what}: ${actual} is not ${expected}`)

test('the figures are the game files’ and the replays’', () => {
  assert.deepEqual([PROWLER.headCm, PROWLER.loopMs, PROWLER.speed], [185, 1867, 950])
  assert.deepEqual([PROWLER.ribbonS, PROWLER.whiskerS, PROWLER.inkRate], [0.35, 0.2, 25])
  assert.deepEqual([PROWLER.inkLife, PROWLER.inkCm, PROWLER.inkCarry, PROWLER.inkDrag], [[1.5, 3], [5, 15], [0.5, 1.2], [0, 2]])
  assert.deepEqual([PROWLER_SPRITE.headings, PROWLER_SPRITE.frames, PROWLER_SPRITE.spanCm], [16, 12, 300])
  assert.equal(PROWLER_FAR_REACH, 1.5)
})

test('only Fade’s C is a Prowler', () => {
  assert.ok(isProwler('Fade', 'Grenade'))
  assert.ok(isProwler(' fade ', 'Grenade'))
  assert.ok(!isProwler('Fade', 'Ability1'))
  assert.ok(!isProwler('Sova', 'Grenade'))
  assert.ok(!isProwler('Fade', null))
})

test('zoomed out it is drawn larger than life with no detail; close up at its size with everything', () => {
  // On the board at 100 % its head would be 14 px long: drawn 30.
  const far = prowlerLook(14)
  nearly(far.big, 30 / 14, 'big')
  assert.equal(far.detail, 0)
  assert.deepEqual(prowlerLook(30), { big: 1, detail: 0 })
  nearly(prowlerLook(50).detail, 0.5, 'half way')
  assert.deepEqual(prowlerLook(70), { big: 1, detail: 1 })
  assert.deepEqual(prowlerLook(400), { big: 1, detail: 1 })
  assert.deepEqual(prowlerLook(0), { big: 1, detail: 0 })
})

test('its way is kept oldest first, without junk', () => {
  const way = prowlerWay([
    { x: 0, y: 0, ago: 450 },
    { x: Number.NaN, y: 0, ago: 400 },
    { x: 100, y: 0, ago: 300 },
    { x: 150, y: 0, ago: 320 },
    { x: 200, y: 0, ago: 150 },
    { x: 300, y: 0, ago: 0 },
  ])
  assert.deepEqual(way.map(p => p.x), [0, 100, 200, 300])
  assert.equal(prowlerAge(way), 450)
  assert.equal(prowlerAge([]), 0)
  // Before its first point is passed it has not started.
  assert.equal(prowlerAge(prowlerWay([{ x: 0, y: 0, ago: -50 }, { x: 10, y: 0, ago: -200 }])), 0)
})

test('on a straight run it is where its speed puts it, heading along it', () => {
  const way = prowlerWay([0, 1, 2, 3, 4].map(i => ({ x: i * 150, y: 0, ago: 600 - i * 150 })))
  for (const ago of [600, 525, 300, 80, 0]) {
    const p = prowlerAt(way, ago)!
    nearly(p.x, 600 - ago, `x at ${ago}`)
    nearly(p.y, 0, `y at ${ago}`)
    nearly(p.heading, 0, `heading at ${ago}`)
  }
  // It holds its ends.
  nearly(prowlerAt(way, 5000)!.x, 0, 'before the start')
  nearly(prowlerAt(way, -5000)!.x, 600, 'after the end')
  assert.equal(prowlerAt([], 0), null)
})

test('through a turn it goes through every point of its way and turns smoothly between them', () => {
  // East, then south: the corner is at (300, 0).
  const way = prowlerWay([
    { x: 0, y: 0, ago: 600 },
    { x: 150, y: 0, ago: 450 },
    { x: 300, y: 0, ago: 300 },
    { x: 300, y: 150, ago: 150 },
    { x: 300, y: 300, ago: 0 },
  ])
  const corner = prowlerAt(way, 300)!
  nearly(corner.x, 300, 'corner x')
  nearly(corner.y, 0, 'corner y')
  // At the corner it heads between east and south, not along either.
  nearly(corner.heading, Math.PI / 4, 'heading at the corner')
  // The heading turns steadily through the corner: no jump from one side of a point to the other.
  const headings = [340, 320, 301, 299, 280, 260].map(ago => prowlerAt(way, ago)!.heading)
  for (let i = 1; i < headings.length; i++) {
    assert.ok(headings[i] > headings[i - 1], 'it keeps turning the same way')
    assert.ok(headings[i] - headings[i - 1] < 0.5, 'without a jump')
  }
})

test('the sheet’s row follows the heading, with the turn left over', () => {
  // Heading right on the board is row 0; heading up the screen (−y) is a quarter turn anticlockwise, row 4.
  assert.deepEqual(prowlerRow(0), { row: 0, turn: 0 })
  assert.equal(prowlerRow(-Math.PI / 2).row, 4)
  assert.equal(prowlerRow(Math.PI / 2).row, 12)
  assert.equal(prowlerRow(Math.PI).row, 8)
  // 10° clockwise of right: still row 0, turned the 10°.
  const tilted = prowlerRow((10 * Math.PI) / 180)
  assert.equal(tilted.row, 0)
  nearly(tilted.turn, (10 * Math.PI) / 180, 'turn')
  // Never more than half a step either way.
  for (let a = -7; a < 7; a += 0.13) assert.ok(Math.abs(prowlerRow(a).turn) <= Math.PI / 16 + 1e-9)
})

test('its loop has 12 frames over 1.867 s', () => {
  assert.equal(prowlerFrame(0), 0)
  assert.equal(prowlerFrame(PROWLER.loopMs / 2), 6)
  assert.equal(prowlerFrame(PROWLER.loopMs - 1), 11)
  assert.equal(prowlerFrame(PROWLER.loopMs), 0)
  assert.equal(prowlerFrame(-1), 11)
})

test('its random numbers and curves are steady', () => {
  assert.equal(prowlerRandom(7, 3), prowlerRandom(7, 3))
  assert.ok(prowlerRandom(7, 3) >= 0 && prowlerRandom(7, 3) < 1)
  assert.equal(prowlerCurve([1, 0.5, 0], 0.5), 0.5)
  assert.equal(prowlerCurve([1, 0.5, 0], 2), 0)
})
