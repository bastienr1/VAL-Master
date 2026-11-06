/**
 * One round of a replay as a play document (docs/plays-editor-v2.md §2.7).
 *
 * "I played this comp; load the round and edit it into the next strategy."
 * The round is snapshotted at a few moments (barrier drop, first contact,
 * plant, end); each snapshot becomes a step with every living player as an
 * agent element, the abilities cast since the previous snapshot, the area
 * effects still up that no cast explains, and the planted spike.
 *
 * Pure, no React, no Supabase: the caller supplies the agent lookup (built
 * from the registry) and the map transform. Must not import `gameContent.ts`,
 * so that `node --test` can type-check and run it.
 */

import type { ReplayBundle, ReplayCast, ReplayEffect, ReplayKill, ReplayPlayer, ReplayRound } from './replayBundle.ts'
import {
  deathTimesBySubject,
  isAliveAt,
  isPresentAt,
  playerStateAt,
  worldToImage,
  type MapTransform,
  type PlayerState,
} from './replayScene.ts'
import { newId, parsePlayDoc, type AbilitySlot, type PlayDoc, type PlayPos, type UtilityKind } from './playDoc.ts'
import { abilityShape, SLOT_KEYS } from './agentAbilities.ts'

export interface ReplayAgentInfo { name: string; abilities: { slot: AbilitySlot; name: string }[] }
export type ReplayAgentLookup = (agentUuid: string | null) => ReplayAgentInfo | null
export interface ReplayPlay { doc: PlayDoc; side: 'attack' | 'defense'; mapUuid: string | null; title: string; brief: string }

/** Without a measured barrier, the buy phase is taken as 30 s. */
const BUY_PHASE_MS = 30_000
/** Without an end or a kill, the round is taken to run its full 100 s timer. */
const ROUND_TIMER_MS = 100_000
/** Snapshots closer together than this say the same thing twice. */
const MIN_STEP_GAP_MS = 4_000
/** An agent that moved less than this (image units) between two steps stays put. */
const MOVE_THRESHOLD = 0.02
/** A cast explains an effect that opens within this time of it… */
const CAST_EFFECT_MS = 3_000
/** …and this distance (world cm). */
const CAST_EFFECT_CM = 300
const MAX_COMP = 5
const UNKNOWN_AGENT = 'Agent'

const KEY_TO_SLOT: Record<string, AbilitySlot> = Object.fromEntries(
  (Object.entries(SLOT_KEYS) as [AbilitySlot, string][]).map(([slot, key]) => [key, slot]),
)

const EFFECT_SHAPES: Record<string, UtilityKind> = {
  smoke: 'smoke',
  wall: 'wall',
  trap: 'trap',
  slow: 'slow',
  damage_zone: 'molly',
  recon: 'recon',
}

/**
 * Map display names by the codename in the map's asset path (`/Game/Maps/Jam/Jam`
 * is Lotus). The bundle carries no display name, and the registry lives in
 * `gameContent.ts`, which this module may not import. An unlisted map shows
 * its codename.
 */
const MAP_NAMES: Record<string, string> = {
  ascent: 'Ascent',
  duality: 'Bind',
  triad: 'Haven',
  bonsai: 'Split',
  port: 'Icebox',
  foxtrot: 'Breeze',
  canyon: 'Fracture',
  pitt: 'Pearl',
  jam: 'Lotus',
  juliett: 'Sunset',
  infinity: 'Abyss',
  rook: 'Corrode',
  range: 'The Range',
  hurm_alley: 'District',
  hurm_bowl: 'Kasbah',
  hurm_helix: 'Drift',
  hurm_yard: 'Piazza',
  hurm_hightide: 'Glitch',
}

function mapName(mapUrl: string): string {
  const code = mapUrl.split('/').filter(Boolean).pop() ?? ''
  return MAP_NAMES[code.toLowerCase()] ?? (code || 'Unknown map')
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function imagePos(transform: MapTransform, x: number, y: number): { u: number; v: number } {
  const [u, v] = worldToImage(transform, x, y)
  return { u: clamp01(u), v: clamp01(v) }
}

function roundKills(bundle: ReplayBundle, round: ReplayRound): ReplayKill[] {
  return bundle.kills.filter(k => k.round === round.n).sort((a, b) => a.t - b.t)
}

function plantOf(bundle: ReplayBundle, round: ReplayRound) {
  const record = bundle.spike.plants.find(p => p.round === round.n) ?? null
  return { t: round.plant ?? record?.t ?? null, record }
}

function barrierOf(round: ReplayRound): number {
  return round.barrierMs ?? round.buyStartMs + BUY_PHASE_MS
}

function endOf(round: ReplayRound, kills: ReplayKill[]): number {
  const barrier = barrierOf(round)
  const end = round.endMs ?? (kills.length > 0 ? kills[kills.length - 1].t : barrier + ROUND_TIMER_MS)
  return Math.max(end, barrier)
}

/**
 * The moments a round is snapshotted at, in replay ms, in time order: barrier
 * drop, first kill after it, plant, end. A moment closer than 4 s to the one
 * kept before it is dropped; the barrier and the end always remain (when the
 * end comes too soon after a middle moment, that moment gives way).
 */
export function replayStepTimes(bundle: ReplayBundle, round: ReplayRound): { t: number; name: string }[] {
  const barrier = barrierOf(round)
  const kills = roundKills(bundle, round)
  const end = endOf(round, kills)

  const middle: { t: number; name: string }[] = []
  const firstKill = kills.find(k => k.t > barrier)
  if (firstKill) middle.push({ t: firstKill.t, name: 'First contact' })
  const plant = plantOf(bundle, round).t
  if (plant !== null) middle.push({ t: plant, name: 'Plant' })

  const steps = [{ t: barrier, name: 'Barrier drop' }]
  for (const m of middle.filter(m => m.t > barrier && m.t < end).sort((a, b) => a.t - b.t)) {
    if (m.t - steps[steps.length - 1].t >= MIN_STEP_GAP_MS) steps.push(m)
  }
  while (steps.length > 1 && end - steps[steps.length - 1].t < MIN_STEP_GAP_MS) steps.pop()
  steps.push({ t: end, name: 'End' })
  return steps
}

/** "0:12" */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The play for round `roundNumber` of the replay. Throws an `Error` when the
 * bundle has no such round. The document has been through `parsePlayDoc`.
 */
export function roundToPlay(
  bundle: ReplayBundle,
  roundNumber: number,
  lookup: ReplayAgentLookup,
  transform: MapTransform,
): ReplayPlay {
  const round = bundle.rounds.find(r => r.n === roundNumber)
  if (!round) {
    const numbers = bundle.rounds.map(r => r.n)
    const range = numbers.length > 0 ? ` (it has rounds ${Math.min(...numbers)} to ${Math.max(...numbers)})` : ''
    throw new Error(`Round ${roundNumber} is not in this replay${range}.`)
  }

  const playerBySubject = new Map(bundle.players.map(p => [p.subject, p]))
  const infoOf = (player: ReplayPlayer | undefined) => (player ? lookup(player.agentId) : null)
  const nameOf = (subject: string | null) => infoOf(subject ? playerBySubject.get(subject) : undefined)?.name ?? UNKNOWN_AGENT

  // The comp: ally agents in player order, one entry per name, at most five.
  const comp: string[] = []
  for (const player of bundle.players) {
    if (player.team !== 'ALLY') continue
    const name = infoOf(player)?.name ?? UNKNOWN_AGENT
    if (comp.length < MAX_COMP && !comp.some(c => c.toLowerCase() === name.toLowerCase())) comp.push(name)
  }
  const inComp = (name: string) => comp.some(c => c.toLowerCase() === name.toLowerCase())
  const enemies = bundle.players.filter(p => p.team === 'ENEMY').map(p => infoOf(p)?.name ?? UNKNOWN_AGENT)

  const side: 'attack' | 'defense' = round.side === 'defender' ? 'defense' : 'attack'
  const map = mapName(bundle.match.mapUrl)
  const date = bundle.match.recordedAt.slice(0, 10)

  const kills = roundKills(bundle, round)
  const barrier = barrierOf(round)
  const end = endOf(round, kills)
  const times = replayStepTimes(bundle, round)
  const deaths = deathTimesBySubject(bundle)
  const plant = plantOf(bundle, round)
  const firstKill = kills.find(k => k.t > barrier) ?? null

  // Where the spike was planted: the plant's own point, else where the planter stood.
  let plantAt: PlayPos | null = null
  if (plant.record?.x != null && plant.record.y != null) {
    plantAt = imagePos(transform, plant.record.x, plant.record.y)
  } else if (plant.t !== null && plant.record?.player) {
    const state = playerStateAt(bundle.tracks.byPlayer[plant.record.player] ?? [], plant.t)
    if (state) plantAt = imagePos(transform, state.x, state.y)
  }
  const site = plant.record?.site ?? null

  // Stable ids: one per player, one per effect, one for the spike, across every step.
  const playerIds = new Map(bundle.players.map(p => [p.subject, newId()]))
  const effectIds = new Map<ReplayEffect, string>()
  const spikeId = newId()

  const livingAt = (subject: string, t: number): PlayerState | null => {
    const state = playerStateAt(bundle.tracks.byPlayer[subject] ?? [], t)
    if (!isPresentAt(state, t, round.buyStartMs) || !isAliveAt(state, deaths.get(subject), t)) return null
    return state
  }
  const carrierAt = (subject: string, t: number) =>
    bundle.spike.carriers.some(c => c.player === subject && c.from <= t && t < c.to)

  const positioned = (c: ReplayCast): c is ReplayCast & { x: number; y: number } => c.x !== null && c.y !== null
  const casts = bundle.casts.filter(positioned)
  const explained = (e: ReplayEffect) =>
    casts.some(c => Math.abs(c.t - e.start) <= CAST_EFFECT_MS && Math.hypot(c.x - e.x, c.y - e.y) <= CAST_EFFECT_CM)
  const orphanEffects = bundle.effects.filter(e => e.start >= round.buyStartMs && e.start <= end && !explained(e))

  const winner = round.winner === 'ALLY' ? 'your team' : round.winner === 'ENEMY' ? 'the enemy' : null
  const how = round.how ? round.how.replace(/_/g, ' ').toLowerCase() : null
  const outcome = winner ? `${winner} won${how ? ` by ${how}` : ''}` : null

  const facts: Record<string, string> = {
    'First contact': firstKill ? `${nameOf(firstKill.killer)} killed ${nameOf(firstKill.victim)}.` : '',
    Plant: `Spike planted${site ? ` on ${site}` : ''}.`,
    End: outcome ? `${capitalize(outcome)}.` : 'Round over.',
  }

  const steps = times.map((step, i) => {
    const next = times[i + 1] ?? null
    const prevT = i === 0 ? round.buyStartMs : times[i - 1].t
    const elements: unknown[] = []

    for (const player of bundle.players) {
      const state = livingAt(player.subject, step.t)
      if (!state) continue
      const agent = infoOf(player)?.name ?? UNKNOWN_AGENT
      if (player.team === 'ALLY' && !inComp(agent)) continue
      const at = imagePos(transform, state.x, state.y)
      const el: Record<string, unknown> = {
        kind: 'agent',
        id: playerIds.get(player.subject),
        agent,
        team: player.team === 'ALLY' ? 'ally' : 'enemy',
        at,
      }
      const then = next ? livingAt(player.subject, next.t) : null
      if (then) {
        const to = imagePos(transform, then.x, then.y)
        if (Math.hypot(to.u - at.u, to.v - at.v) > MOVE_THRESHOLD) el.moveTo = to
      }
      if (carrierAt(player.subject, step.t)) el.spike = true
      elements.push(el)
    }

    for (const cast of casts) {
      if (cast.round !== round.n || cast.t <= prevT || cast.t > step.t) continue
      const info = infoOf(playerBySubject.get(cast.player))
      const agent = info?.name ?? UNKNOWN_AGENT
      const slot = KEY_TO_SLOT[cast.slot] ?? null
      const el: Record<string, unknown> = { kind: 'ability', id: newId(), agent, slot, shape: 'other', at: imagePos(transform, cast.x, cast.y) }
      if (slot) {
        const { shape, radius } = abilityShape(agent, slot)
        el.shape = shape
        el.radius = radius
        el.label = info?.abilities.find(a => a.slot === slot)?.name ?? SLOT_KEYS[slot]
      }
      elements.push(el)
    }

    for (const effect of orphanEffects) {
      if (effect.start > step.t || (effect.end ?? end) < step.t) continue
      let id = effectIds.get(effect)
      if (!id) {
        id = newId()
        effectIds.set(effect, id)
      }
      const owner = effect.owner ? playerBySubject.get(effect.owner) : undefined
      elements.push({
        kind: 'ability',
        id,
        agent: infoOf(owner)?.name ?? lookup(effect.agent)?.name ?? UNKNOWN_AGENT,
        slot: null,
        shape: EFFECT_SHAPES[effect.kind] ?? 'other',
        at: imagePos(transform, effect.x, effect.y),
      })
    }

    if (plantAt && plant.t !== null && plant.t <= step.t) {
      const marker: Record<string, unknown> = { kind: 'marker', id: spikeId, type: 'spike', at: plantAt }
      if (site) marker.label = site
      elements.push(marker)
    }

    const since = `${clock(step.t - barrier)} after barrier`
    const fact = facts[step.name]
    return { id: slugOf(step.name), name: step.name, caption: fact ? `${since}. ${fact}` : `${since}.`, elements }
  })

  const summary = `Round ${round.n} from the replay${outcome ? `: ${outcome}` : ''}`

  const events: string[] = []
  if (firstKill) events.push(`first kill ${clock(firstKill.t - barrier)} after barrier (${nameOf(firstKill.killer)} on ${nameOf(firstKill.victim)})`)
  if (plant.t !== null) events.push(`spike planted${site ? ` on ${site}` : ''} ${clock(plant.t - barrier)} after barrier`)
  if (outcome) events.push(`${outcome} ${clock(end - barrier)} after barrier`)
  const brief = [
    `Round ${round.n} on ${map}, ${side === 'attack' ? 'attacking' : 'defending'} with ${comp.join(', ') || 'unknown agents'} against ${enemies.join(', ') || 'unknown agents'}.`,
    events.length > 0 ? `${capitalize(events.join('; '))}.` : 'No kills or plant recorded.',
  ].join('\n')

  const doc = parsePlayDoc({ version: 2, summary, comp, steps, assumptions: [] })
  return { doc, side, mapUuid: bundle.match.mapUuid, title: `Round ${round.n} · ${map} · ${date}`, brief }
}
