/**
 * Unit tests for placing a play step on the Plays canvas (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SPREAD_RADIUS,
  MAX_ZOOM,
  MIN_UTILITY_RADIUS,
  UTILITY_COLORS,
  UTILITY_RADIUS_CM,
  UTILITY_STYLE,
  VIEW_SIZE,
  clampCamera,
  cmToView,
  ghostAgents,
  imageToView,
  placeCallouts,
  sceneForStep,
  sceneTurns,
  sceneViewport,
  THROW_BOW,
  THROW_MIN_CM,
  polylineMidpoint,
  throwArc,
  throwOrigin,
  viewBoxFor,
  viewToImage,
  zoomAbout,
  type SceneMap,
  type ViewRect,
} from './playScene.ts'
import {
  calloutViewport,
  type AbilityElement,
  type AgentElement,
  type MapCallout,
  type PlayElement,
  type PlayPos,
  type PlayStep,
} from './playDoc.ts'
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

const stepOf = (...elements: PlayElement[]): PlayStep => ({ id: 's', name: 'S', caption: '', elements })

const agent = (agentName: string, at: PlayPos, over: Partial<AgentElement> = {}): AgentElement => ({
  kind: 'agent',
  id: agentName.toLowerCase(),
  agent: agentName,
  team: 'ally',
  at,
  ...over,
})

let abilityCount = 0
const ability = (shape: AbilityElement['shape'], at: PlayPos, over: Partial<AbilityElement> = {}): AbilityElement => ({
  kind: 'ability',
  id: `ab${abilityCount++}`,
  agent: 'Omen',
  slot: null,
  shape,
  at,
  ...over,
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

test('agents are placed by callout, dragged points win, and paths run at → via → moveTo', () => {
  const step = stepOf(
    agent('Jett', { callout: 'A Main' }, { via: [{ callout: 'Mid Top' }], moveTo: { callout: 'A Site' }, note: 'entry' }),
    agent('Omen', { callout: 'B Main', u: 0.5, v: 0.25 }, { note: 'smokes', spike: true }),
    agent('Raze', { u: 0.9, v: 0.9 }, { team: 'enemy' }),
  )
  const scene = sceneForStep(step, MAP, 'attack')
  assert.equal(scene.step, step)
  assert.equal(scene.agents.length, 3)
  const [jett, omen, raze] = scene.agents
  const [ax, ay] = viewPointOf('A Main')
  close(jett.x, ax)
  close(jett.y, ay)
  assert.equal(jett.id, 'jett')
  assert.equal(jett.note, 'entry')
  assert.equal(jett.path?.length, 3)
  close(jett.path![1][0], viewPointOf('Mid Top')[0])
  close(jett.path![2][1], viewPointOf('A Site')[1])
  assert.equal(jett.spike, false)

  const [ox, oy] = imageToView(scene.view, 0.5, 0.25)
  close(omen.x, ox)
  close(omen.y, oy)
  assert.equal(omen.path, null)
  assert.equal(omen.spike, true)
  assert.equal(omen.team, 'ally')
  assert.deepEqual([raze.team, raze.note], ['enemy', ''])
  assert.deepEqual(scene.unresolved, [])
})

test('unknown callouts are left out and reported once each', () => {
  const step = stepOf(
    agent('Jett', { callout: 'Catwalk Boxes' }),
    agent('Omen', { callout: 'A Main' }, { moveTo: { callout: 'Catwalk Boxes' }, via: [{ callout: 'Nowhere' }] }),
    ability('smoke', { callout: 'A Site', toward: 'Pizza' }),
    { kind: 'marker', id: 'm', type: 'enemy', at: { callout: 'Nowhere' } },
    { kind: 'arrow', id: 'a', from: { callout: 'A Main' }, to: { callout: 'Lost' }, color: '#FFFFFF' },
    { kind: 'text', id: 't', at: { callout: 'Gone' }, text: 'x', color: '#FFFFFF' },
  )
  const scene = sceneForStep(step, MAP, 'attack')
  assert.deepEqual(scene.agents.map(a => a.agent), ['Omen'])
  // The only placed point of Omen's route is `at`: no path.
  assert.equal(scene.agents[0].path, null)
  // An unknown `toward` keeps the ability on its first callout, but is reported.
  assert.equal(scene.abilities.length, 1)
  close(scene.abilities[0].x, viewPointOf('A Site')[0])
  assert.deepEqual([scene.markers, scene.arrows, scene.texts], [[], [], []])
  assert.deepEqual(scene.unresolved, ['Catwalk Boxes', 'Nowhere', 'Pizza', 'Lost', 'Gone'])
})

test('ability radii take the shape default, the given radius, and a floor', () => {
  const step = stepOf(
    ability('smoke', { callout: 'A Site' }, { label: 'Heaven smoke', slot: 'Ability2' }),
    ability('smoke', { callout: 'A Site' }, { radius: 600 }),
    ability('flash', { callout: 'A Main' }),
    ability('wall', { callout: 'A Main' }, { from: { callout: 'A Site' } }),
    ability('wall', { callout: 'A Main' }, { from: { callout: 'Gone' } }),
    ability('slow', { callout: 'A Main' }),
  )
  const scene = sceneForStep(step, MAP, 'attack')
  const view = scene.view
  const [smoke, big, flash, wall, lost, slow] = scene.abilities
  close(smoke.r, cmToView(UTILITY_RADIUS_CM.smoke, ASCENT, view))
  assert.deepEqual([smoke.label, smoke.slot, smoke.shape, smoke.agent], ['Heaven smoke', 'Ability2', 'smoke', 'Omen'])
  assert.equal(big.label, '')
  close(big.r, cmToView(600, ASCENT, view))
  assert.equal(flash.r, MIN_UTILITY_RADIUS)
  assert.ok(wall.from)
  close(wall.from[0], viewPointOf('A Site')[0])
  assert.equal(lost.from, null)
  assert.equal(UTILITY_RADIUS_CM.slow, 300)
  close(slow.r, cmToView(300, ASCENT, view))
  assert.deepEqual(UTILITY_STYLE.slow, { label: 'Slow', swatch: '#60A5FA' })
  assert.equal(UTILITY_STYLE.slow.swatch, UTILITY_COLORS.slow)
  assert.deepEqual(scene.unresolved, ['Gone'])
})

test('pens, arrows and text are placed in viewBox units', () => {
  const step = stepOf(
    { kind: 'pen', id: 'p', points: [{ u: 0.2, v: 0.3 }, { u: 0.4, v: 0.5 }, { u: 0.6, v: 0.1 }], color: '#FF4655' },
    { kind: 'arrow', id: 'a', from: { callout: 'A Main' }, to: { u: 0.5, v: 0.5 }, color: '#53CADC' },
    { kind: 'text', id: 't', at: { callout: 'B Site' }, text: 'Go', color: '#FFFFFF' },
  )
  const scene = sceneForStep(step, MAP, 'attack')
  const view = scene.view
  assert.equal(scene.pens.length, 1)
  assert.equal(scene.pens[0].color, '#FF4655')
  assert.deepEqual(scene.pens[0].points, [
    imageToView(view, 0.2, 0.3),
    imageToView(view, 0.4, 0.5),
    imageToView(view, 0.6, 0.1),
  ])
  const [arrow] = scene.arrows
  assert.deepEqual([arrow.id, arrow.color], ['a', '#53CADC'])
  close(arrow.from[0], viewPointOf('A Main')[0])
  assert.deepEqual(arrow.to, imageToView(view, 0.5, 0.5))
  const [label] = scene.texts
  assert.deepEqual([label.id, label.text, label.color], ['t', 'Go', '#FFFFFF'])
  close(label.y, viewPointOf('B Site')[1])
})

test('a spike marker on a site callout carries the site letter', () => {
  const step = stepOf(
    { kind: 'marker', id: 'b', type: 'spike', at: { callout: 'B Site' } },
    { kind: 'marker', id: 'mid', type: 'spike', at: { callout: 'Mid Top' } },
    { kind: 'marker', id: 'free', type: 'spike', at: { u: 0.4, v: 0.4 } },
    { kind: 'marker', id: 'op', type: 'enemy', at: { callout: 'A Site' }, label: 'Op' },
    { kind: 'marker', id: 'pin', type: 'pin', at: { callout: 'A Site' } },
  )
  const scene = sceneForStep(step, MAP, 'attack')
  assert.deepEqual(scene.markers.map(m => m.site), ['B', null, null, null, null])
  assert.deepEqual(scene.markers.map(m => m.type), ['spike', 'spike', 'spike', 'enemy', 'pin'])
  assert.equal(scene.markers[3].label, 'Op')
  assert.equal(scene.markers[0].label, '')
})

test('no step gives the map alone', () => {
  for (const step of [null, undefined]) {
    const empty = sceneForStep(step, MAP, 'attack')
    assert.equal(empty.step, null)
    assert.equal(empty.callouts.length, CALLOUTS.length)
    assert.deepEqual(
      [empty.agents, empty.abilities, empty.pens, empty.arrows, empty.texts, empty.markers, empty.unresolved],
      [[], [], [], [], [], [], []],
    )
  }
  assert.deepEqual(sceneForStep(stepOf(), MAP, 'attack').agents, [])
})

test('without a transform only dragged points are placed', () => {
  const step = stepOf(agent('Jett', { callout: 'A Main' }), agent('Omen', { u: 0.5, v: 0.5 }))
  const scene = sceneForStep(step, { transform: null, callouts: CALLOUTS }, 'attack')
  assert.deepEqual(scene.agents.map(a => [a.agent, a.x, a.y]), [['Omen', 500, 500]])
  assert.deepEqual(scene.unresolved, ['A Main'])
})

test('agents on the same spot are spread on a circle about it, in element order from the top', () => {
  const comp = ['Jett', 'Omen', 'Sova', 'Killjoy', 'KAY/O']
  const step = stepOf(...comp.map(name => agent(name, { callout: 'Attacker Side Spawn' }, { moveTo: { callout: 'A Main' } })))
  const scene = sceneForStep(step, MAP, 'attack')
  const [sx, sy] = viewPointOf('Attacker Side Spawn')
  const points = scene.agents.map(a => `${a.x.toFixed(3)},${a.y.toFixed(3)}`)
  assert.equal(new Set(points).size, 5)
  for (const a of scene.agents) {
    assert.ok(Math.hypot(a.x - sx, a.y - sy) <= AGENT_SPREAD_RADIUS + 1e-6, `${a.agent} is too far from the spawn`)
    // The arrow leaves the tile that is drawn.
    assert.deepEqual(a.path![0], [a.x, a.y])
  }
  // The first element sits at the top.
  assert.equal(scene.agents[0].agent, 'Jett')
  close(scene.agents[0].x, sx)
  close(scene.agents[0].y, sy - AGENT_SPREAD_RADIUS)
})

test('agents well apart are not moved, allies and enemies on one spot are spread', () => {
  const view = { u: 0, v: 0, size: 1 }
  const apart = stepOf(agent('Jett', { u: 0.5, v: 0.5 }), agent('Omen', { u: 0.6, v: 0.5 }))
  const scene = sceneForStep(apart, { transform: null, callouts: [] }, 'attack')
  assert.deepEqual(scene.view, view)
  assert.deepEqual(scene.agents.map(a => [a.x, a.y]), [[500, 500], [600, 500]])
  // Two on one spot: 2 x 26 apart, one above and one below.
  const together = stepOf(agent('Jett', { u: 0.5, v: 0.5 }), agent('Raze', { u: 0.5, v: 0.5 }, { team: 'enemy' }))
  const pair = sceneForStep(together, { transform: null, callouts: [] }, 'attack').agents
  close(pair[0].x, 500)
  close(pair[0].y, 474)
  close(pair[1].y, 526)
})

// A plain transform: u = y / 10000 + 0.5, v = x / 10000 + 0.5, so fixtures can
// be written straight in image units.
const PLAIN = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
const at = (superRegion: string, region: string, u: number, v: number) =>
  callout(superRegion, region, (v - 0.5) * 1e4, (u - 0.5) * 1e4)
const SITES = [at('A', 'Site', 0.5, 0.2), at('B', 'Site', 0.5, 0.8)]

// Ascent-like: the spawns side by side, attackers at the right.
const SIDE_BY_SIDE: SceneMap = {
  transform: PLAIN,
  callouts: [...SITES, at('Attacker Side', 'Spawn', 0.8, 0.5), at('Defender Side', 'Spawn', 0.2, 0.5)],
}

test('sceneTurns brings the side the play is for to the bottom', () => {
  const view = sceneViewport(SIDE_BY_SIDE)
  const spawnAt = (name: string, side: 'attack' | 'defense') => {
    const c = SIDE_BY_SIDE.callouts.find(x => x.name === name)!
    const [u, v] = worldToImage(PLAIN, c.x, c.y)
    return imageToView(view, u, v, sceneTurns(SIDE_BY_SIDE, side))
  }
  // A clockwise quarter turn takes the right-hand attacker spawn to the bottom.
  assert.equal(sceneTurns(SIDE_BY_SIDE, 'attack'), 1)
  assert.equal(sceneTurns(SIDE_BY_SIDE, 'defense'), 3)
  assert.ok(spawnAt('Attacker Side Spawn', 'attack')[1] > spawnAt('Defender Side Spawn', 'attack')[1])
  assert.ok(spawnAt('Defender Side Spawn', 'defense')[1] > spawnAt('Attacker Side Spawn', 'defense')[1])

  const upright: SceneMap = {
    transform: PLAIN,
    callouts: [...SITES, at('Attacker Side', 'Spawn', 0.5, 0.9), at('Defender Side', 'Spawn', 0.5, 0.1)],
  }
  assert.equal(sceneTurns(upright, 'attack'), 0)
  assert.equal(sceneTurns(upright, 'defense'), 2)

  assert.equal(sceneTurns({ transform: PLAIN, callouts: SITES }, 'defense'), 0)
  assert.equal(sceneTurns({ transform: null, callouts: SIDE_BY_SIDE.callouts }, 'defense'), 0)
})


test('sceneForStep turns every point it returns', () => {
  const step = stepOf(
    agent('Jett', { callout: 'A Site' }, { moveTo: { callout: 'B Site' } }),
    ability('smoke', { callout: 'B Site' }, { agent: 'Jett', from: { callout: 'A Site' } }),
    { kind: 'marker', id: 'm', type: 'spike', at: { callout: 'B Site' } },
    { kind: 'pen', id: 'p', points: [{ u: 0.5, v: 0.2 }, { u: 0.5, v: 0.8 }], color: '#FFFFFF' },
    { kind: 'arrow', id: 'a', from: { callout: 'A Site' }, to: { callout: 'B Site' }, color: '#FFFFFF' },
    { kind: 'text', id: 't', at: { callout: 'A Site' }, text: 'A', color: '#FFFFFF' },
  )
  const flat = sceneForStep(step, { transform: PLAIN, callouts: SITES }, 'attack')
  const turned = sceneForStep(step, SIDE_BY_SIDE, 'attack')
  assert.equal(flat.turns, 0)
  assert.equal(turned.turns, 1)
  const view = turned.view
  const expect = (u: number, v: number) => imageToView(view, u, v, 1)
  const [ax, ay] = expect(0.5, 0.2)
  const [bx, by] = expect(0.5, 0.8)
  close(turned.agents[0].x, ax)
  close(turned.agents[0].y, ay)
  close(turned.agents[0].path![1][0], bx)
  close(turned.abilities[0].x, bx)
  close(turned.abilities[0].from![1], ay)
  close(turned.markers[0].y, by)
  close(turned.pens[0].points[0][0], ax)
  close(turned.pens[0].points[1][1], by)
  close(turned.arrows[0].from[1], ay)
  close(turned.arrows[0].to[0], bx)
  close(turned.texts[0].x, ax)
  const label = turned.callouts.find(c => c.name === 'A Site')!
  close(label.x, ax)
  close(label.y, ay)
})

test('viewToImage inverts imageToView under every turn', () => {
  const view = { u: 0.1, v: 0.2, size: 0.7 }
  for (const turns of [0, 1, 2, 3] as const) {
    const [x, y] = imageToView(view, 0.3, 0.65, turns)
    const back = viewToImage(view, x, y, turns)
    close(back.u, 0.3)
    close(back.v, 0.65)
  }
  // A quarter turn really moves the point.
  assert.notDeepEqual(imageToView(view, 0.3, 0.65, 1), imageToView(view, 0.3, 0.65, 0))
})

test('ghostAgents leaves a tile where a moved agent stood in the previous step', () => {
  const before = stepOf(
    agent('Jett', { callout: 'A Main' }),
    agent('Omen', { callout: 'B Main' }),
    agent('Sova', { u: 0.4, v: 0.4 }),
  )
  const after = stepOf(
    agent('Jett', { callout: 'A Site' }),
    agent('Omen', { callout: 'B Main' }),
    agent('Sova', { u: 0.45, v: 0.4 }),
  )
  const ghosts = ghostAgents(before, after, MAP, 'attack')
  assert.deepEqual(ghosts.map(g => g.id), ['jett', 'sova'])
  const [jx, jy] = viewPointOf('A Main')
  close(ghosts[0].x, jx)
  close(ghosts[0].y, jy)
  // The placed previous step can be handed in; the answer is the same.
  assert.deepEqual(ghostAgents(before, after, MAP, 'attack', sceneForStep(before, MAP, 'attack')), ghosts)
})

test('ghostAgents ignores agents that stayed, left, or cannot be placed', () => {
  const view = sceneViewport(MAP)
  const aMain = viewToImage(view, ...viewPointOf('A Main'))
  const before = stepOf(
    agent('Jett', { callout: 'A Main' }),
    agent('Omen', { callout: 'B Main' }),
    agent('Sova', { callout: 'Nowhere' }),
  )
  const after = stepOf(
    // Dragged onto the very point its callout stood for.
    agent('Jett', { u: aMain.u, v: aMain.v }),
    agent('Sova', { callout: 'A Site' }),
    agent('Raze', { callout: 'A Site' }),
  )
  assert.deepEqual(ghostAgents(before, after, MAP, 'attack'), [])
  assert.deepEqual(ghostAgents(null, after, MAP, 'attack'), [])
  assert.deepEqual(ghostAgents(before, null, MAP, 'attack'), [])
})

test('ghostAgents reads positions as written, not as spread', () => {
  // Two agents share a spot, so the scene spreads them; when one walks off,
  // the other is drawn somewhere else but did not move.
  const before = stepOf(agent('Jett', { u: 0.5, v: 0.5 }), agent('Omen', { u: 0.5, v: 0.5 }))
  const after = stepOf(agent('Jett', { u: 0.5, v: 0.5 }), agent('Omen', { u: 0.8, v: 0.5 }))
  const flat: SceneMap = { transform: null, callouts: [] }
  const ghosts = ghostAgents(before, after, flat, 'attack')
  assert.deepEqual(ghosts.map(g => g.id), ['omen'])
  // Drawn where the previous step drew it: spread below its partner.
  close(ghosts[0].x, 500)
  close(ghosts[0].y, 500 + AGENT_SPREAD_RADIUS)
})

const closeRect = (actual: ViewRect, expected: ViewRect) => {
  close(actual.x, expected.x)
  close(actual.y, expected.y)
  close(actual.w, expected.w)
  close(actual.h, expected.h)
}

test('viewBoxFor at zoom 1 fits the map square to the shorter side and centres it on the longer', () => {
  closeRect(viewBoxFor({ zoom: 1, x: 0, y: 0 }, 1600, 800), { x: -500, y: 0, w: 2000, h: 1000 })
  closeRect(viewBoxFor({ zoom: 1, x: 300, y: 300 }, 500, 1000), { x: 0, y: -500, w: 1000, h: 2000 })
  closeRect(viewBoxFor({ zoom: 1, x: 0, y: 0 }, 600, 600), { x: 0, y: 0, w: 1000, h: 1000 })
  // Unmeasured: square.
  closeRect(viewBoxFor({ zoom: 2, x: 100, y: 100 }, 0, 0), { x: 100, y: 100, w: 500, h: 500 })
})

test('viewBoxFor at zoom 2 in a 2:1 canvas shows the map 1000 wide and 500 tall, held on the map', () => {
  closeRect(viewBoxFor({ zoom: 2, x: 300, y: 900 }, 800, 400), { x: 0, y: 500, w: 1000, h: 500 })
  closeRect(viewBoxFor({ zoom: 2, x: 0, y: -40 }, 800, 400), { x: 0, y: 0, w: 1000, h: 500 })
  // Zoomed past that, the map is wider than the view and pans that way too.
  closeRect(viewBoxFor({ zoom: 4, x: 900, y: 100 }, 800, 400), { x: 500, y: 100, w: 500, h: 250 })
})

test('clampCamera holds the zoom to its range', () => {
  assert.equal(clampCamera({ zoom: 0.4, x: 0, y: 0 }, 600, 600).zoom, 1)
  assert.equal(clampCamera({ zoom: 40, x: 0, y: 0 }, 600, 600).zoom, MAX_ZOOM)
})

test('zoomAbout keeps the point under the pointer where it is on screen', () => {
  const [width, height] = [900, 600]
  const before = clampCamera({ zoom: 2, x: 200, y: 200 }, width, height)
  const p: [number, number] = [450, 380]
  const after = zoomAbout(before, p, 3, width, height)
  const a = viewBoxFor(before, width, height)
  const b = viewBoxFor(after, width, height)
  assert.equal(after.zoom, 3)
  close((p[0] - a.x) / a.w, (p[0] - b.x) / b.w)
  close((p[1] - a.y) / a.h, (p[1] - b.y) / b.h)
})

test('zoomAbout at the same zoom pans, and a pan past the edge stops at the edge', () => {
  const [width, height] = [600, 600]
  const camera = { zoom: 3, x: 300, y: 300 }
  // The point grabbed at (400, 400) is now under the pointer at (350, 420): the view follows.
  const panned = zoomAbout(camera, [400, 400], 3, width, height, [350, 420])
  close(panned.x, 350)
  close(panned.y, 280)
  const far = zoomAbout(camera, [400, 400], 3, width, height, [-5000, 9000])
  close(far.x, VIEW_SIZE - VIEW_SIZE / 3)
  close(far.y, 0)
  // Zooming out to 1 in a wide canvas centres the map again, whatever the pointer.
  const out = zoomAbout({ zoom: 2, x: 0, y: 0 }, [100, 100], 1, 1600, 800)
  closeRect(viewBoxFor(out, 1600, 800), { x: -500, y: 0, w: 2000, h: 1000 })
})

// ── Utility geometry (§2.10) ────────────────────────────────────────────────

test('throwArc runs from the hand to the landing, bowed 18 % of its length to the left of travel on screen', () => {
  // Travelling right on screen (y down): left is up.
  const right = throwArc([100, 500], [500, 500])
  assert.deepEqual(right.control, [300, 500 - 400 * THROW_BOW])
  assert.deepEqual(right.pointAt(0), [100, 500])
  assert.deepEqual(right.pointAt(1), [500, 500])
  // The curve's middle is half way to the control point.
  const mid = right.pointAt(0.5)
  close(mid[0], 300)
  close(mid[1], 500 - 200 * THROW_BOW)
  assert.equal(right.d, `M100,500Q300,${500 - 400 * THROW_BOW} 500,500`)
  // Travelling down on screen: left is +x. Travelling left: left is down.
  assert.deepEqual(throwArc([0, 0], [0, 100]).control, [100 * THROW_BOW, 50])
  assert.deepEqual(throwArc([500, 0], [100, 0]).control, [300, 400 * THROW_BOW])
  // t is clamped.
  assert.deepEqual(right.pointAt(-1), [100, 500])
  assert.deepEqual(right.pointAt(2), [500, 500])
})

test('throwArc bows to the same screen side for a throw and its mirror under a half turn', () => {
  // The same throw seen on attack and on defense (the map half a turn round): travel reverses on screen, the bow follows.
  const attack = throwArc([200, 800], [600, 300])
  const defense = throwArc([800, 200], [400, 700])
  const side = (arc: ReturnType<typeof throwArc>, from: [number, number], at: [number, number]) => {
    const [cx, cy] = arc.control
    // Cross product of travel and (control - from): negative is left of travel with y down.
    return Math.sign((at[0] - from[0]) * (cy - from[1]) - (at[1] - from[1]) * (cx - from[0]))
  }
  assert.equal(side(attack, [200, 800], [600, 300]), -1)
  assert.equal(side(defense, [800, 200], [400, 700]), -1)
})

test('throwArc with an end gap stops short of the landing on the same curve', () => {
  const arc = throwArc([100, 500], [500, 500], 15)
  const [, rest] = arc.d.split('Q')
  const [, end] = rest.split(' ')
  const [ex, ey] = end.split(',').map(Number)
  const gap = Math.hypot(500 - ex, 500 - ey)
  assert.ok(gap > 13 && gap < 17, `gap ${gap}`)
  // The cut end lies on the whole curve.
  const t = 1 - 15 / (2 * Math.hypot(500 - arc.control[0], 500 - arc.control[1]))
  const [px, py] = arc.pointAt(t)
  close(ex, Math.round(px * 100) / 100, 0.01)
  close(ey, Math.round(py * 100) / 100, 0.01)
  // A degenerate throw does not divide by zero.
  assert.equal(throwArc([10, 10], [10, 10], 15).d, 'M10,10Q10,10 10,10')
})

test('polylineMidpoint is half way along by length', () => {
  assert.deepEqual(polylineMidpoint([[0, 0], [10, 0]]), [5, 0])
  // 10 then 30: the middle (20) is 10 into the second leg.
  assert.deepEqual(polylineMidpoint([[0, 0], [10, 0], [10, 30]]), [10, 10])
  assert.deepEqual(polylineMidpoint([[0, 0], [0, 0], [4, 0], [4, 0]]), [2, 0])
  assert.deepEqual(polylineMidpoint([[3, 4]]), [3, 4])
  assert.equal(polylineMidpoint([]), null)
})

test('abilities carry progress and a placed wall path', () => {
  const step = stepOf(
    ability('molly', { callout: 'A Site' }, { from: { callout: 'A Main' }, progress: 0.4 }),
    ability('molly', { callout: 'A Site' }, { progress: 7 }),
    ability('wall', { callout: 'A Site' }, {
      path: [{ callout: 'A Main' }, { callout: 'Gone' }, { u: 0.5, v: 0.5 }],
    }),
    ability('wall', { callout: 'A Site' }, { path: [{ callout: 'A Main' }, { callout: 'Gone' }] }),
    ability('smoke', { callout: 'A Site' }),
  )
  const scene = sceneForStep(step, MAP, 'attack')
  const [flying, clamped, wall, short, plain] = scene.abilities
  assert.equal(flying.progress, 0.4)
  assert.ok(flying.from)
  assert.equal(clamped.progress, 1)
  assert.equal(wall.path?.length, 2)
  close(wall.path![0][0], viewPointOf('A Main')[0])
  assert.equal(short.path, null)
  assert.equal(plain.progress, null)
  assert.equal(plain.path, null)
  assert.deepEqual(scene.unresolved, ['Gone'])
})

test('throwOrigin copies the agent position when it stands more than 3 m from the click', () => {
  const sova = agent('Sova', { callout: 'A Main' })
  const step = stepOf(agent('Jett', { callout: 'A Site' }), sova)
  const scene = sceneForStep(step, MAP, 'attack')
  const [mx, my] = viewPointOf('A Main')
  const threshold = cmToView(THROW_MIN_CM, ASCENT, scene.view)
  const far = throwOrigin(step, ' sova ', [mx + threshold + 1, my], MAP, scene)
  assert.deepEqual(far, { callout: 'A Main' })
  assert.notEqual(far, sova.at)
  assert.equal(throwOrigin(step, 'Sova', [mx + threshold - 1, my], MAP, scene), null)
  assert.equal(throwOrigin(step, 'Omen', [0, 0], MAP, scene), null)
  assert.equal(throwOrigin(null, 'Sova', [0, 0], MAP, scene), null)
  // Measured from the position as written, not where a crowd spread draws the tile.
  const crowd = stepOf(agent('Jett', { callout: 'A Main' }), sova)
  const crowdScene = sceneForStep(crowd, MAP, 'attack')
  assert.equal(throwOrigin(crowd, 'Sova', [mx + threshold - 1, my], MAP, crowdScene), null)
})
