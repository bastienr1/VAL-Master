/**
 * Which kind of match a `matches` row is (docs/plays-editor-v2.md §2.19).
 *
 * Every row used to be a competitive match, and most readers still want only
 * those: they filter on `mode` with `DEATHMATCH_MODE`. A Deathmatch row keeps
 * the competitive columns but means something else by them: `result` is 'W'
 * for first place, `score` is "<placement>/<players>", and the round counts,
 * ACS, KPR and DPR are 0.
 *
 * Pure, no imports, so `node --test` can check it.
 */

/** `matches.mode` of a free-for-all Deathmatch. */
export const DEATHMATCH_MODE = 'Deathmatch'

export type MatchCategory = 'competitive' | 'deathmatch'

export function isDeathmatchMode(mode: string | null | undefined): boolean {
  return typeof mode === 'string' && mode.trim().toLowerCase() === DEATHMATCH_MODE.toLowerCase()
}

/** Anything not a Deathmatch counts as competitive, a row with no mode included. */
export function matchCategory(mode: string | null | undefined): MatchCategory {
  return isDeathmatchMode(mode) ? 'deathmatch' : 'competitive'
}

/** A Deathmatch row's score, "1/12": where the player placed, of how many. Null for any other form. */
export function deathmatchPlacement(score: string): { place: number; players: number } | null {
  const parts = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(score ?? '')
  if (!parts) return null
  const place = Number(parts[1])
  const players = Number(parts[2])
  if (place < 1 || players < 1 || place > players) return null
  return { place, players }
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = Math.abs(n) % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[Math.abs(n) % 10] ?? 'th'
  return `${n}${suffix}`
}

/** "1st of 12" for a Deathmatch score; null when the score is not a placement. */
export function placementLabel(score: string): string | null {
  const placement = deathmatchPlacement(score)
  return placement ? `${ordinal(placement.place)} of ${placement.players}` : null
}
