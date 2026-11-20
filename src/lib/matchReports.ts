/**
 * Reading and writing `match_reports` (migration `20261120_match_reports.sql`):
 * the notes written about a match, and the counts kept for the trend.
 *
 * The shapes and their tolerant parsing are in `matchReportNotes.ts`, which
 * stays free of Supabase so it can be unit-tested. Everything here treats a
 * missing table as "nothing written yet": the report page works before the
 * migration has been run.
 */

import { supabase } from './supabase'
import { parseReportNotes, parseReportSummary, sameSummary, type ReportNotes, type ReportSummary } from './matchReportNotes'
import type { Match } from './types'

// Postgres says 42P01; PostgREST answers PGRST205 when the table isn't in its
// schema cache, which is what the browser actually sees.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

let warnedMissing = false
function noteMissing() {
  if (warnedMissing) return
  warnedMissing = true
  console.warn('[report] match_reports table not found — run migration 20261120_match_reports.sql. Showing the rule-based report only.')
}

export interface StoredMatchReport {
  notes: ReportNotes
  summary: ReportSummary | null
  /** The migration has not been run. */
  tableMissing: boolean
}

/** What is stored for one match; empty notes when there is no row. */
export async function loadStoredReport(userId: string, matchId: string): Promise<StoredMatchReport> {
  const { data, error } = await supabase
    .from('match_reports')
    .select('notes, summary')
    .eq('user_id', userId)
    .eq('match_id', matchId)
    .maybeSingle()
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      noteMissing()
      return { notes: parseReportNotes(null), summary: null, tableMissing: true }
    }
    throw new Error(error.message)
  }
  return { notes: parseReportNotes(data?.notes), summary: parseReportSummary(data?.summary), tableMissing: false }
}

/**
 * Saves the counts for the trend when they differ from what is stored. The
 * notes of an existing row are left as they are: only `summary` is sent.
 */
export async function saveReportSummary(userId: string, matchId: string, stored: ReportSummary | null, summary: ReportSummary): Promise<void> {
  if (sameSummary(stored, summary)) return
  const { error } = await supabase
    .from('match_reports')
    .upsert({ user_id: userId, match_id: matchId, summary, updated_at: new Date().toISOString() }, { onConflict: 'user_id,match_id' })
  if (error && !MISSING_TABLE_CODES.has(error.code)) throw new Error(error.message)
}

export interface TrendRow {
  match: Pick<Match, 'match_id' | 'match_date' | 'map' | 'agent' | 'result' | 'score' | 'acs' | 'headshot_pct' | 'kills' | 'deaths' | 'assists'>
  summary: ReportSummary
}

/**
 * The user's most recent matches of `mode` that have a stored summary, up to
 * and including `until`, newest last. Empty when the table is missing.
 */
export async function loadReportTrend(userId: string, mode: string, until: string, limit = 6): Promise<TrendRow[]> {
  const { data: rows, error } = await supabase.from('match_reports').select('match_id, summary').eq('user_id', userId)
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return []
    throw new Error(error.message)
  }
  const summaries = new Map<string, ReportSummary>()
  for (const row of rows ?? []) {
    const summary = parseReportSummary(row.summary)
    if (summary) summaries.set(row.match_id as string, summary)
  }
  if (summaries.size === 0) return []

  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('match_id, match_date, map, agent, result, score, acs, headshot_pct, kills, deaths, assists')
    .eq('user_id', userId)
    .eq('mode', mode)
    .lte('match_date', until)
    .in('match_id', [...summaries.keys()])
    .order('match_date', { ascending: false })
    .limit(limit)
  if (matchError) throw new Error(matchError.message)
  return (matches ?? [])
    .map(match => ({ match: match as TrendRow['match'], summary: summaries.get(match.match_id as string) as ReportSummary }))
    .reverse()
}
