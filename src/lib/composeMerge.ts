/**
 * What the composer client does to a composed play after `parsePlayDoc`
 * (docs/plays-editor-v2.md §5): one id per ally agent across the steps, so the
 * canvas can animate them, and the player's own drawing carried over from the
 * play being recomposed.
 *
 * Pure: neither function touches its arguments. Kept apart from
 * composePlay.ts (which needs Supabase) so `node --test` can run it.
 */

import type { PlayDoc, PlayElement, PlayStep } from './playDoc.ts'

/**
 * The play with each ally agent carrying one id in every step: the id of that
 * agent's element in the first step that has it (names matched without regard
 * to case). Enemy agents and every other element keep their ids. In the rare
 * case the shared id is already taken by another element of a step, that
 * step's agent keeps its own id, so ids stay unique within a step.
 */
export function unifyAgentIds(doc: PlayDoc): PlayDoc {
  const idByAgent = new Map<string, string>()
  const steps = doc.steps.map((step): PlayStep => {
    const elements = structuredClone(step.elements)
    for (const el of elements) {
      if (el.kind !== 'agent' || el.team !== 'ally') continue
      const key = el.agent.toLowerCase()
      const shared = idByAgent.get(key)
      if (shared === undefined) {
        idByAgent.set(key, el.id)
      } else if (shared !== el.id && !elements.some(other => other !== el && other.id === shared)) {
        el.id = shared
      }
    }
    return { ...step, elements }
  })
  return { ...doc, steps }
}

/** The elements of a previous step the composer cannot produce or may drop: the player's drawing and enemy agents. */
function isKept(el: PlayElement): boolean {
  return el.kind === 'pen' || el.kind === 'arrow' || el.kind === 'text' || (el.kind === 'agent' && el.team === 'enemy')
}

/**
 * The composed play with, in each step whose id matches a step of `previous`,
 * that previous step's pen strokes, arrows, text and enemy agents appended
 * (copies, ids kept), skipping any whose id the step already has. A step with
 * no match (new, or renamed by the composer) gets nothing.
 */
export function mergeKeptElements(result: PlayDoc, previous: PlayDoc): PlayDoc {
  const previousById = new Map(previous.steps.map(step => [step.id, step]))
  const steps = result.steps.map((step): PlayStep => {
    const before = previousById.get(step.id)
    if (!before) return step
    const ids = new Set(step.elements.map(el => el.id))
    const kept: PlayElement[] = []
    for (const el of before.elements) {
      if (!isKept(el) || ids.has(el.id)) continue
      ids.add(el.id)
      kept.push(structuredClone(el))
    }
    return kept.length > 0 ? { ...step, elements: [...step.elements, ...kept] } : step
  })
  return { ...result, steps }
}
