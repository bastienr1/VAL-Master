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
