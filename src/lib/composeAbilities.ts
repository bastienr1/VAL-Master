/**
 * The abilities list the composer is given (docs/plays-editor-v2.md §5): for
 * every agent of the comp, each of their abilities by slot, with its name and
 * the shape the board draws it as. The model uses only these, so it names real
 * abilities by slot instead of inventing them.
 *
 * Pure: the registry lookup is passed in, so this file has no dependency on
 * gameContent.ts (and Vite) and runs under `node --test`.
 */

import { abilityShape, SLOT_ORDER } from './agentAbilities.ts'
import type { AbilitySlot, UtilityKind } from './playDoc.ts'

export interface ComposeAbility {
  /** The agent as the comp spells it. */
  agent: string
  slot: AbilitySlot
  /** The ability's in-game name ("Dark Cover"). */
  name: string
  shape: UtilityKind
}

/**
 * The comp's abilities, agent by agent in comp order and slot by slot in HUD
 * order (C, Q, E, X). The comp is trimmed and deduped without regard to case;
 * an agent the lookup does not know (null) is skipped, as are abilities with
 * no name, an unknown slot, or a slot already listed for that agent.
 */
export function abilitiesForComp(
  comp: string[],
  byAgent: (name: string) => { slot: AbilitySlot; name: string }[] | null,
): ComposeAbility[] {
  const out: ComposeAbility[] = []
  const seenAgents = new Set<string>()
  for (const entry of comp) {
    const agent = entry.trim()
    const key = agent.toLowerCase()
    if (!agent || seenAgents.has(key)) continue
    seenAgents.add(key)

    const abilities = byAgent(agent)
    if (!abilities) continue
    const bySlot = new Map<AbilitySlot, string>()
    for (const ability of abilities) {
      const name = ability.name.trim()
      if (!name || !SLOT_ORDER.includes(ability.slot) || bySlot.has(ability.slot)) continue
      bySlot.set(ability.slot, name)
    }
    for (const slot of SLOT_ORDER) {
      const name = bySlot.get(slot)
      if (name) out.push({ agent, slot, name, shape: abilityShape(agent, slot).shape })
    }
  }
  return out
}
