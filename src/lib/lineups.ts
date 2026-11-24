/**
 * Reading and writing line-ups: rows in `lineups`, pictures in the public
 * `lineup-media` Storage bucket (migration `20261124_lineups.sql`). The rules
 * are in `lineupModel.ts`, which stays free of Supabase so it can be tested.
 *
 * No `user_id` filter: the table is owner-only under RLS, and `user_id`
 * defaults to `auth.uid()` on insert.
 */

import { supabase } from './supabase'
import {
  LINEUP_IMAGE_SLOTS,
  imageColumn,
  lineupImagePath,
  parseLineupPoint,
  parseLineupVia,
  validateLineupImage,
  type Lineup,
  type LineupImageSlot,
  type LineupInput,
} from './lineupModel'

const BUCKET = 'lineup-media'

// Postgres says 42P01; PostgREST answers PGRST205 when the table isn't in its
// schema cache, which is what the browser actually sees.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

export interface LineupsState {
  rows: Lineup[]
  /** The migration hasn't been run: the page says so instead of failing. */
  tableMissing: boolean
}

/** A row as stored, or null when its points are not points (a hand-edited row cannot be drawn). */
function fromRow(raw: Record<string, unknown>): Lineup | null {
  const stand = parseLineupPoint(raw.stand)
  const land = parseLineupPoint(raw.land)
  if (!stand || !land) return null
  return { ...(raw as unknown as Lineup), stand, land, via: parseLineupVia(raw.via), curved: raw.curved === true, note: typeof raw.note === 'string' ? raw.note : '' }
}

/** Every line-up, newest edit first. */
export async function listLineups(): Promise<LineupsState> {
  const { data, error } = await supabase.from('lineups').select('*').order('updated_at', { ascending: false })
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return { rows: [], tableMissing: true }
    throw new Error(error.message)
  }
  const rows = (data ?? []).map(fromRow).filter((row): row is Lineup => row !== null)
  return { rows, tableMissing: false }
}

export async function createLineup(input: LineupInput): Promise<Lineup> {
  const { data, error } = await supabase.from('lineups').insert(input).select('*').single()
  if (error) throw new Error(error.message)
  const row = fromRow(data)
  if (!row) throw new Error('The line-up was saved but could not be read back.')
  return row
}

/** Saves a change. `updated_at` is set here: the table has no trigger for it. */
export async function updateLineup(id: string, patch: Partial<LineupInput>): Promise<Lineup> {
  const { data, error } = await supabase
    .from('lineups')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const row = fromRow(data)
  if (!row) throw new Error('The line-up was saved but could not be read back.')
  return row
}

/** Deletes a line-up and its pictures. */
export async function deleteLineup(lineup: Lineup): Promise<void> {
  const { error } = await supabase.from('lineups').delete().eq('id', lineup.id)
  if (error) throw new Error(error.message)
  // Row first: a file with no row is invisible, a row with no file is a broken picture.
  const paths = LINEUP_IMAGE_SLOTS.map(slot => lineup[imageColumn(slot)]).filter((path): path is string => Boolean(path))
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths)
    if (removeError) console.warn('[lineups] line-up deleted, but its pictures could not be removed', removeError.message)
  }
}

/** The address a stored picture is served from. */
export function lineupImageUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** A screenshot is wider than it needs to be to read a crosshair's place. */
const MAX_IMAGE_WIDTH = 1920
const WEBP_QUALITY = 0.86

/** The picture as a WebP no wider than 1920 px; the picture itself when the browser cannot re-encode it. */
async function slimmed(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
    return webp && webp.type === 'image/webp' ? webp : file
  } catch {
    return file
  }
}

/** Stores `file` as the line-up's picture for `slot`, replacing the one it had. */
export async function setLineupImage(lineup: Lineup, slot: LineupImageSlot, file: Blob): Promise<Lineup> {
  if (!file.type.startsWith('image/')) throw new Error('That is not a picture.')
  const picture = await slimmed(file)
  const refusal = validateLineupImage(picture)
  if (refusal) throw new Error(refusal)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const path = lineupImagePath(user.id, lineup.id, slot, picture.type)

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, picture, { contentType: picture.type })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const before = lineup[imageColumn(slot)]
  try {
    const saved = await updateLineup(lineup.id, { [imageColumn(slot)]: path })
    if (before) await supabase.storage.from(BUCKET).remove([before])
    return saved
  } catch (err) {
    // Don't leave a file nothing points at.
    await supabase.storage.from(BUCKET).remove([path])
    throw err
  }
}

/** Empties a picture slot and deletes its file. */
export async function clearLineupImage(lineup: Lineup, slot: LineupImageSlot): Promise<Lineup> {
  const before = lineup[imageColumn(slot)]
  const saved = await updateLineup(lineup.id, { [imageColumn(slot)]: null })
  if (before) {
    const { error } = await supabase.storage.from(BUCKET).remove([before])
    if (error) console.warn('[lineups] picture removed from the line-up, but its file could not be deleted', error.message)
  }
  return saved
}
