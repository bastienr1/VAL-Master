/**
 * Unit tests for placing a play step on the Plays canvas (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SPREAD_RADIUS,
  MIN_UTILITY_RADIUS,
  UTILITY_RADIUS_CM,
  UTILITY_STYLE,
  VIEW_SIZE,
  cmToView,
  ghostAgents,
  imageToView,
  placeCallouts,
  sceneForStep,
  sceneTurns,
  sceneViewport,
  viewToImage,
  type SceneMap,
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
  assert.deepEqual(UTILITY_STYLE.slow, { label: 'Slow', swatch: 'rgba(96,165,250,0.35)' })
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
