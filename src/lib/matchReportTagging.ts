/**
 * Applying a match report's duels to the match's video as moment tags
 * (docs/match-report.md §5). The rules are in `matchReportTags.ts`, which stays
 * free of Supabase so it can be unit-tested; this reads what the plan needs and
 * writes its rows.
 */

import type { ReportDuel } from './matchReport'
import { planDuelTags, type TagPlan } from './matchReportTags'
import { listMomentTags, listReviewTags } from './momentTags'
import { supabase } from './supabase'

export type DuelTagResult = Omit<TagPlan, 'rows'> & { added: number }

/**
 * Tags every kill and death of `duels` on the video of match `matchId`. Safe to
 * run again: what is already on the review is left alone and counted.
 */
export async function applyDuelTags(matchId: string, duels: ReadonlyArray<ReportDuel>, videoSecond: (replayMs: number) => number): Promise<DuelTagResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const { data: review, error: reviewError } = await supabase
    .from('vod_reviews')
    .select('id')
    .eq('match_id', matchId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (reviewError) throw new Error(reviewError.message)

  const [tags, existing, notes] = await Promise.all([
    listReviewTags(),
    listMomentTags({ type: 'vod', id: matchId }),
    review
      ? supabase.from('vod_comments').select('id, timestamp_seconds').eq('vod_review_id', review.id).then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return (data ?? []) as Array<{ id: string; timestamp_seconds: number }>
        })
      : Promise.resolve([]),
  ])

  const { rows, ...plan } = planDuelTags({ duels, videoSecond, tags, notes, existing })
  if (rows.length > 0) {
    const { error } = await supabase.from('moment_tags').insert(
      rows.map(row => ({
        user_id: user.id,
        tag_id: row.tagId,
        review_type: 'vod',
        review_id: matchId,
        video_ts: row.videoTs,
        note_id: row.noteId,
      })),
    )
    if (error) throw new Error(error.message)
  }
  return { ...plan, added: rows.length }
}
