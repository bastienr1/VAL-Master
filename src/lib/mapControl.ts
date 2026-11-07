/**
 * Map control: who holds which part of the map (docs/plays-editor-v2.md §2.9).
 *
 * The minimap image is cut into a CONTROL_N × CONTROL_N grid of cells. Each
 * playable cell holds a value from −1 (the enemy holds it) to +1 (your team
 * does). Players push the cells around them toward their team's sign with a
 * Gaussian falloff of width σ (1400 world cm, about a room). With a wall grid
 * the falloff runs along walkable paths instead of straight lines, so
 * influence turns corners through doorways and never crosses a wall. Ground keeps
 * its last owner: a cell moves only while someone's influence reaches it. A
 * grid starts at the defenders' value (`baseline`): the defending side owns
 * the map until the attackers contest it (`touched` marks the cells a player
 * has reached). In replay mode the grid is stepped through the round with that
 * memory (`simulateControl`); on a designed step it is the steady state of the
 * agents on the map (`instantControl`).
 *
 * Pure, no React, no DOM: the mask comes from `mapMask.ts`. Must not import
 * `gameContent.ts`, so that `node --test` can type-check and run it.
 */

import type { ReplayBundle, ReplayRound } from './replayBundle.ts'
import {
  deathTimesBySubject,
  isAliveAt,
  isPresentAt,
  playerStateAt,
  worldToImage,
  type MapTransform,
} from './replayScene.ts'
import { roundBarrier, roundSpan } from './replayFrame.ts'
import { resolvePos, type MapCallout, type PlayStep } from './playDoc.ts'

/** Cells per side over the whole minimap image. */
export const CONTROL_N = 96

export interface ControlGrid {
  n: number
  /** −1 (enemy) … +1 (ally), row-major [v][u]: cell (i, j) is `values[j * n + i]`. */
  values: Float32Array
  /** 1 = playable. Same layout as `values`. */
  mask: Uint8Array
  /** Bumped by every mutation, so a renderer repaints only when it changes. Starts at 0. */
  version: number
  /** 1 once a presence's influence at the cell has exceeded 0.05 (the cell has been contested). Same layout as `values`. */
  touched: Uint8Array
  /** The value every playable cell starts at: the defenders' sign (−1 the enemy defends, +1 your team does), or 0. */
  baseline: -1 | 0 | 1
}

/**
 * Who holds the map. A cell is claimed when |v| ≥ 0.25. `claimed` and
 * `contested` are fractions of the playable cells (they sum to 1); `ally` and
 * `enemy` are fractions of the claimed cells (they sum to 1 when anything is
 * claimed, both 0 when nothing is). All zero when nothing is playable.
 */
export interface ControlShare { ally: number; enemy: number; contested: number; claimed: number }

/** A player on the map, in image units (0..1). */
export interface Presence { u: number; v: number; team: 'ally' | 'enemy' }

/** The minimap's walls on an n × n grid over the whole image (`mapMask.ts`, `WALL_N`): 1 = wall, row-major [v][u]. */
export interface WallGrid { n: number; cells: Uint8Array }

/** σ for a typical map (1400 cm at the usual 7e-5 image units per cm), used when the caller gives none. */
export const DEFAULT_CONTROL_SIGMA = 1400 * 7e-5

/** At or below this influence nobody reaches a cell: it keeps its value. */
const INFLUENCE_FLOOR = 0.05
/** Time constant (ms) toward the target where someone stands. */
const TAKE_MS = 2500
/** A cell farther than this many σ from a presence ignores it (exp(−9) ≈ 1e-4). */
const CUTOFF_SIGMAS = 3
/** A cell counts for a team at or beyond this value. */
const HELD = 0.25
/** Replay simulation tick (ms). */
const TICK_MS = 100
/** Control timeline sample spacing (ms). */
const SAMPLE_MS = 1000

const WORLD_SIGMA_CM = 1400

/** A grid with every playable cell at `baseline`, nothing touched, version 0. */
export function emptyGrid(mask: Uint8Array, baseline: -1 | 0 | 1 = 0): ControlGrid {
  const n = Math.round(Math.sqrt(mask.length))
  if (n * n !== mask.length) throw new Error(`A control mask must be square; got ${mask.length} cells.`)
  const values = new Float32Array(n * n)
  if (baseline !== 0) {
    for (let k = 0; k < values.length; k++) if (mask[k]) values[k] = baseline
  }
  return { n, values, mask, version: 0, touched: new Uint8Array(n * n), baseline }
}

/** The defenders' sign for a replay round: −1 when the bundle owner attacks (the enemy defends), +1 when they defend, 0 when unknown. */
export function baselineFor(round: ReplayRound): -1 | 0 | 1 {
  return round.side === 'attacker' ? -1 : round.side === 'defender' ? 1 : 0
}

/** The defenders' sign for a designed play: an attack play starts all enemy, a defense play all ally. */
export function baselineForSide(side: 'attack' | 'defense'): -1 | 1 {
  return side === 'attack' ? -1 : 1
}

/** Σ team × exp(−(d/σ)²) at the image point (cellU, cellV), d in image units. No cutoff. */
export function influence(presences: Presence[], cellU: number, cellV: number, sigma: number): number {
  if (!(sigma > 0)) return 0
  const inv = 1 / (sigma * sigma)
  let sum = 0
  for (const p of presences) {
    const du = cellU - p.u
    const dv = cellV - p.v
    sum += (p.team === 'ally' ? 1 : -1) * Math.exp(-(du * du + dv * dv) * inv)
  }
  return sum
}

/** Reach entries kept per wall grid: a few cells of history per player. */
const REACH_ENTRIES = 64
/**
 * Path steps in integer units, so the search can use a bucket queue: a
 * straight step is 12, a diagonal 17 (17/12 = 1.4167, just above √2, so a
 * path is never shorter than the straight line).
 */
const STEP = 12
const DIAGONAL = 17
const NO_PATH = -1

/**
 * Where a presence standing in one wall cell reaches: the playable control
 * cells whose path distance is within 3σ, as parallel lists. Unreached cells
 * are absent (their distance is in effect infinite).
 */
interface Reach {
  count: number
  cells: Int32Array
  /** Path distance in image units. */
  dist: Float32Array
  /** exp(−(dist/σ)²), so a warm tick does no `exp`. */
  weight: Float32Array
}

interface ReachCache {
  n: number
  sigma: number
  mask: Uint8Array
  /** Capacity of every entry's lists: the control cells of the 3σ box. */
  capacity: number
  /** Key: a wall-grid cell. Insertion order is the LRU order. */
  entries: Map<number, Reach>
}

const reachCaches = new WeakMap<WallGrid, ReachCache>()

// Search scratch, sized to the largest grids seen; grown, never shrunk.
let stampNow = 0
let wallDist = new Int32Array(0)
let wallStamp = new Uint32Array(0)
let settled = new Int32Array(0)
let ctrlDist = new Float32Array(0)
let ctrlStamp = new Uint32Array(0)
// Bucket queue: one singly linked list per integer distance, over a pool of entries.
let bucketHead = new Int32Array(0)
let entryNode = new Int32Array(1024)
let entryNext = new Int32Array(1024)
let entryCount = 0

function growScratch(wallCells: number, ctrlCells: number, buckets: number): void {
  if (wallDist.length < wallCells) {
    wallDist = new Int32Array(wallCells)
    wallStamp = new Uint32Array(wallCells)
    settled = new Int32Array(wallCells)
    stampNow = 0
  }
  if (ctrlDist.length < ctrlCells) {
    ctrlDist = new Float32Array(ctrlCells)
    ctrlStamp = new Uint32Array(ctrlCells)
    stampNow = 0
  }
  if (bucketHead.length < buckets) bucketHead = new Int32Array(buckets)
  if (stampNow === 0) {
    wallStamp.fill(0)
    ctrlStamp.fill(0)
  }
}

/** Offers wall cell `k` at path length `d` (integer units), queueing it when that is shorter than what it has. */
function relax(k: number, d: number): void {
  if (wallStamp[k] === stampNow && wallDist[k] <= d) return
  wallStamp[k] = stampNow
  wallDist[k] = d
  if (entryCount === entryNode.length) {
    const nodes = new Int32Array(entryCount * 2)
    const next = new Int32Array(entryCount * 2)
    nodes.set(entryNode)
    next.set(entryNext)
    entryNode = nodes
    entryNext = next
  }
  entryNode[entryCount] = k
  entryNext[entryCount] = bucketHead[d]
  bucketHead[d] = entryCount++
}

/**
 * Path distances from wall cell (wi, wj) to the control cells around it.
 *
 * A bounded Dijkstra over the wall grid (with a bucket queue, the step costs
 * being small integers): 8-connected, diagonal steps cost ≈ √2, wall cells
 * impassable, a diagonal step only when both cells it cuts past are free (so
 * it cannot slip through a wall corner), stopping at 3σ. A control cell's
 * distance is the minimum, over the wall cells whose centre lies in it (and,
 * when control cells are finer than wall cells, the wall cell under its own
 * centre), of the path to that wall cell plus the straight step from there to
 * the control cell's centre. So it is never shorter than the straight line
 * from the start cell's centre, and close to it on open ground. A presence
 * standing on a wall pixel (the wall grid is drawn conservatively) starts
 * from the free cells around it.
 */
function computeReach(walls: WallGrid, n: number, mask: Uint8Array, sigma: number, wi: number, wj: number, out: Reach): void {
  const w = walls.n
  const cells = walls.cells
  const reach = CUTOFF_SIGMAS * sigma // image units
  const limit = Math.ceil(reach * w * STEP) // integer path units
  growScratch(w * w, n * n, limit + DIAGONAL + 1)
  stampNow++
  bucketHead.fill(NO_PATH, 0, limit + 1)
  entryCount = 0
  out.count = 0

  const start = wj * w + wi
  if (!cells[start]) {
    relax(start, 0)
  } else {
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = wi + di
        const j = wj + dj
        const d = Math.ceil(Math.sqrt(di * di + dj * dj) * STEP)
        if (i < 0 || j < 0 || i >= w || j >= w || cells[j * w + i] || d > limit) continue
        relax(j * w + i, d)
      }
    }
  }

  let nSettled = 0
  for (let d = 0; d <= limit; d++) {
    for (let e = bucketHead[d]; e !== NO_PATH; e = entryNext[e]) {
      const k = entryNode[e]
      if (wallDist[k] !== d) continue // a shorter path was found since
      settled[nSettled++] = k
      const i = k % w
      const left = i > 0 && !cells[k - 1]
      const right = i < w - 1 && !cells[k + 1]
      const up = k >= w && !cells[k - w]
      const down = k < w * (w - 1) && !cells[k + w]
      const d1 = d + STEP
      const d2 = d + DIAGONAL
      if (d1 <= limit) {
        if (left) relax(k - 1, d1)
        if (right) relax(k + 1, d1)
        if (up) relax(k - w, d1)
        if (down) relax(k + w, d1)
      }
      if (d2 <= limit) {
        if (left && up && !cells[k - w - 1]) relax(k - w - 1, d2)
        if (right && up && !cells[k - w + 1]) relax(k - w + 1, d2)
        if (left && down && !cells[k + w - 1]) relax(k + w - 1, d2)
        if (right && down && !cells[k + w + 1]) relax(k + w + 1, d2)
      }
    }
  }

  // Wall-cell paths to control cells, in image units.
  const toImage = 1 / w
  const unit = toImage / STEP
  const list = out.cells
  const capacity = list.length
  for (let s = 0; s < nSettled; s++) {
    const k = settled[s]
    const i = k % w
    const u = (i + 0.5) * toImage
    const v = ((k - i) / w + 0.5) * toImage
    const ci = Math.min(n - 1, Math.floor(u * n))
    const cj = Math.min(n - 1, Math.floor(v * n))
    const c = cj * n + ci
    if (!mask[c]) continue
    const du = (ci + 0.5) / n - u
    const dv = (cj + 0.5) / n - v
    const d = wallDist[k] * unit + Math.sqrt(du * du + dv * dv)
    if (d > reach) continue
    if (ctrlStamp[c] !== stampNow) {
      if (out.count >= capacity) continue
      ctrlStamp[c] = stampNow
      ctrlDist[c] = d
      list[out.count++] = c
    } else if (d < ctrlDist[c]) {
      ctrlDist[c] = d
    }
  }
  if (n > w) {
    const ou = (wi + 0.5) * toImage
    const ov = (wj + 0.5) * toImage
    const i0 = Math.max(0, Math.floor((ou - reach) * n))
    const i1 = Math.min(n - 1, Math.floor((ou + reach) * n))
    const j0 = Math.max(0, Math.floor((ov - reach) * n))
    const j1 = Math.min(n - 1, Math.floor((ov + reach) * n))
    for (let cj = j0; cj <= j1; cj++) {
      for (let ci = i0; ci <= i1; ci++) {
        const c = cj * n + ci
        if (!mask[c]) continue
        const cu = (ci + 0.5) / n
        const cv = (cj + 0.5) / n
        const mi = Math.floor(cu * w)
        const mj = Math.floor(cv * w)
        const k = mj * w + mi
        if (wallStamp[k] !== stampNow) continue
        const du = cu - (mi + 0.5) * toImage
        const dv = cv - (mj + 0.5) * toImage
        const d = wallDist[k] * unit + Math.sqrt(du * du + dv * dv)
        if (d > reach) continue
        if (ctrlStamp[c] !== stampNow) {
          if (out.count >= capacity) continue
          ctrlStamp[c] = stampNow
          ctrlDist[c] = d
          list[out.count++] = c
        } else if (d < ctrlDist[c]) {
          ctrlDist[c] = d
        }
      }
    }
  }
  const inv = 1 / (sigma * sigma)
  for (let q = 0; q < out.count; q++) {
    const d = ctrlDist[list[q]]
    out.dist[q] = d
    out.weight[q] = Math.exp(-d * d * inv)
  }
}

/**
 * The cached reach of a presence standing in wall cell (wi, wj); recomputed
 * only when a player moves to another wall cell. The same wall cell always
 * gives the same reach, whatever the cache holds.
 */
function reachFor(walls: WallGrid, n: number, mask: Uint8Array, sigma: number, wi: number, wj: number): Reach {
  let cache = reachCaches.get(walls)
  if (!cache || cache.n !== n || cache.sigma !== sigma || cache.mask !== mask) {
    const side = 2 * Math.ceil(CUTOFF_SIGMAS * sigma * n) + 3
    cache = { n, sigma, mask, capacity: Math.min(n * n, side * side), entries: new Map() }
    reachCaches.set(walls, cache)
  }
  const key = wj * walls.n + wi
  const entries = cache.entries
  const hit = entries.get(key)
  if (hit) {
    entries.delete(key)
    entries.set(key, hit)
    return hit
  }
  let out: Reach
  if (entries.size >= REACH_ENTRIES) {
    const oldest = entries.keys().next().value as number
    out = entries.get(oldest)!
    entries.delete(oldest)
  } else {
    const capacity = cache.capacity
    out = { count: 0, cells: new Int32Array(capacity), dist: new Float32Array(capacity), weight: new Float32Array(capacity) }
  }
  computeReach(walls, n, mask, sigma, wi, wj, out)
  entries.set(key, out)
  return out
}

// Scratch buffers, reused across calls so the per-cell loops allocate nothing.
let scratchInfluence = new Float32Array(0)
let scratchWu = new Float32Array(0)
let scratchWv = new Float32Array(0)

/**
 * The influence of every cell of an n × n grid, written into a shared scratch
 * buffer (valid until the next call). Without walls, each presence touches
 * only the cells of its 3σ bounding box; the Gaussian is separable, so it is
 * the product of a per-column and a per-row weight. With walls, each presence
 * adds exp(−(d/σ)²) with d its path distance (`reachFor`) to the cells it
 * reaches, and nothing elsewhere.
 */
function influenceField(
  n: number,
  mask: Uint8Array,
  presences: Presence[],
  sigma: number,
  walls: WallGrid | undefined,
): Float32Array {
  const cells = n * n
  if (scratchInfluence.length < cells) scratchInfluence = new Float32Array(cells)
  if (scratchWu.length < n) {
    scratchWu = new Float32Array(n)
    scratchWv = new Float32Array(n)
  }
  const field = scratchInfluence
  const wu = scratchWu
  const wv = scratchWv
  field.fill(0, 0, cells)
  if (!(sigma > 0)) return field

  const inv = 1 / (sigma * sigma)
  const reach = CUTOFF_SIGMAS * sigma
  const walled = walls !== undefined && walls.n > 0 && walls.cells.length >= walls.n * walls.n
  for (let p = 0; p < presences.length; p++) {
    const { u, v, team } = presences[p]
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue
    const sign = team === 'ally' ? 1 : -1
    if (walled) {
      const w = walls.n
      const wi = Math.min(w - 1, Math.max(0, Math.floor(u * w)))
      const wj = Math.min(w - 1, Math.max(0, Math.floor(v * w)))
      const { count, cells: list, weight } = reachFor(walls, n, mask, sigma, wi, wj)
      for (let q = 0; q < count; q++) field[list[q]] += sign * weight[q]
      continue
    }
    const i0 = Math.max(0, Math.ceil((u - reach) * n - 0.5))
    const i1 = Math.min(n - 1, Math.floor((u + reach) * n - 0.5))
    const j0 = Math.max(0, Math.ceil((v - reach) * n - 0.5))
    const j1 = Math.min(n - 1, Math.floor((v + reach) * n - 0.5))
    if (i0 > i1 || j0 > j1) continue
    for (let i = i0; i <= i1; i++) {
      const d = (i + 0.5) / n - u
      wu[i] = Math.exp(-d * d * inv)
    }
    for (let j = j0; j <= j1; j++) {
      const d = (j + 0.5) / n - v
      wv[j] = sign * Math.exp(-d * d * inv)
    }
    for (let j = j0; j <= j1; j++) {
      const row = j * n
      const w = wv[j]
      for (let i = i0; i <= i1; i++) {
        const k = row + i
        if (mask[k]) field[k] += w * wu[i]
      }
    }
  }
  return field
}

/**
 * Advances the grid by `dtMs`, in place. Where the influence I of a playable
 * cell is stronger than 0.05, the cell becomes touched and moves toward
 * sign(I)·min(1, |I|) with a 2.5 s time constant. Every other cell keeps its
 * value: ground keeps its last owner (or the baseline) until someone reaches
 * it again. `sigma` defaults to a typical map's; pass `sigmaFor(transform)`.
 * With `walls`, influence spreads along walkable paths only (see `computeReach`).
 */
export function stepControl(
  grid: ControlGrid,
  presences: Presence[],
  dtMs: number,
  sigma = DEFAULT_CONTROL_SIGMA,
  walls?: WallGrid,
): void {
  if (!(dtMs > 0)) return
  const { n, values, mask, touched } = grid
  const field = influenceField(n, mask, presences, sigma, walls)
  const take = 1 - Math.exp(-dtMs / TAKE_MS)
  const cells = n * n
  for (let k = 0; k < cells; k++) {
    if (!mask[k]) continue
    const I = field[k]
    if (I > INFLUENCE_FLOOR || I < -INFLUENCE_FLOOR) {
      const target = I > 1 ? 1 : I < -1 ? -1 : I
      values[k] += (target - values[k]) * take
      touched[k] = 1
    }
  }
  grid.version++
}

/**
 * No memory, for designed steps: a playable cell whose influence is stronger
 * than 0.05 is its target (and touched); every other one is `baseline`.
 * With `walls`, influence spreads along walkable paths only (see `computeReach`).
 */
export function instantControl(
  mask: Uint8Array,
  presences: Presence[],
  sigma = DEFAULT_CONTROL_SIGMA,
  baseline: -1 | 0 | 1 = 0,
  walls?: WallGrid,
): ControlGrid {
  const grid = emptyGrid(mask, baseline)
  const { n, values, touched } = grid
  const field = influenceField(n, mask, presences, sigma, walls)
  const cells = n * n
  for (let k = 0; k < cells; k++) {
    if (!mask[k]) continue
    const I = field[k]
    if (I > INFLUENCE_FLOOR || I < -INFLUENCE_FLOOR) {
      values[k] = I > 1 ? 1 : I < -1 ? -1 : I
      touched[k] = 1
    }
  }
  grid.version = 1
  return grid
}

/** Claimed and contested fractions of the playable cells, and each team's fraction of the claimed ones. */
export function controlShare(grid: ControlGrid): ControlShare {
  const { values, mask } = grid
  let playable = 0
  let ally = 0
  let enemy = 0
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue
    playable++
    const v = values[k]
    if (v >= HELD) ally++
    else if (v <= -HELD) enemy++
  }
  if (playable === 0) return { ally: 0, enemy: 0, contested: 0, claimed: 0 }
  const claimed = ally + enemy
  return {
    ally: claimed > 0 ? ally / claimed : 0,
    enemy: claimed > 0 ? enemy / claimed : 0,
    contested: (playable - claimed) / playable,
    claimed: claimed / playable,
  }
}

/** 1400 world cm in image units. */
export function sigmaFor(transform: MapTransform): number {
  return WORLD_SIGMA_CM * Math.abs(transform.xMultiplier)
}

/** Every agent element of a step (a step has no alive flag) that `resolvePos` can place. */
export function presencesOf(step: PlayStep, callouts: MapCallout[], transform: MapTransform): Presence[] {
  const out: Presence[] = []
  for (const el of step.elements) {
    if (el.kind !== 'agent') continue
    const pos = resolvePos(el.at, callouts, transform)
    if (!pos) continue
    out.push({ u: pos[0], v: pos[1], team: el.team })
  }
  return out
}

const deathsCache = new WeakMap<ReplayBundle, Map<string, number[]>>()

function deathsOf(bundle: ReplayBundle): Map<string, number[]> {
  let deaths = deathsCache.get(bundle)
  if (!deaths) {
    deaths = deathTimesBySubject(bundle)
    deathsCache.set(bundle, deaths)
  }
  return deaths
}

/**
 * Advances `grid` through the round from `fromMs` (exclusive) to `toMs`
 * (inclusive), one 100 ms tick at a time, and returns the replay time it
 * reached: `toMs` when done, or the time of its last tick when it stopped
 * after `maxTicks` ticks (call again from there to go on). Ticks fall on the
 * round's buy start plus multiples of 100 ms, so consecutive calls (a, b] then
 * (b, c] give the same grid as one call (a, c]. Ticks outside the round's span
 * are skipped. Each tick uses the players present and alive at it; with
 * `walls`, their influence spreads along walkable paths only. Going backwards
 * is the caller's job: start again from a fresh grid at the round start, made
 * with `emptyGrid(mask, baselineFor(round))`.
 */
export function simulateControl(
  bundle: ReplayBundle,
  round: ReplayRound,
  fromMs: number,
  toMs: number,
  grid: ControlGrid,
  transform: MapTransform,
  walls?: WallGrid,
  maxTicks = Infinity,
): number {
  const span = roundSpan(bundle, round)
  const start = round.buyStartMs
  const lo = Math.max(fromMs, start - 1)
  const hi = Math.min(toMs, span.end)
  if (!(hi > lo)) return toMs

  const sigma = sigmaFor(transform)
  const deaths = deathsOf(bundle)
  const players = bundle.players.map(p => ({
    subject: p.subject,
    rows: bundle.tracks.byPlayer[p.subject] ?? [],
    team: p.team === 'ALLY' ? ('ally' as const) : ('enemy' as const),
  }))
  const pool: Presence[] = players.map(() => ({ u: 0, v: 0, team: 'ally' }))
  const presences: Presence[] = []

  let ticks = 0
  for (let k = Math.floor((lo - start) / TICK_MS) + 1; start + k * TICK_MS <= hi; k++) {
    const t = start + k * TICK_MS
    if (ticks >= maxTicks) return Math.max(fromMs, t - TICK_MS)
    ticks++
    presences.length = 0
    for (let i = 0; i < players.length; i++) {
      const player = players[i]
      const state = playerStateAt(player.rows, t)
      if (!state || !isPresentAt(state, t, start) || !isAliveAt(state, deaths.get(player.subject), t)) continue
      const [u, v] = worldToImage(transform, state.x, state.y)
      const p = pool[i]
      p.u = u
      p.v = v
      p.team = player.team
      presences.push(p)
    }
    stepControl(grid, presences, TICK_MS, sigma, walls)
  }
  return toMs
}

export interface TimelineSample { t: number; share: ControlShare }

/** A round's control timeline computed a slice at a time (`createTimelineRun`). */
export interface TimelineRun {
  /**
   * Does at most `maxUnits` units of work and says whether the run is done.
   * A unit is at most one second of simulation (10 ticks): each sample after
   * the first is one unit, and the buy phase before the barrier is one unit
   * per second.
   */
  step(maxUnits: number): boolean
  /** The samples so far, in time order; complete once `step` returned true. */
  samples: TimelineSample[]
  /** How many samples the finished timeline has. */
  total: number
}

/**
 * Starts the control timeline of a round: each team's share of the map once a
 * second from the barrier to the round's end, simulated from a fresh grid at
 * buy start that starts at the round's baseline (`baselineFor`). Run it in
 * slices off the render path; the result is the same however it is sliced.
 */
export function createTimelineRun(
  bundle: ReplayBundle,
  round: ReplayRound,
  mask: Uint8Array,
  transform: MapTransform,
  walls?: WallGrid,
): TimelineRun {
  const grid = emptyGrid(mask, baselineFor(round))
  const span = roundSpan(bundle, round)
  const barrier = roundBarrier(round)
  const total = span.end >= barrier ? Math.floor((span.end - barrier) / SAMPLE_MS) + 1 : 0
  const samples: TimelineSample[] = []
  let at = span.start
  let next = barrier
  return {
    samples,
    total,
    step(maxUnits) {
      for (let unit = 0; unit < maxUnits && samples.length < total; unit++) {
        const to = Math.min(next, at + SAMPLE_MS)
        simulateControl(bundle, round, at, to, grid, transform, walls)
        at = to
        if (at === next) {
          samples.push({ t: next, share: controlShare(grid) })
          next += SAMPLE_MS
        }
      }
      return samples.length >= total
    },
  }
}

/**
 * The whole control timeline of a round in one call (`createTimelineRun` run
 * to the end). For the scrubber's track and the summary line. `onProgress`
 * hears after every sample how many are done out of how many.
 */
export function controlTimeline(
  bundle: ReplayBundle,
  round: ReplayRound,
  mask: Uint8Array,
  transform: MapTransform,
  walls?: WallGrid,
  onProgress?: (done: number, total: number) => void,
): TimelineSample[] {
  const run = createTimelineRun(bundle, round, mask, transform, walls)
  let reported = -1
  for (;;) {
    const done = run.step(1)
    if (run.samples.length !== reported) {
      reported = run.samples.length
      onProgress?.(reported, run.total)
    }
    if (done) return run.samples
  }
}

/** The mean of each of the four fractions over a timeline; all zero when it is empty. */
export function averageShare(timeline: { share: ControlShare }[]): ControlShare {
  if (timeline.length === 0) return { ally: 0, enemy: 0, contested: 0, claimed: 0 }
  let ally = 0
  let enemy = 0
  let contested = 0
  let claimed = 0
  for (const { share } of timeline) {
    ally += share.ally
    enemy += share.enemy
    contested += share.contested
    claimed += share.claimed
  }
  const n = timeline.length
  return { ally: ally / n, enemy: enemy / n, contested: contested / n, claimed: claimed / n }
}
