import { sameMap } from './mapContent.ts'
import { skillDef, skillLabel } from './skillTaxonomy.ts'
import type { ReferenceReview, SavedDrill, SavedDrillScope } from './types.ts'

/**
 * Where a drill saved from a guide is filed, and how saved drills are read
 * back. Pure: the Supabase side is `savedDrills.ts`.
 *
 * The default follows the video's context (Bastien, 2026-10-03): a guide about
 * one map files its drills under that map, otherwise under its one agent, then
 * its skill. When none of those is single, nothing is assumed and the picker
 * opens. The picker can move a save anywhere afterwards.
 */

type ScopeSource = Pick<ReferenceReview, 'map' | 'maps' | 'agent' | 'agents' | 'skill'>

/** Trimmed, blanks dropped, duplicates removed ignoring case (first spelling kept). */
function cleanList(values: Array<string | null | undefined> | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values ?? []) {
    const value = (raw ?? '').trim()
    const key = value.toLowerCase()
    if (value === '' || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** `maps` when it has entries, else the single `map`. */
function mapsOf(review: ScopeSource): string[] {
  const many = cleanList(review.maps)
  return many.length > 0 ? many : cleanList([review.map])
}

function agentsOf(review: ScopeSource): string[] {
  const many = cleanList(review.agents)
  return many.length > 0 ? many : cleanList([review.agent])
}

function soleAgent(review: ScopeSource): string | null {
  const agents = agentsOf(review)
  return agents.length === 1 ? agents[0] : null
}

function knownSkill(review: ScopeSource): string | null {
  return skillDef(review.skill)?.value ?? null
}

/**
 * The place a drill from this guide is saved to by default, or null when the
 * guide gives no single answer and the user has to pick.
 */
export function defaultScope(review: ScopeSource): SavedDrillScope | null {
  const maps = mapsOf(review)
  if (maps.length === 1) return { type: 'map', value: maps[0], agent: soleAgent(review) }

  const agents = agentsOf(review)
  if (agents.length === 1) return { type: 'agent', value: agents[0], agent: null }

  const skill = knownSkill(review)
  if (skill) return { type: 'concept', value: skill, agent: null }

  return null
}

/**
 * Everything the picker offers, in order: the guide's maps, its agents, its
 * skill, then the rest of the map pool. Every map option carries the guide's
 * sole agent, as the default does, so moving a save between maps keeps the
 * agent chip working.
 */
export function scopeOptions(review: ScopeSource, poolMaps: string[]): SavedDrillScope[] {
  const agent = soleAgent(review)
  const options: SavedDrillScope[] = []
  const push = (option: SavedDrillScope) => {
    if (!options.some(existing => sameScope(existing, option))) options.push(option)
  }

  for (const map of mapsOf(review)) push({ type: 'map', value: map, agent })
  for (const name of agentsOf(review)) push({ type: 'agent', value: name, agent: null })
  const skill = knownSkill(review)
  if (skill) push({ type: 'concept', value: skill, agent: null })
  for (const map of cleanList(poolMaps)) push({ type: 'map', value: map, agent })

  return options
}

/** The map or agent name as is; a skill by its label. */
export function scopeLabel(scope: Pick<SavedDrillScope, 'type' | 'value'>): string {
  return scope.type === 'concept' ? skillLabel(scope.value) : scope.value
}

export function sameScope(
  a: Pick<SavedDrillScope, 'type' | 'value'>,
  b: Pick<SavedDrillScope, 'type' | 'value'>,
): boolean {
  return a.type === b.type && a.value.trim().toLowerCase() === b.value.trim().toLowerCase()
}

function newestFirst(a: SavedDrill, b: SavedDrill): number {
  return b.created_at.localeCompare(a.created_at)
}

/**
 * The Map Hub shelf: saves filed under this map, newest first. With an agent
 * chip on, saves made with no agent stay — they are about the map, not an
 * agent — and only saves tagged with a different agent drop out.
 */
export function drillsForMap(saved: SavedDrill[], mapName: string, agent: string | null): SavedDrill[] {
  const wanted = agent?.trim().toLowerCase() ?? null
  return saved
    .filter(row => row.scope_type === 'map' && sameMap(row.scope_value, mapName))
    .filter(row => wanted === null || row.agent === null || row.agent.trim().toLowerCase() === wanted)
    .sort(newestFirst)
}

export type GroupedSaved = Record<SavedDrill['scope_type'], Array<[string, SavedDrill[]]>>

/**
 * Every save by place, for the all-saved-drills page: values sorted by name
 * (a skill by its label), drills newest first inside each.
 */
export function groupSaved(saved: SavedDrill[]): GroupedSaved {
  const groups: GroupedSaved = { map: [], agent: [], concept: [] }

  for (const type of ['map', 'agent', 'concept'] as const) {
    const byValue = new Map<string, [string, SavedDrill[]]>()
    for (const row of saved) {
      if (row.scope_type !== type) continue
      const key = row.scope_value.trim().toLowerCase()
      const entry = byValue.get(key)
      if (entry) entry[1].push(row)
      else byValue.set(key, [row.scope_value.trim(), [row]])
    }
    groups[type] = [...byValue.values()]
      .map(([value, rows]): [string, SavedDrill[]] => [value, rows.sort(newestFirst)])
      .sort(([a], [b]) => scopeLabel({ type, value: a }).localeCompare(scopeLabel({ type, value: b })))
  }

  return groups
}

/**
 * True when the live drill's title no longer matches the copy taken at save
 * time — the note was edited or its rows reordered. The card says so rather
 * than updating itself.
 */
export function snapshotChanged(saved: Pick<SavedDrill, 'title'>, liveTitle: string | null): boolean {
  if (liveTitle === null) return false
  const live = liveTitle.trim()
  return live !== '' && live !== saved.title.trim()
}
