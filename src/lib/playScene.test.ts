/**
 * Unit tests for placing a play phase on the Plays minimap (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTOR_SPREAD_RADIUS,
  MIN_UTILITY_RADIUS,
  UTILITY_RADIUS_CM,
  VIEW_SIZE,
  cmToView,
  imageToView,
  placeCallouts,
  sceneForPhase,
  sceneViewport,
  viewToImage,
  type SceneMap,
} from './playScene.ts'
import { calloutViewport, type MapCallout, type PlayDoc, type PlayPhase } from './playDoc.ts'
import { worldToImage } from './replayScene.ts'

const ASCENT = { xMultiplier: 0.00007, yMultiplier: -0.00007, xScalarToAdd: 0.813895, yScalarToAdd: 0.573242 }

const callout = (superRegion: string, region: string, x: number, y: number): MapCallout => ({
  region,
  superRegion,
  name: `${superRegion} ${region}`,
  x,
  y,
})

const CALLOUTS: MapCallout[] = [
  callout('A', 'Main', 5321, -4710),
  callout('A', 'Site', 6153, -6626),
  callout('B', 'Main', 2000, 1800),
  callout('B', 'Site', 4500, 2100),
  callout('Mid', 'Top', 3000, -2500),
  callout('Attacker Side', 'Spawn', 60, 50),
]

const MAP: SceneMap = { transform: ASCENT, callouts: CALLOUTS }

const close = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not close to ${expected}`)

/** The viewBox point of a callout, computed the long way. */
function viewPointOf(name: string): [number, number] {
  const c = CALLOUTS.find(x => x.name === name)!
  const view = calloutViewport(CALLOUTS, ASCENT)
  const [u, v] = worldToImage(ASCENT, c.x, c.y)
  return [((u - view.u) / view.size) * 1000, ((v - view.v) / view.size) * 1000]
}

const phase = (over: Partial<PlayPhase>): PlayPhase => ({
  id: 'p',
  name: 'P',
  caption: '',
  actors: [],
  utility: [],
  markers: [],
  ...over,
})

const docOf = (...phases: PlayPhase[]): PlayDoc => ({
  version: 1,
  summary: '',
  comp: ['Jett', 'Omen'],
  phases,
  assumptions: [],
})

test('imageToView and viewToImage are inverses inside the viewport', () => {
  const view = { u: 0.2, v: 0.1, size: 0.6 }
  assert.deepEqual(imageToView(view, 0.2, 0.1), [0, 0])
  const [x, y] = imageToView(view, 0.8, 0.7)
  close(x, VIEW_SIZE)
  close(y, VIEW_SIZE)
  const back = viewToImage(view, 250, 750)
  close(back.u, 0.35)
  close(back.v, 0.55)
})

test('viewToImage clamps a drop outside the image', () => {
  const view = { u: 0.5, v: 0.5, size: 0.5 }
  assert.deepEqual(viewToImage(view, 2000, -2000), { u: 1, v: 0 })
  assert.deepEqual(viewToImage({ u: 0, v: 0, size: 1 }, -10, 1010), { u: 0, v: 1 })
})

test('cmToView scales world cm through |xMultiplier| and the viewport size', () => {
  close(cmToView(1000, ASCENT, { u: 0, v: 0, size: 1 }), 70)
  close(cmToView(1000, ASCENT, { u: 0, v: 0, size: 0.5 }), 140)
  assert.ok(cmToView(1000, null, { u: 0, v: 0, size: 1 }) > 0)
})

test('sceneViewport is the callout viewport, or the whole image without a transform', () => {
  assert.deepEqual(sceneViewport(MAP), calloutViewport(CALLOUTS, ASCENT))
  assert.deepEqual(sceneViewport({ transform: null, callouts: CALLOUTS }), { u: 0, v: 0, size: 1 })
})

test('placeCallouts puts every callout at its viewBox point', () => {
  const placed = placeCallouts(MAP)
  assert.equal(placed.length, CALLOUTS.length)
  const aMain = placed.find(c => c.name === 'A Main')!
  const [x, y] = viewPointOf('A Main')
  close(aMain.x, x)
  close(aMain.y, y)
  for (const c of placed) {
    assert.ok(c.x >= 0 && c.x <= 1000 && c.y >= 0 && c.y <= 1000, `${c.name} is outside the box`)
  }
  assert.deepEqual(placeCallouts({ transform: null, callouts: CALLOUTS }), [])
})

test('actors are placed by callout, dragged points win, and paths run at → via → moveTo', () => {
  const doc = docOf(phase({
    actors: [
      { agent: 'Jett', at: { callout: 'A Main' }, via: [{ callout: 'Mid Top' }], moveTo: { callout: 'A Site' }, note: 'entry' },
      { agent: 'Omen', at: { callout: 'B Main', u: 0.5, v: 0.25 }, note: 'smokes', spike: true },
    ],
  }))
  const scene = sceneForPhase(doc, 0, MAP)
  assert.equal(scene.actors.length, 2)
  const [jett, omen] = scene.actors
  const [ax, ay] = viewPointOf('A Main')
  close(jett.x, ax)
  close(jett.y, ay)
  assert.equal(jett.path?.length, 3)
  close(jett.path![1][0], viewPointOf('Mid Top')[0])
  close(jett.path![2][1], viewPointOf('A Site')[1])
  assert.equal(jett.spike, false)

  const [ox, oy] = imageToView(scene.view, 0.5, 0.25)
  close(omen.x, ox)
  close(omen.y, oy)
  assert.equal(omen.path, null)
  assert.equal(omen.spike, true)
  assert.equal(omen.index, 1)
  assert.deepEqual(scene.unresolved, [])
})

test('unknown callouts are left out and reported once each', () => {
  const doc = docOf(phase({
    actors: [
      { agent: 'Jett', at: { callout: 'Catwalk Boxes' }, note: '' },
      { agent: 'Omen', at: { callout: 'A Main' }, moveTo: { callout: 'Catwalk Boxes' }, via: [{ callout: 'Nowhere' }], note: '' },
    ],
    utility: [{ agent: 'Omen', kind: 'smoke', label: '', at: { callout: 'A Site', toward: 'Pizza' } }],
    markers: [{ kind: 'enemy', at: { callout: 'Nowhere' } }],
  }))
  const scene = sceneForPhase(doc, 0, MAP)
  assert.deepEqual(scene.actors.map(a => a.agent), ['Omen'])
  // The only placed point of Omen's route is `at`: no path.
  assert.equal(scene.actors[0].path, null)
  assert.equal(scene.actors[0].index, 1)
  // An unknown `toward` keeps the item on its first callout, but is reported.
  assert.equal(scene.utility.length, 1)
  close(scene.utility[0].x, viewPointOf('A Site')[0])
  assert.equal(scene.markers.length, 0)
  assert.deepEqual(scene.unresolved, ['Catwalk Boxes', 'Nowhere', 'Pizza'])
})

test('utility radii take the kind default, the given radius, and a floor', () => {
  const doc = docOf(phase({
    utility: [
      { agent: 'Omen', kind: 'smoke', label: 'Heaven smoke', at: { callout: 'A Site' } },
      { agent: 'Omen', kind: 'smoke', label: '', at: { callout: 'A Site' }, radius: 600 },
      { agent: 'Jett', kind: 'flash', label: '', at: { callout: 'A Main' } },
      { agent: 'Jett', kind: 'wall', label: '', at: { callout: 'A Main' }, from: { callout: 'A Site' } },
      { agent: 'Jett', kind: 'wall', label: '', at: { callout: 'A Main' }, from: { callout: 'Gone' } },
    ],
  }))
  const scene = sceneForPhase(doc, 0, MAP)
  const view = scene.view
  close(scene.utility[0].r, cmToView(UTILITY_RADIUS_CM.smoke, ASCENT, view))
  close(scene.utility[1].r, cmToView(600, ASCENT, view))
  assert.equal(scene.utility[2].r, MIN_UTILITY_RADIUS)
  assert.ok(scene.utility[3].from)
  close(scene.utility[3].from![0], viewPointOf('A Site')[0])
  assert.equal(scene.utility[4].from, null)
  assert.deepEqual(scene.unresolved, ['Gone'])
})

test('a spike marker on a site callout carries the site letter', () => {
  const doc = docOf(phase({
    markers: [
      { kind: 'spike', at: { callout: 'B Site' } },
      { kind: 'spike', at: { callout: 'Mid Top' } },
      { kind: 'spike', at: { u: 0.4, v: 0.4 } },
      { kind: 'enemy', at: { callout: 'A Site' }, label: 'Op' },
    ],
  }))
  const scene = sceneForPhase(doc, 0, MAP)
  assert.deepEqual(scene.markers.map(m => m.site), ['B', null, null, null])
  assert.equal(scene.markers[3].label, 'Op')
  assert.equal(scene.markers[0].label, '')
})

test('the phase index is clamped and an empty doc gives an empty scene', () => {
  const doc = docOf(
    phase({ actors: [{ agent: 'Jett', at: { callout: 'A Main' }, note: 'one' }] }),
    phase({ actors: [{ agent: 'Jett', at: { callout: 'B Main' }, note: 'two' }] }),
  )
  assert.equal(sceneForPhase(doc, 9, MAP).actors[0].note, 'two')
  assert.equal(sceneForPhase(doc, -3, MAP).actors[0].note, 'one')
  assert.equal(sceneForPhase(doc, Number.NaN, MAP).actors[0].note, 'one')
  const empty = sceneForPhase({ ...doc, phases: [] }, 0, MAP)
  assert.deepEqual([empty.actors, empty.utility, empty.markers, empty.unresolved], [[], [], [], []])
})

test('without a transform only dragged points are placed', () => {
  const doc = docOf(phase({
    actors: [
      { agent: 'Jett', at: { callout: 'A Main' }, note: '' },
      { agent: 'Omen', at: { u: 0.5, v: 0.5 }, note: '' },
    ],
  }))
  const scene = sceneForPhase(doc, 0, { transform: null, callouts: CALLOUTS })
  assert.deepEqual(scene.actors.map(a => [a.agent, a.x, a.y]), [['Omen', 500, 500]])
  assert.deepEqual(scene.unresolved, ['A Main'])
})

test('actors on the same spot are spread on a circle about it, in comp order from the top', () => {
  const comp = ['Jett', 'Omen', 'Sova', 'Killjoy', 'KAY/O']
  const doc: PlayDoc = {
    ...docOf(phase({
      actors: comp.map(agent => ({ agent, at: { callout: 'Attacker Side Spawn' }, moveTo: { callout: 'A Main' }, note: '' })),
    })),
    comp,
  }
  const scene = sceneForPhase(doc, 0, MAP)
  const [sx, sy] = viewPointOf('Attacker Side Spawn')
  const points = scene.actors.map(a => `${a.x.toFixed(3)},${a.y.toFixed(3)}`)
  assert.equal(new Set(points).size, 5)
  for (const a of scene.actors) {
    assert.ok(Math.hypot(a.x - sx, a.y - sy) <= ACTOR_SPREAD_RADIUS + 1e-6, `${a.agent} is too far from the spawn`)
    // The arrow leaves the marker that is drawn.
    assert.deepEqual(a.path![0], [a.x, a.y])
  }
  // The first of the comp sits at the top.
  close(scene.actors[0].x, sx)
  close(scene.actors[0].y, sy - ACTOR_SPREAD_RADIUS)
})

test('actors well apart are not moved', () => {
  const doc = docOf(phase({
    actors: [
      { agent: 'Jett', at: { u: 0.5, v: 0.5 }, note: '' },
      { agent: 'Omen', at: { u: 0.5, v: 0.5 }, note: '' },
    ],
  }))
  const view = { u: 0, v: 0, size: 1 }
  const apart = docOf(phase({
    actors: [
      { agent: 'Jett', at: { u: 0.5, v: 0.5 }, note: '' },
      { agent: 'Omen', at: { u: 0.6, v: 0.5 }, note: '' },
    ],
  }))
  const scene = sceneForPhase(apart, 0, { transform: null, callouts: [] })
  assert.deepEqual(scene.view, view)
  assert.deepEqual(scene.actors.map(a => [a.x, a.y]), [[500, 500], [600, 500]])
  // Two on one spot: 2 x 26 apart, one above and one below.
  const pair = sceneForPhase(doc, 0, { transform: null, callouts: [] }).actors
  close(pair[0].x, 500)
  close(pair[0].y, 474)
  close(pair[1].y, 526)
})
