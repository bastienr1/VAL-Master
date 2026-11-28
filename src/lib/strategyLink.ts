// Strategy mode (docs/plays-editor-v2.md §2.29): from a round being reviewed to
// a strat in Plays that starts from where everyone really was, and back.
import type { OriginPage, ReplayOrigin } from './playDoc.ts'

/**
 * Where **Strategize** on the review or the report opens Plays: the match, the
 * round on screen and the replay time it is paused on (whole ms), and the page
 * it came from, so the strat can link back.
 */
export function strategizeHref(matchId: string, round: number, replayMs: number, page: OriginPage): string {
  const ms = Math.max(0, Math.round(replayMs))
  return `/plays/new?replay=${encodeURIComponent(matchId)}&round=${round}&t=${ms}&strat=${page}`
}

/** `&strat=`: the page a strategy link came from, or null when it is not one. */
export function parseStratPage(raw: string | null): OriginPage | null {
  return raw === 'review' || raw === 'report' ? raw : null
}

/** `&t=` or `?at=`: a replay time in whole ms, or null when it is not a whole number of at least 0. */
export function parseReplayTime(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  const ms = Number(raw.trim())
  return Number.isSafeInteger(ms) ? ms : null
}

/** The back link of a strat started from a review or a report: that page, at the moment it was started. Null otherwise. */
export function originBack(origin: ReplayOrigin | null | undefined): { to: string; label: string; title: string } | null {
  if (!origin?.page || origin.ms === undefined) return null
  const page = origin.page === 'review' ? 'review' : 'report'
  const round = origin.round !== undefined ? `round ${origin.round}` : 'the match'
  return {
    to: `/${page}/${encodeURIComponent(origin.matchId)}?at=${Math.round(origin.ms)}`,
    label: origin.round !== undefined ? `R${origin.round} ${page}` : `Match ${page}`,
    title: `Back to the ${page} of ${round}, at the moment this strat was started`,
  }
}
