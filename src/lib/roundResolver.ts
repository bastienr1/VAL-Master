import type { MatchRound } from './types'

export function getRoundVideoTime(
  round: MatchRound,
  rounds: MatchRound[],
  barrierOffset: number | null
): number {
  if (barrierOffset == null) return 0
  const r1StartMs = rounds[0]?.round_start_ms
  if (r1StartMs && round.round_start_ms) {
    return barrierOffset + (round.round_start_ms - r1StartMs) / 1000
  }
  // Fallback: estimate from round index
  return barrierOffset + ((round.round_number - 1) * 110)
}

export function resolveRoundFromTimestamp(
  timestampSec: number,
  rounds: MatchRound[],
  barrierOffset: number | null
): MatchRound | null {
  if (rounds.length === 0 || barrierOffset == null) return null

  // Sort by round_number ascending (defensive — should already be sorted)
  const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number)

  // Find the last round whose start time is <= timestamp
  let result: MatchRound | null = null
  for (const round of sorted) {
    const startTime = getRoundVideoTime(round, sorted, barrierOffset)
    if (startTime <= timestampSec) {
      result = round
    } else {
      break
    }
  }
  return result
}
