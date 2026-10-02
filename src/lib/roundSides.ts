/**
 * Which side a team plays in each round of a match.
 *
 * Pure and Supabase-free so it can be unit-tested. Henrik's v2 match payload
 * says who won a round but not who attacked, and its rounds carry no number, so
 * the side has to come from the team colour and the round's position in the
 * match: Red attacks rounds 1–12, Blue attacks 13–24, and overtime swaps every
 * round with Red attacking first. Checked against who planted the spike in real
 * payloads, overtime included.
 *
 * Only competitive matches are synced, so the 12-round half is the only one.
 */

export type RoundSide = 'attack' | 'defense'

const HALF_LENGTH = 12
const REGULATION = HALF_LENGTH * 2

/** `team` is Henrik's "Red" or "Blue"; `roundNumber` counts from 1. */
export function sideForRound(team: string, roundNumber: number): RoundSide {
  const red = team.trim().toLowerCase() === 'red'
  const redAttacks =
    roundNumber <= REGULATION ? roundNumber <= HALF_LENGTH : (roundNumber - REGULATION) % 2 === 1
  return red === redAttacks ? 'attack' : 'defense'
}
