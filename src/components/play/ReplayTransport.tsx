import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Camera, Film, Pause, Play, X } from 'lucide-react'
import { averageShare, controlTimeline, type ControlShare } from '../../lib/mapControl'
import type { ReplayBundle, ReplayRound } from '../../lib/replayBundle'
import { formatRoundClock, roundSpan, roundTicks } from '../../lib/replayFrame'
import type { MapTransform } from '../../lib/replayScene'
import type { ValueStore } from '../../lib/valueStore'

export type ReplayView = 'replay' | 'steps'

/** Where the replay is: the time in ms, the round it is held in, and each team's share of the map then (null with the overlay off). */
export interface ReplayClock {
  ms: number
  round: ReplayRound
  share: ControlShare | null
}

interface ReplayTransportProps {
  bundle: ReplayBundle
  /** Where the replay is, written a few times a second while the match plays; null before the first jump. */
  clock: ValueStore<ReplayClock | null>
  /** The canvas skin's team colours, for the track and the share readout. */
  allyColor: string
  enemyColor: string
  /** An agent name for a player, for the ticks' titles. Keep it stable: the ticks are memoized on it. */
  nameOf(subject: string): string
  playing: boolean
  onTogglePlay(): void
  speed: number
  onSpeed(speed: number): void
  /** A time picked on the scrubber, inside the round shown. The page pauses. */
  onSeek(ms: number): void
  /** A round chip: that round's barrier drop, paused. */
  onRound(n: number): void
  /**
   * The map's playable cells while the control overlay is on (§2.9), else
   * null: the scrubber's track then shows who held more space each second,
   * and a line under the bar the round's average.
   */
  controlMask: Uint8Array | null
  /** The replay's map transform, for the control timeline. */
  transform: MapTransform
  /** False when the play already holds the most steps it can. */
  canCapture: boolean
  onCapture(): void
  view: ReplayView
  /** Shown in the steps view: back to the replay, at the step's time when it has one. */
  onBackToReplay(): void
  onExit(): void
}

const SPEEDS = [0.25, 0.5, 1, 2, 4]

const TICK_COLOR: Record<'barrier' | 'kill' | 'plant' | 'defuse', string> = {
  barrier: 'bg-text-secondary',
  kill: 'bg-val-red',
  plant: 'bg-val-yellow',
  defuse: 'bg-val-cyan',
}

/** A range thumb is about 16 px wide: the ticks follow its centre, not the input's edges. */
const THUMB_PX = 16

/** A lead of more than this in the claimed space (ally − enemy, −1..1) colours the track. */
const TRACK_LEAD = 0.15
const TRACK_ALPHA = 0.55
const TRACK_EVEN = '#334155'

const rgba = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const TRACK_EVEN_COLOR = rgba(TRACK_EVEN, TRACK_ALPHA)

/** A share as a whole percentage. */
const percent = (fraction: number) => Math.round(fraction * 100)

/**
 * The scrubber track as a gradient: each 1 s sample of the control timeline
 * holds its colour until the next one (cyan where your team held more of the
 * claimed space, red where the enemy did, grey when close or nothing is
 * claimed), grey through the buy before the first
 * sample. Stops follow the thumb's centre, like the ticks, and a run of one
 * colour is a single stop.
 */
function trackGradient(
  timeline: { t: number; share: ControlShare }[],
  span: { start: number; end: number },
  allyColor: string,
  enemyColor: string,
): string {
  const ally = rgba(allyColor, TRACK_ALPHA)
  const enemy = rgba(enemyColor, TRACK_ALPHA)
  const length = Math.max(1, span.end - span.start)
  const at = (t: number) => {
    const f = Math.max(0, Math.min(1, (t - span.start) / length))
    return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${f.toFixed(4)})`
  }
  const runs: { color: string; from: number; to: number }[] = []
  const push = (color: string, from: number, to: number) => {
    const prev = runs[runs.length - 1]
    if (prev && prev.color === color) prev.to = to
    else runs.push({ color, from, to })
  }
  push(TRACK_EVEN_COLOR, span.start, timeline[0]?.t ?? span.end)
  timeline.forEach(({ t, share }, i) => {
    const lead = share.ally - share.enemy
    const color = lead > TRACK_LEAD ? ally : lead < -TRACK_LEAD ? enemy : TRACK_EVEN_COLOR
    push(color, t, timeline[i + 1]?.t ?? span.end)
  })
  return `linear-gradient(to right, ${runs.map(r => `${r.color} ${at(r.from)} ${at(r.to)}`).join(', ')})`
}

const button =
  'shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none'
const quiet = `${button} text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-elevated/60`

/**
 * The replay mode's 56 px bar (docs/plays-editor-v2.md §2.8), between the
 * toolbar and the canvas while a match is loaded: the rounds, play / pause,
 * the scrubber over the round shown with its barrier, kills, plant and defuse
 * as ticks, the clock, the speed, Capture step, Back to replay (in the steps
 * view) and Exit replay. With the map-control overlay on (§2.9): each team's
 * share of the space taken now and how much of the map is taken, the track
 * coloured by who held more of it each second, and the round's average in a
 * line under the bar.
 *
 * It reads the replay time and the share from `clock`, so a playing match
 * renders this bar a few times a second and leaves the rest of the editor alone.
 */
export default function ReplayTransport(props: ReplayTransportProps) {
  const { bundle, clock, nameOf, playing, speed, view, controlMask, transform } = props
  const shown = useSyncExternalStore(clock.subscribe, clock.get)
  const round = shown?.round ?? bundle.rounds[0]
  const ms = shown?.ms ?? round.buyStartMs
  const share = controlMask ? (shown?.share ?? null) : null
  const span = useMemo(() => roundSpan(bundle, round), [bundle, round])
  const ticks = useMemo(() => roundTicks(bundle, round, nameOf), [bundle, round, nameOf])
  const length = Math.max(1, span.end - span.start)
  // Once per round (a few ms: one 100 ms tick per tenth of a second of the round).
  const timeline = useMemo(
    () => (controlMask ? controlTimeline(bundle, round, controlMask, transform) : null),
    [bundle, round, controlMask, transform],
  )
  const { allyColor, enemyColor } = props
  const track = useMemo(
    () => (timeline ? trackGradient(timeline, span, allyColor, enemyColor) : null),
    [timeline, span, allyColor, enemyColor],
  )
  const average = useMemo(() => (timeline && timeline.length > 0 ? averageShare(timeline) : null), [timeline])

  // The round shown stays in sight in a long match's row of chips.
  const chips = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chips.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [round.n])

  return (
    <div className="shrink-0 border-b border-bg-elevated bg-bg-secondary">
      <div className="h-14 flex items-center gap-3 px-3 min-w-0 overflow-x-auto">
        <div ref={chips} role="group" aria-label="Rounds" className="flex items-center gap-0.5 min-w-0 max-w-[40%] overflow-x-auto shrink">
          {bundle.rounds.map(r => (
            <button
              key={r.n}
              type="button"
              onClick={() => props.onRound(r.n)}
              aria-current={r.n === round.n ? 'true' : undefined}
              title={`Round ${r.n}: ${r.winner === 'ALLY' ? 'won' : r.winner === 'ENEMY' ? 'lost' : 'no result'}${r.how ? ` by ${r.how}` : ''}`}
              className={`shrink-0 w-8 flex flex-col items-center gap-0.5 rounded-md py-0.5 text-[10px] transition-colors ${
                r.n === round.n ? 'bg-bg-elevated ring-1 ring-val-cyan/60' : 'bg-bg-primary hover:bg-bg-elevated'
              }`}
            >
              <span className="flex items-center gap-1 font-stats text-xs text-text-primary">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    r.winner === 'ALLY' ? 'bg-val-green' : r.winner === 'ENEMY' ? 'bg-val-red' : 'bg-text-muted'
                  }`}
                />
                {r.n}
              </span>
              <span className="text-text-muted">{r.side === 'attacker' ? 'ATK' : r.side === 'defender' ? 'DEF' : '–'}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={props.onTogglePlay}
          aria-label={playing ? 'Pause the replay' : 'Play the replay'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          className="shrink-0 w-7 h-7 rounded flex items-center justify-center bg-bg-elevated/60 text-text-secondary hover:text-val-cyan transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <div className="relative min-w-[160px] flex-1 flex items-center">
          <input
            type="range"
            min={span.start}
            max={span.end}
            step={100}
            value={Math.max(span.start, Math.min(span.end, ms))}
            onChange={e => props.onSeek(Number(e.target.value))}
            aria-label={`Round ${round.n} time`}
            title="Drag to scrub the round (, and . nudge 1 s)"
            className={`w-full accent-val-cyan${track ? ' vm-control-track' : ''}`}
            style={track ? { backgroundImage: track } : undefined}
          />
          {/* Under the track, so a tick's title shows on hover without getting in the way of a drag. */}
          <div className="absolute inset-x-0 -bottom-1.5 h-1.5" aria-hidden="true">
            {ticks.map((tick, i) => {
              const at = Math.max(0, Math.min(1, (tick.t - span.start) / length))
              return (
                <span
                  key={`${tick.kind}-${tick.t}-${i}`}
                  title={`${formatRoundClock(round, tick.t)} · ${tick.label}`}
                  className={`absolute top-0 w-0.5 h-1.5 -translate-x-1/2 rounded-full ${TICK_COLOR[tick.kind]}`}
                  style={{ left: `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${at})` }}
                />
              )
            })}
          </div>
        </div>

        <span className="shrink-0 font-stats text-xs tabular-nums text-text-primary whitespace-nowrap">
          {formatRoundClock(round, ms)}
        </span>

        {share && (
          <span
            title="Each team's share of the space taken, and how much of the map is taken at all"
            className="shrink-0 flex items-center gap-1.5 font-stats text-[11px] tabular-nums text-text-secondary whitespace-nowrap"
          >
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: allyColor }} />
            <span>You {percent(share.ally)} %</span>
            <span aria-hidden="true" className="text-text-muted">·</span>
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: enemyColor }} />
            <span>Enemy {percent(share.enemy)} %</span>
            <span className="text-text-muted">· {percent(share.claimed)} % of the map claimed</span>
          </span>
        )}

        <select
          value={speed}
          onChange={e => props.onSpeed(Number(e.target.value))}
          aria-label="Replay speed"
          className="shrink-0 bg-bg-primary border border-bg-elevated rounded-md text-xs px-1 py-1 focus:border-val-cyan outline-none"
        >
          {SPEEDS.map(s => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={props.onCapture}
          disabled={!props.canCapture || view === 'steps'}
          title={
            view === 'steps'
              ? 'Back to the replay to capture a moment'
              : props.canCapture
                ? 'Keep this moment as a step'
                : 'A play holds at most 10 steps'
          }
          className={`${button} text-val-cyan border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Capture step</span>
        </button>
        {view === 'steps' && (
          <button type="button" onClick={props.onBackToReplay} title="Back to the replay" className={quiet}>
            <Film className="w-3.5 h-3.5" />
            <span>Back to replay</span>
          </button>
        )}
        <button type="button" onClick={props.onExit} title="Leave the replay; the captured steps stay" className={quiet}>
          <X className="w-3.5 h-3.5" />
          <span>Exit replay</span>
        </button>
      </div>
      {average && (
        <p className="px-3 pb-1 text-[11px] text-text-muted truncate">
          Of the space taken, your team held {percent(average.ally)} % on average ({percent(average.claimed)} % of the map was claimed).
        </p>
      )}
    </div>
  )
}
