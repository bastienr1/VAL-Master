import { supabase } from './supabase'
import type { ReferenceNote, ReferenceNoteInput, ReferenceReview } from './types'

/**
 * Pro Study data layer.
 *
 * Reference reviews are pro VODs seeded from Notion (`scripts/seedProStudy.ts`)
 * — read-only here. The notes on top of them are the user's own, and are the
 * only thing the app writes.
 *
 * No `user_id` filter: these tables carry no RLS and no owner column, matching
 * the other seeded content tables. Revisit at Phase 2 auth.
 */

/**
 * Newest pro VODs first; rows with no date sort last.
 *
 * Most of the Notion rows carry no Date (5 of 70 at first seed), so the tail of
 * the list is really ordered by player — without that secondary key the bulk of
 * the library would shuffle between loads.
 */
export async function getAllReviews(): Promise<ReferenceReview[]> {
  const { data, error } = await supabase
    .from('reference_reviews')
    .select('*')
    .order('played_at', { ascending: false, nullsFirst: false })
    .order('player', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** One pro VOD, or null when the id does not exist. */
export async function getReview(id: string): Promise<ReferenceReview | null> {
  const { data, error } = await supabase
    .from('reference_reviews')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ?? null
}

/** Notes for one pro VOD, in tape order. */
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
