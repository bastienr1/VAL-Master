/**
 * The VOD of a replayed match, for the Plays replay panel
 * (docs/plays-editor-v2.md §2.12): the same video and barrier-drop sync the
 * VOD review page uses.
 */

import { supabase } from './supabase'
import { extractYouTubeId } from './youtube'

export interface ReplayVod {
  videoId: string
  /** Video seconds at the round 1 barrier drop; null until the match is synced on the review page. */
  barrierOffset: number | null
}

/** The match's video, its review's first, else the one on the match; null when it has none. */
export async function getReplayVod(matchId: string): Promise<ReplayVod | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [{ data: review }, { data: match }] = await Promise.all([
    supabase.from('vod_reviews').select('youtube_url, barrier_drop_offset').eq('match_id', matchId).eq('user_id', user.id).maybeSingle(),
    supabase.from('matches').select('youtube_url').eq('match_id', matchId).eq('user_id', user.id).maybeSingle(),
  ])
  const url: string | null = review?.youtube_url || match?.youtube_url || null
  const videoId = url ? extractYouTubeId(url) : null
  return videoId ? { videoId, barrierOffset: review?.barrier_drop_offset ?? null } : null
}
