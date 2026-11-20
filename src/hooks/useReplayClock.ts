import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayBundle } from '../lib/replayBundle'
import { replayMsToVideoSeconds, videoSecondsToReplayMs } from '../lib/replaySync'

/**
 * The anchor the clock hands the minimap in place of a video's: "video second"
 * 60 is the round 1 barrier drop, which leaves room to show the first buy phase.
 */
export const CLOCK_ANCHOR_S = 60

/** How long before a round's barrier drop the clock lands when it skips a buy phase. */
const LEAD_IN_MS = 3000
/** How long after a round is decided the clock keeps running before it skips ahead. */
const TAIL_MS = 4000

export interface ReplayClock {
  /** Pass to the minimap as `barrierOffset`. */
  anchor: number
  isPlaying: boolean
  rate: number
  /** The replay time last shown, refreshed five times a second while playing: for a slider, not for drawing. */
  shownMs: number
  getTime: () => number
  getRate: () => number
  /** In the minimap's own unit (seconds on the clock), as its `onSeek` gives it. */
  seekSeconds: (seconds: number) => void
  seekMs: (replayMs: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  setRate: (rate: number) => void
}

/**
 * A clock for a replay that has no video to follow (docs/match-report.md).
 *
 * The minimap asks a video for its time every frame. Here it asks this clock
 * instead, in the same unit, so the component needs no second mode. Buy phases
 * are skipped while playing: nothing happens on the map in them.
 */
export function useReplayClock(bundle: ReplayBundle): ReplayClock {
  const startMs = bundle.rounds[0]?.barrierMs != null ? bundle.rounds[0].barrierMs - LEAD_IN_MS : 0
  const timeRef = useRef(startMs)
  const rateRef = useRef(1)
  const [isPlaying, setPlaying] = useState(false)
  const [rate, setRateState] = useState(1)
  const [shownMs, setShownMs] = useState(startMs)

  // Another match's bundle starts its own clock.
  const [clockOf, setClockOf] = useState(bundle)
  if (clockOf !== bundle) {
    setClockOf(bundle)
    setPlaying(false)
    setShownMs(startMs)
  }
  useEffect(() => {
    timeRef.current = startMs
  }, [bundle, startMs])

  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      let t = timeRef.current + (now - last) * rateRef.current
      last = now
      // Past a round's end and short of the next barrier drop: jump to it.
      for (const round of bundle.rounds) {
        if (round.buyStartMs > t) break
        const next = bundle.rounds.find(r => r.n === round.n + 1)
        if (round.endMs != null && next?.barrierMs != null && t > round.endMs + TAIL_MS && t < next.barrierMs - LEAD_IN_MS) {
          t = next.barrierMs - LEAD_IN_MS
        }
      }
      if (t >= bundle.match.durationMs) {
        t = bundle.match.durationMs
        setPlaying(false)
      }
      timeRef.current = t
    }
    raf = requestAnimationFrame(tick)
    const shown = setInterval(() => setShownMs(timeRef.current), 200)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(shown)
    }
  }, [isPlaying, bundle])

  const getTime = useCallback(() => replayMsToVideoSeconds(bundle, CLOCK_ANCHOR_S, timeRef.current), [bundle])
  const getRate = useCallback(() => rateRef.current, [])
  const seekMs = useCallback((replayMs: number) => {
    const t = Math.max(0, Math.min(bundle.match.durationMs, replayMs))
    timeRef.current = t
    setShownMs(t)
  }, [bundle])
  const seekSeconds = useCallback((seconds: number) => seekMs(videoSecondsToReplayMs(bundle, CLOCK_ANCHOR_S, seconds)), [bundle, seekMs])
  const play = useCallback(() => setPlaying(true), [])
  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => setPlaying(p => !p), [])
  const setRate = useCallback((next: number) => {
    rateRef.current = next
    setRateState(next)
  }, [])

  return useMemo(
    () => ({ anchor: CLOCK_ANCHOR_S, isPlaying, rate, shownMs, getTime, getRate, seekSeconds, seekMs, play, pause, toggle, setRate }),
    [isPlaying, rate, shownMs, getTime, getRate, seekSeconds, seekMs, play, pause, toggle, setRate],
  )
}
