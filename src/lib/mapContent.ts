/**
 * Everything the player has for one map, gathered from the three tables that
 * each know a part of it: `playbooks`, `reference_reviews` and `matches`.
 *
 * All three store the map as free text, so matching is by trimmed,
 * case-insensitive name, and a row with no map belongs to no map.
 *
 * Pure and Supabase-free so the grouping can be unit-tested. The queries are in
 * `homeData.ts`.
 */

import type { HomeMatch } from './homeStats.ts'
import type { PlaybookWithCount, ReferenceReview } from './types.ts'

const nameKey = (name: string) => name.trim().toLowerCase()

/** A map as the portal pages need it. `uuid` is null only while the registry is unavailable. */
export interface PortalMap {
  name: string
  uuid: string | null
  /** The game's tall list icon — the portrait crop the map cards are shaped for. */
  listViewIconTall: string | null
  /** The game's wide splash, for the hub header. */
  splash: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Slugs — /maps/<slug>
// ──────────────────────────────────────────────────────────────────────────

/** `Ascent` → `ascent`. */
export function mapSlug(name: string): string {
  return nameKey(name).replace(/\s+/g, '-')
}

/**
 * The part of the game-content registry a slug lookup reads. Spelled out here
 * rather than imported: `gameContent.ts` reaches Supabase, and this file has to
 * load under the Node test runner.
 */
interface MapIndex<M extends { name: string }> {
  maps: { byId: Map<string, M>; byName: Map<string, M> }
}

/** The registry map a slug names, in any letter case, or null. */
export function mapFromSlug<M extends { name: string }>(slug: string, registry: MapIndex<M>): M | null {
  const wanted = mapSlug(slug)
  if (!wanted) return null
  const direct = registry.maps.byName.get(wanted)
  if (direct) return direct
  // A name with a space in it slugs to something byName isn't keyed on.
  for (const map of registry.maps.byId.values()) {
    if (mapSlug(map.name) === wanted) return map
  }
  return null
}

/** Same map, ignoring case and stray whitespace. A missing map matches nothing. */
export function sameMap(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const left = nameKey(a)
  return left !== '' && left === nameKey(b)
}

// ──────────────────────────────────────────────────────────────────────────
// Which shelf a Pro Study row belongs on
// ──────────────────────────────────────────────────────────────────────────

type ReviewKind = Pick<ReferenceReview, 'source' | 'content_type'>

/** A pro match: seeded from Notion, or a vault note filed as a pro review. */
export function isProVod(review: ReviewKind): boolean {
  return review.source === 'notion' || review.content_type === 'pro-review'
}

/** A map-guide video from the vault. Never also a pro VOD. */
export function isMapGuide(review: ReviewKind): boolean {
  return review.source === 'vault' && review.content_type === 'map-guide'
}

// ──────────────────────────────────────────────────────────────────────────
// Grouping
// ──────────────────────────────────────────────────────────────────────────

export interface MapVod {
  match: HomeMatch
  /** The match has a `vod_reviews` row, i.e. a VOD link was attached to it. */
  reviewed: boolean
}

export interface MapContent {
  /** Strategy shelf. */
  playbooks: PlaybookWithCount[]
  /** Video guides shelf. */
  guides: ReferenceReview[]
  proVods: ReferenceReview[]
  /** The player's own matches on the map, reviewed ones first, then newest first. */
  myVods: MapVod[]
  /** What the map card prints. Each equals the cards on the matching shelf or shelves. */
  counts: {
    /** Strategy + Video guides. */
    guides: number
    proVods: number
    myVods: number
  }
}

const countsOf = (content: Omit<MapContent, 'counts'>): MapContent['counts'] => ({
  guides: content.playbooks.length + content.guides.length,
  proVods: content.proVods.length,
  myVods: content.myVods.length,
})

export const EMPTY_MAP_CONTENT: MapContent = {
  playbooks: [],
  guides: [],
  proVods: [],
  myVods: [],
  counts: { guides: 0, proVods: 0, myVods: 0 },
}

export interface MapContentInput {
  playbooks: PlaybookWithCount[]
  reviews: ReferenceReview[]
  matches: HomeMatch[]
  /** `match_id`s that have a `vod_reviews` row. */
  reviewedMatchIds: ReadonlySet<string>
}

/** Per-map content, keyed by lower-cased map name. Read it with `contentForMap`. */
export function groupContentByMap(input: MapContentInput): Map<string, MapContent> {
  const drafts = new Map<string, Omit<MapContent, 'counts'>>()

  const bucket = (map: string | null | undefined) => {
    const key = map ? nameKey(map) : ''
    if (!key) return null // a row with no map lands on no map
    let draft = drafts.get(key)
    if (!draft) {
      draft = { playbooks: [], guides: [], proVods: [], myVods: [] }
      drafts.set(key, draft)
    }
    return draft
  }

  for (const playbook of input.playbooks) bucket(playbook.map)?.playbooks.push(playbook)

  for (const review of input.reviews) {
    const draft = bucket(review.map)
    if (!draft) continue
    if (isProVod(review)) draft.proVods.push(review)
    else if (isMapGuide(review)) draft.guides.push(review)
    // Agent guides, mechanics and mindset notes aren't about a map even when
    // they name one, and stay in Pro Study.
  }

  for (const match of input.matches) {
    bucket(match.map)?.myVods.push({ match, reviewed: input.reviewedMatchIds.has(match.match_id) })
  }

  const grouped = new Map<string, MapContent>()
  for (const [key, draft] of drafts) {
    draft.myVods.sort(
      (a, b) =>
        Number(b.reviewed) - Number(a.reviewed) ||
        new Date(b.match.match_date).getTime() - new Date(a.match.match_date).getTime(),
    )
    grouped.set(key, { ...draft, counts: countsOf(draft) })
  }
  return grouped
}

export function contentForMap(grouped: Map<string, MapContent>, mapName: string): MapContent {
  return grouped.get(nameKey(mapName)) ?? EMPTY_MAP_CONTENT
}

/**
 * How much there is to study on a map: guides, pro VODs and the player's own
 * reviewed matches. Unreviewed matches are left out, so a map played a lot but
 * never studied doesn't outrank one with real material.
 */
export function studyMaterialCount(content: MapContent): number {
  return content.counts.guides + content.counts.proVods + content.myVods.filter(v => v.reviewed).length
}

/** Most study material first, then most played, then by name. */
export function sortMapsForPortal<T extends { name: string }>(maps: T[], grouped: Map<string, MapContent>): T[] {
  return [...maps].sort((a, b) => {
    const left = contentForMap(grouped, a.name)
    const right = contentForMap(grouped, b.name)
    return (
      studyMaterialCount(right) - studyMaterialCount(left) ||
      right.myVods.length - left.myVods.length ||
      a.name.localeCompare(b.name)
    )
  })
}

/**
 * Narrows the two shelves that have an agent — pro VODs and the player's own —
 * so "Raze on Ascent" puts pros playing Raze beside the player's Raze games.
 * Strategy and video guides are about the map and stay as they are.
 */
export function filterContentByAgent(content: MapContent, agent: string | null): MapContent {
  if (!agent) return content
  const wanted = nameKey(agent)
  const narrowed = {
    playbooks: content.playbooks,
    guides: content.guides,
    proVods: content.proVods.filter(r => r.agent != null && nameKey(r.agent) === wanted),
    myVods: content.myVods.filter(v => nameKey(v.match.agent) === wanted),
  }
  return { ...narrowed, counts: countsOf(narrowed) }
}
