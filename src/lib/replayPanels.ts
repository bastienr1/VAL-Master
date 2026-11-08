/**
 * What the Analyst layout's roster reads from a replay frame
 * (docs/plays-editor-v2.md §2.12): who is alive, and who carries the spike.
 *
 * Pure, types only, so `node --test` can type-check it.
 */

import type { AgentElement, PlayStep, Team } from './playDoc.ts'

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
