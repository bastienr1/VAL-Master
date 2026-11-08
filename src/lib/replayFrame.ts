/**
 * The state of a replay at one instant as a play step (docs/plays-editor-v2.md §2.8).
 *
 * Replay mode in the Plays editor plays a whole match on the canvas: every
 * frame is `frameStep(bundle, t, …)`, a step holding every present, living
 * player as an agent element, the area effects up at `t` and the casts of the
 * last moments as abilities, and the planted spike. The snapshot import
 * (`replayToPlay.ts`, §2.7) builds its steps from the same function.
 *
 * Also the round helpers the transport needs: the span a round's scrubber
 * covers, its side, its clock and the ticks on it.
 *
 * Utility follows §2.10: a thrown ability is drawn at its landing with an arc
 * from the hand (`from`, and `progress` while in flight), a wall's segments
 * as one `path`, and the class table of `utilityClasses.ts` says which
 * effect is which.
 *
 * Pure, no React, no Supabase: the caller supplies the agent lookup (built
 * from the registry) and the map transform. Must not import `gameContent.ts`,
 * so that `node --test` can type-check and run it.
 */

import type { ReplayBundle, ReplayCast, ReplayEffect, ReplayKill, ReplayRound } from './replayBundle.ts'
import {
  deathTimesBySubject,
  isAliveAt,
  isPresentAt,
  playerStateAt,
  worldToImage,
  type MapTransform,
} from './replayScene.ts'
import { roundAtReplayMs } from './replaySync.ts'
import {
  newId,
  type AbilityElement,
  type AbilitySlot,
  type AgentElement,
  type MarkerElement,
  type PlayElement,
  type PlayPos,
  type PlayStep,
} from './playDoc.ts'
import { abilityShape, SLOT_KEYS } from './agentAbilities.ts'
import { classInfo, type EffectClassInfo } from './utilityClasses.ts'

export interface ReplayAgentInfo { name: string; abilities: { slot: AbilitySlot; name: string }[] }
export type ReplayAgentLookup = (agentUuid: string | null) => ReplayAgentInfo | null

/**
 * Element ids that stay the same for the life of one bundle session, so the
 * canvas can key a marker from one frame to the next: one per player, per
 * effect (by its index in `bundle.effects`), per round's plant and per cast.
 * A throw in flight has its landing's id, a wall its first segment's.
 */
export interface FrameIds {
  forSubject(subject: string): string
  forEffect(index: number): string
  forPlant(round: number): string
  /** Keyed `cast:<round>:<t>:<player>`. */
  forCast(cast: ReplayCast): string
}

/** Without a measured barrier, the buy phase is taken as 30 s. */
const BUY_PHASE_MS = 30_000
/** Without an end or a next round, a round's scrubber runs this long past the barrier. */
const ROUND_SPAN_AFTER_BARRIER_MS = 120_000
/** A cast explains an effect of the same owner that opens within this time of it… */
const CAST_EFFECT_MS = 3_000
/** …and this distance (world cm). */
const CAST_EFFECT_CM = 300
/** A cast no effect explains (a flash, a dash) stays on the map this long. */
const CAST_SHOWN_MS = 2_500
/** A landing pairs with a projectile of its owner when it starts this long before… */
const LAND_EARLY_MS = 600
/** …to this long after the projectile ends, */
const LAND_LATE_MS = 1_500
/**
 * or while the projectile is still alive, at least this long after it
 * spawned: Jett's smoke forms ~1.5 s before its projectile actor closes,
 * while an emitter that starts with its wall must not count as a throw.
 */
const MIN_FLIGHT_MS = 50
/** A landing keeps its throw arc this long. */
const ARC_KEPT_MS = 3_000
/** Wall segments of one owner and class starting within this time of the first are one wall. */
const WALL_GROUP_MS = 500
const UNKNOWN_AGENT = 'Agent'

const KEY_TO_SLOT: Record<string, AbilitySlot> = Object.fromEntries(
  (Object.entries(SLOT_KEYS) as [AbilitySlot, string][]).map(([slot, key]) => [key, slot]),
)

export function createFrameIds(): FrameIds {
  const ids = new Map<string, string>()
  const issued = new Set<string>()
  const idFor = (key: string): string => {
    let id = ids.get(key)
    if (id === undefined) {
      // Never two keys on one id: the parser would regenerate the repeat and the canvas lose the marker.
      do id = newId()
      while (issued.has(id))
      issued.add(id)
      ids.set(key, id)
    }
    return id
  }
  return {
    forSubject: subject => idFor(`subject:${subject}`),
    forEffect: index => idFor(`effect:${index}`),
    forPlant: round => idFor(`plant:${round}`),
    forCast: cast => idFor(`cast:${cast.round}:${cast.t}:${cast.player}`),
  }
}

/** The round whose buy phase has started at `t`; round 1 before that. */
export function roundAt(bundle: ReplayBundle, t: number): ReplayRound {
  return roundAtReplayMs(bundle, t)
}

/** When the barriers drop: measured, else 30 s after buy start. */
export function roundBarrier(round: ReplayRound): number {
  return round.barrierMs ?? round.buyStartMs + BUY_PHASE_MS
}

/** The round's plant: its time (the round's own, else the spike record's) and the record, when there is one. */
export function roundPlant(bundle: ReplayBundle, round: ReplayRound) {
  const record = bundle.spike.plants.find(p => p.round === round.n) ?? null
  return { t: round.plant ?? record?.t ?? null, record }
}

/** What the round's scrubber spans: buy start to the end, else the next round's buy start, else 120 s past the barrier. */
export function roundSpan(bundle: ReplayBundle, round: ReplayRound): { start: number; end: number } {
  const start = round.buyStartMs
  if (round.endMs !== null) return { start, end: round.endMs }
  const i = bundle.rounds.findIndex(r => r.n === round.n)
  const next = i >= 0 ? bundle.rounds[i + 1] : undefined
  if (next) return { start, end: next.buyStartMs }
  return { start, end: roundBarrier(round) + ROUND_SPAN_AFTER_BARRIER_MS }
}

/** The bundle owner's side this round; attack when unknown. */
export function roundSide(round: ReplayRound): 'attack' | 'defense' {
  return round.side === 'defender' ? 'defense' : 'attack'
}

/**
 * "R3 · 0:13": whole seconds since the barrier drop, counted down with a
 * minus sign during the buy ("R3 · -0:12"). Seconds are floored on both
 * sides of the barrier, so every second of the round has one label and
 * there is no "-0:00".
 */
export function formatRoundClock(round: ReplayRound, t: number): string {
  const s = Math.floor((t - roundBarrier(round)) / 1000)
  const abs = Math.abs(s)
  return `R${round.n} · ${s < 0 ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

export interface RoundTick { t: number; kind: 'barrier' | 'kill' | 'plant' | 'defuse'; label: string }

/**
 * The marks on a round's scrubber, in time order: the barrier drop, each kill
 * ("Killer ▸ Victim", names from `lookupName`, the subject itself without
 * one), the plant ("Plant A") and the defuse.
 */
export function roundTicks(
  bundle: ReplayBundle,
  round: ReplayRound,
  lookupName: (subject: string) => string = subject => subject,
): RoundTick[] {
  const name = (subject: string | null) => (subject ? lookupName(subject) : UNKNOWN_AGENT)
  const ticks: RoundTick[] = [{ t: roundBarrier(round), kind: 'barrier', label: 'Barrier drop' }]
  for (const kill of roundKills(bundle, round)) {
    ticks.push({ t: kill.t, kind: 'kill', label: `${name(kill.killer)} ▸ ${name(kill.victim)}` })
  }
  const plant = roundPlant(bundle, round)
  if (plant.t !== null) {
    const site = plant.record?.site
    ticks.push({ t: plant.t, kind: 'plant', label: site ? `Plant ${site}` : 'Plant' })
  }
  const defuse = round.defuse ?? bundle.spike.defuses.find(d => d.round === round.n)?.t ?? null
  if (defuse !== null) ticks.push({ t: defuse, kind: 'defuse', label: 'Defuse' })
  // A stable sort: at equal times the barrier comes before a kill, a kill before the plant.
  return ticks.sort((a, b) => a.t - b.t)
}

function roundKills(bundle: ReplayBundle, round: ReplayRound): ReplayKill[] {
  return bundle.kills.filter(k => k.round === round.n).sort((a, b) => a.t - b.t)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function imagePos(transform: MapTransform, x: number, y: number): { u: number; v: number } {
  const [u, v] = worldToImage(transform, x, y)
  return { u: clamp01(u), v: clamp01(v) }
}

// Built once per bundle: frameStep runs every animation frame.
const deathsCache = new WeakMap<ReplayBundle, Map<string, number[]>>()
function deathsOf(bundle: ReplayBundle): Map<string, number[]> {
  let deaths = deathsCache.get(bundle)
  if (!deaths) {
    deaths = deathTimesBySubject(bundle)
    deathsCache.set(bundle, deaths)
  }
  return deaths
}

/** How a bundle's effects go together: their classes, the throws and the walls. */
interface EffectPlan {
  info: EffectClassInfo[]
  /** Projectile index → its landing's index. */
  landingOf: Map<number, number>
  /** Landing index → its projectile's index. */
  throwOf: Map<number, number>
  /** A wall's first segment index → its segment indices, in order along the wall. */
  walls: Map<number, number[]>
  /** Every segment index of a wall → the wall's first segment index. */
  wallOf: Map<number, number>
}

// Built once per bundle, like the deaths.
const planCache = new WeakMap<ReplayBundle, EffectPlan>()
function planOf(bundle: ReplayBundle): EffectPlan {
  let plan = planCache.get(bundle)
  if (!plan) {
    plan = buildPlan(bundle.effects)
    planCache.set(bundle, plan)
  }
  return plan
}

/**
 * The throws of a bundle, projectile index → landing index (in
 * `bundle.effects`). A projectile pairs with a landing of its owner that
 * starts −600…+1500 ms from the projectile's end, or while the projectile is
 * still alive and at least 50 ms after it spawned; the nearest gap to the
 * end wins, and a landing pairs once.
 */
export function throwPairs(bundle: ReplayBundle): ReadonlyMap<number, number> {
  return planOf(bundle).landingOf
}

function buildPlan(effects: ReplayEffect[]): EffectPlan {
  const info = effects.map(e => classInfo(e.cls, e.kind))
  const byOwner = new Map<string, { projectiles: number[]; landings: number[]; lines: number[] }>()
  effects.forEach((e, i) => {
    if (e.owner === null) return
    let own = byOwner.get(e.owner)
    if (!own) {
      own = { projectiles: [], landings: [], lines: [] }
      byOwner.set(e.owner, own)
    }
    const { role, line } = info[i]
    if (role === 'projectile') {
      if (e.end !== null) own.projectiles.push(i)
    } else if (role === 'landing') own.landings.push(i)
    else if (line && role !== 'ignore') own.lines.push(i)
  })

  // Throws: every admissible (projectile, landing) pair, the nearest gaps first.
  const candidates: { gap: number; p: number; l: number }[] = []
  for (const own of byOwner.values()) {
    for (const p of own.projectiles) {
      const { start, end } = effects[p] as ReplayEffect & { end: number }
      for (const l of own.landings) {
        const lands = effects[l].start
        if (lands < start) continue
        const gap = lands - end
        const nearEnd = gap >= -LAND_EARLY_MS && gap <= LAND_LATE_MS
        const whileAlive = lands >= start + MIN_FLIGHT_MS && lands <= end
        if (nearEnd || whileAlive) candidates.push({ gap: Math.abs(gap), p, l })
      }
    }
  }
  candidates.sort((a, b) => a.gap - b.gap || a.p - b.p || a.l - b.l)
  const landingOf = new Map<number, number>()
  const throwOf = new Map<number, number>()
  for (const { p, l } of candidates) {
    if (landingOf.has(p) || throwOf.has(l)) continue
    landingOf.set(p, l)
    throwOf.set(l, p)
  }

  // Walls: a segment joins the wall of its owner and class whose first segment started within 500 ms.
  const walls = new Map<number, number[]>()
  for (const own of byOwner.values()) {
    const open = new Map<string, number[]>()
    const lines = [...own.lines].sort((a, b) => effects[a].start - effects[b].start || a - b)
    for (const i of lines) {
      const group = open.get(effects[i].cls)
      if (group && effects[i].start - effects[group[0]].start <= WALL_GROUP_MS) {
        group.push(i)
      } else {
        const fresh = [i]
        open.set(effects[i].cls, fresh)
        walls.set(i, fresh)
      }
    }
  }
  const wallOf = new Map<number, number>()
  for (const [head, members] of walls) {
    walls.set(head, alongWall(members, effects))
    for (const m of members) wallOf.set(m, head)
  }
  return { info, landingOf, throwOf, walls, wallOf }
}

/** A wall's segments in order: along the line through the two that lie farthest apart. */
function alongWall(members: number[], effects: ReplayEffect[]): number[] {
  let a = effects[members[0]]
  let b = a
  let far = -1
  for (const i of members) {
    for (const j of members) {
      const d = Math.hypot(effects[i].x - effects[j].x, effects[i].y - effects[j].y)
      if (d > far) {
        far = d
        a = effects[i]
        b = effects[j]
      }
    }
  }
  const along = (i: number) => (effects[i].x - a.x) * (b.x - a.x) + (effects[i].y - a.y) * (b.y - a.y)
  return [...members].sort((i, j) => along(i) - along(j) || i - j)
}

/** The point halfway along a polyline. */
function midway(points: { u: number; v: number }[]): { u: number; v: number } {
  const legs = points.slice(1).map((q, k) => Math.hypot(q.u - points[k].u, q.v - points[k].v))
  let left = legs.reduce((sum, d) => sum + d, 0) / 2
  for (let k = 0; k < legs.length; k++) {
    if (legs[k] > 0 && left <= legs[k]) {
      const f = left / legs[k]
      const p = points[k]
      const q = points[k + 1]
      return { u: p.u + (q.u - p.u) * f, v: p.v + (q.v - p.v) * f }
    }
    left -= legs[k]
  }
  return points[points.length - 1]
}

type PositionedCast = ReplayCast & { x: number; y: number }
const positioned = (c: ReplayCast): c is PositionedCast => c.x !== null && c.y !== null

/** Whether `cast` is the one that put `effect` down: same owner, within 3 s and 300 cm. */
const explains = (cast: PositionedCast, effect: ReplayEffect) =>
  effect.owner !== null &&
  cast.player === effect.owner &&
  Math.abs(cast.t - effect.start) <= CAST_EFFECT_MS &&
  Math.hypot(cast.x - effect.x, cast.y - effect.y) <= CAST_EFFECT_CM

/**
 * The match at replay time `t` as a step (id `frame`, named by the round
 * clock, empty caption, `replayMs: t`): every present, living player as an
 * agent (no `moveTo`), the area effects up at `t` and the casts of the last
 * 2.5 s that no such effect explains as abilities, and the round's plant
 * once it has happened as a spike marker. The elements are already in the
 * form `parsePlayDoc` gives them, given a comp of the ally agents' names.
 *
 * `round` defaults to the round at `t`; the snapshot import passes its own so
 * a fallback end past the next buy start still reads the round it belongs to.
 */
export function frameStep(
  bundle: ReplayBundle,
  t: number,
  lookup: ReplayAgentLookup,
  transform: MapTransform,
  ids: FrameIds,
  round: ReplayRound = roundAt(bundle, t),
): PlayStep {
  const playerBySubject = new Map(bundle.players.map(p => [p.subject, p]))
  const infoOfSubject = (subject: string | null) => {
    const player = subject ? playerBySubject.get(subject) : undefined
    return player ? lookup(player.agentId) : null
  }
  const deaths = deathsOf(bundle)
  const elements: PlayElement[] = []

  // Agents: one per agent name and team, as the parser keeps them.
  const placed = new Set<string>()
  for (const player of bundle.players) {
    const state = playerStateAt(bundle.tracks.byPlayer[player.subject] ?? [], t)
    if (!state || !isPresentAt(state, t, round.buyStartMs) || !isAliveAt(state, deaths.get(player.subject), t)) continue
    const agent = (lookup(player.agentId)?.name ?? UNKNOWN_AGENT).trim() || UNKNOWN_AGENT
    const team = player.team === 'ALLY' ? 'ally' : 'enemy'
    const key = `${team}:${agent.toLowerCase()}`
    if (placed.has(key)) continue
    placed.add(key)
    const el: AgentElement = { kind: 'agent', id: ids.forSubject(player.subject), agent, team, at: imagePos(transform, state.x, state.y) }
    if (bundle.spike.carriers.some(c => c.player === player.subject && c.from <= t && t < c.to)) el.spike = true
    elements.push(el)
  }

  const casts = bundle.casts.filter(positioned)
  const plan = planOf(bundle)
  const effects = bundle.effects
  const posOf = (e: ReplayEffect) => imagePos(transform, e.x, e.y)
  // Up at t, opened during this round; one that never closed lasts the round.
  const upAt = (e: ReplayEffect) => e.start >= round.buyStartMs && e.start <= t && (e.end === null || e.end >= t)

  /**
   * The ability effect `index` stands for (a landing, or a thing put down),
   * with its class's shape. The slot is the class's, else its throw's, else
   * that of the cast that put one of `sources` down, nearest in time.
   */
  const abilityOf = (index: number, sources: ReplayEffect[], id: string, at: PlayPos, thrown?: number): AbilityElement => {
    const effect = effects[index]
    const { shape, radius } = plan.info[index]
    let slot = plan.info[index].slot ?? (thrown !== undefined ? plan.info[thrown].slot : undefined) ?? null
    if (!slot) {
      let cast: PositionedCast | null = null
      for (const source of sources) {
        for (const c of casts) {
          if (explains(c, source) && (!cast || Math.abs(c.t - source.start) < Math.abs(cast.t - source.start))) cast = c
        }
      }
      slot = cast ? KEY_TO_SLOT[cast.slot] ?? null : null
    }
    const info = infoOfSubject(effect.owner) ?? lookup(effect.agent)
    const agent = info?.name.trim() || UNKNOWN_AGENT
    const el: AbilityElement = { kind: 'ability', id, agent, slot, shape, at }
    if (radius !== undefined) el.radius = radius
    if (slot) {
      // Else the board table's radius, only when it agrees on what the effect is.
      const table = abilityShape(agent, slot)
      if (el.radius === undefined && table.shape === shape) el.radius = table.radius
      el.label = info?.abilities.find(a => a.slot === slot)?.name.trim() || SLOT_KEYS[slot]
    }
    return el
  }

  // Utility up at t. `shown` holds what a cast may be explained by: every effect drawn, and a drawn throw's projectile.
  const shown: ReplayEffect[] = []
  effects.forEach((effect, index) => {
    const { role } = plan.info[index]
    if (role === 'ignore') return

    if (role === 'projectile') {
      // In flight: drawn at its landing, from the hand, under the landing's id. Without a landing, not at all.
      const l = plan.landingOf.get(index)
      if (l === undefined) return
      const landing = effects[l]
      if (effect.start < round.buyStartMs || t < effect.start || t >= landing.start) return
      const el = abilityOf(l, [effect, landing], ids.forEffect(l), posOf(landing), index)
      el.from = posOf(effect)
      el.progress = clamp01((t - effect.start) / (landing.start - effect.start))
      shown.push(effect)
      elements.push(el)
      return
    }

    const head = plan.wallOf.get(index)
    if (head !== undefined) {
      // One wall for its segments, drawn by its first: the segments up, in order, the badge halfway along.
      if (head !== index) return
      const up = (plan.walls.get(head) ?? []).map(i => effects[i]).filter(upAt)
      if (up.length === 0) return
      const points = up.map(posOf)
      const el = abilityOf(index, up, ids.forEffect(index), midway(points))
      if (points.length >= 2) el.path = points
      shown.push(...up)
      elements.push(el)
      return
    }

    if (!upAt(effect)) return
    const thrown = plan.throwOf.get(index)
    const projectile = thrown !== undefined ? effects[thrown] : null
    const el = abilityOf(index, projectile ? [effect, projectile] : [effect], ids.forEffect(index), posOf(effect), thrown)
    // Just landed: the arc from the hand stays a moment.
    if (projectile && t - effect.start < ARC_KEPT_MS) el.from = posOf(projectile)
    shown.push(effect)
    if (projectile) shown.push(projectile)
    elements.push(el)
  })

  // Casts of the last moments that left nothing drawn of their own (flashes, dashes, darts).
  const usedCastIds = new Set<string>()
  for (const cast of casts) {
    if (cast.t <= t - CAST_SHOWN_MS || cast.t > t || cast.t < round.buyStartMs) continue
    if (shown.some(e => explains(cast, e))) continue
    const id = ids.forCast(cast)
    if (usedCastIds.has(id)) continue
    usedCastIds.add(id)
    const info = infoOfSubject(cast.player)
    const agent = info?.name.trim() || UNKNOWN_AGENT
    const slot = KEY_TO_SLOT[cast.slot] ?? null
    const el: AbilityElement = { kind: 'ability', id, agent, slot, shape: 'other', at: imagePos(transform, cast.x, cast.y) }
    if (slot) {
      const { shape, radius } = abilityShape(agent, slot)
      el.shape = shape
      el.radius = radius
      el.label = info?.abilities.find(a => a.slot === slot)?.name.trim() || SLOT_KEYS[slot]
    }
    elements.push(el)
  }

  // The spike, once planted: at the plant's own point, else where the planter stood.
  const plant = roundPlant(bundle, round)
  if (plant.t !== null && plant.t <= t) {
    let at: PlayPos | null = null
    if (plant.record?.x != null && plant.record.y != null) {
      at = imagePos(transform, plant.record.x, plant.record.y)
    } else if (plant.record?.player) {
      const state = playerStateAt(bundle.tracks.byPlayer[plant.record.player] ?? [], plant.t)
      if (state) at = imagePos(transform, state.x, state.y)
    }
    if (at) {
      const el: MarkerElement = { kind: 'marker', id: ids.forPlant(round.n), type: 'spike', at }
      const site = plant.record?.site?.trim()
      if (site) el.label = site
      elements.push(el)
    }
  }

  return { id: 'frame', name: formatRoundClock(round, t), caption: '', elements, replayMs: Math.max(0, t) }
}
