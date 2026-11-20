import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import MatchRecapHeader from '../components/MatchRecapHeader'
import ReportSections, { type ReportNames } from '../components/report/ReportSections'
import ReportStage, { type ReportStageHandle, type ReportVideo } from '../components/report/ReportStage'
import { getLoadedGameContent, loadGameContent, type GameContentRegistry } from '../lib/gameContent'
import { buildMatchReport, type AbilitySlot } from '../lib/matchReport'
import { useReplayBundle } from '../lib/replays'
import { replayMsToVideoSeconds, weaponLabel } from '../lib/replaySync'
import { supabase } from '../lib/supabase'
import type { Match, MatchRound } from '../lib/types'
import { extractYouTubeId } from '../lib/youtube'

const ABILITY_SLOT: Record<AbilitySlot, 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'> = { C: 'Grenade', Q: 'Ability1', E: 'Ability2', X: 'Ultimate' }
const SLOT_FALLBACK: Record<AbilitySlot, string> = { C: 'Ability C', Q: 'Ability Q', E: 'Ability E', X: 'Ultimate' }

interface Loaded {
  match: Match
  /** The match's recording, whether or not it is synced. */
  videoId: string | null
  barrierOffset: number | null
  rounds: MatchRound[]
}

/**
 * A match's report (docs/match-report.md): what the replay says about the
 * rounds, the positioning, the duels and the kit, with the replay itself pinned
 * beside the text so each line can be watched while it is read.
 *
 * The numbers are worked out here, in the browser, from the bundle the review
 * page already attaches (`buildMatchReport`); nothing is stored.
 */
export default function MatchReport() {
  const { matchId } = useParams<{ matchId: string }>()
  const [loaded, setLoaded] = useState<{ matchId: string; data: Loaded | null } | null>(null)
  const [content, setContent] = useState<GameContentRegistry | null>(() => getLoadedGameContent())
  const replay = useReplayBundle(matchId)
  const stage = useRef<ReportStageHandle | null>(null)

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
      const [{ data: review }, { data: rounds }] = await Promise.all([
        supabase.from('vod_reviews').select('youtube_url, barrier_drop_offset').eq('match_id', id).eq('user_id', user.id).maybeSingle(),
        supabase.from('match_rounds').select('*').eq('match_id', id).eq('user_id', user.id).order('round_number', { ascending: true }),
      ])
      const url: string | null = review?.youtube_url || (match as { youtube_url?: string | null }).youtube_url || null
      return {
        match: match as Match,
        videoId: url ? extractYouTubeId(url) : null,
        barrierOffset: typeof review?.barrier_drop_offset === 'number' ? review.barrier_drop_offset : null,
        rounds: (rounds ?? []) as MatchRound[],
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
  const { match } = data

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
        <div className="grid gap-4 items-start lg:grid-cols-[minmax(300px,440px)_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-10 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto space-y-2">
            <ReportStage bundle={bundle} video={video} matchId={matchId} handleRef={stage} />
            {videoId && !video && (
              <p className="text-[11px] text-val-yellow px-1">
                This match has a video that is not synced yet. Sync the round 1 barrier drop in the{' '}
                <Link to={`/review/${matchId}`} className="underline">review</Link> and the duels here will open on it.
              </p>
            )}
          </aside>
          <ReportSections report={report} names={names} matchRounds={data.rounds} onWatch={onWatch} videoSecond={videoSecond} matchId={matchId} />
        </div>
      )}
    </div>
  )
}
