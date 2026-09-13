/**
 * Map fundamentals — one choice per map, per user: an external URL or a saved
 * playbook (Sprint 6b).
 *
 * These belong to the map, not to a review: the fundamentals for Ascent are
 * the same whichever Ascent match you are reviewing. Stored in Supabase so the
 * choice follows the account across devices, replacing the original per-review
 * column plus its localStorage carry-forward.
 */

import { supabase } from './supabase'
import { normalizeUrl } from './url'
import { fromFundamentalsRow, toFundamentalsRow, type FundamentalsChoice } from './fundamentalsChoice'

export type { FundamentalsChoice } from './fundamentalsChoice'

export interface MapFundamentals {
  id: string
  user_id: string
  map: string
  url: string | null
  playbook_id: string | null
  updated_at: string
}

const LEGACY_PREFIX = 'mapFundamentals:'
const MIGRATED_FLAG = 'mapFundamentals:migrated'

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

/** The stored choice for a map — { kind: 'none' } when nothing is set. */
export async function getMapFundamentals(map: string): Promise<FundamentalsChoice> {
  if (!map) return { kind: 'none' }

  // Scoped explicitly rather than leaning on RLS alone — a policy gap should
  // not turn into reading someone else's choice.
  const userId = await currentUserId()
  if (!userId) return { kind: 'none' }

  const { data, error } = await supabase
    .from('map_fundamentals')
    .select('url, playbook_id')
    .eq('user_id', userId)
    .eq('map', map)
    .maybeSingle()

  if (error) {
    // Surface it — silently showing "None" would invite overwriting a real choice.
    throw new Error(error.message)
  }
  return fromFundamentalsRow(data)
}

/**
 * Writes the choice for a map. None (or a blank / unsafe URL) deletes the row,
 * so clearing actually forgets the choice rather than leaving a stale one.
 * Returns the choice as stored.
 */
export async function saveMapFundamentals(map: string, choice: FundamentalsChoice): Promise<FundamentalsChoice> {
  if (!map) throw new Error('Cannot save map fundamentals without a map')

  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const row = toFundamentalsRow(choice)

  if (!row) {
    const { error } = await supabase
      .from('map_fundamentals')
      .delete()
      .eq('user_id', userId)
      .eq('map', map)
    if (error) throw new Error(error.message)
    return { kind: 'none' }
  }

  const { error } = await supabase
    .from('map_fundamentals')
    .upsert(
      { user_id: userId, map, ...row, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,map' },
    )
  if (error) throw new Error(error.message)
  return fromFundamentalsRow(row)
}

/**
 * One-time lift of the old localStorage carry-forward into Supabase. Existing
 * rows win, so this never overwrites a link already saved on the account.
 */
export async function migrateLegacyLocalLinks(): Promise<number> {
  if (localStorage.getItem(MIGRATED_FLAG)) return 0

  const legacy: { map: string; url: string; key: string }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(LEGACY_PREFIX) || key === MIGRATED_FLAG) continue
    const url = localStorage.getItem(key)
    if (url) legacy.push({ map: key.slice(LEGACY_PREFIX.length), url, key })
  }

  if (legacy.length === 0) {
    localStorage.setItem(MIGRATED_FLAG, 'true')
    return 0
  }

  const userId = await currentUserId()
  if (!userId) return 0 // try again next session, once signed in

  let migrated = 0
  for (const entry of legacy) {
    const url = normalizeUrl(entry.url)
    if (!url) continue
    const { error } = await supabase
      .from('map_fundamentals')
      .upsert(
        { user_id: userId, map: entry.map, url },
        { onConflict: 'user_id,map', ignoreDuplicates: true },
      )
    if (error) {
      console.warn(`[mapFundamentals] migration failed for "${entry.map}":`, error.message)
      continue
    }
    migrated++
  }

  legacy.forEach(e => localStorage.removeItem(e.key))
  localStorage.setItem(MIGRATED_FLAG, 'true')

  if (migrated > 0) {
    console.info(`[mapFundamentals] migrated ${migrated} local link(s) to Supabase`)
  }
  return migrated
}
