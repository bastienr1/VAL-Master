import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Volume2, VolumeX } from 'lucide-react'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer'
import type { ReplayBundle } from '../../lib/replayBundle'
import { replayMsToVideoSeconds } from '../../lib/replaySync'
import { getReplayVod, type ReplayVod } from '../../lib/replayVod'
import type { ValueStore } from '../../lib/valueStore'
import { shouldSeekVideo, videoRateFor } from '../../lib/vodFollow'

interface ReplayVodPlayerProps {
  matchId: string
  bundle: ReplayBundle
  /** Where the replay is. */
  clock: Pick<ValueStore<{ ms: number } | null>, 'get' | 'subscribe'>
  playing: boolean
  speed: number
  onTogglePlay(): void
}

const MUTED_KEY = 'plays.vodMuted'

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) !== 'false'
  } catch {
    return true
  }
}

const note = 'text-[11px] text-text-secondary'

function SyncedVideo({ vod, bundle, clock, playing, speed, onTogglePlay }: Omit<ReplayVodPlayerProps, 'matchId'> & { vod: ReplayVod }) {
  const offset = vod.barrierOffset
  const following = offset !== null
  const { containerRef, ready, isPlaying, embedBlocked, seekTo, pause, play, setRate, setMuted, getCurrentTime } = useYouTubePlayer(vod.videoId, {
    controls: !following,
  })
  // Off by default: a muted video may start from code, and the map is what is being read.
  const [muted, setMutedState] = useState(readMuted)
  useEffect(() => {
    if (ready) setMuted(muted)
  }, [ready, muted, setMuted])
  const toggleMuted = () => {
    setMutedState(m => {
      try {
        localStorage.setItem(MUTED_KEY, String(!m))
      } catch {
        /* a preference only */
      }
      return !m
    })
  }

  const rate = videoRateFor(speed)
  const running = following && playing && rate !== null

  // The video plays when the replay plays. A seek on a video not started yet makes YouTube start it: stopped here too.
  useEffect(() => {
    if (!ready || !following) return
    if (running && rate !== null) {
      setRate(rate)
      play()
    } else if (isPlaying) {
      pause()
    }
  }, [ready, following, running, rate, isPlaying, play, pause, setRate])

  // And goes where the replay goes.
  const latest = useRef({ getCurrentTime, seekTo, running })
  useEffect(() => {
    latest.current = { getCurrentTime, seekTo, running }
  })
  const lastSeek = useRef(0)
  useEffect(() => {
    if (!ready || offset === null) return
    const follow = () => {
      const shown = clock.get()
      if (!shown) return
      const target = Math.max(0, replayMsToVideoSeconds(bundle, offset, shown.ms))
      const now = performance.now()
      if (shouldSeekVideo(latest.current.getCurrentTime() - target, latest.current.running, now - lastSeek.current)) {
        lastSeek.current = now
        latest.current.seekTo(target)
      }
    }
    follow()
    return clock.subscribe(follow)
  }, [ready, offset, bundle, clock, running])

  if (embedBlocked) {
    return (
      <a href={`https://www.youtube.com/watch?v=${vod.videoId}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-val-cyan hover:underline">
        Watch on YouTube ↗
      </a>
    )
  }

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {following && (
        <>
          {/* The replay's transport drives the video; a click here is its play button. */}
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause the replay' : 'Play the replay'}
            className="absolute inset-0 w-full h-full cursor-pointer"
          />
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={!muted}
            aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
            title={muted ? 'Sound off' : 'Sound on'}
            className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md bg-bg-primary/80 text-text-secondary hover:text-val-cyan transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </>
      )}
    </div>
  )
}

/** The match's VOD at the top of the Rounds panel (§2.12), following the replay once synced on the review page. */
export default function ReplayVodPlayer({ matchId, ...props }: ReplayVodPlayerProps) {
  const [loaded, setLoaded] = useState<{ matchId: string; vod: ReplayVod | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    getReplayVod(matchId)
      .catch(() => null)
      .then(vod => {
        if (!cancelled) setLoaded({ matchId, vod })
      })
    return () => {
      cancelled = true
    }
  }, [matchId])

  const reviewLink = (
    // A new tab: the editor has no unsaved-changes guard, so leaving it would drop the play.
    <Link to={`/review/${matchId}`} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
      review page ↗
    </Link>
  )

  if (!loaded || loaded.matchId !== matchId) {
    return (
      <div className="px-2 pt-2">
        <div className="aspect-video rounded-lg bg-bg-elevated animate-pulse" aria-hidden="true" />
      </div>
    )
  }
  if (!loaded.vod) {
    return <p className={`px-3 pt-3 ${note}`}>No VOD on this match yet. Add one on its {reviewLink}.</p>
  }
  return (
    <div className="px-2 pt-2 space-y-1">
      <SyncedVideo key={loaded.vod.videoId} vod={loaded.vod} {...props} />
      {loaded.vod.barrierOffset === null && <p className={`px-1 ${note}`}>Not synced yet: mark the barrier drop on the {reviewLink} and the video will follow the replay.</p>}
      {loaded.vod.barrierOffset !== null && videoRateFor(props.speed) === null && <p className={`px-1 ${note}`}>The video waits above 2× and catches up when you pause.</p>}
    </div>
  )
}
