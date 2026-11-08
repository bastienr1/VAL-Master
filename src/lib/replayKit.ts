/**
 * What an agent has left at one instant (docs/plays-editor-v2.md §2.15): the
 * charges the replay recorded for each ability and the agent's ultimate points.
 *
 * Pure, so `node --test` can check it.
 */

import type { AbilitySlot, KitSlot } from './playDoc.ts'
import type { ReplayCharges, ReplayKit } from './replayBundle.ts'

/** How long a recharged ability glows. */
export const KIT_GLOW_MS = 1500

const KEYS: readonly { key: 'C' | 'Q' | 'E'; slot: AbilitySlot }[] = [
  { key: 'C', slot: 'Grenade' },
  { key: 'Q', slot: 'Ability1' },
  { key: 'E', slot: 'Ability2' },
]

/** The index of the last row at or before `t`, -1 when none is. */
function lastAt(rows: ReplayCharges, t: number): number {
  let lo = 0
  let hi = rows.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid][0] <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * How bright the glow is at `t`, 1…0: from the latest time the series rose past
 * `threshold`, once the round is live (buying charges is not a recharge).
 */
function glowAt(rows: ReplayCharges, index: number, t: number, liveFrom: number, threshold: number): number {
  for (let i = index; i > 0; i--) {
    const at = rows[i][0]
    if (at <= t - KIT_GLOW_MS || at < liveFrom) return 0
    if (rows[i][1] > rows[i - 1][1] && rows[i][1] >= threshold) return Math.max(0, 1 - (t - at) / KIT_GLOW_MS)
  }
  return 0
}

const maxCache = new WeakMap<ReplayCharges, number>()
function maxOf(rows: ReplayCharges): number {
  let max = maxCache.get(rows)
  if (max === undefined) {
    max = rows.reduce((best, [, n]) => Math.max(best, n), 0)
    maxCache.set(rows, max)
  }
  return max
}

/** An agent's kit at `t`, C Q E X, for the keys the replay has a record of. An ultimate of unknown cost is ready at the most points the agent held. */
export function kitAt(kit: ReplayKit, t: number, liveFrom: number): KitSlot[] {
  const slots: KitSlot[] = []
  for (const { key, slot } of KEYS) {
    const rows = kit[key]
    if (!rows || rows.length === 0) continue
    const i = lastAt(rows, t)
    const n = i >= 0 ? rows[i][1] : 0
    slots.push({ slot, n, max: maxOf(rows), glow: glowAt(rows, i, t, liveFrom, 1) })
  }
  const points = kit.X
  if (points && points.length > 0) {
    const i = lastAt(points, t)
    const cost = kit.cost ?? maxOf(points)
    const ready = i >= 0 && points[i][1] >= cost
    slots.push({ slot: 'Ultimate', n: ready ? 1 : 0, max: 1, glow: glowAt(points, i, t, liveFrom, cost) })
  }
  return slots
}
