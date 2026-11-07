/**
 * Map control: who holds which part of the map (docs/plays-editor-v2.md §2.9).
 *
 * The minimap image is cut into a CONTROL_N × CONTROL_N grid of cells. Each
 * playable cell holds a value from −1 (the enemy holds it) to +1 (your team
 * does). Players push the cells around them toward their team's sign with a
 * Gaussian falloff of width σ (1400 world cm, about a room); a cell nobody is
 * near slowly forgets who held it (25 s), so taken space stays coloured until
 * the other team walks it. In replay mode the grid is stepped through the round
 * with that memory (`simulateControl`); on a designed step it is the steady
 * state of the agents on the map (`instantControl`).
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

/** σ for a typical map (1400 cm at the usual 7e-5 image units per cm), used when the caller gives none. */
export const DEFAULT_CONTROL_SIGMA = 1400 * 7e-5

/** Below this influence a cell is treated as unattended and decays. */
const INFLUENCE_FLOOR = 0.05
/** Time constant (ms) toward the target where someone stands. */
const TAKE_MS = 2500
/** Time constant (ms) of the decay toward 0 where nobody stands. */
const FORGET_MS = 25000
/** A cell farther than this many σ from a presence ignores it (exp(−9) ≈ 1e-4). */
const CUTOFF_SIGMAS = 3
/** A cell counts for a team at or beyond this value. */
const HELD = 0.25
/** Replay simulation tick (ms). */
const TICK_MS = 100
/** Control timeline sample spacing (ms). */
const SAMPLE_MS = 1000

const WORLD_SIGMA_CM = 1400

export function emptyGrid(mask: Uint8Array): ControlGrid {
  const n = Math.round(Math.sqrt(mask.length))
  if (n * n !== mask.length) throw new Error(`A control mask must be square; got ${mask.length} cells.`)
  return { n, values: new Float32Array(n * n), mask, version: 0 }
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

// Scratch buffers, reused across calls so the per-cell loops allocate nothing.
let scratchInfluence = new Float32Array(0)
let scratchWu = new Float32Array(0)
let scratchWv = new Float32Array(0)

/**
 * The influence of every cell of an n × n grid, written into a shared scratch
 * buffer (valid until the next call). Each presence touches only the cells of
 * its 3σ bounding box; the Gaussian is separable, so it is the product of a
 * per-column and a per-row weight.
 */
function influenceField(n: number, mask: Uint8Array, presences: Presence[], sigma: number): Float32Array {
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
  for (let p = 0; p < presences.length; p++) {
    const { u, v, team } = presences[p]
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue
    const i0 = Math.max(0, Math.ceil((u - reach) * n - 0.5))
    const i1 = Math.min(n - 1, Math.floor((u + reach) * n - 0.5))
    const j0 = Math.max(0, Math.ceil((v - reach) * n - 0.5))
    const j1 = Math.min(n - 1, Math.floor((v + reach) * n - 0.5))
    if (i0 > i1 || j0 > j1) continue
    const sign = team === 'ally' ? 1 : -1
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
 * Advances the grid by `dtMs`, in place. Each playable cell moves toward
 * sign(I)·min(1, |I|) with a 2.5 s time constant where the influence I is
 * stronger than 0.05, and otherwise decays toward 0 with a 25 s time constant.
 * `sigma` defaults to a typical map's; pass `sigmaFor(transform)`.
 */
export function stepControl(grid: ControlGrid, presences: Presence[], dtMs: number, sigma = DEFAULT_CONTROL_SIGMA): void {
  if (!(dtMs > 0)) return
  const { n, values, mask } = grid
  const field = influenceField(n, mask, presences, sigma)
  const take = 1 - Math.exp(-dtMs / TAKE_MS)
  const keep = Math.exp(-dtMs / FORGET_MS)
  const cells = n * n
  for (let k = 0; k < cells; k++) {
    if (!mask[k]) continue
    const I = field[k]
    if (I > INFLUENCE_FLOOR || I < -INFLUENCE_FLOOR) {
      const target = I > 1 ? 1 : I < -1 ? -1 : I
      values[k] += (target - values[k]) * take
    } else {
      values[k] *= keep
    }
  }
  grid.version++
}

/** No memory: each playable cell is its target, 0 where the influence is 0.05 or weaker. For designed steps. */
export function instantControl(mask: Uint8Array, presences: Presence[], sigma = DEFAULT_CONTROL_SIGMA): ControlGrid {
  const grid = emptyGrid(mask)
  const { n, values } = grid
  const field = influenceField(n, mask, presences, sigma)
  const cells = n * n
  for (let k = 0; k < cells; k++) {
    if (!mask[k]) continue
    const I = field[k]
    if (I > INFLUENCE_FLOOR || I < -INFLUENCE_FLOOR) values[k] = I > 1 ? 1 : I < -1 ? -1 : I
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
 * (inclusive), one 100 ms tick at a time. Ticks fall on the round's buy start
 * plus multiples of 100 ms, so consecutive calls (a, b] then (b, c] give the
 * same grid as one call (a, c]. Ticks outside the round's span are skipped.
 * Each tick uses the players present and alive at it. Going backwards is the
 * caller's job: start again from a fresh grid at the round start.
 */
export function simulateControl(
  bundle: ReplayBundle,
  round: ReplayRound,
  fromMs: number,
  toMs: number,
  grid: ControlGrid,
  transform: MapTransform,
): void {
  const span = roundSpan(bundle, round)
  const start = round.buyStartMs
  const lo = Math.max(fromMs, start - 1)
  const hi = Math.min(toMs, span.end)
  if (!(hi > lo)) return

  const sigma = sigmaFor(transform)
  const deaths = deathsOf(bundle)
  const players = bundle.players.map(p => ({
    subject: p.subject,
    rows: bundle.tracks.byPlayer[p.subject] ?? [],
    team: p.team === 'ALLY' ? ('ally' as const) : ('enemy' as const),
  }))
  const pool: Presence[] = players.map(() => ({ u: 0, v: 0, team: 'ally' }))
  const presences: Presence[] = []

  for (let k = Math.floor((lo - start) / TICK_MS) + 1; start + k * TICK_MS <= hi; k++) {
    const t = start + k * TICK_MS
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
    stepControl(grid, presences, TICK_MS, sigma)
  }
}

/**
 * Each team's share of the map once a second from the barrier to the round's
 * end, simulated from a fresh grid at buy start. For the scrubber's track and
 * the summary line.
 */
export function controlTimeline(
  bundle: ReplayBundle,
  round: ReplayRound,
  mask: Uint8Array,
  transform: MapTransform,
): { t: number; share: ControlShare }[] {
  const grid = emptyGrid(mask)
  const span = roundSpan(bundle, round)
  const out: { t: number; share: ControlShare }[] = []
  let at = span.start
  for (let t = roundBarrier(round); t <= span.end; t += SAMPLE_MS) {
    simulateControl(bundle, round, at, t, grid, transform)
    at = t
    out.push({ t, share: controlShare(grid) })
  }
  return out
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
