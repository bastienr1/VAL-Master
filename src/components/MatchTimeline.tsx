import { useMemo } from 'react'
import type { MatchRound } from '../lib/types'
import { getRoundVideoTime } from '../lib/roundResolver'

interface MatchTimelineProps {
  rounds: MatchRound[]
  duration: number
  currentTime: number
  barrierOffset: number | null
  activeRound: number | null
  onSeek: (seconds: number) => void
  onRoundChange: (round: number | null) => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function clampPct(pct: number): number {
  return Math.max(0, Math.min(100, pct))
}

export default function MatchTimeline({
  rounds,
  duration,
  currentTime,
  barrierOffset,
  activeRound,
  onSeek,
  onRoundChange,
}: MatchTimelineProps) {
  const sortedRounds = useMemo(
    () => [...rounds].sort((a, b) => a.round_number - b.round_number),
    [rounds]
  )

  // Find the side-switch round (first round whose side differs from rounds[0].side)
  const switchRoundNumber = useMemo(() => {
    if (sortedRounds.length === 0) return null
    const firstSide = sortedRounds[0].side
    const switched = sortedRounds.find(r => r.side !== firstSide)
    return switched?.round_number ?? null
  }, [sortedRounds])

  const enabled = barrierOffset != null && duration > 0

  const handleStripClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const seekTime = (clickX / rect.width) * duration
    onSeek(seekTime)
  }

  return (
    <div className="bg-bg-elevated rounded-lg px-3 py-2">
      {/* Legend row */}
      <div className="flex items-center gap-3 text-[9px] text-text-muted mb-1">
        <span className="uppercase tracking-widest">Match timeline</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-val-green" />
          Kill
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-val-red" />
          Death
        </span>
        <span className="flex items-center gap-1">
          <span className="w-px h-2.5 bg-text-muted/60" />
          Round start
        </span>
        <span className="ml-auto">click to seek</span>
      </div>

      {/* Strip */}
      <div
        className={`relative h-14 ${enabled ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={handleStripClick}
      >
        {/* Center rail */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-bg-card -translate-y-1/2" />
        {/* Cyan progress fill */}
        {enabled && (
          <div
            className="absolute top-1/2 left-0 h-0.5 bg-val-cyan/30 -translate-y-1/2 pointer-events-none"
            style={{ width: `${clampPct(duration > 0 ? (currentTime / duration) * 100 : 0)}%` }}
          />
        )}

        {!enabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-text-muted text-xs">Sync match to enable timeline</span>
          </div>
        )}

        {enabled && sortedRounds.map(round => {
          const startTime = getRoundVideoTime(round, sortedRounds, barrierOffset)
          const pct = clampPct((startTime / duration) * 100)
          const isSwitch = switchRoundNumber != null && round.round_number === switchRoundNumber
          const isActive = activeRound === round.round_number
          const lineColor = isActive
            ? 'bg-val-cyan'
            : isSwitch
              ? 'bg-val-yellow/50'
              : 'bg-text-muted/30'
          const labelColor = isActive ? 'text-val-cyan' : 'text-text-muted'
          return (
            <div key={`r-${round.round_number}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSeek(startTime)
                  onRoundChange(round.round_number)
                }}
                className={`absolute top-0 bottom-3 w-px ${lineColor} hover:bg-val-cyan/80 transition-colors`}
                style={{ left: `${pct}%` }}
                title={`R${round.round_number} · ${round.side}`}
              />
              <span
                className={`absolute bottom-0 text-[8px] font-stats ${labelColor} pointer-events-none`}
                style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
              >
                R{round.round_number}
              </span>
            </div>
          )
        })}

        {enabled && sortedRounds.flatMap(round =>
          (round.kill_events || []).map((kill, i) => {
            const killTime = getRoundVideoTime(round, sortedRounds, barrierOffset) + (kill.kill_time_ms / 1000)
            const pct = clampPct((killTime / duration) * 100)
            const isMultiKill = round.kills >= 2
            return (
              <button
                key={`k-${round.round_number}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSeek(killTime)
                  onRoundChange(round.round_number)
                }}
                className={`absolute w-[7px] h-[7px] rounded-full bg-val-green border-[1.5px] border-bg-card hover:scale-150 transition-transform ${
                  isMultiKill ? 'ring-2 ring-val-green/30' : ''
                }`}
                style={{ left: `${pct}%`, top: '14px', transform: 'translateX(-50%)' }}
                title={`${formatTime(killTime)} — Killed ${kill.victim} (${kill.weapon || 'unknown'})`}
              />
            )
          })
        )}

        {enabled && sortedRounds.flatMap(round =>
          (round.death_events || []).map((death, i) => {
            const deathTime = getRoundVideoTime(round, sortedRounds, barrierOffset) + (death.kill_time_ms / 1000)
            const pct = clampPct((deathTime / duration) * 100)
            return (
              <button
                key={`d-${round.round_number}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSeek(deathTime)
                  onRoundChange(round.round_number)
                }}
                className="absolute w-[7px] h-[7px] rounded-full bg-val-red border-[1.5px] border-bg-card hover:scale-150 transition-transform"
                style={{ left: `${pct}%`, top: '32px', transform: 'translateX(-50%)' }}
                title={`${formatTime(deathTime)} — Died to ${death.killer} (${death.weapon || 'unknown'})`}
              />
            )
          })
        )}

        {/* Playhead needle */}
        {enabled && (
          <div
            className="absolute top-1/2 w-0.5 h-8 bg-white/70 pointer-events-none"
            style={{
              left: `${clampPct((currentTime / duration) * 100)}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
      </div>
    </div>
  )
}
