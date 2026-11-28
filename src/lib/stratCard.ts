// Strat cards (docs/plays-editor-v2.md §2.30): what makes a play a card to
// recall — the situations it answers (tags), the pattern that should bring it
// to mind ("When you see…"), and what a teammate tends to do (the read).
// Pure: the editor writes it into the play document, the Plays index filters on it.

export interface StratCard {
  /** The situations, as the user names them ("Retake", "A execute"). Unique, ignoring case. */
  tags: string[]
  /** "When you see…": the pattern in a round that should bring this strat to mind. */
  when: string
  /** What a teammate tends to do here, learnt from the round it was made from. */
  read: string
}

export const TAG_MAX = 8
export const TAG_LENGTH = 32
export const WHEN_MAX = 200
export const READ_MAX = 500

/** Offered after the user's own tags while they have few: the usual situations of a round. */
export const STARTER_TAGS = ['Default', 'Execute', 'Retake', 'Post-plant', 'Mid control', 'Lurk', 'Eco', 'Anti-eco'] as const

export const EMPTY_CARD: StratCard = { tags: [], when: '', read: '' }

/** One tag as typed: spaces collapsed, trimmed, cut to its length. '' when nothing is left. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, TAG_LENGTH).trim()
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** `tags` with `raw` added at the end, unless it is empty, already there (ignoring case) or the card is full. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw)
  if (!tag || tags.length >= TAG_MAX || tags.some(t => sameTag(t, tag))) return tags
  return [...tags, tag]
}

export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter(t => !sameTag(t, tag))
}

/** A card with nothing on it is no card. */
export function isEmptyCard(card: StratCard): boolean {
  return card.tags.length === 0 && !card.when.trim() && !card.read.trim()
}

/** A stored `card`: its sound parts, or null when it holds nothing. Never throws. */
export function parseStratCard(raw: unknown): StratCard | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  let tags: string[] = []
  if (Array.isArray(r.tags)) for (const t of r.tags) if (typeof t === 'string') tags = addTag(tags, t)
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const card: StratCard = { tags, when: text(r.when, WHEN_MAX), read: text(r.read, READ_MAX) }
  return isEmptyCard(card) ? null : card
}

/** Every tag in use, with how many plays carry it: most used first, then by name. Spelling of the first seen. */
export function tagCounts(cards: (StratCard | null)[]): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>()
  for (const card of cards) {
    for (const tag of card?.tags ?? []) {
      const key = tag.toLowerCase()
      const hit = byKey.get(key)
      if (hit) hit.count += 1
      else byKey.set(key, { tag, count: 1 })
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * What to offer while typing a tag: the user's own tags (most used first),
 * then the starter tags, those that contain what is typed, without the ones
 * already on the card. At most `limit`.
 */
export function tagSuggestions(pool: string[], typed: string, current: string[], limit = 6): string[] {
  const query = normalizeTag(typed).toLowerCase()
  const out: string[] = []
  for (const tag of [...pool, ...STARTER_TAGS]) {
    if (out.length >= limit) break
    if (current.some(t => sameTag(t, tag)) || out.some(t => sameTag(t, tag))) continue
    if (query && !tag.toLowerCase().includes(query)) continue
    out.push(tag)
  }
  return out
}

/** Whether a card carries every one of `tags` (ignoring case). No tags asked: every card, even none. */
export function hasTags(card: StratCard | null, tags: string[]): boolean {
  return tags.every(tag => (card?.tags ?? []).some(t => sameTag(t, tag)))
}
