import { supabase } from './supabase'
import { loadGameContent } from './gameContent'
import type { MatchProReference, ReferenceReview } from './types'

/**
 * Pro references — the pro VODs a user has attached to one of their matches.
 *
 * The junction is `match_pro_references`, keyed by `matches.match_id` (text)
 * rather than the `matches.id` surrogate, matching how the other match-scoped
 * tables address a match.
 *
 * Candidates come from `reference_reviews` **restricted to `source = 'notion'`**.
 * That table now also holds the vault study guides, but those are what the top
 * half of the Study Dock is already for; offering them here would point at the
 * same material twice, and a guide has a creator rather than a player, so it
 * does not fit the row shape either.
 */

/** A pro reference with the review fields the row renders. */
export interface ProReferenceRow extends MatchProReference {
  review: Pick<
    ReferenceReview,
    'id' | 'player' | 'team' | 'agent' | 'map' | 'event' | 'played_at' | 'video_id'
  >
}

/**
 * One marked second of a pro VOD, with everything captured there.
 *
 * Grouped by timestamp rather than listed per row: a moment you tagged
 * `DEFENSE`, `A` and `ATTACK` is one moment described three ways, not three
 * moments. Listing them separately gave three dropdown rows that all seek to the
 * same second and made the real count of marked moments impossible to read.
 *
 * Notes and tags share the grouping for the same reason — a note and the tags
 * dropped alongside it describe the same instant.
 */
export interface ReviewMarker {
  key: string
  seconds: number
  /** Note text captured at this second; usually none or one. */
  notes: string[]
  /** Tag names applied at this second, in the order they were created. */
  tags: string[]
  /** The first tag's colour, for a dot in the row. */
  color: string | null
}

/** "16:14 · Round 1 · DEFENSE, A, ATTACK" — the whole moment on one line. */
export function markerSummary(marker: ReviewMarker): string {
  return [marker.notes.join(' / '), marker.tags.join(', ')].filter(Boolean).join(' · ')
}

/** Trimmed to a dropdown-sized line; the full text lives on the review screen. */
function markerLabel(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine
}

/**
 * Notes and moment tags on one pro VOD, in tape order.
 *
 * Loaded on demand — a review screen with four attached VODs should not fetch
 * four sets of notes nobody has asked to see.
 */
export async function listReviewMarkers(reviewId: string): Promise<ReviewMarker[]> {
  const [notes, tags] = await Promise.all([
    supabase
      .from('reference_notes')
      .select('id, timestamp_seconds, text, category, label')
      .eq('reference_review_id', reviewId),
    supabase
      .from('moment_tags')
      .select('id, video_ts, tag:review_tags(name, color)')
      .eq('review_type', 'reference')
      .eq('review_id', reviewId),
  ])

  if (notes.error) throw new Error(notes.error.message)
  if (tags.error) throw new Error(tags.error.message)

  // One bucket per second, so everything marked at that instant travels together.
  const bySecond = new Map<number, ReviewMarker>()
  const bucket = (seconds: number) => {
    const existing = bySecond.get(seconds)
    if (existing) return existing
    const fresh: ReviewMarker = { key: `t${seconds}`, seconds, notes: [], tags: [], color: null }
    bySecond.set(seconds, fresh)
    return fresh
  }

  for (const n of notes.data ?? []) {
    const text = markerLabel(n.text || n.label || n.category || 'Note')
    if (text) bucket(n.timestamp_seconds).notes.push(text)
  }

  for (const t of tags.data ?? []) {
    const tag = Array.isArray(t.tag) ? t.tag[0] : t.tag
    if (!tag) continue
    const entry = bucket(t.video_ts)
    entry.tags.push(tag.name)
    entry.color ??= tag.color
  }

  return [...bySecond.values()].sort((a, b) => a.seconds - b.seconds)
}

/**
 * Canonical name from the game-content registry, lowercased for comparison.
 *
 * This is load-bearing, not defensive: `reference_reviews` stores Notion's
 * uppercase values (`HAVEN`, `JETT`) and `matches` stores Henrik's title case
 * (`Haven`, `Jett`), so a direct string compare matches **nothing** — measured
 * at 0 of 11 maps and 0 of 10 agents. A name the registry does not know falls
 * back to a lowercased trim, which still beats an exact compare.
 */
async function canonicalKeys(): Promise<(kind: 'map' | 'agent', name: string | null) => string | null> {
  let registry: Awaited<ReturnType<typeof loadGameContent>> | null = null
  try {
    registry = await loadGameContent()
  } catch {
    registry = null // registry unreachable — fall through to the plain compare
  }

  return (kind, name) => {
    if (!name) return null
    const key = name.trim().toLowerCase()
    if (!registry) return key
    const hit =
      kind === 'map' ? registry.maps.byName.get(key) : registry.agents.byName.get(key)
    return (hit?.name ?? name).trim().toLowerCase()
  }
}

/** The pro VODs already attached to this match, newest first. */
export async function listProReferencesForMatch(matchId: string): Promise<ProReferenceRow[]> {
  const { data, error } = await supabase
    .from('match_pro_references')
    .select(
      'id, user_id, match_id, reference_review_id, created_at, review:reference_reviews(id, player, team, agent, map, event, played_at, video_id)',
    )
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // PostgREST types an embedded row as an array; it is one row here.
  return (data ?? []).flatMap(row => {
    const review = Array.isArray(row.review) ? row.review[0] : row.review
    return review ? [{ ...row, review } as ProReferenceRow] : []
  })
}

export interface CandidateGroups {
  /** Same map and same agent as the match. */
  exact: ReferenceReview[]
  /** Same map, a different agent. */
  sameMap: ReferenceReview[]
}

/**
 * Pro VODs worth offering for a match, grouped by how well they fit.
 *
 * One query for the map, split client-side: with ~70 rows across two dozen
 * players an exact map+agent hit is often 0–2 rows, so the second group is what
 * keeps the picker from looking broken.
 */
export async function listCandidateReferences(
  map: string | null,
  agent: string | null,
): Promise<CandidateGroups> {
  if (!map) return { exact: [], sameMap: [] }

  const { data, error } = await supabase
    .from('reference_reviews')
    .select('*')
    .eq('source', 'notion')
    .order('played_at', { ascending: false, nullsFirst: false })
    .order('player', { ascending: true })

  if (error) throw new Error(error.message)

  const canonical = await canonicalKeys()
  const wantMap = canonical('map', map)
  const wantAgent = canonical('agent', agent)

  const onMap = (data ?? []).filter(r => canonical('map', r.map) === wantMap)
  if (!wantAgent) return { exact: [], sameMap: onMap }

  return {
    exact: onMap.filter(r => canonical('agent', r.agent) === wantAgent),
    sameMap: onMap.filter(r => canonical('agent', r.agent) !== wantAgent),
  }
}

/** Postgres unique violation — the (user, match, review) constraint. */
const UNIQUE_VIOLATION = '23505'

/**
 * Attaches a pro VOD to a match.
 *
 * A duplicate is success, not an error: the row the user wanted is already
 * there, and racing two clicks should not produce a red message.
 */
export async function addProReference(
  matchId: string,
  referenceReviewId: string,
): Promise<ProReferenceRow | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(authError.message)
  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase.from('match_pro_references').insert({
    user_id: user.id,
    match_id: matchId,
    reference_review_id: referenceReviewId,
  })

  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message)

  // Re-read rather than returning the insert: the row needs its joined review
  // fields, and the duplicate path has no returned row at all.
  const rows = await listProReferencesForMatch(matchId)
  return rows.find(r => r.reference_review_id === referenceReviewId) ?? null
}

export async function removeProReference(id: string): Promise<void> {
  const { error } = await supabase.from('match_pro_references').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
