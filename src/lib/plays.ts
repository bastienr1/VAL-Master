import { createResource } from './resourceStore'
import { scopeToUser } from './sessionScope'
import { supabase } from './supabase'
import type { Play } from './types'

/**
 * Plays — the user's own set plays, the Supabase side of `/plays`.
 *
 * One shared resource feeds the index and the designer, and every write
 * invalidates it, so a play saved in the designer is on the index by the time
 * the user goes back.
 *
 * No `user_id` filter: the table is owner-only under RLS, and `user_id`
 * defaults to `auth.uid()` on insert. `play` comes back as stored; the
 * designer runs it through `parsePlayDoc` before drawing it.
 */

/** The columns a page writes: everything but the id, the owner and the timestamps. */
export type PlayInput = Pick<Play, 'title' | 'map' | 'map_uuid' | 'side' | 'comp' | 'brief' | 'play' | 'composed_with'>

/** Every play, newest edit first. */
export async function listPlays(): Promise<Play[]> {
  const { data, error } = await supabase
    .from('plays')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Play[]
}

export const playsResource = scopeToUser(createResource(listPlays))

/** One play, or null when it does not exist or belongs to someone else. */
export async function getPlay(id: string): Promise<Play | null> {
  const { data, error } = await supabase.from('plays').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Play | null) ?? null
}

export async function createPlay(input: PlayInput): Promise<Play> {
  const { data, error } = await supabase.from('plays').insert(input).select('*').single()
  if (error) throw new Error(error.message)
  playsResource.invalidate()
  return data as Play
}

/** Saves a change. `updated_at` is set here: the table has no trigger for it. */
export async function updatePlay(id: string, patch: Partial<PlayInput>): Promise<Play> {
  const { data, error } = await supabase
    .from('plays')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  playsResource.invalidate()
  return data as Play
}

export async function deletePlay(id: string): Promise<void> {
  const { error } = await supabase.from('plays').delete().eq('id', id)
  if (error) throw new Error(error.message)
  playsResource.invalidate()
}
