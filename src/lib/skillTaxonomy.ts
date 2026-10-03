/**
 * The agreed list of skills a study guide can train, and the group each sits in.
 *
 * One source of truth for the importer (which stores the group and warns on a
 * value it does not know), the Pro Study library (which shelves by it) and the
 * tests. The two vault skills that write the notes carry a copy of the values.
 * Decided 2026-10-03: two groups rather than one flat list, and one skill per
 * note. Moving a skill between groups is a one-line edit here.
 */

export type SkillGroup = 'mechanics' | 'game-sense'

export interface SkillDef {
  /** The `skill:` value as written in frontmatter. */
  value: string
  /** What the app shows. */
  label: string
  group: SkillGroup
}

/** In display order: Mechanics block first, then Game sense. */
export const SKILL_GROUPS: SkillGroup[] = ['mechanics', 'game-sense']

export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = {
  mechanics: 'Mechanics',
  'game-sense': 'Game sense',
}

/** In display order within a group. */
export const SKILLS: SkillDef[] = [
  { value: 'aim', label: 'Aim', group: 'mechanics' },
  { value: 'crosshair-placement', label: 'Crosshair placement', group: 'mechanics' },
  { value: 'peeking', label: 'Peeking', group: 'mechanics' },
  { value: 'movement', label: 'Movement', group: 'mechanics' },
  { value: 'angle-holding', label: 'Angle holding', group: 'mechanics' },
  // P1a: zasko III's bucket is how to practise aim and when to stop rushing shots.
  { value: 'mindset-practice', label: 'Mindset and practice', group: 'mechanics' },
  { value: 'entry', label: 'Entry and site hits', group: 'game-sense' },
  { value: 'pacing', label: 'Pacing and timing', group: 'game-sense' },
  // P1b: from the mechanics playlist, but about fight-taking and team play.
  { value: 'decision-making', label: 'Decision-making', group: 'game-sense' },
  { value: 'utility', label: 'Utility and smokes', group: 'game-sense' },
  { value: 'role', label: 'Agent choice and role', group: 'game-sense' },
  { value: 'reading-the-enemy', label: 'Reading the enemy', group: 'game-sense' },
  { value: 'map-knowledge', label: 'Map knowledge', group: 'game-sense' },
]

const BY_VALUE = new Map(SKILLS.map(skill => [skill.value, skill]))

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** The definition behind a frontmatter value, or null for one the list does not know. */
export function skillDef(value: string | null | undefined): SkillDef | null {
  return BY_VALUE.get(normalise(value)) ?? null
}

/**
 * What to print for a skill value: its label, the raw value when the list does
 * not know it (so a typo is visible rather than hidden), or `Unsorted` for none.
 */
export function skillLabel(value: string | null | undefined): string {
  const def = skillDef(value)
  if (def) return def.label
  const raw = (value ?? '').trim()
  return raw === '' ? 'Unsorted' : raw
}

export function skillGroupFor(value: string | null | undefined): SkillGroup | null {
  return skillDef(value)?.group ?? null
}

/** Position in `SKILLS`, with unknown values after every known one. */
export function skillOrder(value: string | null | undefined): number {
  const index = SKILLS.findIndex(skill => skill.value === normalise(value))
  return index === -1 ? SKILLS.length : index
}
