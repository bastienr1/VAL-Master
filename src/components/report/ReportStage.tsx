import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Pause, Play } from 'lucide-react'
import ReplayMinimap from '../ReplayMinimap'
import { useReplayClock } from '../../hooks/useReplayClock'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer'
import type { ReplayBundle } from '../../lib/replayBundle'
import { replayMsToVideoSeconds, roundAtReplayMs } from '../../lib/replaySync'
import { formatTime } from '../../lib/youtube'

/** What the report's text can ask of the stage beside it. */
export interface ReportStageHandle {
  /** Shows the moment at `replayMs` and plays from there. */
  watch: (replayMs: number) => void
}

export interface ReportVideo {
  videoId: string
  /** Video seconds at the round 1 barrier drop. */
  barrierOffset: number
}

interface ReportStageProps {
  bundle: ReplayBundle
  /** The match's synced recording; null plays the map on a clock of its own. */
  video: ReportVideo | null
  matchId: string
  handleRef: RefObject<ReportStageHandle | null>
}

const SPEEDS = [1, 2, 4]

/**
 * The replay beside the report (docs/match-report.md): the match's recording
 * with the minimap following it when there is a synced one, the minimap on its
 * own clock when there is not. Either way the text drives it through
 * `handleRef`, so a duel or a round in the report is one click from being seen.
 */
export default function ReportStage(props: ReportStageProps) {
  return props.video ? <VideoStage {...props} video={props.video} /> : <ClockStage {...props} />
}

function usePlaysHref(matchId: string) {
  return useCallback((n: number) => `/plays/new?replay=${matchId}&round=${n}`, [matchId])
}

function VideoStage({ bundle, video, matchId, handleRef }: ReportStageProps & { video: ReportVideo }) {
  const { containerRef, embedBlocked, isPlaying, getCurrentTime, seekTo, play } = useYouTubePlayer(video.videoId)
  const playsHref = usePlaysHref(matchId)

  // The minimap is memoized and its frame loop outlives renders: it gets
  // callbacks that never change and read the player through a ref.
  const player = useRef({ getCurrentTime, seekTo, play })
  useEffect(() => {
    player.current = { getCurrentTime, seekTo, play }
  })
  const getVideoTime = useCallback(() => player.current.getCurrentTime(), [])
  const getPlaybackRate = useCallback(() => 1, [])
  const onSeek = useCallback((seconds: number) => player.current.seekTo(seconds), [])

  useEffect(() => {
    handleRef.current = {
      watch: (replayMs) => {
        player.current.seekTo(Math.max(0, replayMsToVideoSeconds(bundle, video.barrierOffset, replayMs)))
        player.current.play()
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [bundle, video.barrierOffset, handleRef])

  return (
    <div className="space-y-2">
      {embedBlocked ? (
        <a
          href={`https://www.youtube.com/watch?v=${video.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm text-val-cyan hover:underline"
        >
          Watch on YouTube ↗
        </a>
      ) : (
        <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
        </div>
      )}
      <ReplayMinimap
        bundle={bundle}
        barrierOffset={video.barrierOffset}
        getVideoTime={getVideoTime}
        getPlaybackRate={getPlaybackRate}
        isPlaying={isPlaying}
        onSeek={onSeek}
        playsHref={playsHref}
      />
    </div>
  )
}

function ClockStage({ bundle, matchId, handleRef }: ReportStageProps) {
  const clock = useReplayClock(bundle)
  const playsHref = usePlaysHref(matchId)
  const { seekMs, play } = clock

  useEffect(() => {
    handleRef.current = {
      watch: (replayMs) => {
        seekMs(replayMs)
        play()
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [seekMs, play, handleRef])

  // The slider spans the round on screen: from just before its barrier drop to just after its end.
  const span = useMemo(() => {
    const round = roundAtReplayMs(bundle, clock.shownMs)
    const next = bundle.rounds.find(r => r.n === round.n + 1)
    const barrier = round.barrierMs ?? round.buyStartMs
    const from = Math.max(round.buyStartMs, barrier - 3000)
    const to = (round.endMs ?? next?.buyStartMs ?? bundle.match.durationMs) + 4000
    return { from, to, barrier }
  }, [bundle, clock.shownMs])

  return (
    <div className="space-y-2">
      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={clock.isPlaying ? 'Pause the replay' : 'Play the replay'}
          className="w-8 h-8 shrink-0 rounded-md bg-val-cyan/10 text-val-cyan border border-val-cyan/25 hover:bg-val-cyan/20 flex items-center justify-center transition-colors"
        >
          {clock.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min={span.from}
          max={span.to}
          step={100}
          value={Math.max(span.from, Math.min(span.to, clock.shownMs))}
          onChange={e => clock.seekMs(Number(e.target.value))}
          aria-label="Time in the round"
          className="flex-1 min-w-0 accent-val-cyan"
        />
        <span className="font-stats text-xs text-text-secondary w-10 text-right">
          {clock.shownMs < span.barrier ? 'buy' : formatTime((clock.shownMs - span.barrier) / 1000)}
        </span>
        <div className="flex gap-1" role="group" aria-label="Speed">
          {SPEEDS.map(speed => (
            <button
              key={speed}
              type="button"
              onClick={() => clock.setRate(speed)}
              aria-pressed={clock.rate === speed}
              className={`px-1.5 py-0.5 rounded text-[10px] font-stats transition-colors ${
                clock.rate === speed ? 'bg-val-cyan/15 text-val-cyan' : 'bg-bg-elevated text-text-muted hover:text-text-secondary'
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
      <ReplayMinimap
        bundle={bundle}
        barrierOffset={clock.anchor}
        getVideoTime={clock.getTime}
        getPlaybackRate={clock.getRate}
        isPlaying={clock.isPlaying}
        onSeek={clock.seekSeconds}
        playsHref={playsHref}
      />
    </div>
  )
}
