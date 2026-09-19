import { useCallback, useEffect, useRef, useState } from 'react'
import { EMBED_BLOCKED_CODES, loadYouTubeApi, type YTPlayer } from '../lib/youtube'

interface UseYouTubePlayerResult {
  ready: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  /** True when the owner disabled embedding — callers show a watch-on-YouTube row. */
  embedBlocked: boolean
  togglePlay: () => void
  /** Relative jump, clamped to the video. */
  seek: (offsetSeconds: number) => void
  seekTo: (seconds: number) => void
  pause: () => void
}

/**
 * Mounts a YouTube IFrame player into `elementId` and tracks its state.
 *
 * The same player lifecycle the VOD workstation has run since Sprint 5b, with
 * an `onError` hook added: pro broadcast channels disable embedding, and the
 * Pro Study screen needs to notice and link out instead of showing a dead box.
 */
export function useYouTubePlayer(elementId: string, videoId: string | null): UseYouTubePlayerResult {
  const playerRef = useRef<YTPlayer | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [ready, setReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [embedBlocked, setEmbedBlocked] = useState(false)

  // Swapping the video resets every derived reading. Done during render rather
  // than in the mount effect — the React-recommended way to adjust state when a
  // prop changes, and it avoids the cascading render an effect would cause.
  const [renderedVideoId, setRenderedVideoId] = useState(videoId)
  if (videoId !== renderedVideoId) {
    setRenderedVideoId(videoId)
    setReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setEmbedBlocked(false)
  }

  useEffect(() => {
    if (!videoId) return

    let disposed = false

    const initPlayer = () => {
      // The effect can be torn down while the API script is still loading.
      if (disposed || !document.getElementById(elementId)) return

      if (playerRef.current) {
        try { playerRef.current.destroy() } catch { /* ignore */ }
        playerRef.current = null
      }

      playerRef.current = new window.YT.Player(elementId, {
        videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            setReady(true)
            setDuration(event.target.getDuration())
          },
          onStateChange: (event) => {
            setIsPlaying(event.data === window.YT.PlayerState.PLAYING)
          },
          onError: (event) => {
            if (EMBED_BLOCKED_CODES.has(event.data)) setEmbedBlocked(true)
          },
        },
      })
    }

    loadYouTubeApi(initPlayer)

    return () => {
      disposed = true
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch { /* ignore */ }
        playerRef.current = null
      }
    }
  }, [elementId, videoId])

  // Poll the playhead only while it is actually moving.
  useEffect(() => {
    if (isPlaying && playerRef.current) {
      timerRef.current = setInterval(() => {
        if (playerRef.current) setCurrentTime(playerRef.current.getCurrentTime())
      }, 250)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying])

  const togglePlay = useCallback(() => {
    if (!playerRef.current || !ready) return
    if (isPlaying) playerRef.current.pauseVideo()
    else playerRef.current.playVideo()
  }, [isPlaying, ready])

  const seek = useCallback((offsetSeconds: number) => {
    if (!playerRef.current || !ready) return
    const next = Math.max(0, Math.min(playerRef.current.getCurrentTime() + offsetSeconds, duration))
    playerRef.current.seekTo(next, true)
    setCurrentTime(next)
  }, [ready, duration])

  const seekTo = useCallback((seconds: number) => {
    if (!playerRef.current || !ready) return
    playerRef.current.seekTo(seconds, true)
    setCurrentTime(seconds)
  }, [ready])

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo()
  }, [])

  return { ready, isPlaying, currentTime, duration, embedBlocked, togglePlay, seek, seekTo, pause }
}
