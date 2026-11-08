/**
 * The play document — what a set play is, as data (docs/plays-editor-v2.md §3).
 *
 * A play is a sequence of up to ten steps; each step is a list of elements
 * drawn on the map: agents of either team, the abilities they throw, pen
 * strokes, arrows, text and markers. Positions are written as callouts ("A
 * Main", "Heaven"), because that is how the composer and the user both talk,
 * and only become minimap coordinates when drawn. A point the user placed or
 * dragged carries image units instead, which win.
 *
 * Every element has an id, unique within its step. Copying a step keeps the
 * ids, so the same agent is the same element from one step to the next and
 * the canvas can animate it walking.
 *
 * Version 1 (phases of actors, utility and markers) is still read: the
 * database holds rows saved before v2, and `migratePlayDoc` turns them into
 * steps on the way in.
 *
 * Pure, no React, no Supabase: the model's output and the database row both
 * come through `parsePlayDoc`, and the rules are unit-tested.
 *
 * Must not import from `types.ts`, which re-exports `PlayDoc` from here, nor
 * from `gameContent.ts`, which needs Vite's `import.meta.env` and so cannot be
 * type-checked with the tests.
 */

import { worldToImage, type MapTransform, type Viewport } from './replayScene.ts'

export const PLAY_DOC_VERSION = 2

/**
 * One valorant-api callout, in world cm. `name` is super-region and region in
 * one string ("A Main", "Mid Top", "Attacker Side Spawn"): the form players say
 * and the composer writes, so it is what `findCallout` matches against.
 *
 * Defined here rather than in the registry so this file stays testable under
 * plain Node; `gameContent.ts` re-exports it and fills `GameMap.callouts`.
 */
export interface MapCallout {
  region: string
  superRegion: string
  name: string
  x: number
  y: number
}

/** Where something is on the map. Resolved to image units (u, v in 0..1) by `resolvePos`. */
export interface PlayPos {
  /** A callout as valorant-api names it: "A Main", "Heaven", "Mid Catwalk", "Attacker Side Spawn". */
  callout?: string
  /** Optional second callout: the point is `t` of the way from `callout` to `toward` (default 0.5). */
  toward?: string
  t?: number
  /** Image units, set when the user placed or dragged the element or when no callout fits. Wins over callout. */
  u?: number
  v?: number
}

/** An ability's key on the HUD, as valorant-api names the slots (C, Q, E, X). */
export type AbilitySlot = 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'

const ABILITY_SLOTS: readonly AbilitySlot[] = ['Grenade', 'Ability1', 'Ability2', 'Ultimate']

export type Team = 'ally' | 'enemy'

/** The shape an ability is drawn as. */
export type UtilityKind =
  | 'smoke' | 'flash' | 'molly' | 'recon' | 'wall' | 'trap' | 'drone' | 'stun' | 'slow' | 'ult' | 'other'

const UTILITY_KINDS: readonly UtilityKind[] = [
  'smoke', 'flash', 'molly', 'recon', 'wall', 'trap', 'drone', 'stun', 'slow', 'ult', 'other',
]

export type MarkerType = 'spike' | 'enemy' | 'pin'

const MARKER_TYPES: readonly MarkerType[] = ['spike', 'enemy', 'pin']

export interface AgentElement {
  kind: 'agent'
  id: string
  /** Agent display name as the registry knows it ("KAY/O", "Killjoy"). An ally's is spelled as in the comp. */
  agent: string
  team: Team
  at: PlayPos
  /** Where the agent goes during this step; drawn as an arrow from `at`. Optional waypoints in `via`. */
  moveTo?: PlayPos
  via?: PlayPos[]
  /** One short line: what this agent does in this step. */
  note?: string
  /** The spike carrier this step (attack only). */
  spike?: boolean
  /** Who played the agent: the Riot name, without the tag, on agents taken from a match replay. */
  player?: string
}

export interface AbilityElement {
  kind: 'ability'
  id: string
  agent: string
  /** Which of the agent's abilities, or null when not known (a v1 utility, an invented one). */
  slot: AbilitySlot | null
  shape: UtilityKind
  at: PlayPos
  /** Where it is thrown from, when it matters (recon darts, mollies). Drawn as a thin line. */
  from?: PlayPos
  /** World cm radius for area utility; the renderer has defaults per shape. */
  radius?: number
  /** "Heaven smoke", "Flash over A Main". */
  label?: string
  /** While in flight (a replay throw): how far along from `from` to `at` it is, 0…1. No area is drawn yet. */
  progress?: number
  /** A wall's extent: its points in order along the wall (at least 2); the canvas puts the badge at the path's middle. */
  path?: PlayPos[]
  /** A replay frame's utility: how much of its life is left, 1…0 (a ring on the badge). Not kept in a strat. */
  life?: number
}

export interface PenElement {
  kind: 'pen'
  id: string
  /** Image units, in drawing order. At least two. */
  points: { u: number; v: number }[]
  /** `#rrggbb`. */
  color: string
}

export interface ArrowElement {
  kind: 'arrow'
  id: string
  from: PlayPos
  to: PlayPos
  /** `#rrggbb`. */
  color: string
}

export interface TextElement {
  kind: 'text'
  id: string
  at: PlayPos
  text: string
  /** `#rrggbb`. */
  color: string
}

export interface MarkerElement {
  kind: 'marker'
  id: string
  type: MarkerType
  at: PlayPos
  label?: string
}

export type PlayElement = AgentElement | AbilityElement | PenElement | ArrowElement | TextElement | MarkerElement

export interface PlayStep {
  /** 'setup', 'execute', 'post-plant', or a slug of the name; unique within the play. */
  id: string
  /** "Setup", "Execute", "Post-plant", "Retake"… */
  name: string
  /** One or two sentences: what this step is about and what has to be true before it starts. */
  caption: string
  /** Drawn in kind order by the canvas, not in this order. */
  elements: PlayElement[]
  /** Replay time (ms) this step was captured at, when it came from a replay (§2.8). */
  replayMs?: number
}

export interface PlayDoc {
  version: 2
  /** One line for the card. */
  summary: string
  /** Up to 5 agent names, the order used everywhere. Every ally agent element names one of them. */
  comp: string[]
  /** 0 to 10. */
  steps: PlayStep[]
  /** What the composer guessed because the brief did not say it. Shown to the user. */
  assumptions: string[]
  /** The match whose replay this play was built from, so a saved strat can reopen it (§2.8). */
  replay?: { matchId: string }
}

// ── Version 1, read only ────────────────────────────────────────────────────
// What `migratePlayDoc` takes: the play rows saved before v2.

export interface PlayActorV1 {
  agent: string
  at: PlayPos
  moveTo?: PlayPos
  via?: PlayPos[]
  note: string
  spike?: boolean
}

export interface PlayUtilityV1 {
  agent: string
  kind: UtilityKind
  label: string
  at: PlayPos
  from?: PlayPos
  radius?: number
}

export interface PlayMarkerV1 {
  kind: 'enemy' | 'spike' | 'note'
  at: PlayPos
  label?: string
}

export interface PlayPhaseV1 {
  id: string
  name: string
  caption: string
  actors: PlayActorV1[]
  utility: PlayUtilityV1[]
  markers: PlayMarkerV1[]
}

export interface PlayDocV1 {
  version: 1
  summary: string
  comp: string[]
  phases: PlayPhaseV1[]
  assumptions: string[]
}

const MAX_COMP = 5
const MAX_STEPS = 10
const DEFAULT_COLOR = '#FFFFFF'
const COLOR = /^#[0-9a-f]{6}$/i

/** A play that cannot be read. The message is a sentence meant for the user. */
export class PlayDocError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlayDocError'
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Ids
// ──────────────────────────────────────────────────────────────────────────

const ID_LENGTH = 8

/**
 * A fresh element id: 8 random base-36 characters. Unique enough within a
 * step (36^8 ≈ 2.8e12); the parser regenerates the rare repeat anyway.
 */
export function newId(): string {
  const bytes = new Uint8Array(ID_LENGTH)
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let i = 0; i < ID_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let id = ''
  // 256 is not a multiple of 36: the first 4 digits come up a hair more often, which is fine for ids.
  for (const byte of bytes) id += (byte % 36).toString(36)
  return id
}

// ──────────────────────────────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** One of `allowed`, matched without regard to case, or null. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const said = text(value).toLowerCase()
  return allowed.find(a => a.toLowerCase() === said) ?? null
}

const color = (value: unknown): string => {
  const said = text(value)
  return COLOR.test(said) ? said : DEFAULT_COLOR
}

/**
 * A position, trimmed and clamped, or null when it names no place at all. An
 * image point needs both coordinates; half of one is dropped.
 */
function parsePos(raw: unknown): PlayPos | null {
  if (!isObject(raw)) return null
  const pos: PlayPos = {}
  const callout = text(raw.callout)
  if (callout) {
    pos.callout = callout
    const toward = text(raw.toward)
    if (toward) {
      pos.toward = toward
      const t = finite(raw.t)
      if (t !== null) pos.t = clamp01(t)
    }
  }
  const u = finite(raw.u)
  const v = finite(raw.v)
  if (u !== null && v !== null) {
    pos.u = clamp01(u)
    pos.v = clamp01(v)
  }
  return pos.callout !== undefined || pos.u !== undefined ? pos : null
}

function parsePoint(raw: unknown): { u: number; v: number } | null {
  if (!isObject(raw)) return null
  const u = finite(raw.u)
  const v = finite(raw.v)
  return u !== null && v !== null ? { u: clamp01(u), v: clamp01(v) } : null
}

/** Which version a raw play is: an explicit `version`, else v1 when it has phases and no steps. */
function versionOf(raw: Raw): 1 | 2 {
  const said = raw.version
  if (said === undefined || said === null) return 'phases' in raw && !('steps' in raw) ? 1 : 2
  if (said === 1 || said === '1') return 1
  if (said === 2 || said === '2') return 2
  throw new PlayDocError('This play was saved by a newer version of the app and cannot be opened here.')
}

/**
 * Validates and normalizes a play from the model or the database, version 1
 * or 2 (a v1 play is migrated first). Anything fixable is fixed quietly
 * (whitespace, `t` out of range, an unknown shape or marker type, a bad
 * colour, a repeated agent, missing or repeated ids, too many steps);
 * anything that would leave the map wrong throws a `PlayDocError` the page
 * can show as is. Ally agents are matched to the comp without regard to case
 * and take the comp's spelling, so "kay/o" in a step is the "KAY/O" of the
 * comp; enemy agents need not be in it.
 */
export function parsePlayDoc(raw: unknown): PlayDoc {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      throw new PlayDocError('The play could not be read: it is not valid JSON.')
    }
  }
  if (!isObject(raw)) throw new PlayDocError('The play could not be read: it is empty or not an object.')
  return versionOf(raw) === 1 ? migratePlayDoc(raw as unknown as PlayDocV1) : validate(raw)
}

/** The v2 rules: everything `parsePlayDoc` promises, on a raw v2 object. */
function validate(raw: Raw): PlayDoc {
  // The comp, deduped without regard to case, first spelling kept.
  const comp: string[] = []
  const compByKey = new Map<string, string>()
  for (const entry of list(raw.comp)) {
    const name = text(entry)
    const key = name.toLowerCase()
    if (!name || compByKey.has(key)) continue
    if (comp.length === MAX_COMP) break
    comp.push(name)
    compByKey.set(key, name)
  }
  // An empty comp is allowed: a blank hand-made play has no agents yet. Any
  // ally agent then fails the comp check below.

  const usedStepIds = new Set<string>()
  const steps = list(raw.steps)
    .filter(isObject)
    .slice(0, MAX_STEPS)
    .map((s, i): PlayStep => {
      const name = text(s.name) || `Step ${i + 1}`
      const base = slug(text(s.id)) || slug(name) || `step-${i + 1}`
      let id = base
      for (let n = 2; usedStepIds.has(id); n++) id = `${base}-${n}`
      usedStepIds.add(id)
      const step: PlayStep = { id, name, caption: text(s.caption), elements: parseElements(list(s.elements), name, comp, compByKey) }
      const replayMs = finite(s.replayMs)
      if (replayMs !== null && replayMs >= 0) step.replayMs = replayMs
      return step
    })

  const doc: PlayDoc = {
    version: PLAY_DOC_VERSION,
    summary: text(raw.summary),
    comp,
    steps,
    assumptions: list(raw.assumptions).map(text).filter(Boolean),
  }
  const matchId = isObject(raw.replay) ? text(raw.replay.matchId) : ''
  if (matchId) doc.replay = { matchId }
  return doc
}

/** The elements of one step, in order, each with an id unique within the step. */
function parseElements(
  raws: unknown[],
  stepName: string,
  comp: string[],
  compByKey: Map<string, string>,
): PlayElement[] {
  const elements: PlayElement[] = []
  const usedIds = new Set<string>()
  const placedAgents = new Set<string>()

  const idFor = (raw: Raw): string => {
    let id = text(raw.id)
    while (!id || usedIds.has(id)) id = newId()
    usedIds.add(id)
    return id
  }

  for (const e of raws) {
    if (!isObject(e)) continue
    switch (text(e.kind).toLowerCase()) {
      case 'agent': {
        const team: Team = oneOf(e.team, ['ally', 'enemy'] as const) ?? 'ally'
        const said = text(e.agent)
        let agent: string
        if (team === 'ally') {
          const known = compByKey.get(said.toLowerCase())
          if (!known) {
            throw new PlayDocError(
              `${said || 'An unnamed agent'} is in the "${stepName}" step but not in the comp (${comp.join(', ')}).`,
            )
          }
          agent = known
        } else {
          // An enemy needs a name to be drawn; it need not be in the comp.
          if (!said) continue
          agent = said
        }
        // One element per agent and team: a repeat is the model saying the same thing twice.
        const key = `${team}:${agent.toLowerCase()}`
        if (placedAgents.has(key)) continue
        const at = parsePos(e.at)
        if (!at) throw new PlayDocError(`${agent} has no position in the "${stepName}" step.`)
        placedAgents.add(key)

        const el: AgentElement = { kind: 'agent', id: idFor(e), agent, team, at }
        const moveTo = parsePos(e.moveTo)
        if (moveTo) el.moveTo = moveTo
        const via = list(e.via).map(parsePos).filter((pos): pos is PlayPos => pos !== null)
        if (via.length > 0) el.via = via
        const note = text(e.note)
        if (note) el.note = note
        if (e.spike === true) el.spike = true
        const player = text(e.player)
        if (player) el.player = player
        elements.push(el)
        break
      }
      // Everything else is decoration: one without a place is dropped, not fatal.
      case 'ability': {
        const at = parsePos(e.at)
        if (!at) break
        const said = text(e.agent)
        const el: AbilityElement = {
          kind: 'ability',
          id: idFor(e),
          agent: compByKey.get(said.toLowerCase()) ?? said,
          slot: oneOf(e.slot, ABILITY_SLOTS),
          shape: oneOf(e.shape, UTILITY_KINDS) ?? 'other',
          at,
        }
        const from = parsePos(e.from)
        if (from) el.from = from
        const radius = finite(e.radius)
        if (radius !== null && radius > 0) el.radius = radius
        const label = text(e.label)
        if (label) el.label = label
        const progress = finite(e.progress)
        if (progress !== null && progress >= 0 && progress <= 1) el.progress = progress
        const path = list(e.path).map(parsePos).filter((pos): pos is PlayPos => pos !== null)
        if (path.length >= 2) el.path = path
        const life = finite(e.life)
        if (life !== null && life >= 0 && life <= 1) el.life = life
        elements.push(el)
        break
      }
      case 'pen': {
        const points = list(e.points).map(parsePoint).filter((p): p is { u: number; v: number } => p !== null)
        if (points.length < 2) break
        elements.push({ kind: 'pen', id: idFor(e), points, color: color(e.color) })
        break
      }
      case 'arrow': {
        const from = parsePos(e.from)
        const to = parsePos(e.to)
        if (!from || !to) break
        elements.push({ kind: 'arrow', id: idFor(e), from, to, color: color(e.color) })
        break
      }
      case 'text': {
        const at = parsePos(e.at)
        if (!at) break
        elements.push({ kind: 'text', id: idFor(e), at, text: text(e.text), color: color(e.color) })
        break
      }
      case 'marker': {
        const at = parsePos(e.at)
        if (!at) break
        const el: MarkerElement = { kind: 'marker', id: idFor(e), type: oneOf(e.type, MARKER_TYPES) ?? 'pin', at }
        const label = text(e.label)
        if (label) el.label = label
        elements.push(el)
        break
      }
      default:
        // An unknown kind: nothing to draw.
        break
    }
  }
  return elements
}

/**
 * A version 1 play as version 2, validated: phases become steps; each actor an
 * ally agent element (one id per agent for the whole play, so the agent is the
 * same element in every step); each utility an ability element with no slot
 * and its kind as the shape; each marker a marker element ("note" becomes a
 * pin). Throws `PlayDocError` as `parsePlayDoc` does. Does not touch its
 * argument; the only thing not fixed by the input is the ids, which are new.
 */
export function migratePlayDoc(v1: PlayDocV1): PlayDoc {
  const raw: unknown = v1
  if (!isObject(raw)) throw new PlayDocError('The play could not be read: it is empty or not an object.')

  const agentIds = new Map<string, string>()
  const agentId = (agent: unknown) => {
    const key = text(agent).toLowerCase()
    let id = agentIds.get(key)
    if (!id) {
      id = newId()
      agentIds.set(key, id)
    }
    return id
  }

  const steps = list(raw.phases)
    .filter(isObject)
    .map(p => ({
      id: p.id,
      name: p.name,
      caption: p.caption,
      elements: [
        ...list(p.actors)
          .filter(isObject)
          .map(a => ({
            kind: 'agent',
            id: agentId(a.agent),
            agent: a.agent,
            team: 'ally',
            at: a.at,
            moveTo: a.moveTo,
            via: a.via,
            note: a.note,
            spike: a.spike,
          })),
        ...list(p.utility)
          .filter(isObject)
          .map(u => ({
            kind: 'ability',
            id: newId(),
            agent: u.agent,
            slot: null,
            shape: u.kind,
            at: u.at,
            from: u.from,
            radius: u.radius,
            label: u.label,
          })),
        ...list(p.markers)
          .filter(isObject)
          .map(m => ({
            kind: 'marker',
            id: newId(),
            type: text(m.kind).toLowerCase() === 'note' ? 'pin' : m.kind,
            at: m.at,
            label: m.label,
          })),
      ],
    }))

  return validate({ summary: raw.summary, comp: raw.comp, steps, assumptions: raw.assumptions })
}

// ──────────────────────────────────────────────────────────────────────────
// Callouts
// ──────────────────────────────────────────────────────────────────────────

/** Lower case, punctuation to spaces, one space between words, no leading "the". */
function calloutKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

const sortedWords = (key: string) => key.split(' ').sort().join(' ')

const ATTACKER_SPAWN = /^(t|atk|attack|attacking|attacker|attackers)( side)? spawn$/
const DEFENDER_SPAWN = /^(ct|def|defense|defence|defending|defender|defenders)( side)? spawn$/

// A bare region shared by several super-regions ("Main") goes to the first of
// these that has it: the site the phase is about is not known here.
const SUPER_REGION_ORDER = ['a', 'b', 'c', 'mid']

function superRegionRank(callout: MapCallout): number {
  const i = SUPER_REGION_ORDER.indexOf(calloutKey(callout.superRegion))
  return i === -1 ? SUPER_REGION_ORDER.length : i
}

function matchKey(key: string, callouts: MapCallout[]): MapCallout | null {
  if (!key) return null
  const exact = callouts.find(c => calloutKey(c.name) === key)
  if (exact) return exact
  // Word order: "Main A" is "A Main".
  const words = sortedWords(key)
  const reordered = callouts.find(c => sortedWords(calloutKey(c.name)) === words)
  if (reordered) return reordered
  // A bare region: "Heaven", or "Main" when several sites have one.
  const regions = callouts.filter(c => calloutKey(c.region) === key)
  if (regions.length === 0) return null
  return regions.reduce((best, c) => (superRegionRank(c) < superRegionRank(best) ? c : best))
}

/**
 * The callout a name means, read the way people write them: any case, words
 * in either order ("Main A"), dashes for spaces ("a-main"), a bare region when
 * it is unique ("Heaven") or ambiguous (then A before B before C before Mid),
 * "T spawn" and "Attacker Spawn" for the attackers' spawn and the like for
 * defenders, and a leading "the" or trailing "site" ignored. Null when
 * nothing fits, so the caller can say which name it could not place.
 */
export function findCallout(name: string, callouts: MapCallout[]): MapCallout | null {
  const key = calloutKey(name)
  if (!key) return null

  const spawn = ATTACKER_SPAWN.test(key) ? 'attacker' : DEFENDER_SPAWN.test(key) ? 'defender' : null
  if (spawn) {
    return callouts.find(c => {
      const k = calloutKey(c.name)
      return k.includes(spawn) && k.includes('spawn')
    }) ?? null
  }

  const hit = matchKey(key, callouts)
  if (hit) return hit

  // "B site" with no "B Site" callout, or "A Main site": try without "site".
  if (key.endsWith(' site')) return matchKey(key.slice(0, -' site'.length), callouts)
  return null
}

/**
 * A position in minimap image units, or null when it cannot be placed. A
 * dragged point (`u`/`v`) wins; otherwise the callout, moved `t` of the way
 * (default half) toward `toward`. An unknown `toward` leaves the point on the
 * first callout rather than losing the marker.
 */
export function resolvePos(pos: PlayPos, callouts: MapCallout[], transform: MapTransform): [number, number] | null {
  if (finite(pos.u) !== null && finite(pos.v) !== null) return [pos.u as number, pos.v as number]
  if (!pos.callout) return null
  const from = findCallout(pos.callout, callouts)
  if (!from) return null
  const [u0, v0] = worldToImage(transform, from.x, from.y)
  const to = pos.toward ? findCallout(pos.toward, callouts) : null
  if (!to) return [u0, v0]
  const [u1, v1] = worldToImage(transform, to.x, to.y)
  const t = clamp01(finite(pos.t) ?? 0.5)
  return [u0 + (u1 - u0) * t, v0 + (v1 - v0) * t]
}

/**
 * The square of the minimap image that holds every callout plus a margin. The
 * published images carry wide empty borders; cropping to the callouts makes
 * the map fill the canvas, as `playedViewport` does for replays.
 */
export function calloutViewport(callouts: MapCallout[], transform: MapTransform, margin = 0.06): Viewport {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const c of callouts) {
    const [u, v] = worldToImage(transform, c.x, c.y)
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  if (!Number.isFinite(u0)) return { u: 0, v: 0, size: 1 }

  const size = Math.min(1, Math.max(u1 - u0, v1 - v0) + margin * 2)
  const clamp = (centre: number) => Math.max(0, Math.min(1 - size, centre - size / 2))
  return { u: clamp((u0 + u1) / 2), v: clamp((v0 + v1) / 2), size }
}


// ──────────────────────────────────────────────────────────────────────────
// Building and editing
// ──────────────────────────────────────────────────────────────────────────

/** A comp cleaned as `parsePlayDoc` cleans it: trimmed, deduped without regard to case, five at most. */
function cleanComp(comp: string[]): string[] {
  const agents: string[] = []
  for (const entry of comp) {
    const name = entry.trim()
    if (!name || agents.some(a => a.toLowerCase() === name.toLowerCase())) continue
    if (agents.length === MAX_COMP) break
    agents.push(name)
  }
  return agents
}

/**
 * A blank play for placing agents by hand, every agent of the comp standing
 * in their side's spawn as an ally agent element, with one id per agent
 * across the steps. Attack gets Setup, Execute and Post-plant; defense gets
 * Setup, Hold and Retake, the beats a defensive set is talked through in.
 * The comp is cleaned as `parsePlayDoc` would.
 */
export function emptyPlayDoc(comp: string[], side: 'attack' | 'defense' = 'attack'): PlayDoc {
  const agents = cleanComp(comp).map(agent => ({ agent, id: newId() }))
  const spawn = side === 'attack' ? 'Attacker Side Spawn' : 'Defender Side Spawn'
  const step = (id: string, name: string, caption: string): PlayStep => ({
    id,
    name,
    caption,
    elements: agents.map(({ agent, id: elementId }): AgentElement => ({
      kind: 'agent',
      id: elementId,
      agent,
      team: 'ally',
      at: { callout: spawn },
    })),
  })
  return {
    version: PLAY_DOC_VERSION,
    summary: '',
    comp: agents.map(a => a.agent),
    steps:
      side === 'attack'
        ? [
            step('setup', 'Setup', 'Group up and take map control. Everyone in position before the execute call.'),
            step('execute', 'Execute', 'Utility first, then the entry. Who goes first, and where the plant is.'),
            step('post-plant', 'Post-plant', 'Spread out, hold the crossfires, play for time.'),
          ]
        : [
            step('setup', 'Setup', 'Default positions and the opening utility. Who anchors, who plays for info.'),
            step('hold', 'Hold', 'Reads and rotations once the attack shows. Who holds, who falls back, who rotates.'),
            step('retake', 'Retake', 'If the site falls: the regroup point, the retake utility, who goes first.'),
          ],
    assumptions: [],
  }
}

/**
 * A new step that starts where `step` ends: the same elements with the same
 * ids (so agents animate from one to the next), a new step id, the given
 * name and an empty caption (the old one described the old step). The
 * elements are deep copies; nothing is shared with `step`. A replay time is
 * kept, so the copy still points at the moment of the match it came from.
 */
export function copyStep(step: PlayStep, name: string): PlayStep {
  const copy: PlayStep = { id: newId(), name: name.trim(), caption: '', elements: structuredClone(step.elements) }
  if (step.replayMs !== undefined) copy.replayMs = step.replayMs
  return copy
}

/** The element with this id in the step, or null. */
export function elementAt(step: PlayStep, id: string): PlayElement | null {
  return step.elements.find(e => e.id === id) ?? null
}

/** The step with `el` in place of the element of the same id, or appended when there is none. */
export function withElement(step: PlayStep, el: PlayElement): PlayStep {
  const i = step.elements.findIndex(e => e.id === el.id)
  const elements = i === -1 ? [...step.elements, el] : step.elements.map((e, j) => (j === i ? el : e))
  return { ...step, elements }
}

/** The step without the element of this id (the same content when there is none). */
export function withoutElement(step: PlayStep, id: string): PlayStep {
  return { ...step, elements: step.elements.filter(e => e.id !== id) }
}
