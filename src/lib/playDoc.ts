/**
 * The play document — what a set play is, as data.
 *
 * A play is a handful of phases; each phase puts every agent of the comp
 * somewhere on the map, with what they do, the utility thrown and what the
 * team expects to meet. Positions are written as callouts ("A Main",
 * "Heaven"), because that is how the composer and the user both talk, and only
 * become minimap coordinates when drawn. A marker the user dragged carries
 * image units instead, which win.
 *
 * Pure, no React, no Supabase: the model's output and the database row both
 * come through `parsePlayDoc`, and the rules are unit-tested.
 *
 * Must not import from `types.ts`, which re-exports `PlayDoc` from here, nor
 * from `gameContent.ts`, which needs Vite's `import.meta.env` and so cannot be
 * type-checked with the tests.
 */

import { worldToImage, type MapTransform, type Viewport } from './replayScene.ts'

export const PLAY_DOC_VERSION = 1

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
  /** Image units, set when the user dragged the marker or when no callout fits. Wins over callout. */
  u?: number
  v?: number
}

export type UtilityKind =
  | 'smoke' | 'flash' | 'molly' | 'recon' | 'wall' | 'trap' | 'drone' | 'stun' | 'ult' | 'other'

const UTILITY_KINDS: readonly UtilityKind[] = [
  'smoke', 'flash', 'molly', 'recon', 'wall', 'trap', 'drone', 'stun', 'ult', 'other',
]

export interface PlayActor {
  /** Agent display name as the registry knows it ("KAY/O", "Killjoy"). */
  agent: string
  at: PlayPos
  /** Where the agent goes during this phase; drawn as an arrow from `at`. Optional waypoints in `via`. */
  moveTo?: PlayPos
  via?: PlayPos[]
  /** One short line: what this agent does in this phase. */
  note: string
  /** The spike carrier this phase (attack only). */
  spike?: boolean
}

export interface PlayUtility {
  agent: string
  kind: UtilityKind
  /** "Heaven smoke", "Flash over A Main". */
  label: string
  at: PlayPos
  /** Where it is thrown from, when it matters (recon darts, mollies). Drawn as a thin line. */
  from?: PlayPos
  /** World cm radius for area utility; the renderer has defaults per kind. */
  radius?: number
}

export interface PlayMarker {
  kind: 'enemy' | 'spike' | 'note'
  at: PlayPos
  label?: string
}

const MARKER_KINDS: readonly PlayMarker['kind'][] = ['enemy', 'spike', 'note']

export interface PlayPhase {
  /** 'setup', 'execute', 'post-plant', or a slug of the name. */
  id: string
  /** "Setup", "Execute", "Post-plant", "Retake"… */
  name: string
  /** One or two sentences: what this phase is about and what has to be true before it starts. */
  caption: string
  /** Exactly one entry per agent in the comp. */
  actors: PlayActor[]
  utility: PlayUtility[]
  markers: PlayMarker[]
}

export interface PlayDoc {
  version: 1
  /** One line for the card. */
  summary: string
  /** 5 agent names, the order used everywhere. */
  comp: string[]
  /** 2 to 5. */
  phases: PlayPhase[]
  /** What the composer guessed because the brief did not say it. Shown to the user. */
  assumptions: string[]
}

const MAX_COMP = 5
const MAX_PHASES = 5

/** A play that cannot be read. The message is a sentence meant for the user. */
export class PlayDocError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlayDocError'
  }
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

/**
 * Validates and normalizes a play from the model or the database. Anything
 * fixable is fixed quietly (whitespace, `t` out of range, an unknown utility
 * kind, a repeated agent, missing ids and arrays, too many phases); anything
 * that would leave the map wrong throws a `PlayDocError` the page can show
 * as is. Agents are matched to the comp without regard to case and take the
 * comp's spelling, so "kay/o" in a phase is the "KAY/O" of the comp.
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

  if (raw.version !== undefined && raw.version !== PLAY_DOC_VERSION && raw.version !== String(PLAY_DOC_VERSION)) {
    throw new PlayDocError('This play was saved by a newer version of the app and cannot be opened here.')
  }

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
  // actor then fails the comp check below.

  const phasesRaw = list(raw.phases).filter(isObject).slice(0, MAX_PHASES)
  if (phasesRaw.length === 0) throw new PlayDocError('The play has no phases.')

  const usedIds = new Set<string>()
  const phases = phasesRaw.map((p, i): PlayPhase => {
    const name = text(p.name) || `Phase ${i + 1}`
    const base = slug(text(p.id)) || slug(name) || `phase-${i + 1}`
    let id = base
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`
    usedIds.add(id)

    const actors: PlayActor[] = []
    const placed = new Set<string>()
    for (const a of list(p.actors)) {
      if (!isObject(a)) continue
      const said = text(a.agent)
      const agent = compByKey.get(said.toLowerCase())
      if (!agent) {
        throw new PlayDocError(
          `${said || 'An unnamed agent'} is in the "${name}" phase but not in the comp (${comp.join(', ')}).`,
        )
      }
      // One entry per agent: a repeat is the model saying the same thing twice.
      if (placed.has(agent)) continue
      const at = parsePos(a.at)
      if (!at) throw new PlayDocError(`${agent} has no position in the "${name}" phase.`)
      placed.add(agent)

      const actor: PlayActor = { agent, at, note: text(a.note) }
      const moveTo = parsePos(a.moveTo)
      if (moveTo) actor.moveTo = moveTo
      const via = list(a.via).map(parsePos).filter((pos): pos is PlayPos => pos !== null)
      if (via.length > 0) actor.via = via
      if (a.spike === true) actor.spike = true
      actors.push(actor)
    }
    // Comp order everywhere, so the cards and the map list agents the same way.
    actors.sort((x, y) => comp.indexOf(x.agent) - comp.indexOf(y.agent))

    // Utility and markers are decoration: one without a place is dropped, not fatal.
    const utility: PlayUtility[] = []
    for (const u of list(p.utility)) {
      if (!isObject(u)) continue
      const at = parsePos(u.at)
      if (!at) continue
      const said = text(u.agent)
      const kindSaid = text(u.kind).toLowerCase() as UtilityKind
      const item: PlayUtility = {
        agent: compByKey.get(said.toLowerCase()) ?? said,
        kind: UTILITY_KINDS.includes(kindSaid) ? kindSaid : 'other',
        label: text(u.label),
        at,
      }
      const from = parsePos(u.from)
      if (from) item.from = from
      const radius = finite(u.radius)
      if (radius !== null && radius > 0) item.radius = radius
      utility.push(item)
    }

    const markers: PlayMarker[] = []
    for (const m of list(p.markers)) {
      if (!isObject(m)) continue
      const at = parsePos(m.at)
      if (!at) continue
      const kindSaid = text(m.kind).toLowerCase() as PlayMarker['kind']
      const marker: PlayMarker = { kind: MARKER_KINDS.includes(kindSaid) ? kindSaid : 'note', at }
      const label = text(m.label)
      if (label) marker.label = label
      markers.push(marker)
    }

    return { id, name, caption: text(p.caption), actors, utility, markers }
  })

  return {
    version: PLAY_DOC_VERSION,
    summary: text(raw.summary),
    comp,
    phases,
    assumptions: list(raw.assumptions).map(text).filter(Boolean),
  }
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

/**
 * A blank play for placing agents by hand, every agent standing in their
 * side's spawn (`side` defaults to attack, the spec's signature has no side).
 * Attack gets Setup, Execute and Post-plant; defense gets Setup, Hold and
 * Retake, the beats a defensive set is talked through in. The comp is cleaned
 * as `parsePlayDoc` would.
 */
export function emptyPlayDoc(comp: string[], side: 'attack' | 'defense' = 'attack'): PlayDoc {
  const agents: string[] = []
  for (const entry of comp) {
    const name = entry.trim()
    if (!name || agents.some(a => a.toLowerCase() === name.toLowerCase())) continue
    if (agents.length === MAX_COMP) break
    agents.push(name)
  }
  const spawn = side === 'attack' ? 'Attacker Side Spawn' : 'Defender Side Spawn'
  const phase = (id: string, name: string): PlayPhase => ({
    id,
    name,
    caption: '',
    actors: agents.map(agent => ({ agent, at: { callout: spawn }, note: '' })),
    utility: [],
    markers: [],
  })
  return {
    version: PLAY_DOC_VERSION,
    summary: '',
    comp: agents,
    phases:
      side === 'attack'
        ? [phase('setup', 'Setup'), phase('execute', 'Execute'), phase('post-plant', 'Post-plant')]
        : [phase('setup', 'Setup'), phase('hold', 'Hold'), phase('retake', 'Retake')],
    assumptions: [],
  }
}
