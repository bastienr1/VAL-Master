/**
 * What the Analyst layout's side panels read from a replay frame
 * (docs/plays-editor-v2.md §2.12): who is alive, and the utility up now with
 * how much of its life is left.
 *
 * Pure, types only, so `node --test` can type-check it.
 */

import type { AbilityElement, AgentElement, PlayStep, Team, UtilityKind } from './playDoc.ts'

/** One player of the match, as the roster lists them. */
export interface RosterPlayer {
  subject: string
  /** The id of their agent element in every frame. */
  elementId: string
  agent: string
  team: Team
  /** The Riot name when Henrik has answered. */
  playerName?: string
}

export interface RosterRow extends RosterPlayer {
  alive: boolean
  spike: boolean
}

/** The players with their state in this frame: a player with no agent element is down (or not in the round yet). */
export function rosterOf(players: RosterPlayer[], step: PlayStep | null | undefined): RosterRow[] {
  const agents = new Map(
    (step?.elements ?? []).filter((e): e is AgentElement => e.kind === 'agent').map(e => [e.id, e]),
  )
  return players.map(player => {
    const element = agents.get(player.elementId)
    return { ...player, alive: element !== undefined, spike: element?.spike === true }
  })
}

export interface UtilityRow {
  id: string
  name: string
  agent: string
  shape: UtilityKind
  /** 1…0, how much of its life is left. */
  life: number
}

/** The landed utility of this frame with a known life, the longest left first. In-flight throws and bare cast badges are left out. */
export function utilityUp(step: PlayStep | null | undefined): UtilityRow[] {
  return (step?.elements ?? [])
    .filter((e): e is AbilityElement & { life: number } => e.kind === 'ability' && e.life !== undefined && e.progress === undefined)
    .map(e => ({ id: e.id, name: e.label || e.agent, agent: e.agent, shape: e.shape, life: e.life }))
    .sort((a, b) => b.life - a.life || a.id.localeCompare(b.id))
}
