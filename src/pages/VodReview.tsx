import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { Match, VodReview as VodReviewType } from '../lib/types'
import {
  ArrowLeft, Crosshair, Target, Swords, Percent, Play, Pause,
  SkipBack, SkipForward, Link as LinkIcon, Check, Clock, Film
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

function StatRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-text-muted" />
      <span className="text-[10px] text-text-muted uppercase w-8">{label}</span>
      <span className="text-xs font-stats font-medium text-text-primary">{value}</span>
    </div>
  )
}

export default function VodReview() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [_vodReview, setVodReview] = useState<VodReviewType | null>(null)
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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, seek])

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

  const resultColor = match.result === 'W' ? 'val-green' : match.result === 'L' ? 'val-red' : 'val-yellow'
  const resultLabel = match.result === 'W' ? 'VICTORY' : match.result === 'L' ? 'DEFEAT' : 'DRAW'
  const date = new Date(match.match_date)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">

        {/* === LEFT PANEL: Video + Controls === */}
        <div className="space-y-3">

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
                  <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Shift+←→</kbd> ±10s</span>
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

          {/* Sprint 3 preview — tagging placeholder */}
          {videoId && playerReady && (
            <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-3 text-center">
              <p className="text-text-muted text-xs">
                🏷️ Timestamped tagging — Sprint 3. Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> to tag moments while watching.
              </p>
            </div>
          )}
        </div>

        {/* === RIGHT PANEL: Match Context === */}
        <div className="space-y-3">

          {/* Match context card */}
          <div className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
            <div className="relative h-28">
              <img
                src={getMapSplash(match.map)}
                alt={match.map}
                className="absolute inset-0 w-full h-full object-cover opacity-30"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

              <div className="absolute bottom-2 left-3 flex items-center gap-2">
                <img
                  src={getAgentIcon(match.agent)}
                  alt={match.agent}
                  className="w-10 h-10 rounded-full border-2 border-bg-card"
                />
                <div>
                  <h2 className="text-sm font-heading font-bold leading-tight">{match.agent} on {match.map}</h2>
                  <p className="text-[10px] text-text-muted">{dateStr} · {timeStr}</p>
                </div>
              </div>

              <div className="absolute bottom-2 right-3 text-right">
                <div className={`text-xl font-stats font-bold text-${resultColor}`}>{match.score}</div>
                <div className={`text-[10px] font-bold text-${resultColor}`}>{resultLabel}</div>
              </div>
            </div>

            <div className="px-3 py-3 border-t border-bg-elevated grid grid-cols-2 gap-y-2 gap-x-4">
              <StatRow icon={Target} label="ACS" value={match.acs} />
              <StatRow icon={Crosshair} label="K/D" value={match.kd} />
              <StatRow icon={Swords} label="KDA" value={`${match.kills}/${match.deaths}/${match.assists}`} />
              <StatRow icon={Percent} label="HS%" value={`${match.headshot_pct}%`} />
              <StatRow icon={Crosshair} label="KPR" value={match.kpr} />
              <StatRow icon={Target} label="DPR" value={match.dpr} />
            </div>
          </div>

          {/* Sprint 4 preview — inline debrief placeholder */}
          <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-6 text-center">
            <p className="text-text-muted text-xs">
              📝 Inline debrief — Sprint 4. Peak moment, key lesson, themes, quality rating.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
