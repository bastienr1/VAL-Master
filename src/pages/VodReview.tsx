import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { Match, VodReview as VodReviewType, VodTag, MatchRound, VodComment } from '../lib/types'
import { fetchMatchRoundData, generateAutoTags, saveAutoTags } from '../lib/matchSync'
import RoundCard from '../components/RoundCard'
import InlineDebrief from '../components/InlineDebrief'
import {
  ArrowLeft, Crosshair, Target, Swords, Percent, Play, Pause,
  SkipBack, SkipForward, Link as LinkIcon, Check, Clock, Film,
  Tag, Trash2, Plus, X, Zap, ChevronDown, ChevronRight
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

const MANUAL_TAG_TYPES = [
  { type: 'strength', label: 'Strength', color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  { type: 'mistake', label: 'Mistake', color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  { type: 'read', label: 'Read', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  { type: 'clutch', label: 'Clutch', color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  { type: 'comms', label: 'Comms', color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  { type: 'positioning', label: 'Position', color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  { type: 'utility', label: 'Utility', color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  { type: 'economy', label: 'Economy', color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  { type: 'aim', label: 'Aim', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
] as const

const ALL_TAG_COLORS: Record<string, { color: string; textColor: string; dotColor: string }> = {
  strength: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  mistake: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  read: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  clutch: { color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  comms: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  positioning: { color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  utility: { color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  economy: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  aim: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  round: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#475569' },
  kill: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  death: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  half: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
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

  // Tagging state
  const [tags, setTags] = useState<VodTag[]>([])
  const [isTagging, setIsTagging] = useState(false)
  const [selectedTagType, setSelectedTagType] = useState<string>('strength')
  const [tagLabel, setTagLabel] = useState('')
  const [tagTimestamp, setTagTimestamp] = useState(0)
  const [savingTag, setSavingTag] = useState(false)
  const tagLabelRef = useRef<HTMLInputElement>(null)

  // Match sync state
  const [matchRounds, setMatchRounds] = useState<MatchRound[]>([])
  const [roundsLoading, setRoundsLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [showAutoTags, setShowAutoTags] = useState(true)

  // Comments state
  const [comments, setComments] = useState<VodComment[]>([])
  const [atkExpanded, setAtkExpanded] = useState(true)
  const [defExpanded, setDefExpanded] = useState(true)

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

  // Start tagging flow
  const startTagging = useCallback((preselectedType?: string) => {
    if (!playerRef.current || !playerReady || !vodReview) return
    playerRef.current.pauseVideo()
    const ts = playerRef.current.getCurrentTime()
    setTagTimestamp(ts)
    setSelectedTagType(preselectedType || 'strength')
    setTagLabel('')
    setIsTagging(true)
    setTimeout(() => tagLabelRef.current?.focus(), 50)
  }, [playerReady, vodReview])

  // Save a tag
  const saveTag = async () => {
    if (!tagLabel.trim() || !vodReview) return

    setSavingTag(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('vod_tags')
        .insert({
          user_id: user.id,
          vod_review_id: vodReview.id,
          timestamp_seconds: Math.round(tagTimestamp),
          tag_type: selectedTagType,
          label: tagLabel.trim(),
          is_auto: false,
        })
        .select()
        .single()

      if (error) throw error
      if (data) {
        setTags(prev => [...prev, data].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
      }

      setIsTagging(false)
      setTagLabel('')
    } catch (err) {
      console.error('Failed to save tag:', err)
    } finally {
      setSavingTag(false)
    }
  }

  // Delete a tag
  const deleteTag = async (tagId: string) => {
    try {
      const { error } = await supabase
        .from('vod_tags')
        .delete()
        .eq('id', tagId)

      if (!error) {
        setTags(prev => prev.filter(t => t.id !== tagId))
      }
    } catch (err) {
      console.error('Failed to delete tag:', err)
    }
  }

  // Cancel tagging
  const cancelTagging = () => {
    setIsTagging(false)
    setTagLabel('')
  }

  // Seek to tag timestamp
  const seekToTag = (seconds: number) => {
    if (!playerRef.current || !playerReady) return
    playerRef.current.seekTo(seconds, true)
    setCurrentTime(seconds)
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
  const handleCommentAdded = (comment: VodComment) => {
    setComments(prev => [...prev, comment].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
  }

  const handleCommentDeleted = (commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId))
  }

  // Compute video timestamps for rounds (same logic as generateAutoTags)
  const getRoundVideoTime = useCallback((round: MatchRound): number => {
    if (!vodReview?.barrier_drop_offset) return 0
    const r1StartMs = matchRounds[0]?.round_start_ms
    if (r1StartMs && round.round_start_ms) {
      return vodReview.barrier_drop_offset + (round.round_start_ms - r1StartMs) / 1000
    }
    // Fallback: estimate from round index
    return vodReview.barrier_drop_offset + ((round.round_number - 1) * 110)
  }, [vodReview?.barrier_drop_offset, matchRounds])

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
          if (!isTagging) {
            startTagging('strength')
          }
          break
        case 'Escape':
          e.preventDefault()
          if (isTagging) {
            cancelTagging()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, seek, isTagging, startTagging, cancelTagging])

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
                  <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> tag</span>
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

          {/* === TAGGING + MATCH SYNC === */}
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
                  <label className="ml-auto flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAutoTags}
                      onChange={(e) => setShowAutoTags(e.target.checked)}
                      className="w-3 h-3 accent-val-cyan"
                    />
                    <span>Show auto-tags</span>
                  </label>
                </div>
              )}

              {/* Rounds loading state */}
              {roundsLoading && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <div className="w-3 h-3 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
                  Loading round data from API...
                </div>
              )}

              {/* Tag input bar — shown when tagging is active */}
              {isTagging ? (
                <div className="bg-bg-card border border-val-cyan/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-stats text-xs text-val-cyan">
                      {formatTime(tagTimestamp)}
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {MANUAL_TAG_TYPES.map(t => (
                        <button
                          key={t.type}
                          onClick={() => setSelectedTagType(t.type)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                            selectedTagType === t.type
                              ? `${t.color}/20 ${t.textColor} border-current`
                              : 'bg-bg-elevated text-text-muted border-transparent hover:border-bg-card'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={tagLabelRef}
                      type="text"
                      value={tagLabel}
                      onChange={(e) => setTagLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagLabel.trim()) saveTag()
                        if (e.key === 'Escape') cancelTagging()
                      }}
                      placeholder="What happened here? (e.g., clean one-tap B site)"
                      className="flex-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/40"
                    />
                    <button
                      onClick={saveTag}
                      disabled={!tagLabel.trim() || savingTag}
                      className="flex items-center gap-1 px-3 py-1.5 bg-val-green/10 text-val-green border border-val-green/20 rounded-lg text-xs font-medium hover:bg-val-green/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingTag ? (
                        <div className="w-3 h-3 border-2 border-val-green border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      Save
                    </button>
                    <button onClick={cancelTagging} className="p-1.5 text-text-muted hover:text-text-secondary transition-colors" title="Cancel (Esc)">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <div className="flex gap-1 flex-wrap">
                    {MANUAL_TAG_TYPES.map(t => (
                      <button
                        key={t.type}
                        onClick={() => startTagging(t.type)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${t.color}/10 ${t.textColor} border border-transparent hover:border-current transition-colors`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-[10px] text-text-muted hidden md:block">
                    <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> quick tag
                  </span>
                </div>
              )}

              {/* Visual timeline scrubber */}
              {(() => {
                const visibleTags = showAutoTags ? tags : tags.filter(t => !t.is_auto)
                if (visibleTags.length === 0) return null

                return (
                  <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                    <div
                      className="relative h-6 bg-bg-elevated rounded-full cursor-pointer group"
                      onClick={(e) => {
                        if (!playerRef.current || !duration) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const pct = (e.clientX - rect.left) / rect.width
                        const seekTime = pct * duration
                        playerRef.current.seekTo(seekTime, true)
                        setCurrentTime(seekTime)
                      }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-white/5 rounded-full transition-all"
                        style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                      />

                      {/* Half-switch marker line */}
                      {visibleTags.filter(t => t.tag_type === 'half').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        return (
                          <div
                            key={tag.id}
                            className="absolute top-0 bottom-0 w-px bg-val-yellow/40"
                            style={{ left: `${Math.max(1, Math.min(99, pct))}%` }}
                            title={tag.label}
                          />
                        )
                      })}

                      {/* Round markers (small ticks) */}
                      {showAutoTags && visibleTags.filter(t => t.tag_type === 'round').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        return (
                          <button
                            key={tag.id}
                            onClick={(e) => { e.stopPropagation(); seekToTag(tag.timestamp_seconds) }}
                            className="absolute top-0 w-px h-2 bg-text-muted/30 hover:bg-text-muted/60 transition-colors"
                            style={{ left: `${Math.max(1, Math.min(99, pct))}%` }}
                            title={tag.label}
                          />
                        )
                      })}

                      {/* Tag dots (non-structural) */}
                      {visibleTags.filter(t => t.tag_type !== 'round' && t.tag_type !== 'half').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        const tagMeta = ALL_TAG_COLORS[tag.tag_type]
                        return (
                          <button
                            key={tag.id}
                            onClick={(e) => { e.stopPropagation(); seekToTag(tag.timestamp_seconds) }}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-bg-card hover:scale-150 transition-transform z-10"
                            style={{
                              left: `${Math.max(1, Math.min(99, pct))}%`,
                              backgroundColor: tagMeta?.dotColor || '#64748B',
                            }}
                            title={`${formatTime(tag.timestamp_seconds)} — ${tag.label}`}
                          />
                        )
                      })}

                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-4 bg-white rounded-full opacity-60 pointer-events-none"
                        style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-text-muted">
                        {tags.filter(t => !t.is_auto).length} manual · {tags.filter(t => t.is_auto).length} auto
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Hierarchical Round View */}
              {vodReview.barrier_drop_offset != null && matchRounds.length > 0 && (
                <div className="space-y-3">
                  {/* ATK section */}
                  {(() => {
                    const atkRounds = matchRounds.filter(r => r.side === 'attack')
                    if (atkRounds.length === 0) return null
                    return (
                      <div>
                        <button
                          onClick={() => setAtkExpanded(!atkExpanded)}
                          className="w-full flex items-center gap-2 mb-1 hover:opacity-80 transition-opacity"
                        >
                          {atkExpanded ? <ChevronDown className="w-3 h-3 text-val-red" /> : <ChevronRight className="w-3 h-3 text-val-red" />}
                          <span className="text-[10px] font-bold text-val-red uppercase tracking-widest">Attack</span>
                          <span className="text-[10px] text-text-muted">({atkRounds.length})</span>
                          <div className="flex-1 h-px bg-val-red/20" />
                        </button>
                        {atkExpanded && <div className="space-y-1">
                          {atkRounds.map(round => (
                            <RoundCard
                              key={round.round_number}
                              round={round}
                              roundVideoTime={getRoundVideoTime(round)}
                              r1StartMs={matchRounds[0]?.round_start_ms}
                              manualTags={tags.filter(t => !t.is_auto && t.round_number === round.round_number)}
                              comments={comments.filter(c => c.round_number === round.round_number)}
                              vodReviewId={vodReview.id}
                              onSeek={seekToTag}
                              onCommentAdded={handleCommentAdded}
                              onCommentDeleted={handleCommentDeleted}
                            />
                          ))}
                        </div>}
                      </div>
                    )
                  })()}

                  {/* DEF section */}
                  {(() => {
                    const defRounds = matchRounds.filter(r => r.side === 'defense')
                    if (defRounds.length === 0) return null
                    return (
                      <div>
                        <button
                          onClick={() => setDefExpanded(!defExpanded)}
                          className="w-full flex items-center gap-2 mb-1 hover:opacity-80 transition-opacity"
                        >
                          {defExpanded ? <ChevronDown className="w-3 h-3 text-val-cyan" /> : <ChevronRight className="w-3 h-3 text-val-cyan" />}
                          <span className="text-[10px] font-bold text-val-cyan uppercase tracking-widest">Defense</span>
                          <span className="text-[10px] text-text-muted">({defRounds.length})</span>
                          <div className="flex-1 h-px bg-val-cyan/20" />
                        </button>
                        {defExpanded && <div className="space-y-1">
                          {defRounds.map(round => (
                            <RoundCard
                              key={round.round_number}
                              round={round}
                              roundVideoTime={getRoundVideoTime(round)}
                              r1StartMs={matchRounds[0]?.round_start_ms}
                              manualTags={tags.filter(t => !t.is_auto && t.round_number === round.round_number)}
                              comments={comments.filter(c => c.round_number === round.round_number)}
                              vodReviewId={vodReview.id}
                              onSeek={seekToTag}
                              onCommentAdded={handleCommentAdded}
                              onCommentDeleted={handleCommentDeleted}
                            />
                          ))}
                        </div>}
                      </div>
                    )
                  })()}

                  {/* Unlinked manual tags (tags without a round_number) */}
                  {(() => {
                    const unlinkedTags = tags.filter(t => !t.is_auto && !t.round_number)
                    if (unlinkedTags.length === 0) return null
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">General Tags</span>
                          <div className="flex-1 h-px bg-bg-elevated" />
                        </div>
                        <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                          <div className="divide-y divide-bg-elevated">
                            {unlinkedTags.map(tag => {
                              const tagColor = ALL_TAG_COLORS[tag.tag_type]
                              return (
                                <div
                                  key={tag.id}
                                  className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 cursor-pointer group transition-colors"
                                  onClick={() => seekToTag(tag.timestamp_seconds)}
                                >
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagColor?.dotColor || '#64748B' }} />
                                  <span className="font-stats text-[11px] text-val-cyan w-10 shrink-0">{formatTime(tag.timestamp_seconds)}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tagColor?.color}/15 ${tagColor?.textColor} shrink-0`}>{tag.tag_type}</span>
                                  <span className="text-xs text-text-secondary truncate flex-1">{tag.label}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteTag(tag.id) }}
                                    className="p-1 text-text-muted hover:text-val-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Flat tag list fallback — when no barrier sync yet */}
              {(vodReview.barrier_drop_offset == null || matchRounds.length === 0) && tags.length > 0 && (
                <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                  <div className="max-h-60 overflow-y-auto divide-y divide-bg-elevated">
                    {(showAutoTags ? tags : tags.filter(t => !t.is_auto)).map(tag => {
                      const tagMeta = ALL_TAG_COLORS[tag.tag_type]
                      return (
                        <div
                          key={tag.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 cursor-pointer group transition-colors"
                          onClick={() => seekToTag(tag.timestamp_seconds)}
                        >
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagMeta?.dotColor || '#64748B' }} />
                          <span className="font-stats text-[11px] text-val-cyan w-10 shrink-0">{formatTime(tag.timestamp_seconds)}</span>
                          {tag.round_number && <span className="text-[9px] text-text-muted w-6 shrink-0">R{tag.round_number}</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tagMeta?.color}/15 ${tagMeta?.textColor} shrink-0`}>{tag.tag_type}</span>
                          <span className="text-xs text-text-secondary truncate flex-1">{tag.label}</span>
                          {tag.is_auto ? (
                            <span className="text-[9px] text-text-muted shrink-0">auto</span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteTag(tag.id) }}
                              className="p-1 text-text-muted hover:text-val-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
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

          {/* Inline debrief */}
          {vodReview && (
            <InlineDebrief vodReview={vodReview} onUpdate={setVodReview} />
          )}
        </div>
      </div>
    </div>
  )
}
