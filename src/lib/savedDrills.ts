import { createResource } from './resourceStore'
import { scopeToUser } from './sessionScope'
import { supabase } from './supabase'
import type { PracticeDrill, ReferenceReview, SavedDrill, SavedDrillScope } from './types'

/**
 * Saved drills — the Supabase side of `savedDrillScope.ts`.
 *
 * One shared resource feeds the review page, the Map Hub shelf and the
 * all-saved-drills page, and every write invalidates it, so a save made on
 * the review page is on the map's shelf by the time the user gets there.
 *
 * No `user_id` filter: the table carries no owner column and no RLS, matching
 * the other Pro Study tables. Revisit at Phase 2 auth.
 */

/** Every save, newest first. */
export async function listSavedDrills(): Promise<SavedDrill[]> {
  const { data, error } = await supabase
    .from('saved_drills')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as SavedDrill[]
}

export const savedDrillsResource = scopeToUser(createResource(listSavedDrills))

/**
 * Saves a drill to a place, or moves it when it is already saved.
 *
 * Select-then-write rather than an upsert: the one-save-per-drill rule is a
 * partial unique index, which PostgREST cannot take as an `onConflict`
 * target. On a move only the three scope columns change — the text copy is
 * what the user saw when they saved, and stays.
 */
export async function saveDrill(
  drill: PracticeDrill,
  review: Pick<ReferenceReview, 'id' | 'title'>,
  scope: SavedDrillScope,
): Promise<SavedDrill> {
  const place = {
    scope_type: scope.type,
    scope_value: scope.value,
    agent: scope.type === 'map' ? scope.agent : null,
  }

  const { data: existing, error: readError } = await supabase
    .from('saved_drills')
    .select('id')
    .eq('drill_id', drill.id)
    .maybeSingle()
  if (readError) throw new Error(readError.message)

  const query = existing
    ? supabase.from('saved_drills').update(place).eq('id', existing.id as string)
    : supabase.from('saved_drills').insert({
        ...place,
        drill_id: drill.id,
        reference_review_id: review.id,
        title: drill.title,
        venue: drill.venue,
        cue: drill.cue,
        success_signal: drill.success_signal,
        source_start_seconds: drill.source_start_seconds,
        source_end_seconds: drill.source_end_seconds,
        source_title: review.title,
      })

  const { data, error } = await query.select('*').single()
  if (error) throw new Error(error.message)

  savedDrillsResource.invalidate()
  return data as SavedDrill
}

/**
 * The live drills behind a set of saves, by drill id — one `in(...)` query for
 * the all-saved-drills page, so its cards can show status and flag a drill
 * whose note changed. A save whose drill is gone simply has no entry.
 */
export async function getLiveDrills(drillIds: string[]): Promise<Map<string, PracticeDrill>> {
  if (drillIds.length === 0) return new Map()
  const { data, error } = await supabase.from('practice_drills').select('*').in('id', drillIds)
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as PracticeDrill[]).map(drill => [drill.id, drill]))
}

/** Logged sessions per drill, one query, for the same cards. */
export async function getDrillLogCounts(drillIds: string[]): Promise<Map<string, number>> {
  if (drillIds.length === 0) return new Map()
  const { data, error } = await supabase.from('practice_logs').select('drill_id').in('drill_id', drillIds)
  if (error) throw new Error(error.message)
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = row.drill_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * Sets or clears a save's category. The caller normalises and matches the
 * text (`drillCategories.ts`); this never writes an empty string.
 */
export async function setSavedDrillCategory(id: string, category: string | null): Promise<SavedDrill> {
  const { data, error } = await supabase
    .from('saved_drills')
    .update({ category: category?.trim() || null })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  savedDrillsResource.invalidate()
  return data as SavedDrill
}

export async function removeSavedDrill(id: string): Promise<void> {
  const { error } = await supabase.from('saved_drills').delete().eq('id', id)
  if (error) throw new Error(error.message)
  savedDrillsResource.invalidate()
}
