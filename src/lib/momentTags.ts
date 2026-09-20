import { supabase } from './supabase'
import type { MomentTag, ReviewRef, ReviewTag } from './types'

/**
 * Moment Tags — a user-created tag vocabulary applied to timestamped moments,
 * shared across both review surfaces.
 *
 * `review_tags` is the vocabulary, `moment_tags` the timestamped applications.
 * The junction is polymorphic (`review_type` + text `review_id`) so one tag pool
 * spans own-match VOD Review and Pro Study — the whole point of the feature is
 * that "retake-timing" means the same thing on a pro's round and on yours.
 *
 * These tables carry `user_id` (NOT NULL, FK to `auth.users`) but no RLS,
 * matching the operative convention on the other Phase-4 tables. Every write
 * therefore stamps the session user explicitly — `reference_notes` has no owner
 * column to copy, so there is no ambient default to lean on.
 */

/**
 * Eight colours drawn from the existing theme, so a moment tag reads as the same
 * kind of object as a note chip. Cycled by creation order — no picker in v1.
 */
export const TAG_PALETTE = [
  '#53CADC', // val-cyan
  '#3DD598', // val-green
  '#FF4655', // val-red
  '#FFCA3A', // val-yellow
  '#F97316', // utility orange
  '#6EE7B7', // positioning mint
  '#94A3B8', // text-secondary slate
  '#64748B', // text-muted slate
] as const

export function nextTagColor(existingCount: number): string {
  return TAG_PALETTE[existingCount % TAG_PALETTE.length]
}

/** Postgres unique-violation — the vocabulary's case-insensitive name index. */
const UNIQUE_VIOLATION = '23505'

const NAME_MAX = 40

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Not signed in.')
  return data.user.id
}

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length === 0) throw new Error('A tag needs a name.')
  if (name.length > NAME_MAX) throw new Error(`Tag names are capped at ${NAME_MAX} characters.`)
  return name
}

// ------------------------------------------------------------------ vocabulary

/**
 * The whole vocabulary, alphabetical.
 *
 * Sorted here rather than in the query: PostgREST orders by the raw column, so
 * `Retake` would sort before `aim`. The pool is a few dozen rows.
 */
export async function listReviewTags(): Promise<ReviewTag[]> {
  const { data, error } = await supabase.from('review_tags').select('*')
  if (error) throw new Error(error.message)

  return (data ?? []).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )
}

/**
 * Creates a tag, or returns the existing one with that name.
 *
 * Idempotent on purpose: the picker creates on Enter, and a double-Enter or a
 * name that differs only in case must land on the same row rather than erroring
 * in the user's face mid-capture.
 */
export async function createReviewTag(rawName: string): Promise<ReviewTag> {
  const name = cleanName(rawName)
  const existing = await listReviewTags()

  const alreadyThere = existing.find(t => t.name.toLowerCase() === name.toLowerCase())
  if (alreadyThere) return alreadyThere

  const { data, error } = await supabase
    .from('review_tags')
    .insert({ user_id: await currentUserId(), name, color: nextTagColor(existing.length) })
    .select()
    .single()

  if (error) {
    // Lost a race against another tab — the winner's row is the answer.
    if (error.code === UNIQUE_VIOLATION) {
      const { data: found, error: findError } = await supabase
        .from('review_tags')
        .select('*')
        .ilike('name', name)
        .limit(1)
        .maybeSingle()
      if (findError) throw new Error(findError.message)
      if (found) return found
    }
    throw new Error(error.message)
  }

  return data
}

export async function renameReviewTag(id: string, rawName: string): Promise<ReviewTag> {
  const name = cleanName(rawName)

  const { data, error } = await supabase
    .from('review_tags')
    .update({ name })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error(`"${name}" already exists.`)
    }
    throw new Error(error.message)
  }
  return data
}

/** Deleting a tag cascades its moment rows; the notes themselves are untouched. */
export async function deleteReviewTag(id: string): Promise<void> {
  const { error } = await supabase.from('review_tags').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** How many moments carry this tag — shown in the delete confirmation. */
export async function countTagUsage(tagId: string): Promise<number> {
  const { count, error } = await supabase
    .from('moment_tags')
    .select('id', { count: 'exact', head: true })
    .eq('tag_id', tagId)

  if (error) throw new Error(error.message)
  return count ?? 0
}

// --------------------------------------------------------------- applications

/** Every moment tag on one review, in tape order. */
export async function listMomentTags(ref: ReviewRef): Promise<MomentTag[]> {
  const { data, error } = await supabase
    .from('moment_tags')
    .select('*')
    .eq('review_type', ref.type)
    .eq('review_id', ref.id)
    .order('video_ts', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Applies a tag at a moment.
 *
 * The same tag at the same second in the same review is blocked by a unique
 * index; rather than surface that as an error, the existing row is returned —
 * from the user's side the tag is simply already there.
 *
 * If that existing row carries no note and this call supplies one, the row is
 * adopted by the note. Quick-dropping a tag and then writing a note at the same
 * second is an ordinary sequence, and without this the note would silently show
 * no chip: the insert is refused, and the row it collided with belongs to
 * nothing.
 */
export async function addMomentTag(
  ref: ReviewRef,
  tagId: string,
  videoTs: number,
  noteId?: string | null,
): Promise<MomentTag> {
  const row = {
    user_id: await currentUserId(),
    tag_id: tagId,
    review_type: ref.type,
    review_id: ref.id,
    video_ts: Math.max(0, Math.floor(videoTs)),
    note_id: noteId ?? null,
  }

  const { data, error } = await supabase.from('moment_tags').insert(row).select().single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: found, error: findError } = await supabase
        .from('moment_tags')
        .select('*')
        .eq('review_type', row.review_type)
        .eq('review_id', row.review_id)
        .eq('tag_id', row.tag_id)
        .eq('video_ts', row.video_ts)
        .limit(1)
        .maybeSingle()
      if (findError) throw new Error(findError.message)

      if (found) {
        if (row.note_id && !found.note_id) {
          const { data: adopted, error: adoptError } = await supabase
            .from('moment_tags')
            .update({ note_id: row.note_id })
            .eq('id', found.id)
            .select()
            .single()
          if (adoptError) throw new Error(adoptError.message)
          return adopted
        }
        return found
      }
    }
    throw new Error(error.message)
  }

  return data
}

/** Removes one application. Never touches the note it was captured with. */
export async function removeMomentTag(id: string): Promise<void> {
  const { error } = await supabase.from('moment_tags').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
