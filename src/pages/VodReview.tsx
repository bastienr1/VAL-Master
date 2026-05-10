import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Match, VodReview as VodReviewType, VodTag, MatchRound, VodComment, RoundScreenshot } from '../lib/types'
import { fetchMatchRoundData, generateAutoTags, saveAutoTags } from '../lib/matchSync'
import InlineDebrief from '../components/InlineDebrief'
import MatchRecapHeader from '../components/MatchRecapHeader'
import MatchTimeline from '../components/MatchTimeline'
import CapturePanel from '../components/CapturePanel'
import NotesPanel from '../components/NotesPanel'
import { useSplitter, SplitterHandle } from '../components/ColumnSplitter'
import { resolveRoundFromTimestamp } from '../lib/roundResolver'
import {
  ArrowLeft, Play, Pause,
  SkipBack, SkipForward, Link as LinkIcon, Check, Clock, Film,
  Zap,
} from 'lucide-react'

// YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        config: {
          videoId: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (event: { target: YTPlayer }) => void
            onStateChange?: (event: { data: number; target: YTPlayer }) => void
          }
        }
      ) => YTPlayer
      PlayerState: {
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        ENDED: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}

interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  pauseVideo: () => void
  playVideo: () => void
  destroy: () => void
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function VodReview() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [vodReview, setVodReview] = useState<VodReviewType | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // YouTube state
  const playerRef = useRef<YTPlayer | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [urlSaved, setUrlSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Legacy vod_tags (auto-tags from barrier sync + any unconverted manual tags)
  const [tags, setTags] = useState<VodTag[]>([])

  // Match sync state
  const [matchRounds, setMatchRounds] = useState<MatchRound[]>([])
  const [roundsLoading, setRoundsLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Comments state
  const [comments, setComments] = useState<VodComment[]>([])
  const [screenshots, setScreenshots] = useState<RoundScreenshot[]>([])

  // Capture / focus state (Sprint 5b)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [activeRound, setActiveRound] = useState<number | null>(null)

  // Data loading
  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: matchData, error: matchError } = await supabase
          .from('matches')
          .select('*')
          .eq('match_id', matchId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (matchError) throw matchError
        if (!matchData) { setNotFound(true); return }
        setMatch(matchData)

        const { data: reviewData } = await supabase
          .from('vod_reviews')
          .select('*')
          .eq('match_id', matchId!)
          .eq('user_id', user.id)
          .maybeSingle()

        if (reviewData) {
          setVodReview(reviewData)
          setYoutubeUrl(reviewData.youtube_url)
          const vid = extractYouTubeId(reviewData.youtube_url)
          if (vid) setVideoId(vid)
        } else if (matchData.youtube_url) {
          setYoutubeUrl(matchData.youtube_url)
          const vid = extractYouTubeId(matchData.youtube_url)
          if (vid) setVideoId(vid)
        }
      } catch (err) {
        console.error('Failed to load match:', err)
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [matchId])

  // Load tags when vod_review is available
  useEffect(() => {
    if (!vodReview) return

    async function loadTags() {
      const { data, error } = await supabase
        .from('vod_tags')
        .select('*')
        .eq('vod_review_id', vodReview!.id)
        .order('timestamp_seconds', { ascending: true })

      if (!error && data) setTags(data)
    }
    loadTags()
  }, [vodReview])

  // Load comments when vod_review is available
  useEffect(() => {
    if (!vodReview) return

    async function loadComments() {
      const { data, error } = await supabase
        .from('vod_comments')
        .select('*')
        .eq('vod_review_id', vodReview!.id)
        .order('timestamp_seconds', { ascending: true })

      if (!error && data) setComments(data)
    }
    loadComments()
  }, [vodReview])

  // Load screenshots when match is available
  useEffect(() => {
    if (!match?.match_id) return

    async function loadScreenshots() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('round_screenshots')
        .select('*')
        .eq('match_id', match!.match_id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      if (!error && data) setScreenshots(data)
    }
    loadScreenshots()
  }, [match])

  // Load round data when match is available
  useEffect(() => {
    if (!match || !match.match_id) return

    async function loadRounds() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      setRoundsLoading(true)
      const rounds = await fetchMatchRoundData(match!.match_id, user.id)
      if (rounds) setMatchRounds(rounds)
      setRoundsLoading(false)
    }
    loadRounds()
  }, [match])

  // YouTube IFrame API loader
  useEffect(() => {
    if (!videoId) return

    setPlayerReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)

    const initPlayer = () => {
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch { /* ignore */ }
        playerRef.current = null
      }

      playerRef.current = new window.YT.Player('yt-player', {
        videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            setPlayerReady(true)
            setDuration(event.target.getDuration())
          },
          onStateChange: (event) => {
            const playing = event.data === window.YT.PlayerState.PLAYING
            setIsPlaying(playing)
          },
        },
      })
    }

    if (window.YT && window.YT.Player) {
      initPlayer()
    } else {
      window.onYouTubeIframeAPIReady = initPlayer
      if (!document.getElementById('yt-api-script')) {
        const tag = document.createElement('script')
        tag.id = 'yt-api-script'
        tag.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(tag)
      }
    }

    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch { /* ignore */ }
        playerRef.current = null
      }
    }
  }, [videoId])

  // Time tracking interval
  useEffect(() => {
    if (isPlaying && playerRef.current) {
      timerRef.current = setInterval(() => {
        if (playerRef.current) {
          setCurrentTime(playerRef.current.getCurrentTime())
        }
      }, 250)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying])

  // Playback controls
  const togglePlay = useCallback(() => {
    if (!playerRef.current || !playerReady) return
    if (isPlaying) {
      playerRef.current.pauseVideo()
    } else {
      playerRef.current.playVideo()
    }
  }, [isPlaying, playerReady])

  const seek = useCallback((offsetSeconds: number) => {
    if (!playerRef.current || !playerReady) return
    const newTime = Math.max(0, Math.min(playerRef.current.getCurrentTime() + offsetSeconds, duration))
    playerRef.current.seekTo(newTime, true)
    setCurrentTime(newTime)
  }, [playerReady, duration])

  const seekToTimestamp = useCallback((seconds: number) => {
    if (!playerRef.current || !playerReady) return
    playerRef.current.seekTo(seconds, true)
    setCurrentTime(seconds)
    const round = resolveRoundFromTimestamp(seconds, matchRounds, vodReview?.barrier_drop_offset ?? null)
    setActiveRound(round?.round_number ?? null)
  }, [playerReady, matchRounds, vodReview?.barrier_drop_offset])

  // Save YouTube URL
  const handleSaveUrl = async () => {
    const vid = extractYouTubeId(youtubeUrl)
    if (!vid) return

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('vod_reviews')
        .upsert({
          user_id: user.id,
          match_id: matchId!,
          youtube_url: youtubeUrl,
        }, { onConflict: 'match_id,user_id' })
        .select()
        .maybeSingle()

      if (error) throw error
      if (data) setVodReview(data)

      await supabase
        .from('matches')
        .update({ youtube_url: youtubeUrl })
        .eq('match_id', matchId!)
        .eq('user_id', user.id)

      setVideoId(vid)
      setUrlSaved(true)
      setTimeout(() => setUrlSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save URL:', err)
    } finally {
      setSaving(false)
    }
  }

  // === MATCH SYNC (calibration) ===
  const handleBarrierSync = async () => {
    if (!playerRef.current || !playerReady || !vodReview) return
    setSyncing(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const offset = Math.round(playerRef.current.getCurrentTime())

      // Save barrier offset to vod_reviews
      const { data, error } = await supabase
        .from('vod_reviews')
        .update({ barrier_drop_offset: offset })
        .eq('id', vodReview.id)
        .select()
        .maybeSingle()

      if (error) throw error
      if (data) setVodReview(data)

      // Generate and save auto-tags
      if (matchRounds.length > 0) {
        const autoTagData = generateAutoTags(matchRounds, offset)
        const savedTags = await saveAutoTags(vodReview.id, user.id, autoTagData)

        // Merge with existing manual tags
        setTags(prev => {
          const manualTags = prev.filter(t => !t.is_auto)
          return [...manualTags, ...savedTags].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
        })
      }
    } catch (err) {
      console.error('Failed to sync match:', err)
    } finally {
      setSyncing(false)
    }
  }

  // Comment handlers
  const handleCommentAdded = useCallback((comment: VodComment) => {
    setComments(prev => [...prev, comment].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
  }, [])

  const handleCommentDeleted = useCallback((commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId))
  }, [])

  const handleScreenshotAdded = useCallback((screenshot: RoundScreenshot) => {
    setScreenshots(prev => [...prev, screenshot])
  }, [])

  const handleScreenshotDeleted = useCallback((screenshotId: string) => {
    setScreenshots(prev => prev.filter(s => s.id !== screenshotId))
  }, [])

  const handleLegacyTagConverted = useCallback((tagId: string) => {
    setTags(prev => prev.filter(t => t.id !== tagId))
  }, [])

  // Open capture panel — pause video and show panel
  const openCapture = useCallback(() => {
    if (!playerRef.current || !playerReady || !vodReview) return
    playerRef.current.pauseVideo()
    setCaptureOpen(true)
  }, [playerReady, vodReview])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(e.shiftKey ? -10 : -5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(e.shiftKey ? 10 : 5)
          break
        case 't':
        case 'T':
          e.preventDefault()
          openCapture()
          break
        case 'Escape':
          e.preventDefault()
          setCaptureOpen(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, seek, openCapture])

  // Resizable notes panel (right column)
  const { width: notesPanelWidth, dragHandlers } = useSplitter({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 480,
    storageKey: 'vodReview.notesPanelWidth',
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !match) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-heading font-bold mb-4">Match not found</h2>
        <Link to="/" className="flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to Matches
        </Link>
      </div>
    )
  }

  const notedRoundCount = new Set(comments.map(c => c.round_number).filter((n): n is number => n != null)).size
  const legacyManualTags = tags.filter(t => !t.is_auto)

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-1 mb-2">
        <Link to="/" className="text-text-secondary hover:text-val-cyan transition-colors text-xs">
          Matches
        </Link>
        <span className="text-text-muted text-xs">/</span>
        <span className="text-text-primary text-xs font-medium">
          {match.agent} on {match.map} · {match.score} {match.result}
        </span>
        <span className="ml-auto text-text-muted text-xs">
          {matchRounds.length > 0
            ? `${notedRoundCount}/${matchRounds.length} rounds noted`
            : `${notedRoundCount} rounds noted`}
        </span>
      </div>

      {/* Match recap header */}
      <MatchRecapHeader match={match} />

      {/* Two-panel layout (flex + splitter) */}
      <div className="flex gap-4">

        {/* === LEFT PANEL: Video + Controls === */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* YouTube Player OR URL Input */}
          {videoId ? (
            <div className="space-y-2">
              {/* Video embed container — 16:9 aspect ratio */}
              <div className="relative w-full bg-black rounded-xl overflow-hidden" style={{ paddingBottom: '56.25%' }}>
                <div id="yt-player" className="absolute inset-0 w-full h-full" />
              </div>

              {/* Playback controls bar */}
              <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-2 flex items-center gap-3">
                <button
                  onClick={() => seek(-5)}
                  className="text-text-muted hover:text-val-cyan transition-colors"
                  title="Back 5s (←)"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  onClick={togglePlay}
                  className="w-9 h-9 rounded-full bg-val-cyan/10 border border-val-cyan/20 flex items-center justify-center text-val-cyan hover:bg-val-cyan/20 transition-colors"
                  title="Play/Pause (Space)"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>

                <button
                  onClick={() => seek(5)}
                  className="text-text-muted hover:text-val-cyan transition-colors"
                  title="Forward 5s (→)"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 ml-2">
                  <Clock className="w-3.5 h-3.5 text-text-muted" />
                  <span className="font-stats text-sm text-text-secondary">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="ml-auto text-[10px] text-text-muted hidden md:flex items-center gap-3">
                  <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Space</kbd> play/pause</span>
                  <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">←→</kbd> ±5s</span>
                  <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> capture</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 flex flex-col items-center text-center">
              <Film className="w-12 h-12 text-text-muted mb-3" />
              <h2 className="text-lg font-heading font-bold mb-1">Link Your VOD</h2>
              <p className="text-text-secondary text-sm mb-4 max-w-sm">
                Paste a YouTube URL to start reviewing this match. Record with Insights Capture, upload to YouTube, then link it here.
              </p>
              <div className="flex items-center gap-2 w-full max-w-lg">
                <input
                  type="text"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/40"
                />
                <button
                  onClick={handleSaveUrl}
                  disabled={!youtubeUrl || saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg text-sm font-medium hover:bg-val-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
                  ) : urlSaved ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <LinkIcon className="w-4 h-4" />
                  )}
                  {urlSaved ? 'Linked!' : 'Link Video'}
                </button>
              </div>
            </div>
          )}

          {/* URL editor — shown when video is already linked */}
          {videoId && (
            <div className="flex items-center gap-2">
              <LinkIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="flex-1 bg-transparent text-xs text-text-muted truncate focus:outline-none focus:text-text-secondary"
                title="YouTube URL — edit and press Update to change"
              />
              {extractYouTubeId(youtubeUrl) !== videoId && (
                <button
                  onClick={handleSaveUrl}
                  disabled={saving}
                  className="text-xs text-val-cyan hover:text-val-cyan/80 font-medium shrink-0"
                >
                  {saving ? 'Saving...' : 'Update'}
                </button>
              )}
            </div>
          )}

          {/* === MATCH SYNC + TIMELINE + CAPTURE === */}
          {videoId && playerReady && vodReview && (
            <div className="space-y-2">

              {/* Sync bar — shown when no barrier offset set yet */}
              {vodReview.barrier_drop_offset == null && matchRounds.length > 0 && (
                <div className="bg-bg-card border border-val-yellow/30 rounded-lg px-4 py-2 flex items-center gap-3">
                  <Zap className="w-4 h-4 text-val-yellow shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-text-secondary">
                      <strong className="text-val-yellow">Sync match data:</strong> Play the VOD to the moment R1 barriers drop, then click Sync.
                    </p>
                  </div>
                  <button
                    onClick={handleBarrierSync}
                    disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-val-yellow/10 text-val-yellow border border-val-yellow/20 rounded-lg text-xs font-medium hover:bg-val-yellow/20 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {syncing ? (
                      <div className="w-3 h-3 border-2 border-val-yellow border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Sync: Barriers Drop
                  </button>
                </div>
              )}

              {/* Re-sync option — shown when barrier offset IS set */}
              {vodReview.barrier_drop_offset != null && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <Zap className="w-3 h-3" />
                  <span>Synced at {formatTime(vodReview.barrier_drop_offset)} — {matchRounds.length} rounds loaded</span>
                  <button
                    onClick={handleBarrierSync}
                    disabled={syncing}
                    className="text-val-yellow hover:text-val-yellow/80 font-medium"
                  >
                    {syncing ? 'Syncing...' : 'Re-sync'}
                  </button>
                </div>
              )}

              {/* Rounds loading state */}
              {roundsLoading && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <div className="w-3 h-3 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
                  Loading round data from API...
                </div>
              )}

              {/* Match timeline */}
              {matchRounds.length > 0 && (
                <MatchTimeline
                  rounds={matchRounds}
                  duration={duration}
                  currentTime={currentTime}
                  barrierOffset={vodReview.barrier_drop_offset}
                  activeRound={activeRound}
                  onSeek={seekToTimestamp}
                  onRoundChange={setActiveRound}
                />
              )}

              {/* Capture panel */}
              <CapturePanel
                vodReviewId={vodReview.id}
                matchId={match.match_id}
                rounds={matchRounds}
                barrierOffset={vodReview.barrier_drop_offset}
                currentTime={currentTime}
                isPaused={!isPlaying}
                isOpen={captureOpen}
                onClose={() => setCaptureOpen(false)}
                onCommentAdded={handleCommentAdded}
                onScreenshotAdded={handleScreenshotAdded}
                onScreenshotDeleted={handleScreenshotDeleted}
                screenshots={screenshots}
              />
            </div>
          )}
        </div>

        <SplitterHandle {...dragHandlers} />

        {/* === RIGHT PANEL: Notes + Inline Debrief === */}
        <div style={{ width: notesPanelWidth, flexShrink: 0 }} className="space-y-3">
          {vodReview && (
            <NotesPanel
              comments={comments}
              screenshots={screenshots}
              rounds={matchRounds}
              legacyTags={legacyManualTags}
              activeRound={activeRound}
              vodReviewId={vodReview.id}
              barrierOffset={vodReview.barrier_drop_offset}
              onSeek={seekToTimestamp}
              onCommentDeleted={handleCommentDeleted}
              onCommentAdded={handleCommentAdded}
              onLegacyTagConverted={handleLegacyTagConverted}
            />
          )}
          {vodReview && (
            <InlineDebrief vodReview={vodReview} onUpdate={setVodReview} />
          )}
        </div>
      </div>
    </div>
  )
}
