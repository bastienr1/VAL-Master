import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clipEmbedUrl,
  formatClock,
  imageColumn,
  lineupElement,
  lineupImagePath,
  lineupTitle,
  lineupsStep,
  movedLineup,
  nearestCallout,
  parseClock,
  parseLineupPoint,
  pictureCount,
  recipeLine,
  validateLineupImage,
  type Lineup,
} from './lineupModel.ts'
import type { MapCallout } from './playDoc.ts'

// u = y · 1e-4 + 0.5, v = x · 1e-4 + 0.5: the world's origin is the middle of the picture.
const T = { xMultiplier: 1e-4, yMultiplier: 1e-4, xScalarToAdd: 0.5, yScalarToAdd: 0.5 }
const callout = (superRegion: string, region: string, x: number, y: number): MapCallout => ({ superRegion, region, name: `${superRegion} ${region}`, x, y })
const CALLOUTS = [callout('A', 'Main', 0, -3000), callout('A', 'Site', 0, 3000), callout('Mid', 'Courtyard', 2000, 0)]

const SHOCK: Pick<Lineup, 'id' | 'agent' | 'slot' | 'stand' | 'land' | 'title'> = {
  id: 'l1',
  agent: 'Sova',
  slot: 'Ability1',
  stand: { u: 0.2, v: 0.5 },
  land: { u: 0.8, v: 0.5 },
  title: 'A Site from A Main',
}

test('a stored point is a point or nothing', () => {
  assert.deepEqual(parseLineupPoint({ u: 0.25, v: 0.5, extra: 1 }), { u: 0.25, v: 0.5 })
  assert.equal(parseLineupPoint({ u: '0.25', v: 0.5 }), null)
  assert.equal(parseLineupPoint({ u: Number.NaN, v: 0.5 }), null)
  assert.equal(parseLineupPoint(null), null)
  assert.equal(parseLineupPoint({ callout: 'A Main' }), null)
})

test('the nearest callout names a place', () => {
  assert.equal(nearestCallout({ u: 0.22, v: 0.5 }, CALLOUTS, T)?.name, 'A Main')
  assert.equal(nearestCallout({ u: 0.79, v: 0.52 }, CALLOUTS, T)?.name, 'A Site')
  assert.equal(nearestCallout({ u: 0.5, v: 0.68 }, CALLOUTS, T)?.name, 'Mid Courtyard')
  assert.equal(nearestCallout({ u: 0.5, v: 0.5 }, [], T), null)
})

test('a line-up is named from where it lands and where you stand', () => {
  assert.equal(lineupTitle('A Site', 'A Main', 'Shock Bolt'), 'A Site from A Main')
  assert.equal(lineupTitle('A Site', 'A Site', 'Shock Bolt'), 'Shock Bolt, A Site')
  assert.equal(lineupTitle('A Site', null, 'Shock Bolt'), 'Shock Bolt to A Site')
  assert.equal(lineupTitle(null, 'A Main', 'Shock Bolt'), 'Shock Bolt from A Main')
  assert.equal(lineupTitle(null, null, 'Shock Bolt'), 'Shock Bolt')
})

test('on the board it is the ability at its landing, thrown from where you stand', () => {
  const el = lineupElement(SHOCK)
  assert.deepEqual(
    { kind: el.kind, id: el.id, agent: el.agent, slot: el.slot, at: el.at, from: el.from, team: el.team, label: el.label },
    { kind: 'ability', id: 'l1', agent: 'Sova', slot: 'Ability1', at: { u: 0.8, v: 0.5 }, from: { u: 0.2, v: 0.5 }, team: 'ally', label: 'A Site from A Main' },
  )
  // The catalogue's shape and reach: Shock Bolt ends 4 m out.
  assert.equal(el.radius, 400)
  const step = lineupsStep([SHOCK], [{ kind: 'marker', id: 'pin', type: 'pin', at: { u: 0.1, v: 0.1 } }])
  assert.deepEqual(step.elements.map(e => e.id), ['l1', 'pin'])
})

test('a drag on the board is read back as new points, and a press that moved nothing is not', () => {
  const step = lineupsStep([SHOCK])
  assert.equal(movedLineup(step, SHOCK), null)
  const [el] = step.elements
  assert.ok(el.kind === 'ability')
  // The landing dragged.
  assert.deepEqual(movedLineup({ ...step, elements: [{ ...el, at: { u: 0.7, v: 0.4 } }] }, SHOCK), { stand: SHOCK.stand, land: { u: 0.7, v: 0.4 } })
  // The hand dragged.
  assert.deepEqual(movedLineup({ ...step, elements: [{ ...el, from: { u: 0.3, v: 0.6 } }] }, SHOCK), { stand: { u: 0.3, v: 0.6 }, land: SHOCK.land })
  // Not drawn (another map is showing): nothing to read.
  assert.equal(movedLineup({ ...step, elements: [] }, SHOCK), null)
})

test('clip times are read as a clock or as seconds', () => {
  assert.equal(parseClock('83'), 83)
  assert.equal(parseClock('1:23'), 83)
  assert.equal(parseClock('1:02:03'), 3723)
  assert.equal(parseClock(' 0:07 '), 7)
  assert.equal(parseClock(''), null)
  assert.equal(parseClock('1:2a'), null)
  assert.equal(parseClock('-4'), null)
  assert.equal(formatClock(83), '1:23')
  assert.equal(formatClock(7), '0:07')
  assert.equal(formatClock(null), '')
})

test('the clip plays between its two times, and only a YouTube link is a clip', () => {
  assert.equal(clipEmbedUrl('https://youtu.be/dQw4w9WgXcQ', 83, 91), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=83&end=91')
  assert.equal(clipEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', null, null), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0')
  // An end before the start is dropped rather than making a clip that never plays.
  assert.equal(clipEmbedUrl('https://youtu.be/dQw4w9WgXcQ', 90, 80), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90')
  assert.equal(clipEmbedUrl('https://example.com/clip.mp4', 0, 5), null)
  assert.equal(clipEmbedUrl(null, 0, 5), null)
})

test('the recipe reads in one line, with only what is known', () => {
  const none = { stance: null, movement: null, click: null, bounces: null, charge: null }
  assert.equal(recipeLine(none), '')
  assert.equal(recipeLine({ ...none, stance: 'standing', movement: 'still', click: 'left' }), 'Standing · Still · Left click')
  assert.equal(recipeLine({ ...none, stance: 'crouched', movement: 'run-jump', click: 'right', charge: 2, bounces: 1 }), 'Crouched · Run and jump · Right click · 2 bars · 1 bounce')
  assert.equal(recipeLine({ ...none, charge: 1, bounces: 0 }), '1 bar · No bounce')
})

test('pictures: three fixed slots, kept under their owner', () => {
  assert.equal(imageColumn('aim'), 'aim_image')
  assert.equal(lineupImagePath('user', 'l1', 'aim', 'image/webp', 42), 'user/l1/aim-42.webp')
  assert.equal(lineupImagePath('user', 'l1', 'stand', 'image/jpeg', 42), 'user/l1/stand-42.jpg')
  assert.equal(validateLineupImage({ type: 'image/webp', size: 1000 }), null)
  assert.match(validateLineupImage({ type: 'image/gif', size: 1000 }) ?? '', /WebP, PNG or JPEG/)
  assert.match(validateLineupImage({ type: 'image/png', size: 6 * 1024 * 1024 }) ?? '', /6\.0 MB/)
  assert.equal(pictureCount({ stand_image: 'a', aim_image: null, result_image: 'c' }), 2)
})
