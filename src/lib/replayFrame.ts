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
 * Utility follows §2.14: an ability is drawn where it takes effect, from the
 * first frame of its throw, and only a small flyer travels from the hand. How
 * long it lasts and how it reads come from its family (`agentAbilities.ts`);
 * the class table of `utilityClasses.ts` says which effect is which.
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
import {
  abilityLook,
  abilityRadius,
  abilityShape,
  BURST_MS,
  FAMILY_RADIUS_CM,
  SLOT_KEYS,
  WAVE_MS,
  WAVE_SWEEP_MS,
  type AbilityFamily,
  type AbilityLook,
} from './agentAbilities.ts'
import { blindAt, kitAt, vitalsAt } from './replayKit.ts'
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
/** An effect may open this long before the cast the game records for it. */
const CAST_LEAD_MS = 500
/** An ability that acts on the agent alone is shown on the agent this long. */
const SELF_SHOWN_MS = 1_500
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
/** A landing keeps the way it came this long. */
const ARC_KEPT_MS = 1_000
/** A projectile has arrived once this close (world cm) to where its track ends: a flash lies there until its actor closes. */
const ARRIVED_CM = 60
/** A pawn pairs with the effect that starts within this time and distance of its first sample. */
const PAWN_JOIN_MS = 1_500
const PAWN_JOIN_CM = 400
/** A pawn's movement is kept at this spacing, and counts as moving past this distance. */
const PAWN_STEP_MS = 150
const PAWN_MOVES_CM = 100
/** A scout's trail shows this far back. */
const SCOUT_TRAIL_MS = 4_000
/** What runs on a timer shows its seconds. */
const TIMED: ReadonlySet<AbilityFamily> = new Set<AbilityFamily>(['cloud', 'zone', 'wall'])
/** What has no clock at all: it waits. */
const UNTIMED: ReadonlySet<AbilityFamily> = new Set<AbilityFamily>(['device'])
/** A runner and the wall it draws start within this of each other. */
const TRACER_MS = 300
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
  /** A wall with no points of its own → the runner whose track draws it. */
  tracerOf: Map<number, number>
  /** A pawn's effect index → how it moved, [t, x, y]; absent for one that stays put. */
  pawnOf: Map<number, [number, number, number][]>
  /** A wire anchor's index → its far end's. */
  wireEnd: Map<number, number>
  /** Whether the bundle knows where thrown things went: older ones hold area effects only. */
  hasTracks: boolean
}

// Built once per bundle, like the deaths.
const planCache = new WeakMap<ReplayBundle, EffectPlan>()
function planOf(bundle: ReplayBundle): EffectPlan {
  let plan = planCache.get(bundle)
  if (!plan) {
    plan = buildPlan(bundle.effects, bundle.pawns?.items ?? [])
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

function buildPlan(effects: ReplayEffect[], pawns: ReplayBundle['pawns']['items']): EffectPlan {
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
        // Labelled with different keys: another ability's landing (a Breach flash and his Aftershock).
        if (info[p].slot && info[l].slot && info[p].slot !== info[l].slot) continue
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
  // A runner's track draws the wall of its owner that starts with it (Neon's Fast Lane).
  const tracerOf = new Map<number, number>()
  effects.forEach((e, i) => {
    if (!info[i].traces || !e.track || e.track.length < 2 || e.owner === null) return
    let best = -1
    effects.forEach((w, j) => {
      if (w.owner !== e.owner || info[j].shape !== 'wall' || info[j].role === 'ignore' || tracerOf.has(j)) return
      if (Math.abs(w.start - e.start) > TRACER_MS) return
      if (best < 0 || Math.abs(w.start - e.start) < Math.abs(effects[best].start - e.start)) best = j
    })
    if (best >= 0) tracerOf.set(best, i)
  })
  // Pawns move in their own table: each is the one that starts with its effect, in the same place.
  const pawnOf = new Map<number, [number, number, number][]>()
  const taken = new Set<number>()
  effects.forEach((e, i) => {
    if (!e.cls.startsWith('Pawn_')) return
    let best = -1
    let bestGap = Infinity
    pawns.forEach((pawn, j) => {
      const first = pawn.samples[0]
      if (!first || taken.has(j) || (pawn.owner !== null && e.owner !== null && pawn.owner !== e.owner)) return
      const gap = Math.abs(first[0] - e.start)
      if (gap <= PAWN_JOIN_MS && gap < bestGap && Math.hypot(first[1] - e.x, first[2] - e.y) <= PAWN_JOIN_CM) {
        best = j
        bestGap = gap
      }
    })
    if (best < 0) return
    taken.add(best)
    const samples = pawns[best].samples
    const start = samples[0]
    if (!samples.some(s => Math.hypot(s[1] - start[1], s[2] - start[2]) > PAWN_MOVES_CM)) return
    const kept: [number, number, number][] = []
    for (const [t, x, y] of samples) {
      if (kept.length === 0 || t - kept[kept.length - 1][0] >= PAWN_STEP_MS) kept.push([t, x, y])
    }
    const last = samples[samples.length - 1]
    if (kept[kept.length - 1][0] !== last[0]) kept.push([last[0], last[1], last[2]])
    pawnOf.set(i, kept)
  })
  // A wire's far end starts with its anchor.
  const wireEnd = new Map<number, number>()
  effects.forEach((e, i) => {
    if (!info[i].wireEnd) return
    const anchor = effects.findIndex((a, j) => info[j].shape === 'trap' && !info[j].wireEnd && a.owner === e.owner && a.cls.includes('TripWire') && !wireEnd.has(j) && Math.abs(a.start - e.start) <= WALL_GROUP_MS)
    if (anchor >= 0) wireEnd.set(anchor, i)
  })
  const hasTracks = effects.some(e => e.track !== undefined && e.track.length > 0)
  return { info, landingOf, throwOf, walls, wallOf, tracerOf, pawnOf, wireEnd, hasTracks }
}

/** When a tracked projectile reached the point its track ends at. */
function arrivalOf(track: ReadonlyArray<readonly [number, number, number]>): number {
  const [, x, y] = track[track.length - 1]
  const first = track.find(([, sx, sy]) => Math.hypot(sx - x, sy - y) <= ARRIVED_CM)
  return (first ?? track[track.length - 1])[0]
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

/** Where a track ([t, x, y] in time order) has its actor at `t`: interpolated, clamped to its ends. */
export function trackAt(track: ReadonlyArray<readonly [number, number, number]>, t: number): [number, number] {
  const first = track[0]
  const last = track[track.length - 1]
  if (t <= first[0]) return [first[1], first[2]]
  if (t >= last[0]) return [last[1], last[2]]
  let k = 1
  while (track[k][0] < t) k++
  const [t0, x0, y0] = track[k - 1]
  const [t1, x1, y1] = track[k]
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]
}

/** How much of a life from `start` to `end` is left at `t`, 1…0; null for a life of no length. */
function lifeLeft(start: number, end: number, t: number): number | null {
  if (end <= start) return null
  return clamp01((end - t) / (end - start))
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
  /** Who played each subject (Riot name), when known: put on the agent as `player`. */
  playerName?: (subject: string) => string | undefined,
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
    const name = playerName?.(player.subject)
    if (name) el.player = name
    const kit = bundle.kits?.[player.subject]
    if (kit) el.kit = kitAt(kit, t, roundBarrier(round))
    const vitals = bundle.vitals?.[player.subject]
    if (vitals) {
      const { hp, armor } = vitalsAt(vitals, t)
      el.hp = hp
      el.armor = armor
    }
    const blinds = bundle.blinds?.[player.subject]
    const blind = blinds ? blindAt(blinds, t) : null
    if (blind !== null) el.blind = blind
    elements.push(el)
  }

  const casts = bundle.casts.filter(positioned)
  const plan = planOf(bundle)
  const effects = bundle.effects
  const posOf = (e: ReplayEffect) => imagePos(transform, e.x, e.y)
  /** Where a tracked actor is at `t`: between its two samples around it, else at the nearer end. */
  const trackPos = (track: ReadonlyArray<readonly [number, number, number]>, at: number): PlayPos => {
    const [x, y] = trackAt(track, at)
    return imagePos(transform, x, y)
  }
  // Up at t, opened during this round; one that never closed lasts the round.
  const upAt = (e: ReplayEffect) => e.start >= round.buyStartMs && e.start <= t && (e.end === null || e.end >= t)

  /**
   * The ability effect `index` stands for (a landing, or a thing put down),
   * with its class's shape. The slot is the class's, else its throw's, else
   * that of the cast that put one of `sources` down, nearest in time.
   */
  const abilityOf = (index: number, sources: ReplayEffect[], id: string, at: PlayPos, thrown?: number): AbilityElement => {
    const effect = effects[index]
    const { shape, radius, family: phase } = plan.info[index]
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
    const look = lookOf(index, thrown)
    const el: AbilityElement = { kind: 'ability', id, agent, slot, shape, at, family: look.family }
    if (radius !== undefined) el.radius = radius
    else {
      // A phase of its own (a cage's canister) is not the area the table sizes.
      const named = look.r ?? (slot && !phase ? abilityRadius(agent, slot) : null)
      el.radius = named ?? FAMILY_RADIUS_CM[look.family]
    }
    if (slot) el.label = info?.abilities.find(a => a.slot === slot)?.name.trim() || SLOT_KEYS[slot]
    return el
  }

  /** How effect `index` behaves: its class's phase, else its ability's. */
  function lookOf(index: number, thrown?: number): AbilityLook {
    const { family, slot, shape } = plan.info[index]
    if (family) return { family }
    const info = infoOfSubject(effects[index].owner) ?? lookup(effects[index].agent)
    const key = slot ?? (thrown !== undefined ? plan.info[thrown].slot : undefined) ?? null
    return abilityLook(info?.name ?? '', key, shape)
  }

  /** When it stops being drawn: a burst and a wave by their own clock, what has a figure by that, else its actor's. */
  const endOf = (effect: ReplayEffect, look: AbilityLook): number | null => {
    if (look.family === 'burst') return effect.start + (look.ms ?? BURST_MS)
    if (look.family === 'wave') return effect.start + (look.ms ?? WAVE_MS)
    if (look.ms !== undefined) return effect.start + look.ms
    return effect.end
  }

  /** The clock on an element: its ring, and its seconds when it runs on a timer and its end is known. */
  const clock = (el: AbilityElement, start: number, end: number, known: boolean) => {
    if (el.family && UNTIMED.has(el.family)) return
    const life = lifeLeft(start, end, t)
    if (life !== null) el.life = life
    if (known && el.family && TIMED.has(el.family)) el.seconds = Math.ceil((end - t) / 1000)
  }

  /** The samples of a track up to `t`, and where it is at `t`. */
  const walked = (track: ReadonlyArray<readonly [number, number, number]>, since = -Infinity): PlayPos[] => [
    ...track.filter(([at]) => at <= t && at >= since).map(([, x, y]) => imagePos(transform, x, y)),
    trackPos(track, t),
  ]

  // Utility up at t.
  effects.forEach((effect, index) => {
    const { role } = plan.info[index]
    if (plan.info[index].orb) {
      if (upAt(effect)) elements.push({ kind: 'marker', id: ids.forEffect(index), type: 'orb', at: posOf(effect) })
      return
    }
    if (role === 'ignore') return

    if (role === 'projectile') {
      const l = plan.landingOf.get(index)
      if (l === undefined) {
        // No landing actor (a flash that pops in the air, a missile): where its own track ends. No track, nothing.
        const track = effect.track
        if (!track || track.length < 2 || effect.end === null || effect.start < round.buyStartMs) return
        const look = lookOf(index)
        const lands = arrivalOf(track)
        const end = lands + (look.ms ?? BURST_MS)
        if (t < effect.start || t > end) return
        const [, x, y] = track[track.length - 1]
        const el = abilityOf(index, [effect], ids.forEffect(index), imagePos(transform, x, y))
        el.from = posOf(effect)
        if (t < lands) {
          el.progress = clamp01((t - effect.start) / (lands - effect.start))
          el.flyer = trackPos(track, t)
          el.trail = walked(track)
        } else clock(el, lands, end, true)
        elements.push(el)
        return
      }
      // In flight: already where it will land, under the landing's id.
      const landing = effects[l]
      if (effect.start < round.buyStartMs || t < effect.start || t >= landing.start) return
      const el = abilityOf(l, [effect, landing], ids.forEffect(l), posOf(landing), index)
      el.from = posOf(effect)
      el.progress = clamp01((t - effect.start) / (landing.start - effect.start))
      if (effect.track && effect.track.length >= 2) {
        el.flyer = trackPos(effect.track, t)
        el.trail = walked(effect.track)
      }
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
      const ends = up.map(e => e.end)
      if (ends.every((end): end is number => end !== null)) clock(el, Math.min(...up.map(e => e.start)), Math.max(...ends), true)
      elements.push(el)
      return
    }

    const thrown = plan.throwOf.get(index)
    const look = lookOf(index, thrown)
    const end = endOf(effect, look)
    if (effect.start < round.buyStartMs || effect.start > t || (end !== null && end < t)) return
    const projectile = thrown !== undefined ? effects[thrown] : null
    // A wall built point by point is the part already built, the badge halfway along it.
    const tracer = plan.tracerOf.get(index)
    const shape = plan.info[index].shape === 'wall' ? (effect.points ?? (tracer !== undefined ? effects[tracer].track : undefined) ?? []) : []
    const formed = shape.filter(([at]) => at <= t).map(([, x, y]) => imagePos(transform, x, y))
    const moved = plan.pawnOf.get(index)
    const ownerRows = effect.owner !== null ? bundle.tracks.byPlayer[effect.owner] : undefined
    const ownerNow = plan.info[index].onOwner && ownerRows ? playerStateAt(ownerRows, t) : null
    const at = ownerNow ? imagePos(transform, ownerNow.x, ownerNow.y) : formed.length >= 2 ? midway(formed) : moved ? trackPos(moved, t) : effect.track && effect.track.length > 0 ? trackPos(effect.track, t) : posOf(effect)
    const el = abilityOf(index, projectile ? [effect, projectile] : [effect], ids.forEffect(index), at, thrown)
    if (formed.length >= 2) el.path = formed
    const wire = plan.wireEnd.get(index)
    if (wire !== undefined) el.path = [posOf(effect), posOf(effects[wire])]
    if (moved) el.trail = walked(moved, t - SCOUT_TRAIL_MS)
    // Just landed: the way it came stays a moment.
    if (projectile && t - effect.start < ARC_KEPT_MS) {
      el.from = posOf(projectile)
      if (projectile.track && projectile.track.length >= 2) el.trail = projectile.track.map(([, x, y]) => imagePos(transform, x, y))
    }
    if (look.family === 'wave' && look.reach !== undefined && ownerRows) {
      // Along the aim the agent had when it went off.
      const aim = playerStateAt(ownerRows, effect.start)
      if (aim) {
        const rad = (aim.yaw * Math.PI) / 180
        const swept = look.reach * clamp01((t - effect.start) / (look.sweep ?? WAVE_SWEEP_MS))
        el.reach = imagePos(transform, effect.x + Math.cos(rad) * swept, effect.y + Math.sin(rad) * swept)
      }
    }
    // One that never closed lasts the round.
    clock(el, effect.start, end ?? roundSpan(bundle, round).end, end !== null)
    elements.push(el)
  })

  // What acts on the agent alone rides on the agent. So does what the replay cannot place: a cast on an
  // older bundle with no effect of its own, and a throw with neither a landing nor a track (Curveball).
  const usedCastIds = new Set<string>()
  for (const cast of casts) {
    if (cast.t <= t - SELF_SHOWN_MS || cast.t > t || cast.t < round.buyStartMs) continue
    const slot = KEY_TO_SLOT[cast.slot] ?? null
    if (!slot) continue
    const info = infoOfSubject(cast.player)
    if (!info) continue
    const agent = info.name.trim() || UNKNOWN_AGENT
    const { shape, radius } = abilityShape(agent, slot)
    if (abilityLook(agent, slot, shape).family !== 'self') {
      const ownNear = (i: number, e: ReplayEffect) => e.owner === cast.player && plan.info[i].role !== 'ignore' && e.start >= cast.t - CAST_LEAD_MS && e.start <= cast.t + CAST_EFFECT_MS
      const unplaced = effects.some((e, i) => ownNear(i, e) && plan.info[i].role === 'projectile' && !plan.landingOf.has(i) && !(e.track && e.track.length >= 2) && (!plan.info[i].slot || plan.info[i].slot === slot))
      if (!unplaced && (plan.hasTracks || effects.some((e, i) => ownNear(i, e)))) continue
    }
    const state = playerStateAt(bundle.tracks.byPlayer[cast.player] ?? [], t)
    if (!state || !isAliveAt(state, deaths.get(cast.player), t)) continue
    const id = ids.forCast(cast)
    if (usedCastIds.has(id)) continue
    usedCastIds.add(id)
    elements.push({
      kind: 'ability',
      id,
      agent,
      slot,
      shape,
      radius,
      at: imagePos(transform, state.x, state.y),
      family: 'self',
      label: info.abilities.find(a => a.slot === slot)?.name.trim() || SLOT_KEYS[slot],
    })
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
