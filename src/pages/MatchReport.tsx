import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SplitterHandle, useSplitter } from '../components/ColumnSplitter'
import MatchRecapHeader from '../components/MatchRecapHeader'
import ReportSections, { type ReportNames } from '../components/report/ReportSections'
import ReportStage, { type ReportStageHandle, type ReportVideo } from '../components/report/ReportStage'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { getLoadedGameContent, loadGameContent, type GameContentRegistry } from '../lib/gameContent'
import { buildMatchReport, type AbilitySlot } from '../lib/matchReport'
import { parseReportNotes, reportSummary } from '../lib/matchReportNotes'
import { loadReportTrend, loadStoredReport, saveReportSummary, type StoredMatchReport, type TrendRow } from '../lib/matchReports'
import { useReplayBundle } from '../lib/replays'
import { replayMsToVideoSeconds, weaponLabel } from '../lib/replaySync'
import { supabase } from '../lib/supabase'
import type { Match, MatchRound } from '../lib/types'
import { extractYouTubeId } from '../lib/youtube'

const ABILITY_SLOT: Record<AbilitySlot, 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'> = { C: 'Grenade', Q: 'Ability1', E: 'Ability2', X: 'Ultimate' }
const SLOT_FALLBACK: Record<AbilitySlot, string> = { C: 'Ability C', Q: 'Ability Q', E: 'Ability E', X: 'Ultimate' }
const NOTHING_STORED: StoredMatchReport = { notes: parseReportNotes(null), summary: null, tableMissing: false }

// The replay panel: wide enough to read the map by default, and the user's to
// drag as far as the text column's floor allows.
const STAGE_DEFAULT_W = 560
const STAGE_MIN_W = 320
const STAGE_MAX_W = 1600
const TEXT_MIN_W = 420

interface Loaded {
  userId: string
  match: Match
  /** The match's recording, whether or not it is synced. */
  videoId: string | null
  barrierOffset: number | null
  rounds: MatchRound[]
  stored: StoredMatchReport
}

/**
 * A match's report (docs/match-report.md): what the replay says about the
 * rounds, the positioning, the duels and the kit, with the replay itself pinned
 * beside the text so each line can be watched while it is read.
 *
 * The numbers are worked out here, in the browser, from the bundle the review
 * page already attaches (`buildMatchReport`). What a person wrote about the
 * match, and the counts the trend needs, are in `match_reports`.
 */
export default function MatchReport() {
  const { matchId } = useParams<{ matchId: string }>()
  const [loaded, setLoaded] = useState<{ matchId: string; data: Loaded | null } | null>(null)
  const [trendOf, setTrendOf] = useState<{ matchId: string; rows: TrendRow[] } | null>(null)
  const [content, setContent] = useState<GameContentRegistry | null>(() => getLoadedGameContent())
  const replay = useReplayBundle(matchId)
  const stage = useRef<ReportStageHandle | null>(null)
  const isLg = useMediaQuery('(min-width: 1024px)')
  const { dragHandlers, panelProps } = useSplitter({
    initialWidth: STAGE_DEFAULT_W,
    minWidth: STAGE_MIN_W,
    maxWidth: STAGE_MAX_W,
    minOtherSide: TEXT_MIN_W,
    storageKey: 'matchReport.stageWidth',
    side: 'left',
    label: 'Resize the replay panel',
  })

  useEffect(() => {
    let cancelled = false
    loadGameContent().then(registry => { if (!cancelled) setContent(registry) }, () => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    async function load(id: string): Promise<Loaded | null> {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data: match } = await supabase.from('matches').select('*').eq('match_id', id).eq('user_id', user.id).maybeSingle()
      if (!match) return null
      const [{ data: review }, { data: rounds }, stored] = await Promise.all([
        supabase.from('vod_reviews').select('youtube_url, barrier_drop_offset').eq('match_id', id).eq('user_id', user.id).maybeSingle(),
        supabase.from('match_rounds').select('*').eq('match_id', id).eq('user_id', user.id).order('round_number', { ascending: true }),
        // The written notes are an extra: the report still opens if they cannot be read.
        loadStoredReport(user.id, id).catch(err => {
          console.warn('[report] could not read the stored report:', err)
          return NOTHING_STORED
        }),
      ])
      const url: string | null = review?.youtube_url || (match as { youtube_url?: string | null }).youtube_url || null
      return {
        userId: user.id,
        match: match as Match,
        videoId: url ? extractYouTubeId(url) : null,
        barrierOffset: typeof review?.barrier_drop_offset === 'number' ? review.barrier_drop_offset : null,
        rounds: (rounds ?? []) as MatchRound[],
        stored,
      }
    }
    load(matchId).then(
      data => { if (!cancelled) setLoaded({ matchId, data }) },
      err => {
        console.error('[report] failed to load the match:', err)
        if (!cancelled) setLoaded({ matchId, data: null })
      },
    )
    return () => { cancelled = true }
  }, [matchId])

  const current = loaded && loaded.matchId === matchId ? loaded : null
  const data = current?.data ?? null
  const bundle = replay.bundle
  const videoId = data?.videoId ?? null
  const barrierOffset = data?.barrierOffset ?? null
  const video = useMemo<ReportVideo | null>(
    () => (videoId && barrierOffset !== null ? { videoId, barrierOffset } : null),
    [videoId, barrierOffset],
  )

  const report = useMemo(() => {
    if (!bundle || !content) return null
    const map = bundle.match.mapUuid ? content.maps.byId.get(bundle.match.mapUuid) : undefined
    return buildMatchReport(bundle, map?.callouts ?? [])
  }, [bundle, content])

  // Save this match's counts when they are new, then read the trend, so the
  // match is in its own trend the first time its report is opened.
  useEffect(() => {
    if (!data || !report || !matchId || data.stored.tableMissing) return
    let cancelled = false
    const { userId, match, stored } = data
    saveReportSummary(userId, matchId, stored.summary, reportSummary(report))
      .then(() => loadReportTrend(userId, match.mode, match.match_date))
      .then(
        rows => { if (!cancelled) setTrendOf({ matchId, rows }) },
        err => console.warn('[report] could not save or read the trend:', err),
      )
    return () => { cancelled = true }
  }, [data, report, matchId])

  const names = useMemo<ReportNames>(() => {
    const agentOf = new Map(bundle?.players.map(p => [p.subject, p.agentId]) ?? [])
    const agentName = (subject: string | null) => {
      const id = subject ? agentOf.get(subject) : null
      return (id && content?.agents.byId.get(id)?.name) || 'Agent'
    }
    const mine = bundle?.players.find(p => p.isMe)?.agentId
    const abilities = (mine && content?.agents.byId.get(mine)?.abilities) || []
    return {
      agent: agentName,
      weapon: index => (index === null ? 'Ability' : weaponLabel(bundle?.weapons[index]) || 'Ability'),
      ability: slot => abilities.find(a => a.slot === ABILITY_SLOT[slot])?.name ?? SLOT_FALLBACK[slot],
    }
  }, [bundle, content])

  const onWatch = useCallback((replayMs: number) => stage.current?.watch(replayMs), [])
  const videoSecond = useMemo(
    () => (bundle && video ? (replayMs: number) => replayMsToVideoSeconds(bundle, video.barrierOffset, replayMs) : null),
    [bundle, video],
  )

  if (!current || (data && (replay.status === 'loading' || !content))) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!data || !matchId) {
    return (
      <div className="py-16 text-center space-y-2">
        <p className="text-sm text-text-secondary">This match is not in your library.</p>
        <Link to="/matches" className="text-sm text-val-cyan hover:underline">Back to matches</Link>
      </div>
    )
  }
  const { match, stored } = data
  const trend = trendOf && trendOf.matchId === matchId ? trendOf.rows : []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1 mb-2 text-xs">
        <Link to="/matches" className="text-text-secondary hover:text-val-cyan transition-colors">Matches</Link>
        <span className="text-text-muted">/</span>
        <Link to={`/review/${matchId}`} className="text-text-secondary hover:text-val-cyan transition-colors">
          {match.agent} on {match.map} · {match.score} {match.result}
        </Link>
        <span className="text-text-muted">/</span>
        <span className="text-text-primary font-medium">Report</span>
        <Link to={`/review/${matchId}`} className="ml-auto text-text-muted hover:text-val-cyan transition-colors">Open the review ↗</Link>
      </div>

      <MatchRecapHeader match={match} />

      {!bundle || !report ? (
        <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-8 text-center space-y-2">
          <p className="text-sm text-text-secondary">
            {replay.status === 'error'
              ? `The replay data for this match could not be read: ${replay.error}`
              : 'The report is built from the match’s replay data, and this match has none attached yet.'}
          </p>
          <Link to={`/review/${matchId}`} className="text-sm text-val-cyan hover:underline">Attach it in the review</Link>
        </div>
      ) : (
        // Two columns from lg up, the replay panel sized by the splitter; one column below it.
        <div className="lg:flex lg:items-start">
          <div
            {...(isLg ? panelProps : null)}
            className="space-y-2 mb-4 lg:mb-0 lg:sticky lg:top-10 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
          >
            <ReportStage bundle={bundle} video={video} matchId={matchId} handleRef={stage} />
            {videoId && !video && (
              <p className="text-[11px] text-val-yellow px-1">
                This match has a video that is not synced yet. Sync the round 1 barrier drop in the{' '}
                <Link to={`/review/${matchId}`} className="underline">review</Link> and the duels here will open on it.
              </p>
            )}
          </div>
          {isLg && (
            // The handle stays in view with the panel it sizes, however long the text is.
            <div className="sticky top-10 flex h-[calc(100vh-3rem)] px-1">
              <SplitterHandle {...dragHandlers} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <ReportSections
              report={report}
              notes={stored.notes}
              trend={trend}
              tableMissing={stored.tableMissing}
              names={names}
              matchRounds={data.rounds}
              onWatch={onWatch}
              videoSecond={videoSecond}
              matchId={matchId}
            />
          </div>
        </div>
      )}
    </div>
  )
}
