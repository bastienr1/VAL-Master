/**
 * Reading and writing art slot overrides.
 *
 * Rows live in `art_slots`, files in the public `site-art` Storage bucket
 * (migration `20261002_art_slots.sql`). The rules — which row is showing, what a
 * slot falls back to — are in `artSlots.ts`, which stays free of Supabase so it
 * can be unit-tested.
 */

import { supabase } from './supabase'
import { createResource } from './resourceStore'
import { scopeToUser, sessionUserId } from './sessionScope'
import { artStoragePath, clamp01, validateArtFile, type ArtSlotRow } from './artSlots'

const BUCKET = 'site-art'

export interface ArtSlotsState {
  /** Every row the user owns, in any state: showing, scheduled, covered or expired. */
  rows: ArtSlotRow[]
  /** The migration hasn't been run. Home still renders, on defaults. */
  tableMissing: boolean
}

// Postgres says 42P01; PostgREST answers PGRST205 when the table isn't in its
// schema cache, which is what the browser actually sees.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

let warnedMissing = false

async function fetchArtSlotRows(): Promise<ArtSlotsState> {
  const userId = await sessionUserId()
  if (!userId) return { rows: [], tableMissing: false }

  // All of the user's rows, not only the ones showing: a handful per slot at
  // most, and Settings lists the scheduled and covered ones too. Which row is
  // showing is decided at render time, so a scheduled change needs no refetch.
  const { data, error } = await supabase
    .from('art_slots')
    .select('*')
    .eq('user_id', userId)
    .order('active_from', { ascending: false })

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      if (!warnedMissing) {
        warnedMissing = true
        console.warn('[artSlot] art_slots table not found — run migration 20261002_art_slots.sql. Using default art.')
      }
      return { rows: [], tableMissing: true }
    }
    throw new Error(error.message)
  }

  return { rows: (data ?? []) as ArtSlotRow[], tableMissing: false }
}

/** One query per session, shared by every slot on the page. */
export const artSlotsResource = scopeToUser(createResource(fetchArtSlotRows))

/** Call after any write so mounted slots pick the change up. */
export function invalidateArtSlots() {
  artSlotsResource.invalidate()
}

export interface ArtSlotOptions {
  focal_x?: number
  focal_y?: number
  overlay?: number
  href?: string | null
  label?: string | null
  /** ISO timestamps. `active_from` defaults to now on the server. */
  active_from?: string
  active_until?: string | null
}

function rowFields(opts: ArtSlotOptions) {
  return {
    ...(opts.focal_x !== undefined && { focal_x: clamp01(opts.focal_x) }),
    ...(opts.focal_y !== undefined && { focal_y: clamp01(opts.focal_y) }),
    ...(opts.overlay !== undefined && { overlay: clamp01(opts.overlay) }),
    ...(opts.href !== undefined && { href: opts.href }),
    ...(opts.label !== undefined && { label: opts.label }),
    ...(opts.active_from !== undefined && { active_from: opts.active_from }),
    ...(opts.active_until !== undefined && { active_until: opts.active_until }),
  }
}

async function requireUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return user.id
}

/** Uploads `file` and makes it the slot's newest override. */
export async function uploadArtSlot(slotKey: string, file: File, opts: ArtSlotOptions = {}): Promise<ArtSlotRow> {
  const refusal = validateArtFile(file)
  if (refusal) throw new Error(refusal)

  const userId = await requireUserId()
  const path = artStoragePath(userId, slotKey, file.type)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

  const { data, error } = await supabase
    .from('art_slots')
    .insert({ user_id: userId, slot_key: slotKey, image_url: publicUrl, storage_path: path, ...rowFields(opts) })
    .select()
    .single()

  if (error) {
    // Don't leave a file nothing points at.
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(error.message)
  }

  invalidateArtSlots()
  return data as ArtSlotRow
}

/** Makes an image hosted elsewhere the slot's newest override. */
export async function setArtSlotUrl(slotKey: string, url: string, opts: ArtSlotOptions = {}): Promise<ArtSlotRow> {
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from('art_slots')
    .insert({ user_id: userId, slot_key: slotKey, image_url: url, storage_path: null, ...rowFields(opts) })
    .select()
    .single()

  if (error) throw new Error(error.message)
  invalidateArtSlots()
  return data as ArtSlotRow
}

/** Changes the framing, schedule or link of an existing override. */
export async function updateArtSlot(id: string, opts: ArtSlotOptions): Promise<ArtSlotRow> {
  const { data, error } = await supabase
    .from('art_slots')
    .update(rowFields(opts))
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  invalidateArtSlots()
  return data as ArtSlotRow
}

/** Deletes an override and its file; the slot falls back down the chain. */
export async function removeArtSlot(row: Pick<ArtSlotRow, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await supabase.from('art_slots').delete().eq('id', row.id)
  if (error) throw new Error(error.message)

  // Row first: a file with no row is invisible, a row with no file is a broken
  // image for as long as it takes to fall back.
  if (row.storage_path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.storage_path])
    if (removeError) console.warn('[artSlot] override removed, but its file could not be deleted', removeError.message)
  }

  invalidateArtSlots()
}
