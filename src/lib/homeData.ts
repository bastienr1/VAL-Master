/**
 * The queries behind Home and the Map Hub.
 *
 * Two shared caches: the player's matches, and the study material (playbooks,
 * Pro Study rows, which matches have a VOD). Home, `/maps` and `/maps/:slug`
 * all read the same two, so moving between them costs no new queries beyond a
 * background refresh. The maths over these rows is in `homeStats.ts` and
 * `mapContent.ts`.
 */

import { supabase } from './supabase'
import { createResource } from './resourceStore'
import { scopeToUser, sessionUserId } from './sessionScope'
import { MATCHES_SYNCED_EVENT } from './loadLatest'
import { PLAYBOOKS_CHANGED_EVENT, listPlaybooks } from './playbooks'
import { getGuideCounts, listReviews, type GuideCounts } from './referenceReviews'
import type { HomeMatch } from './homeStats'
import type { PlaybookWithCount, ReferenceReview } from './types'

// Shown at once from cache when a page mounts, then refreshed if older than
// this. Short, because a VOD link or a note added on another page has no event
// to announce it.
const REFRESH_AFTER_MS = 15_000

const HOME_MATCH_COLUMNS =
  'id, match_id, match_date, map, map_id, agent, agent_id, result, score, acs, kills, deaths, assists, kda, headshot_pct'

// PostgREST caps a response at 1000 rows whether or not the query sets a limit.
const PAGE_SIZE = 1000

/**
 * Every match the player has, newest first.
 *
 * Deliberately no row cap, unlike the Match Library's latest-50: Home's totals
 * have to equal a plain `count(*)` over the table. Only the columns Home reads
 * are selected, so the full history stays a light query.
 */
async function fetchHomeMatches(): Promise<HomeMatch[]> {
  const userId = await sessionUserId()
  if (!userId) return []

  const rows: HomeMatch[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('matches')
      .select(HOME_MATCH_COLUMNS)
      .eq('user_id', userId)
      .order('match_date', { ascending: false })
      .order('id', { ascending: true }) // a stable order, so pages can't overlap
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as HomeMatch[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

export const homeMatchesResource = scopeToUser(createResource(fetchHomeMatches, { maxAgeMs: REFRESH_AFTER_MS }))

export interface StudyContent {
  playbooks: PlaybookWithCount[]
  reviews: ReferenceReview[]
  /** Chapter and drill counts per Pro Study row, for its card. */
  guideCounts: Map<string, GuideCounts>
  /** `match_id`s the player has attached a VOD to. */
  reviewedMatchIds: Set<string>
}

async function fetchReviewedMatchIds(): Promise<Set<string>> {
  const userId = await sessionUserId()
  if (!userId) return new Set()

  const { data, error } = await supabase
    .from('vod_reviews')
    .select('match_id, youtube_url')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return new Set((data ?? []).map(row => row.match_id as string))
}

async function fetchStudyContent(): Promise<StudyContent> {
  const [playbooks, reviews, guideCounts, reviewedMatchIds] = await Promise.all([
    listPlaybooks(),
    listReviews(),
    getGuideCounts(),
    fetchReviewedMatchIds(),
  ])
  return { playbooks, reviews, guideCounts, reviewedMatchIds }
}

export const studyContentResource = scopeToUser(createResource(fetchStudyContent, { maxAgeMs: REFRESH_AFTER_MS }))

// Load Latest and playbook imports announce themselves; anything mounted
// refetches at once, anything else on its next visit.
window.addEventListener(MATCHES_SYNCED_EVENT, () => {
  homeMatchesResource.invalidate()
  studyContentResource.invalidate()
})
window.addEventListener(PLAYBOOKS_CHANGED_EVENT, () => studyContentResource.invalidate())
