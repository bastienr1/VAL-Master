/**
 * Unit tests for the canvas skins (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANVAS_SKIN_IDS,
  CANVAS_SKINS,
  type CanvasSkinId,
  DEFAULT_CANVAS_SKIN,
  canvasSkin,
  hexChannels,
  nextCanvasSkin,
  skinDrawColor,
  skinLinesMatrix,
  skinMapMatrix,
} from './canvasSkins.ts'
import { UTILITY_COLORS } from './playScene.ts'

const HEX = /^#[0-9A-F]{6}$/

test('Graphite is the default, and an unknown stored skin falls back on it', () => {
  assert.equal(DEFAULT_CANVAS_SKIN, 'graphite')
  assert.equal(canvasSkin(null).id, 'graphite')
  assert.equal(canvasSkin('neon').id, 'graphite')
  assert.equal(canvasSkin('radar').id, 'radar')
})

test('every skin has valid colours, a full utility palette and ids matching its key', () => {
  for (const id of CANVAS_SKIN_IDS) {
    const skin = CANVAS_SKINS[id]
    assert.equal(skin.id, id)
    assert.ok(skin.name && skin.blurb, id)
    for (const key of ['back', 'floor', 'wall', 'callout', 'ally', 'enemy', 'spike', 'tile', 'allyName', 'enemyName', 'label', 'ink', 'card', 'cardBorder', 'cardText', 'cardMuted'] as const) {
      assert.match(skin[key], HEX, `${id}.${key}`)
    }
    assert.deepEqual(Object.keys(skin.utility).sort(), Object.keys(UTILITY_COLORS).sort(), id)
    assert.notEqual(skin.ally, skin.enemy, id)
    assert.ok(skin.mapOpacity > 0 && skin.mapOpacity <= 1, id)
  }
})

test('the map tint takes grey 0 to the floor and grey 1 to the wall, keeping alpha', () => {
  for (const id of CANVAS_SKIN_IDS) {
    const skin = CANVAS_SKINS[id]
    const m = skinMapMatrix(skin).split(/\s+/).map(Number)
    assert.equal(m.length, 20, id)
    assert.deepEqual(m.slice(15), [0, 0, 0, 1, 0], id)
    const apply = (grey: number) => [0, 1, 2].map(i => Math.round((m[i * 5 + i] * grey + m[i * 5 + 4]) * 255))
    assert.deepEqual(apply(0), hexChannels(skin.floor), `${id} floor`)
    assert.deepEqual(apply(1), hexChannels(skin.wall), `${id} wall`)
  }
})

test('Teal keeps the map tint the editor has always had', () => {
  const m = skinMapMatrix(CANVAS_SKINS.teal).split(/\s+/).map(Number)
  assert.ok(Math.abs(m[0] - 0.17) < 0.01 && Math.abs(m[6] - 0.7) < 0.01 && Math.abs(m[12] - 0.79) < 0.01)
})

test('only the two World skins show a baked ground, one per look, and their opacities are fractions', () => {
  const looks: Record<string, string> = { world: 'lit', worldUnlit: 'unlit' }
  for (const id of CANVAS_SKIN_IDS) {
    const ground = CANVAS_SKINS[id].ground
    assert.equal(ground?.look, looks[id], id)
    if (ground) {
      assert.ok(ground.opacity > 0 && ground.opacity <= 1, id)
      assert.ok(ground.lines > 0 && ground.lines <= 1, id)
    }
  }
})

test('the two World skins differ only by the look of their ground', () => {
  const lit = CANVAS_SKINS.world
  const unlit = CANVAS_SKINS.worldUnlit
  assert.deepEqual({ ...lit, id: unlit.id, name: unlit.name, blurb: unlit.blurb, ground: unlit.ground }, unlit)
  assert.notEqual(lit.name, unlit.name)
  assert.notEqual(lit.blurb, unlit.blurb)
  assert.deepEqual({ ...lit.ground, look: 'unlit' }, unlit.ground)
})

test('the lines matrix paints the wall colour, clear at the floor grey and solid at white', () => {
  const skin = CANVAS_SKINS.world
  const m = skinLinesMatrix(skin).split(/\s+/).map(Number)
  assert.equal(m.length, 20)
  assert.deepEqual([0, 1, 2].map(i => Math.round(m[i * 5 + 4] * 255)), hexChannels(skin.wall))
  const alpha = (grey: number) => Math.min(1, Math.max(0, m[15] * grey + m[19]))
  assert.equal(alpha(0), 0)
  assert.equal(alpha(0.5), 0)
  assert.equal(alpha(1), 1)
  assert.ok(alpha(0.8) > 0 && alpha(0.8) < 1)
})

test('the shortcut walks every skin and wraps both ways', () => {
  let id: CanvasSkinId = CANVAS_SKIN_IDS[0]
  const seen = new Set<CanvasSkinId>([id])
  for (let i = 1; i < CANVAS_SKIN_IDS.length; i++) {
    id = nextCanvasSkin(id)
    seen.add(id)
  }
  assert.equal(seen.size, CANVAS_SKIN_IDS.length)
  assert.equal(nextCanvasSkin(id), CANVAS_SKIN_IDS[0])
  assert.equal(nextCanvasSkin(CANVAS_SKIN_IDS[0], -1), id)
})

test('a drawing stored in white takes the skin\'s ink; other colours stay', () => {
  assert.equal(skinDrawColor(CANVAS_SKINS.blueprint, '#ffffff'), '#14263D')
  assert.equal(skinDrawColor(CANVAS_SKINS.graphite, '#FFFFFF'), '#FFFFFF')
  assert.equal(skinDrawColor(CANVAS_SKINS.blueprint, '#FF4655'), '#FF4655')
})
