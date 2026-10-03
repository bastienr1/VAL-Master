import {
  SKILLS,
  SKILL_GROUPS,
  SKILL_GROUP_LABELS,
  skillDef,
  skillLabel,
  skillOrder,
  type SkillGroup,
} from './skillTaxonomy.ts'
import type { GuideCounts, ReferenceReview } from './types.ts'

/**
 * The Pro Study library as shelves: series → skill → video, or any of the other
 * groupings the page offers. Pure — takes the rows the page already loaded and
 * returns a tree; the page only renders it.
 *
 * Mirrors the vault's two coaching MOCs, which group a playlist by the one
 * skill each video trains, so the app and the MOC can be checked against each
 * other. Every review lands in exactly one block whatever the grouping, so the
 * total never changes when the switch does.
 */

export type GroupBy = 'series' | 'skill' | 'map' | 'date'

export const GROUP_BY_OPTIONS: GroupBy[] = ['series', 'skill', 'map', 'date']

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  series: 'Series',
  skill: 'Skill',
  map: 'Map',
  date: 'Date added',
}

export interface ShelfStats {
  videos: number
  durationSeconds: number
  drills: number
}

export interface ShelfSection {
  key: string
  /** Null → the reviews render without a section heading. */
  title: string | null
  reviews: ReferenceReview[]
}

export interface ShelfBlock {
  /** Stable across loads — the open/closed memory is keyed on it. */
  key: string
  title: string
  stats: ShelfStats
  sections: ShelfSection[]
}

const NO_MAP = 'No map'
const UNSORTED = 'Unsorted'

// ---------------------------------------------------------------------- order

/**
 * Reading order inside a series: oldest upload first.
 *
 * Both coaching playlists run newest-first, so a note without `published`
 * falls back to its playlist position *descending*; a note with neither sorts
 * by title. Decision 4 of 2026-10-03: a coaching series that builds week on
 * week reads better from episode one.
 */
export function readingOrder(a: ReferenceReview, b: ReferenceReview): number {
  const pa = a.published ?? null
  const pb = b.published ?? null
  if (pa && pb && pa !== pb) return pa < pb ? -1 : 1
  if (pa && !pb) return -1
  if (!pa && pb) return 1

  const ia = a.playlist_index ?? null
  const ib = b.playlist_index ?? null
  if (ia !== null && ib !== null && ia !== ib) return ib - ia
  if (ia !== null && ib === null) return -1
  if (ia === null && ib !== null) return 1

  return (a.title ?? '').localeCompare(b.title ?? '')
}

/** "8h 32m", "47m", or "" for nothing — a header slot that is better empty than "0m". */
export function formatDuration(seconds: number): string {
  // Rounded to minutes first, so 59m 40s is "1h" rather than "60m".
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return minutes > 0 ? `${minutes}m` : ''
}

// -------------------------------------------------------------------- helpers

function isMapGuide(review: ReferenceReview): boolean {
  return review.source === 'vault' && review.content_type === 'map-guide'
}

/** Insertion-ordered buckets, so a caller sorting the input sorts the buckets. */
function bucket<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const existing = out.get(key)
    if (existing) existing.push(item)
    else out.set(key, [item])
  }
  return out
}

function statsOf(reviews: ReferenceReview[], counts: Map<string, GuideCounts>): ShelfStats {
  return reviews.reduce<ShelfStats>(
    (acc, review) => ({
      videos: acc.videos + 1,
      durationSeconds: acc.durationSeconds + (review.duration_seconds ?? 0),
      drills: acc.drills + (counts.get(review.id)?.drills ?? 0),
    }),
    { videos: 0, durationSeconds: 0, drills: 0 },
  )
}

function block(
  key: string,
  title: string,
  sections: ShelfSection[],
  counts: Map<string, GuideCounts>,
): ShelfBlock | null {
  const kept = sections.filter(section => section.reviews.length > 0)
  if (kept.length === 0) return null
  const reviews = kept.flatMap(section => section.reviews)
  return { key, title, stats: statsOf(reviews, counts), sections: kept }
}

/** A block with no headings inside — one grid. */
function flatBlock(
  key: string,
  title: string,
  reviews: ReferenceReview[],
  counts: Map<string, GuideCounts>,
): ShelfBlock | null {
  return block(key, title, [{ key, title: null, reviews }], counts)
}

/**
 * The skill sections of one series: group order first (Mechanics before Game
 * sense), then the fuller section, then label; a review with no skill or one
 * the list does not know lands in a last `Unsorted` section so nothing is lost.
 */
function skillSections(reviews: ReferenceReview[], keyPrefix: string): ShelfSection[] {
  const known = bucket(
    reviews.filter(review => skillDef(review.skill)),
    review => skillDef(review.skill)!.value,
  )
  const unsorted = reviews.filter(review => !skillDef(review.skill))

  const groupRank = (group: SkillGroup) => SKILL_GROUPS.indexOf(group)
  const sections = [...known.entries()]
    .map(([value, items]) => ({ def: skillDef(value)!, items }))
    .sort(
      (a, b) =>
        groupRank(a.def.group) - groupRank(b.def.group) ||
        b.items.length - a.items.length ||
        a.def.label.localeCompare(b.def.label),
    )
    .map(({ def, items }) => ({
      key: `${keyPrefix}:${def.value}`,
      title: def.label,
      reviews: [...items].sort(readingOrder),
    }))

  if (unsorted.length > 0) {
    sections.push({ key: `${keyPrefix}:unsorted`, title: UNSORTED, reviews: [...unsorted].sort(readingOrder) })
  }
  return sections
}

/** One section per map, fullest first, `No map` last. Reviews keep their input (newest-first) order. */
function mapSections(reviews: ReferenceReview[], keyPrefix: string): ShelfSection[] {
  return [...bucket(reviews, review => review.map ?? NO_MAP).entries()]
    .sort(([a, as], [b, bs]) => {
      if (a === NO_MAP) return 1
      if (b === NO_MAP) return -1
      return bs.length - as.length || a.localeCompare(b)
    })
    .map(([map, items]) => ({ key: `${keyPrefix}:${map}`, title: map, reviews: items }))
}

// ---------------------------------------------------------------------- build

/**
 * Null for `date`: that is today's flat grid and the page renders it as is.
 *
 * Reviews arrive in `listReviews` order (newest first), which the untitled
 * sections keep; only series and skill sections re-sort into reading order.
 */
export function buildShelves(
  reviews: ReferenceReview[],
  counts: Map<string, GuideCounts>,
  groupBy: GroupBy,
): ShelfBlock[] | null {
  if (groupBy === 'date') return null

  const guides = reviews.filter(review => review.source === 'vault')
  const proVods = reviews.filter(review => review.source !== 'vault')
  const mapGuides = guides.filter(isMapGuide)
  const shelved = guides.filter(review => !isMapGuide(review))

  const tail = (extra: Array<ShelfBlock | null>) =>
    [
      block('map-playbooks', 'Map playbooks', mapSections(mapGuides, 'map-playbooks'), counts),
      ...extra,
      flatBlock('pro-vods', 'Pro VODs', proVods, counts),
    ].filter((b): b is ShelfBlock => b !== null)

  if (groupBy === 'series') {
    const inSeries = shelved.filter(review => !!review.series)
    const standalone = shelved.filter(review => !review.series)

    const seriesBlocks = [...bucket(inSeries, review => review.series!).entries()]
      .sort(([a, as], [b, bs]) => bs.length - as.length || a.localeCompare(b))
      .map(([series, items]) => block(`series:${series}`, series, skillSections(items, `series:${series}`), counts))

    return [
      ...seriesBlocks.filter((b): b is ShelfBlock => b !== null),
      ...tail([
        block('standalone', 'Standalone', [{ key: 'standalone', title: null, reviews: [...standalone].sort(readingOrder) }], counts),
      ]),
    ]
  }

  if (groupBy === 'skill') {
    const bySeriesThenReading = (a: ReferenceReview, b: ReferenceReview) => {
      const sa = a.series ?? null
      const sb = b.series ?? null
      if (sa && sb && sa !== sb) return sa.localeCompare(sb)
      if (sa && !sb) return -1
      if (!sa && sb) return 1
      return readingOrder(a, b)
    }

    const groupBlocks = SKILL_GROUPS.map(group =>
      block(
        `group:${group}`,
        SKILL_GROUP_LABELS[group],
        SKILLS.filter(skill => skill.group === group).map(skill => ({
          key: `group:${group}:${skill.value}`,
          title: skill.label,
          reviews: shelved
            .filter(review => skillDef(review.skill)?.value === skill.value)
            .sort(bySeriesThenReading),
        })),
        counts,
      ),
    )

    const unsorted = shelved.filter(review => !skillDef(review.skill))
    // A value the list does not know gets its own line so the typo is visible.
    const unsortedSections = [...bucket(unsorted, review => skillLabel(review.skill)).entries()]
      .sort(([a], [b]) => skillOrder(a) - skillOrder(b) || a.localeCompare(b))
      .map(([label, items]) => ({ key: `unsorted:${label}`, title: label, reviews: [...items].sort(readingOrder) }))

    return [
      ...groupBlocks.filter((b): b is ShelfBlock => b !== null),
      ...tail([block('unsorted', UNSORTED, unsortedSections, counts)]),
    ]
  }

  // map: every source, fullest map first, `No map` last.
  return mapSections(reviews, 'map')
    .map(section => flatBlock(`map:${section.title}`, section.title!, section.reviews, counts))
    .filter((b): b is ShelfBlock => b !== null)
}
