import type { ReferenceReview } from './types'

/**
 * How a Pro Study review names itself, on the library card and the review
 * page alike. Pure so both surfaces agree and it can be unit-tested.
 *
 * A guide answers "what is this" with its title — a creator alone makes every
 * card from the same channel identical — and a pro VOD with the player.
 */
export function reviewHeading(review: Pick<ReferenceReview, 'source' | 'title' | 'creator' | 'player'>): string {
  if (review.source !== 'vault') return review.player
  return review.title ?? review.creator ?? 'Study guide'
}

/**
 * The creator as a sub-line or chip wants it: vault notes qualify the name in
 * parentheses ("This Valorant Life (coach: Adam — surname not given)"), which
 * would swallow the line, and an unknown creator says nothing worth a slot.
 * The library's Creator filter chip keeps the full value.
 */
export function shortCreator(creator: string | null): string | null {
  if (!creator) return null
  const name = creator.split(' (')[0].trim()
  return name && !/^unknown$/i.test(name) ? name : null
}

/**
 * The Pro Study page for a review, optionally opened at a moment of its video.
 *
 * `?t=` is whole seconds, the shape the review page seeks to once its player is
 * ready. Left off for the very start of the tape, so a link made before anything
 * has played is the plain page.
 */
export function proStudyLink(reviewId: string, seconds?: number | null): string {
  const t = seconds != null && Number.isFinite(seconds) ? Math.floor(seconds) : 0
  return t > 0 ? `/study/${reviewId}?t=${t}` : `/study/${reviewId}`
}

export interface ActionItem {
  text: string
  /** `- [x]` in the note. */
  done: boolean
}

/**
 * The task lines of a guide's Action Items, as the importer stored them.
 *
 * The importer keeps only `- [ ]` / `- [x]` lines, so anything else here would
 * be a hand-edited row; it is skipped rather than shown as an open task.
 */
export function parseActionItems(markdown: string | null | undefined): ActionItem[] {
  if (!markdown) return []
  const items: ActionItem[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/)
    if (task) items.push({ done: task[1] !== ' ', text: task[2] })
  }
  return items
}
