import { supabase } from './supabase'
import type {
  DrillWithProgress,
  GuideContentType,
  PracticeDrill,
  PracticeLog,
  PracticeOutcome,
  ReferenceNote,
  ReferenceNoteInput,
  ReferenceReview,
  ReferenceSection,
  ReviewSource,
  ReviewWithGuide,
} from './types'

/**
 * Pro Study data layer.
 *
 * Reference reviews are read-only here, from either of two capture surfaces: pro
 * VODs seeded from Notion (`scripts/seedProStudy.ts`) and study guides imported
 * from the Obsidian vault (`scripts/importVodLibrary.ts`). The notes on top of
 * them are the user's own, and — with drill status and practice logs — the only
 * thing the app writes.
 *
 * No `user_id` filter: these tables carry no RLS and no owner column, matching
 * the other seeded content tables. Revisit at Phase 2 auth.
 */

export interface ListReviewsOptions {
  source?: ReviewSource
  contentType?: GuideContentType
}

/**
 * Newest first; rows with no date sort last.
 *
 * Most Notion rows carry no Date (5 of 70 at first seed), so the tail of the
 * list is really ordered by player — without that secondary key the bulk of the
 * library would shuffle between loads. Vault guides all carry their note's date.
 *
 * The filters exist for callers that want a single source; the library screen
 * loads everything once and filters the array, since the whole table is a few
 * dozen rows.
 */
export async function listReviews(options: ListReviewsOptions = {}): Promise<ReferenceReview[]> {
  let query = supabase.from('reference_reviews').select('*')

  if (options.source) query = query.eq('source', options.source)
  if (options.contentType) query = query.eq('content_type', options.contentType)

  const { data, error } = await query
    .order('played_at', { ascending: false, nullsFirst: false })
    .order('player', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** One review, or null when the id does not exist. */
export async function getReview(id: string): Promise<ReferenceReview | null> {
  const { data, error } = await supabase
    .from('reference_reviews')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ?? null
}

/** Chapters of a study guide, in tape order. */
export async function getSections(reviewId: string): Promise<ReferenceSection[]> {
  const { data, error } = await supabase
    .from('reference_sections')
    .select('*')
    .eq('reference_review_id', reviewId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Drills of a study guide, in note order.
 *
 * `dropped` rows are included: a drill can only be dropped by disappearing from
 * the note, and one the user has logged against is still part of their history.
 * The panel is free to fold them away.
 */
export async function getDrills(reviewId: string): Promise<PracticeDrill[]> {
  const { data, error } = await supabase
    .from('practice_drills')
    .select('*')
    .eq('reference_review_id', reviewId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** Attaches log counts to drills — one query covering every drill's logs. */
async function withProgress(drills: PracticeDrill[]): Promise<DrillWithProgress[]> {
  if (drills.length === 0) return []

  const { data, error } = await supabase
    .from('practice_logs')
    .select('drill_id, outcome, logged_at')
    .in(
      'drill_id',
      drills.map(drill => drill.id),
    )
    .order('logged_at', { ascending: false })

  if (error) throw new Error(error.message)

  type LogRow = Pick<PracticeLog, 'drill_id' | 'outcome' | 'logged_at'>
  const byDrill = new Map<string, LogRow[]>()
  for (const log of (data ?? []) as LogRow[]) {
    const bucket = byDrill.get(log.drill_id)
    if (bucket) bucket.push(log)
    else byDrill.set(log.drill_id, [log])
  }

  return drills.map(drill => {
    const logs = byDrill.get(drill.id) ?? []
    const counted = (outcome: PracticeOutcome) => logs.filter(log => log.outcome === outcome).length

    return {
      ...drill,
      log_count: logs.length,
      hit_count: counted('hit'),
      partial_count: counted('partial'),
      // Ordered by date descending above, so the first row is the latest.
      last_outcome: logs[0]?.outcome ?? null,
      last_logged_at: logs[0]?.logged_at ?? null,
    }
  })
}

/**
 * A review plus its chapters and drills, with each drill's logs rolled up.
 *
 * Four queries flat — review, sections, drills, then every log for those drills
 * in one `in(...)` — rather than a log query per drill. The roll-up happens here
 * rather than in a Postgres view because this project applies migrations by
 * hand; a view would be one more thing to keep in step with the SQL file.
 */
export async function getReviewWithGuide(id: string): Promise<ReviewWithGuide | null> {
  const review = await getReview(id)
  if (!review) return null

  const [sections, drills] = await Promise.all([getSections(id), getDrills(id)])
  return { review, sections, drills: await withProgress(drills) }
}

export interface GuideCounts {
  chapters: number
  drills: number
  /** Drills the user has activated — the library badges a guide that has any. */
  activeDrills: number
}

/**
 * Chapter and drill counts per guide, for the library cards.
 *
 * Two flat queries rolled up here rather than a count per card: PostgREST has no
 * group-by, and the whole corpus is a few hundred rows — a `head: true` count per
 * review would be one request per card for the same answer.
 */
export async function getGuideCounts(): Promise<Map<string, GuideCounts>> {
  const [sections, drills] = await Promise.all([
    supabase.from('reference_sections').select('reference_review_id'),
    supabase.from('practice_drills').select('reference_review_id, status'),
  ])

  if (sections.error) throw new Error(sections.error.message)
  if (drills.error) throw new Error(drills.error.message)

  const counts = new Map<string, GuideCounts>()
  const bucket = (id: string) => {
    const existing = counts.get(id)
    if (existing) return existing
    const fresh: GuideCounts = { chapters: 0, drills: 0, activeDrills: 0 }
    counts.set(id, fresh)
    return fresh
  }

  for (const row of sections.data ?? []) {
    bucket(row.reference_review_id as string).chapters += 1
  }
  for (const row of drills.data ?? []) {
    const entry = bucket(row.reference_review_id as string)
    // A dropped drill left the note; it should not inflate the card's count.
    if (row.status === 'dropped') continue
    entry.drills += 1
    if (row.status === 'active') entry.activeDrills += 1
  }

  return counts
}

/** Notes for one review, in tape order. */
export async function getNotes(reviewId: string): Promise<ReferenceNote[]> {
  const { data, error } = await supabase
    .from('reference_notes')
    .select('*')
    .eq('reference_review_id', reviewId)
    .order('timestamp_seconds', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createNote(input: ReferenceNoteInput): Promise<ReferenceNote> {
  const { data, error } = await supabase
    .from('reference_notes')
    .insert({
      reference_review_id: input.reference_review_id,
      timestamp_seconds: Math.round(input.timestamp_seconds),
      category: input.category ?? null,
      text: input.text,
      label: input.label ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<ReferenceNote, 'timestamp_seconds' | 'category' | 'text' | 'label'>>,
): Promise<ReferenceNote> {
  const { data, error } = await supabase
    .from('reference_notes')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('reference_notes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
