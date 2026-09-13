import { supabase } from './supabase'
import { fetchRecentMatches } from './henrik'
import type { PlayerConfig } from './profile'

/** Fired on window after a sync writes new rows, so open pages can reload. */
export const MATCHES_SYNCED_EVENT = 'val-master:matches-synced'

/**
 * Pulls the player's latest competitive matches from Henrik and upserts them.
 * Lifted out of Match Library so the top-nav Load Latest button can run it
 * from any page.
 */
export async function loadLatestMatches(player: PlayerConfig): Promise<void> {
  const results = await fetchRecentMatches(player, 5, 'competitive')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  for (const r of results) {
    await supabase
      .from('matches')
      .upsert({ ...r.match, user_id: user.id }, { onConflict: 'match_id' })
  }
  window.dispatchEvent(new Event(MATCHES_SYNCED_EVENT))
}
