/**
 * Unit tests for the play document: parsing, callout matching and placement (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PlayDocError,
  calloutViewport,
  emptyPlayDoc,
  findCallout,
  parsePlayDoc,
  resolvePos,
  type MapCallout,
  type PlayDoc,
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

// Ascent-like: real A Main / A Site / A Tree / spawn coordinates, the rest made up
// but inside the image.
const CALLOUTS: MapCallout[] = [
  callout('A', 'Main', 5321, -4710),
  callout('A', 'Site', 6153, -6626),
  callout('A', 'Tree', 3980, -5938),
  callout('A', 'Heaven', 6800, -5600),
  callout('B', 'Main', 2000, 1800),
  callout('B', 'Site', 4500, 2100),
  callout('Mid', 'Top', 3000, -2500),
  callout('Mid', 'Bottom', 2500, -1500),
  callout('Attacker Side', 'Spawn', 60, 50),
  callout('Defender Side', 'Spawn', 7500, -2900),
]

const VALID: PlayDoc = {
  version: 1,
  summary: 'Default into a fast A hit',
  comp: ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'],
  phases: [
    {
      id: 'setup',
      name: 'Setup',
      caption: 'Take map control before the hit.',
      actors: [
        { agent: 'Omen', at: { callout: 'Mid Top' }, note: 'Lurk mid' },
        { agent: 'Sova', at: { callout: 'A Main' }, note: 'Recon A Main', spike: true },
        { agent: 'Jett', at: { callout: 'A Main', toward: 'A Site', t: 0.25 }, note: 'Entry' },
        { agent: 'KAY/O', at: { callout: 'A Main' }, moveTo: { callout: 'A Site' }, via: [{ u: 0.4, v: 0.2 }], note: 'Flash in' },
        { agent: 'Killjoy', at: { u: 0.5, v: 0.5 }, note: 'Watch flank' },
      ],
      utility: [
        { agent: 'Omen', kind: 'smoke', label: 'Heaven smoke', at: { callout: 'Heaven' }, radius: 380 },
        { agent: 'Sova', kind: 'recon', label: 'Recon site', at: { callout: 'A Site' }, from: { callout: 'A Main' } },
      ],
      markers: [{ kind: 'enemy', at: { callout: 'A Tree' }, label: 'Tree player' }],
    },
    {
      id: 'execute',
      name: 'Execute',
      caption: '',
      actors: [
        { agent: 'Omen', at: { callout: 'Mid Top' }, note: '' },
        { agent: 'Sova', at: { callout: 'A Site' }, note: '' },
        { agent: 'Jett', at: { callout: 'A Site' }, note: '' },
        { agent: 'KAY/O', at: { callout: 'A Site' }, note: '' },
        { agent: 'Killjoy', at: { callout: 'A Main' }, note: '' },
      ],
      utility: [],
      markers: [],
    },
  ],
  assumptions: ['Killjoy plays flank because the brief did not say.'],
}

// ── parsePlayDoc ─────────────────────────────────────────────────────────────

test('a valid play parses to itself, from an object, from JSON and from a string', () => {
  assert.deepEqual(parsePlayDoc(VALID), VALID)
  assert.deepEqual(parsePlayDoc(JSON.parse(JSON.stringify(VALID))), VALID)
  assert.deepEqual(parsePlayDoc(JSON.stringify(VALID)), VALID)
  assert.deepEqual(parsePlayDoc(parsePlayDoc(VALID)), VALID)
})

test('an actor whose agent is not in the comp is rejected with a readable sentence', () => {
  const bad = structuredClone(VALID) as unknown as { phases: { actors: { agent: string }[] }[] }
  bad.phases[1].actors[4].agent = 'Raze'
  assert.throws(
    () => parsePlayDoc(bad),
    (err: unknown) =>
      err instanceof PlayDocError &&
      err.message === 'Raze is in the "Execute" phase but not in the comp (Omen, Sova, Jett, KAY/O, Killjoy).',
  )
})

test('garbage and missing positions are rejected as PlayDocError', () => {
  assert.throws(() => parsePlayDoc(null), PlayDocError)
  assert.throws(() => parsePlayDoc('{not json'), PlayDocError)
  assert.throws(() => parsePlayDoc({ comp: ['Omen'], phases: [] }), /no phases/)
  assert.throws(
    () => parsePlayDoc({ comp: ['Omen'], phases: [{ name: 'Setup', actors: [{ agent: 'Omen', at: {} }] }] }),
    /Omen has no position in the "Setup" phase/,
  )
  assert.throws(() => parsePlayDoc({ ...VALID, version: 2 }), /newer version/)
})

test('parse normalizes what it can fix', () => {
  const doc = parsePlayDoc({
    summary: '  Fast B  ',
    comp: [' Omen ', 'omen', 'Sova', '', 'Jett', 'KAY/O', 'Killjoy', 'Raze'],
    phases: [
      {
        name: ' Setup ',
        actors: [
          { agent: 'kay/o', at: { callout: ' B Main ', toward: 'B Site', t: 1.7 }, note: '  flash  ' },
          { agent: 'Omen', at: { callout: 'Mid Top', toward: 'B Main', t: -2 } },
          { agent: 'OMEN', at: { callout: 'A Main' } },
          { agent: 'Sova', at: { u: 1.4, v: -0.2 }, moveTo: { u: 0.3 }, spike: 'yes' },
        ],
        utility: [
          { agent: 'omen', kind: 'Grenade', label: ' dark cover ', at: { callout: 'B Site' }, radius: -5 },
          { agent: 'Sova', kind: 'RECON', at: { callout: 'B Site' } },
          { agent: 'Sova', kind: 'recon' },
        ],
        markers: [{ kind: 'trap', at: { callout: 'B Site' }, label: '' }, { kind: 'enemy' }],
      },
      { name: 'Post-plant' },
      { name: 'Setup', id: 'Setup' },
      { name: 'Four' },
      { name: 'Five' },
      { name: 'Six' },
    ],
  })

  assert.equal(doc.version, 1)
  assert.equal(doc.summary, 'Fast B')
  assert.deepEqual(doc.comp, ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'])
  assert.deepEqual(doc.assumptions, [])

  assert.equal(doc.phases.length, 5)
  assert.deepEqual(doc.phases.map(p => p.id), ['setup', 'post-plant', 'setup-2', 'four', 'five'])
  assert.deepEqual(doc.phases[1], { id: 'post-plant', name: 'Post-plant', caption: '', actors: [], utility: [], markers: [] })

  const [setup] = doc.phases
  assert.equal(setup.name, 'Setup')
  // Comp order, the repeated Omen dropped, spellings taken from the comp.
  assert.deepEqual(setup.actors.map(a => a.agent), ['Omen', 'Sova', 'KAY/O'])
  assert.deepEqual(setup.actors[0].at, { callout: 'Mid Top', toward: 'B Main', t: 0 })
  assert.equal(setup.actors[0].note, '')
  assert.deepEqual(setup.actors[1], { agent: 'Sova', at: { u: 1, v: 0 }, note: '' })
  assert.deepEqual(setup.actors[2], { agent: 'KAY/O', at: { callout: 'B Main', toward: 'B Site', t: 1 }, note: 'flash' })

  assert.deepEqual(setup.utility, [
    { agent: 'Omen', kind: 'other', label: 'dark cover', at: { callout: 'B Site' } },
    { agent: 'Sova', kind: 'recon', label: '', at: { callout: 'B Site' } },
  ])
  assert.deepEqual(setup.markers, [{ kind: 'note', at: { callout: 'B Site' } }])
})

test('a blank hand-made play parses, and puts everyone in their spawn', () => {
  const attack = emptyPlayDoc(['Omen', ' Sova ', 'sova', 'Jett', 'KAY/O', 'Killjoy', 'Raze'])
  assert.deepEqual(attack.comp, ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'])
  assert.deepEqual(attack.phases.map(p => p.id), ['setup', 'execute', 'post-plant'])
  assert.deepEqual(parsePlayDoc(attack), attack)
  const spawn = worldToImage(ASCENT, 60, 50)
  for (const phase of attack.phases) {
    assert.equal(phase.actors.length, 5)
    for (const actor of phase.actors) assert.deepEqual(resolvePos(actor.at, CALLOUTS, ASCENT), spawn)
  }

  const defense = emptyPlayDoc(['Omen'], 'defense')
  assert.deepEqual(resolvePos(defense.phases[0].actors[0].at, CALLOUTS, ASCENT), worldToImage(ASCENT, 7500, -2900))
  assert.deepEqual(parsePlayDoc(emptyPlayDoc([])).comp, [])
})

test('a blank defense play is Setup, Hold and Retake', () => {
  const defense = emptyPlayDoc(['Omen', 'Killjoy'], 'defense')
  assert.deepEqual(defense.phases.map(p => p.id), ['setup', 'hold', 'retake'])
  assert.deepEqual(defense.phases.map(p => p.name), ['Setup', 'Hold', 'Retake'])
  assert.deepEqual(parsePlayDoc(defense), defense)
  assert.deepEqual(emptyPlayDoc(['Omen'], 'attack').phases.map(p => p.name), ['Setup', 'Execute', 'Post-plant'])
})

// ── findCallout ──────────────────────────────────────────────────────────────

const found = (name: string) => findCallout(name, CALLOUTS)?.name ?? null

test('findCallout ignores case, word order and dashes', () => {
  assert.equal(found('A Main'), 'A Main')
  assert.equal(found('a main'), 'A Main')
  assert.equal(found('Main A'), 'A Main')
  assert.equal(found('a-main'), 'A Main')
  assert.equal(found('MID_TOP'), 'Mid Top')
})

test('findCallout takes a bare region when unique, else A before B before Mid', () => {
  assert.equal(found('Heaven'), 'A Heaven')
  assert.equal(found('Main'), 'A Main')
  assert.equal(findCallout('Main', CALLOUTS.filter(c => c.superRegion !== 'A'))?.name, 'B Main')
  assert.equal(found('Bottom'), 'Mid Bottom')
})

test('findCallout knows the spawns by their usual names', () => {
  for (const name of ['T spawn', 'Attacker Spawn', 'Attack Spawn', 'attackers spawn', 'Attacker Side Spawn']) {
    assert.equal(found(name), 'Attacker Side Spawn', name)
  }
  for (const name of ['CT spawn', 'Defender Spawn', 'Defense Spawn', 'Defender Side Spawn']) {
    assert.equal(found(name), 'Defender Side Spawn', name)
  }
})

test('findCallout drops a leading "the" and a trailing "site"', () => {
  assert.equal(found('the A site'), 'A Site')
  assert.equal(found('The Heaven'), 'A Heaven')
  assert.equal(found('A Main site'), 'A Main')
})

test('findCallout returns null for names it cannot place', () => {
  assert.equal(found('Catwalk Boxes'), null)
  assert.equal(found(''), null)
  assert.equal(found('  '), null)
  assert.equal(findCallout('T spawn', []), null)
})

// ── resolvePos ───────────────────────────────────────────────────────────────

test('resolvePos prefers a dragged point over the callout', () => {
  assert.deepEqual(resolvePos({ callout: 'A Main', u: 0.2, v: 0.7 }, CALLOUTS, ASCENT), [0.2, 0.7])
  assert.deepEqual(resolvePos({ callout: 'A Main' }, CALLOUTS, ASCENT), worldToImage(ASCENT, 5321, -4710))
})

test('resolvePos places a point t of the way toward a second callout', () => {
  const [u0, v0] = worldToImage(ASCENT, 5321, -4710)
  const [u1, v1] = worldToImage(ASCENT, 6153, -6626)
  const near = (got: [number, number] | null, want: [number, number]) => {
    assert.ok(got)
    assert.ok(Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9, `${got} vs ${want}`)
  }
  near(resolvePos({ callout: 'A Main', toward: 'A Site', t: 0.25 }, CALLOUTS, ASCENT), [u0 + (u1 - u0) * 0.25, v0 + (v1 - v0) * 0.25])
  near(resolvePos({ callout: 'A Main', toward: 'A Site' }, CALLOUTS, ASCENT), [(u0 + u1) / 2, (v0 + v1) / 2])
  // An unknown second callout leaves the point on the first.
  near(resolvePos({ callout: 'A Main', toward: 'Nowhere', t: 0.5 }, CALLOUTS, ASCENT), [u0, v0])
})

test('resolvePos returns null when nothing resolves', () => {
  assert.equal(resolvePos({ callout: 'Catwalk Boxes' }, CALLOUTS, ASCENT), null)
  assert.equal(resolvePos({}, CALLOUTS, ASCENT), null)
  assert.equal(resolvePos({ u: 0.5 }, CALLOUTS, ASCENT), null)
})

// ── calloutViewport ──────────────────────────────────────────────────────────

test('calloutViewport is a square inside the image that holds every callout', () => {
  const view = calloutViewport(CALLOUTS, ASCENT)
  assert.ok(view.size > 0 && view.size <= 1)
  assert.ok(view.u >= 0 && view.v >= 0)
  assert.ok(view.u + view.size <= 1 + 1e-12 && view.v + view.size <= 1 + 1e-12)
  for (const c of CALLOUTS) {
    const [u, v] = worldToImage(ASCENT, c.x, c.y)
    assert.ok(u >= view.u && u <= view.u + view.size, `${c.name} u`)
    assert.ok(v >= view.v && v <= view.v + view.size, `${c.name} v`)
  }
})

test('calloutViewport keeps its margin around a small cluster, and falls back to the whole image', () => {
  const cluster = CALLOUTS.slice(0, 3)
  const view = calloutViewport(cluster, ASCENT, 0.06)
  const us = cluster.map(c => worldToImage(ASCENT, c.x, c.y)[0])
  const vs = cluster.map(c => worldToImage(ASCENT, c.x, c.y)[1])
  const span = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs))
  assert.ok(Math.abs(view.size - (span + 0.12)) < 1e-12)
  assert.ok(Math.min(...us) - view.u >= 0.06 - 1e-12 && Math.min(...vs) - view.v >= 0.06 - 1e-12)

  assert.deepEqual(calloutViewport([], ASCENT), { u: 0, v: 0, size: 1 })
})
