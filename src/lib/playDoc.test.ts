/**
 * Unit tests for the play document: parsing, migration from v1, the step
 * helpers, callout matching and placement (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PlayDocError,
  calloutViewport,
  copyStep,
  elementAt,
  emptyPlayDoc,
  findCallout,
  migratePlayDoc,
  newId,
  parsePlayDoc,
  resolvePos,
  withElement,
  withoutElement,
  type AgentElement,
  type MapCallout,
  type PlayDoc,
  type PlayDocV1,
  type PlayElement,
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
  version: 2,
  summary: 'Default into a fast A hit',
  comp: ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'],
  steps: [
    {
      id: 'setup',
      name: 'Setup',
      caption: 'Take map control before the hit.',
      elements: [
        { kind: 'agent', id: 'omen', agent: 'Omen', team: 'ally', at: { callout: 'Mid Top' }, note: 'Lurk mid' },
        { kind: 'agent', id: 'sova', agent: 'Sova', team: 'ally', at: { callout: 'A Main' }, note: 'Recon A Main', spike: true },
        { kind: 'agent', id: 'jett', agent: 'Jett', team: 'ally', at: { callout: 'A Main', toward: 'A Site', t: 0.25 } },
        {
          kind: 'agent',
          id: 'kayo',
          agent: 'KAY/O',
          team: 'ally',
          at: { callout: 'A Main' },
          moveTo: { callout: 'A Site' },
          via: [{ u: 0.4, v: 0.2 }],
          note: 'Flash in',
        },
        { kind: 'agent', id: 'kj', agent: 'Killjoy', team: 'ally', at: { u: 0.5, v: 0.5 }, note: 'Watch flank' },
        { kind: 'agent', id: 'op', agent: 'Chamber', team: 'enemy', at: { callout: 'A Tree' } },
        {
          kind: 'ability',
          id: 'smoke1',
          agent: 'Omen',
          slot: 'Ability2',
          shape: 'smoke',
          at: { callout: 'Heaven' },
          radius: 380,
          label: 'Heaven smoke',
        },
        { kind: 'ability', id: 'dart', agent: 'Sova', slot: null, shape: 'recon', at: { callout: 'A Site' }, from: { callout: 'A Main' } },
        { kind: 'pen', id: 'line', points: [{ u: 0.1, v: 0.2 }, { u: 0.3, v: 0.4 }], color: '#FF4655' },
        { kind: 'arrow', id: 'go', from: { callout: 'A Main' }, to: { callout: 'A Site' }, color: '#FFFFFF' },
        { kind: 'text', id: 'call', at: { u: 0.6, v: 0.6 }, text: 'Go on 3', color: '#53cadc' },
        { kind: 'marker', id: 'tree', type: 'enemy', at: { callout: 'A Tree' }, label: 'Tree player' },
      ],
    },
    {
      id: 'execute',
      name: 'Execute',
      caption: '',
      elements: [
        { kind: 'agent', id: 'omen', agent: 'Omen', team: 'ally', at: { callout: 'Mid Top' } },
        { kind: 'agent', id: 'sova', agent: 'Sova', team: 'ally', at: { callout: 'A Site' } },
        { kind: 'marker', id: 'bomb', type: 'spike', at: { callout: 'A Site' } },
      ],
    },
    { id: 'empty', name: 'Empty', caption: '', elements: [] },
  ],
  assumptions: ['Killjoy plays flank because the brief did not say.'],
}

/** A step's element of this id, which the test expects to be there. */
const el = (step: PlayStep, id: string): PlayElement => {
  const found = step.elements.find(e => e.id === id)
  assert.ok(found, `element ${id}`)
  return found
}

const ID = /^[0-9a-z]{8}$/

// ── parsePlayDoc ─────────────────────────────────────────────────────────────

test('a valid play parses to itself, from an object, from JSON and from a string', () => {
  assert.deepEqual(parsePlayDoc(VALID), VALID)
  assert.deepEqual(parsePlayDoc(JSON.parse(JSON.stringify(VALID))), VALID)
  assert.deepEqual(parsePlayDoc(JSON.stringify(VALID)), VALID)
  assert.deepEqual(parsePlayDoc(parsePlayDoc(VALID)), VALID)
})

test('an ally agent not in the comp is rejected with a readable sentence', () => {
  const bad = structuredClone(VALID)
  ;(bad.steps[1].elements[1] as AgentElement).agent = 'Raze'
  assert.throws(
    () => parsePlayDoc(bad),
    (err: unknown) =>
      err instanceof PlayDocError &&
      err.message === 'Raze is in the "Execute" step but not in the comp (Omen, Sova, Jett, KAY/O, Killjoy).',
  )
})

test('an enemy agent need not be in the comp', () => {
  const doc = parsePlayDoc({
    comp: ['Omen'],
    steps: [
      {
        name: 'Hold',
        elements: [
          { kind: 'agent', agent: 'Omen', at: { callout: 'A Site' } },
          { kind: 'agent', agent: ' Raze ', team: 'ENEMY', at: { callout: 'A Main' } },
          // Same agent on both teams is a mirror, not a repeat.
          { kind: 'agent', agent: 'Omen', team: 'enemy', at: { callout: 'B Main' } },
          { kind: 'agent', agent: '', team: 'enemy', at: { callout: 'B Main' } },
        ],
      },
    ],
  })
  const agents = doc.steps[0].elements as AgentElement[]
  assert.deepEqual(agents.map(a => [a.agent, a.team]), [['Omen', 'ally'], ['Raze', 'enemy'], ['Omen', 'enemy']])
})

test('garbage and missing agent positions are rejected as PlayDocError', () => {
  assert.throws(() => parsePlayDoc(null), PlayDocError)
  assert.throws(() => parsePlayDoc('{not json'), PlayDocError)
  assert.throws(
    () => parsePlayDoc({ comp: ['Omen'], steps: [{ name: 'Setup', elements: [{ kind: 'agent', agent: 'Omen', at: {} }] }] }),
    /Omen has no position in the "Setup" step/,
  )
  assert.throws(
    () => parsePlayDoc({ comp: [], steps: [{ name: 'Setup', elements: [{ kind: 'agent', agent: 'Raze', team: 'enemy' }] }] }),
    /Raze has no position/,
  )
  assert.throws(() => parsePlayDoc({ ...VALID, version: 3 }), /newer version/)
})

test('a play may have no steps, and a step no elements', () => {
  assert.deepEqual(parsePlayDoc({ comp: ['Omen'], steps: [] }), {
    version: 2,
    summary: '',
    comp: ['Omen'],
    steps: [],
    assumptions: [],
  })
  assert.deepEqual(parsePlayDoc({ version: 2, steps: [{}] }).steps, [{ id: 'step-1', name: 'Step 1', caption: '', elements: [] }])
})

test('parse normalizes what it can fix', () => {
  const doc = parsePlayDoc({
    summary: '  Fast B  ',
    comp: [' Omen ', 'omen', 'Sova', '', 'Jett', 'KAY/O', 'Killjoy', 'Raze'],
    steps: [
      {
        name: ' Setup ',
        elements: [
          { kind: 'agent', agent: 'kay/o', at: { callout: ' B Main ', toward: 'B Site', t: 1.7 }, note: '  flash  ' },
          { kind: 'agent', agent: 'Omen', at: { callout: 'Mid Top', toward: 'B Main', t: -2 }, note: '   ' },
          { kind: 'agent', agent: 'OMEN', at: { callout: 'A Main' } },
          { kind: 'Agent', agent: 'Sova', team: 'nobody', at: { u: 1.4, v: -0.2 }, moveTo: { u: 0.3 }, spike: 'yes' },
          { kind: 'ability', agent: 'omen', slot: 'ability2', shape: 'Grenade', label: ' dark cover ', at: { callout: 'B Site' }, radius: -5 },
          { kind: 'ability', agent: 'Sova', slot: 'Passive', shape: 'RECON', at: { callout: 'B Site' } },
          { kind: 'ability', agent: 'Sova', shape: 'slow', at: { u: 0.2, v: 0.2 } },
          { kind: 'ability', agent: 'Sova', shape: 'recon' },
          { kind: 'marker', type: 'trap', at: { callout: 'B Site' }, label: '' },
          { kind: 'marker', type: 'SPIKE', at: { callout: 'B Site' } },
          { kind: 'marker', type: 'enemy' },
          { kind: 'arrow', from: { callout: 'A Main' }, color: '#FFFFFF' },
          { kind: 'text', at: { u: 0.5, v: 0.5 }, text: '  Hold  ' },
          { kind: 'image', at: { u: 0.5, v: 0.5 } },
          'nonsense',
        ],
      },
      { name: 'Post-plant' },
      { name: 'Setup', id: 'Setup' },
      ...Array.from({ length: 9 }, (_, i) => ({ name: `Extra ${i + 1}` })),
    ],
  })

  assert.equal(doc.version, 2)
  assert.equal(doc.summary, 'Fast B')
  assert.deepEqual(doc.comp, ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'])
  assert.deepEqual(doc.assumptions, [])

  assert.equal(doc.steps.length, 10)
  assert.deepEqual(doc.steps.slice(0, 4).map(s => s.id), ['setup', 'post-plant', 'setup-2', 'extra-1'])
  assert.deepEqual(doc.steps[1], { id: 'post-plant', name: 'Post-plant', caption: '', elements: [] })

  const [setup] = doc.steps
  assert.equal(setup.name, 'Setup')
  // Every element has an id, unique within the step.
  for (const e of setup.elements) assert.match(e.id, ID)
  assert.equal(new Set(setup.elements.map(e => e.id)).size, setup.elements.length)

  // Without the generated ids, for comparing.
  const bare = setup.elements.map(e => {
    const { id, ...rest } = e
    assert.ok(id)
    return rest
  })
  assert.deepEqual(bare, [
    // Spellings taken from the comp, the repeated Omen dropped, an empty note left out.
    { kind: 'agent', agent: 'KAY/O', team: 'ally', at: { callout: 'B Main', toward: 'B Site', t: 1 }, note: 'flash' },
    { kind: 'agent', agent: 'Omen', team: 'ally', at: { callout: 'Mid Top', toward: 'B Main', t: 0 } },
    { kind: 'agent', agent: 'Sova', team: 'ally', at: { u: 1, v: 0 } },
    { kind: 'ability', agent: 'Omen', slot: 'Ability2', shape: 'other', at: { callout: 'B Site' }, label: 'dark cover' },
    { kind: 'ability', agent: 'Sova', slot: null, shape: 'recon', at: { callout: 'B Site' } },
    { kind: 'ability', agent: 'Sova', slot: null, shape: 'slow', at: { u: 0.2, v: 0.2 } },
    { kind: 'marker', type: 'pin', at: { callout: 'B Site' } },
    { kind: 'marker', type: 'spike', at: { callout: 'B Site' } },
    { kind: 'text', at: { u: 0.5, v: 0.5 }, text: 'Hold', color: '#FFFFFF' },
  ])
})

test('repeated and missing element ids are regenerated, the first keeps its id', () => {
  const doc = parsePlayDoc({
    comp: ['Omen', 'Sova'],
    steps: [
      {
        name: 'Setup',
        elements: [
          { kind: 'agent', id: 'x', agent: 'Omen', at: { callout: 'A Main' } },
          { kind: 'agent', id: 'x', agent: 'Sova', at: { callout: 'A Main' } },
          { kind: 'marker', id: '  ', type: 'pin', at: { callout: 'A Main' } },
          { kind: 'marker', id: 'x', type: 'pin', at: { callout: 'A Main' } },
        ],
      },
      // Unique within a step, not across steps: the same id may come back.
      { name: 'Execute', elements: [{ kind: 'agent', id: 'x', agent: 'Omen', at: { callout: 'A Site' } }] },
    ],
  })
  const ids = doc.steps[0].elements.map(e => e.id)
  assert.equal(ids[0], 'x')
  for (const id of ids.slice(1)) assert.match(id, ID)
  assert.equal(new Set(ids).size, 4)
  assert.equal(doc.steps[1].elements[0].id, 'x')
})

test('a colour that is not #rrggbb becomes white', () => {
  const doc = parsePlayDoc({
    steps: [
      {
        name: 'Draw',
        elements: [
          { kind: 'pen', points: [{ u: 0, v: 0 }, { u: 1, v: 1 }], color: 'red' },
          { kind: 'arrow', from: { u: 0, v: 0 }, to: { u: 1, v: 1 }, color: '#FFF' },
          { kind: 'text', at: { u: 0, v: 0 }, text: 'a', color: '#12345G' },
          { kind: 'text', at: { u: 0, v: 0 }, text: 'b' },
          { kind: 'text', at: { u: 0, v: 0 }, text: 'c', color: ' #ff4655 ' },
        ],
      },
    ],
  })
  assert.deepEqual(
    doc.steps[0].elements.map(e => ('color' in e ? e.color : null)),
    ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#ff4655'],
  )
})

test('a pen stroke with fewer than two usable points is dropped, points are clamped', () => {
  const doc = parsePlayDoc({
    steps: [
      {
        name: 'Draw',
        elements: [
          { kind: 'pen', id: 'one', points: [{ u: 0.5, v: 0.5 }] },
          { kind: 'pen', id: 'half', points: [{ u: 0.5, v: 0.5 }, { u: 0.2 }, 'x'] },
          { kind: 'pen', id: 'none' },
          { kind: 'pen', id: 'two', points: [{ u: -1, v: 0.5 }, { u: 0.2, v: 3 }] },
        ],
      },
    ],
  })
  assert.deepEqual(doc.steps[0].elements, [
    { kind: 'pen', id: 'two', points: [{ u: 0, v: 0.5 }, { u: 0.2, v: 1 }], color: '#FFFFFF' },
  ])
})

// ── migratePlayDoc ───────────────────────────────────────────────────────────

const V1: PlayDocV1 = {
  version: 1,
  summary: 'Default into a fast A hit',
  comp: ['Omen', 'Sova', 'Jett'],
  phases: [
    {
      id: 'setup',
      name: 'Setup',
      caption: 'Take map control before the hit.',
      actors: [
        { agent: 'Omen', at: { callout: 'Mid Top' }, note: 'Lurk mid' },
        { agent: 'Sova', at: { callout: 'A Main' }, note: '', spike: true },
        { agent: 'Jett', at: { callout: 'A Main' }, moveTo: { callout: 'A Site' }, via: [{ u: 0.4, v: 0.2 }], note: 'Entry' },
      ],
      utility: [
        { agent: 'Omen', kind: 'smoke', label: 'Heaven smoke', at: { callout: 'Heaven' }, radius: 380 },
        { agent: 'Sova', kind: 'recon', label: '', at: { callout: 'A Site' }, from: { callout: 'A Main' } },
      ],
      markers: [
        { kind: 'enemy', at: { callout: 'A Tree' }, label: 'Tree player' },
        { kind: 'note', at: { u: 0.3, v: 0.3 } },
      ],
    },
    {
      id: 'execute',
      name: 'Execute',
      caption: '',
      actors: [
        { agent: 'Omen', at: { callout: 'Mid Top' }, note: '' },
        { agent: 'Sova', at: { callout: 'A Site' }, note: '' },
        { agent: 'Jett', at: { callout: 'A Site' }, note: '' },
      ],
      utility: [],
      markers: [{ kind: 'spike', at: { callout: 'A Site' } }],
    },
  ],
  assumptions: ['Jett entries because the brief did not say.'],
}

const withoutIds = (doc: PlayDoc) => ({
  ...doc,
  steps: doc.steps.map(s => ({
    ...s,
    elements: s.elements.map(({ id, ...rest }) => {
      assert.ok(id)
      return rest
    }),
  })),
})

test('a v1 play migrates: phases to steps, actors to ally agents, utility to abilities, markers kept', () => {
  const before = structuredClone(V1)
  const doc = migratePlayDoc(V1)
  assert.deepEqual(V1, before, 'the v1 play is not touched')

  assert.deepEqual(withoutIds(doc), {
    version: 2,
    summary: 'Default into a fast A hit',
    comp: ['Omen', 'Sova', 'Jett'],
    steps: [
      {
        id: 'setup',
        name: 'Setup',
        caption: 'Take map control before the hit.',
        elements: [
          { kind: 'agent', agent: 'Omen', team: 'ally', at: { callout: 'Mid Top' }, note: 'Lurk mid' },
          { kind: 'agent', agent: 'Sova', team: 'ally', at: { callout: 'A Main' }, spike: true },
          {
            kind: 'agent',
            agent: 'Jett',
            team: 'ally',
            at: { callout: 'A Main' },
            moveTo: { callout: 'A Site' },
            via: [{ u: 0.4, v: 0.2 }],
            note: 'Entry',
          },
          { kind: 'ability', agent: 'Omen', slot: null, shape: 'smoke', at: { callout: 'Heaven' }, radius: 380, label: 'Heaven smoke' },
          { kind: 'ability', agent: 'Sova', slot: null, shape: 'recon', at: { callout: 'A Site' }, from: { callout: 'A Main' } },
          { kind: 'marker', type: 'enemy', at: { callout: 'A Tree' }, label: 'Tree player' },
          { kind: 'marker', type: 'pin', at: { u: 0.3, v: 0.3 } },
        ],
      },
      {
        id: 'execute',
        name: 'Execute',
        caption: '',
        elements: [
          { kind: 'agent', agent: 'Omen', team: 'ally', at: { callout: 'Mid Top' } },
          { kind: 'agent', agent: 'Sova', team: 'ally', at: { callout: 'A Site' } },
          { kind: 'agent', agent: 'Jett', team: 'ally', at: { callout: 'A Site' } },
          { kind: 'marker', type: 'spike', at: { callout: 'A Site' } },
        ],
      },
    ],
    assumptions: ['Jett entries because the brief did not say.'],
  })

  // Ids: fresh, unique within each step, and one per agent across the steps.
  for (const step of doc.steps) {
    for (const e of step.elements) assert.match(e.id, ID)
    assert.equal(new Set(step.elements.map(e => e.id)).size, step.elements.length)
  }
  const agentIds = (step: PlayStep) => step.elements.filter(e => e.kind === 'agent').map(e => e.id)
  assert.deepEqual(agentIds(doc.steps[0]), agentIds(doc.steps[1]))
})

test('parsePlayDoc migrates a v1 play, with or without its version', () => {
  assert.deepEqual(withoutIds(parsePlayDoc(V1)), withoutIds(migratePlayDoc(V1)))
  assert.deepEqual(withoutIds(parsePlayDoc(JSON.stringify(V1))), withoutIds(migratePlayDoc(V1)))
  const { version, ...unversioned } = V1
  assert.equal(version, 1)
  assert.deepEqual(withoutIds(parsePlayDoc(unversioned)), withoutIds(migratePlayDoc(V1)))
  // The result is an ordinary v2 play.
  const migrated = parsePlayDoc(V1)
  assert.deepEqual(parsePlayDoc(migrated), migrated)
})

test('a v1 play keeps the v1 rules through the migration', () => {
  const bad = structuredClone(V1)
  bad.phases[1].actors[2].agent = 'Raze'
  assert.throws(() => parsePlayDoc(bad), /Raze is in the "Execute" step but not in the comp \(Omen, Sova, Jett\)\./)
  assert.throws(
    () => parsePlayDoc({ version: 1, comp: ['Omen'], phases: [{ name: 'Setup', actors: [{ agent: 'Omen', at: {} }] }] }),
    /Omen has no position in the "Setup" step/,
  )
  // A v1 play with no phases is a v2 play with no steps.
  assert.deepEqual(parsePlayDoc({ comp: ['Omen'], phases: [] }).steps, [])
})

// ── emptyPlayDoc ─────────────────────────────────────────────────────────────

test('a blank hand-made play parses, and puts everyone in their spawn', () => {
  const attack = emptyPlayDoc(['Omen', ' Sova ', 'sova', 'Jett', 'KAY/O', 'Killjoy', 'Raze'])
  assert.equal(attack.version, 2)
  assert.deepEqual(attack.comp, ['Omen', 'Sova', 'Jett', 'KAY/O', 'Killjoy'])
  assert.deepEqual(attack.steps.map(s => s.id), ['setup', 'execute', 'post-plant'])
  assert.deepEqual(parsePlayDoc(attack), attack)
  const spawn = worldToImage(ASCENT, 60, 50)
  for (const step of attack.steps) {
    assert.equal(step.elements.length, 5)
    for (const e of step.elements) {
      assert.equal(e.kind, 'agent')
      assert.equal((e as AgentElement).team, 'ally')
      assert.deepEqual(resolvePos((e as AgentElement).at, CALLOUTS, ASCENT), spawn)
    }
    // The same agent is the same element in every step.
    assert.deepEqual(step.elements.map(e => e.id), attack.steps[0].elements.map(e => e.id))
  }
  assert.equal(new Set(attack.steps[0].elements.map(e => e.id)).size, 5)

  const defense = emptyPlayDoc(['Omen'], 'defense')
  assert.deepEqual(
    resolvePos((defense.steps[0].elements[0] as AgentElement).at, CALLOUTS, ASCENT),
    worldToImage(ASCENT, 7500, -2900),
  )
  assert.deepEqual(parsePlayDoc(emptyPlayDoc([])).comp, [])
})

test('a blank defense play is Setup, Hold and Retake', () => {
  const defense = emptyPlayDoc(['Omen', 'Killjoy'], 'defense')
  assert.deepEqual(defense.steps.map(s => s.id), ['setup', 'hold', 'retake'])
  assert.deepEqual(defense.steps.map(s => s.name), ['Setup', 'Hold', 'Retake'])
  assert.deepEqual(parsePlayDoc(defense), defense)
  assert.deepEqual(emptyPlayDoc(['Omen'], 'attack').steps.map(s => s.name), ['Setup', 'Execute', 'Post-plant'])
})

// ── Step helpers ─────────────────────────────────────────────────────────────

test('newId is 8 base-36 characters and does not repeat', () => {
  const ids = Array.from({ length: 2000 }, newId)
  for (const id of ids) assert.match(id, ID)
  assert.equal(new Set(ids).size, ids.length)
})

test('copyStep keeps the element ids under a new step id and name', () => {
  const setup = VALID.steps[0]
  const copy = copyStep(setup, ' Execute ')
  assert.notEqual(copy.id, setup.id)
  assert.equal(copy.name, 'Execute')
  assert.equal(copy.caption, '')
  assert.deepEqual(copy.elements, setup.elements)
  // A deep copy: editing the copy leaves the original alone.
  assert.notEqual(copy.elements[0], setup.elements[0])
  ;(copy.elements[0] as AgentElement).at.callout = 'B Site'
  assert.equal((setup.elements[0] as AgentElement).at.callout, 'Mid Top')
})

test('elementAt, withElement and withoutElement work by id without touching the step', () => {
  const step = structuredClone(VALID.steps[1])
  const before = structuredClone(step)

  assert.equal(elementAt(step, 'sova'), step.elements[1])
  assert.equal(elementAt(step, 'nope'), null)

  const moved: AgentElement = { kind: 'agent', id: 'sova', agent: 'Sova', team: 'ally', at: { u: 0.1, v: 0.9 } }
  const replaced = withElement(step, moved)
  assert.deepEqual(replaced.elements.map(e => e.id), ['omen', 'sova', 'bomb'])
  assert.equal(replaced.elements[1], moved)
  assert.equal(replaced.elements[0], step.elements[0])

  const pin: PlayElement = { kind: 'marker', id: 'pin', type: 'pin', at: { u: 0.5, v: 0.5 } }
  assert.deepEqual(withElement(step, pin).elements.map(e => e.id), ['omen', 'sova', 'bomb', 'pin'])

  assert.deepEqual(withoutElement(step, 'omen').elements.map(e => e.id), ['sova', 'bomb'])
  assert.deepEqual(withoutElement(step, 'nope').elements, step.elements)

  assert.deepEqual(step, before)
  assert.equal(el(replaced, 'omen').kind, 'agent')
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
