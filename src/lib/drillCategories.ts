import type { SavedDrill } from './types.ts'

/**
 * Categories on saved drills — Routing, Peeking, Utility — the first axis the
 * saved-drills page reads by. Pure; `savedDrills.ts` writes the column.
 *
 * The category sits on the save and is the user's own text (Bastien,
 * 2026-10-03). A seed list gets the vocabulary started; after that the picker
 * offers whatever is already in use, and a typed name is matched to an
 * existing one ignoring case so "routing" does not become a second Routing.
 */

/** Drawn from a keyword pass over the 496 drills of 2026-10-03; edit freely. */
export const SEED_CATEGORIES: string[] = [
  'Routing',
  'Peeking',
  'Crosshair placement',
  'Aim',
  'Movement',
  'Utility',
  'Timing',
  'Trading',
  'Positioning',
  'Info and reads',
  'Comms',
  'Economy',
  'Mindset and routine',
]

/** The label (and URL value) for a save with no category. */
export const UNCATEGORISED = 'Uncategorised'

type Categorised = Pick<SavedDrill, 'category'>

const fold = (name: string) => name.trim().toLowerCase()

/** Trimmed, inner whitespace collapsed; null for blank. Case is kept as typed. */
export function normaliseCategory(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ')
  return value === '' ? null : value
}

/** The existing spelling of a category ignoring case, or the name itself when it is new. */
export function matchCategory(name: string, existing: string[]): string {
  const key = fold(name)
  return existing.find(candidate => fold(candidate) === key) ?? name.trim()
}

/** Distinct categories in use, first spelling seen, ignoring case; nulls skipped. */
export function usedCategories(saved: Categorised[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of saved) {
    const name = normaliseCategory(row.category)
    if (!name || seen.has(fold(name))) continue
    seen.add(fold(name))
    out.push(name)
  }
  return out
}

export interface CategoryOption {
  name: string
  /** Saves carrying it. */
  count: number
  seed: boolean
}

/**
 * What the picker offers: the seed list in its order, then categories in use
 * that the list does not know, alphabetically. A used category spelt like a
 * seed one keeps the seed spelling.
 */
export function categoryOptions(saved: Categorised[]): CategoryOption[] {
  const counts = new Map<string, number>()
  for (const row of saved) {
    const name = normaliseCategory(row.category)
    if (name) counts.set(fold(name), (counts.get(fold(name)) ?? 0) + 1)
  }

  const options = SEED_CATEGORIES.map(name => ({ name, count: counts.get(fold(name)) ?? 0, seed: true }))
  const seedKeys = new Set(SEED_CATEGORIES.map(fold))
  const extra = usedCategories(saved)
    .filter(name => !seedKeys.has(fold(name)))
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, count: counts.get(fold(name)) ?? 0, seed: false }))

  return [...options, ...extra]
}

/**
 * Category first: `[name | null, drills]`, fullest category first, ties by
 * name; null (uncategorised) last, and only when present. Drills keep their
 * input order, so a newest-first input stays newest-first.
 */
export function groupByCategory(saved: SavedDrill[]): Array<[string | null, SavedDrill[]]> {
  const buckets = new Map<string, [string, SavedDrill[]]>()
  const none: SavedDrill[] = []
  for (const row of saved) {
    const name = normaliseCategory(row.category)
    if (!name) {
      none.push(row)
      continue
    }
    const entry = buckets.get(fold(name))
    if (entry) entry[1].push(row)
    else buckets.set(fold(name), [name, [row]])
  }

  const groups: Array<[string | null, SavedDrill[]]> = [...buckets.values()].sort(
    ([a, as], [b, bs]) => bs.length - as.length || a.localeCompare(b),
  )
  if (none.length > 0) groups.push([null, none])
  return groups
}

/**
 * `?category=` from the URL → the stored spelling of that category, the
 * `UNCATEGORISED` literal for the no-category chip, or null when the value
 * matches nothing (an unknown value is ignored, as `?agent=` is).
 */
export function resolveCategoryParam(raw: string | null, saved: Categorised[]): string | null {
  const wanted = normaliseCategory(raw)
  if (!wanted) return null
  if (fold(wanted) === fold(UNCATEGORISED)) return UNCATEGORISED
  return usedCategories(saved).find(name => fold(name) === fold(wanted)) ?? null
}

/** Whether a save belongs under a resolved category chip. */
export function inCategory(row: Categorised, category: string): boolean {
  const name = normaliseCategory(row.category)
  if (category === UNCATEGORISED) return name === null
  return name !== null && fold(name) === fold(category)
}
