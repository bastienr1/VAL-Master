/**
 * Line-ups in the Strategizer (docs/plays-editor-v2.md §2.32): which of the
 * user's line-ups fit a strat, and what adding one does to a step. Pure, so
 * `node --test` runs it; the rows come from `lineups.ts`.
 */

import { lineupElement, type Lineup, type LineupPurpose } from './lineupModel.ts'
import type { AbilityElement, AgentElement, PlayStep } from './playDoc.ts'
import type { PlaySide } from './types.ts'

/** A strat holds at most this many allies: the comp. */
export const MAX_COMP = 5

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The strat a line-up is picked for: its map (by Riot id when both have one) and side. */
export interface LineupFor {
  map: string
  mapUuid: string | null
  side: PlaySide
}

/** Is `lineup` on the strat's map? By Riot id when both carry one, else by name. */
export function onMap(lineup: Pick<Lineup, 'map' | 'map_uuid'>, at: Pick<LineupFor, 'map' | 'mapUuid'>): boolean {
  if (lineup.map_uuid && at.mapUuid) return lineup.map_uuid.toLowerCase() === at.mapUuid.toLowerCase()
  return same(lineup.map, at.map)
}

/**
 * The line-ups for a strat: same map and side, of the purpose picked (null
 * for all). The comp's agents come first, in the comp's order, then the
 * others by name; within an agent, by title.
 */
export function lineupsForStrat<T extends Pick<Lineup, 'map' | 'map_uuid' | 'side' | 'agent' | 'title' | 'purpose'>>(
  rows: readonly T[],
  at: LineupFor,
  comp: readonly string[],
  purpose: LineupPurpose | null = null,
): T[] {
  const rank = (agent: string) => {
    const i = comp.findIndex(name => same(name, agent))
    return i === -1 ? comp.length : i
  }
  return rows
    .filter(row => row.side === at.side && onMap(row, at) && (purpose === null || row.purpose === purpose))
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent) || a.title.localeCompare(b.title))
}

/** The purposes the strat's line-ups carry, in the library's order, with how many. */
export function purposesOf(rows: ReadonlyArray<Pick<Lineup, 'purpose'>>, order: readonly LineupPurpose[]): { purpose: LineupPurpose; count: number }[] {
  return order.map(purpose => ({ purpose, count: rows.filter(row => row.purpose === purpose).length })).filter(p => p.count > 0)
}

/** What adding a line-up did. */
export interface PlacedLineup {
  step: PlayStep
  comp: string[]
  /** The ability drawn, with its new id. */
  ability: AbilityElement
  /** The ally sent to where they stand: one already there, one added, or none (the comp was full). */
  agent: 'moved' | 'added' | null
}

/**
 * Adds `lineup` to `step` as a thrown ability (a copy, linked back by
 * `lineup`), and sends that agent's ally to where they stand: the one already
 * on the step is moved there (their move arrow kept), or one is added when
 * the agent is in the comp or the comp has room.
 */
export function placeLineup(
  step: PlayStep,
  comp: readonly string[],
  lineup: Lineup,
  ids: { ability: string; agent: string },
): PlacedLineup {
  const ability: AbilityElement = { ...lineupElement(lineup), id: ids.ability, lineup: lineup.id }
  const stand = { u: lineup.stand.u, v: lineup.stand.v }
  const ally = step.elements.find((e): e is AgentElement => e.kind === 'agent' && e.team === 'ally' && same(e.agent, lineup.agent))
  const compName = comp.find(name => same(name, lineup.agent))

  if (ally) {
    const elements = step.elements.map(e => (e.id === ally.id ? { ...ally, at: stand } : e))
    return { step: { ...step, elements: [...elements, ability] }, comp: [...comp], ability, agent: 'moved' }
  }
  if (!compName && comp.length >= MAX_COMP) {
    return { step: { ...step, elements: [...step.elements, ability] }, comp: [...comp], ability, agent: null }
  }
  const agent: AgentElement = { kind: 'agent', id: ids.agent, agent: compName ?? lineup.agent, team: 'ally', at: stand }
  return {
    step: { ...step, elements: [...step.elements, agent, ability] },
    comp: compName ? [...comp] : [...comp, lineup.agent],
    ability,
    agent: 'added',
  }
}

/** How many of each line-up are on the step, by line-up id. */
export function lineupCounts(step: PlayStep | null): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of step?.elements ?? []) if (e.kind === 'ability' && e.lineup) counts.set(e.lineup, (counts.get(e.lineup) ?? 0) + 1)
  return counts
}
