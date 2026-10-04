import { isProVod, isVideoGuide } from './mapContent.ts'
import type { ReferenceReview } from './types.ts'

/**
 * What the IMPROVE hub (`/improve`) puts on its rows. Pure: the page reads the
 * shared caches and hands the arrays in.
 *
 * Each row is a preview of the page behind it: a carousel of the newest few,
 * with a link to the full page. Guides and pro VODs are split the way the Map Hub splits them.
 */

/** Cards a row shows at once on a wide screen. */
export const HUB_ROW = 4
/** Cards a row holds in all: three screens of the carousel. */
export const HUB_MAX = 12

/** Newest first by updated_at, then name; at most HUB_MAX. */
export function pickPlaybooks<T extends { updated_at?: string | null; name: string }>(all: T[]): T[] {
  return [...all]
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.name.localeCompare(b.name))
    .slice(0, HUB_MAX)
}

/**
 * Newest first by `played_at` — the date `listReviews` orders by: a vault
 * note's own date, or a Notion row's match date. Rows without one sort last,
 * by player then title, so the tail does not shuffle between loads.
 */
function newestFirst(a: ReferenceReview, b: ReferenceReview): number {
  const da = a.played_at ?? null
  const db = b.played_at ?? null
  if (da && db && da !== db) return da < db ? 1 : -1
  if (da && !db) return -1
  if (!da && db) return 1
  return a.player.localeCompare(b.player) || (a.title ?? '').localeCompare(b.title ?? '')
}

/** Video guides (isVideoGuide), newest first, at most HUB_MAX. */
export function pickGuides(reviews: ReferenceReview[]): ReferenceReview[] {
  return reviews.filter(isVideoGuide).sort(newestFirst).slice(0, HUB_MAX)
}

/** Pro VODs (isProVod), newest first, at most HUB_MAX. */
export function pickProVods(reviews: ReferenceReview[]): ReferenceReview[] {
  return reviews.filter(isProVod).sort(newestFirst).slice(0, HUB_MAX)
}

export type BlockIcon = 'crosshair' | 'skull' | 'bars' | 'rank' | 'play' | 'target'

// First match wins, so "Range warm-up" is the range and not something later.
// `dm` and `comp` are whole words: "admin" is not a deathmatch.
const BLOCK_ICONS: Array<[RegExp, BlockIcon]> = [
  [/range|warm/, 'crosshair'],
  [/deathmatch|\bdm\b/, 'skull'],
  [/aim/, 'bars'],
  [/ranked|\bcomp/, 'rank'],
  [/vod|review/, 'play'],
]

/** Icon name for a routine block from its name; 'target' when nothing matches. */
export function blockIcon(name: string): BlockIcon {
  const lower = name.toLowerCase()
  return BLOCK_ICONS.find(([pattern]) => pattern.test(lower))?.[1] ?? 'target'
}

/** The 16:9 thumbnail YouTube keeps for every video, or null without an id. */
export function youtubeThumbnail(videoId: string | null | undefined): string | null {
  const id = videoId?.trim()
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
}

/** A card's sub-line: the parts that exist, joined with ' · '. */
export function metaLine(parts: Array<string | null | undefined>): string {
  return parts
    .map(part => part?.trim() ?? '')
    .filter(part => part !== '')
    .join(' · ')
}
