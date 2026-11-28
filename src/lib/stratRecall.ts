// Strat recall (docs/plays-editor-v2.md §2.31): which of the user's strats a
// round being reviewed can bring up, in what order, and what of a strat is
// drawn over the round. Pure.
import type { OriginPage, PlayDoc, PlayStep, ReplayOrigin } from './playDoc.ts'
import { hasTags, parseStratCard, type StratCard } from './stratCard.ts'
import type { Play, PlaySide } from './types.ts'

/** One `strat_rounds` row (`src/lib/stratRounds.ts`): a strat marked "Seen here" on a round. */
export interface StratRound {
  id: string
  play_id: string
  match_id: string
  round: number
  replay_ms: number | null
  page: OriginPage
  created_at: string
}

/** The round on screen: its match, number and the owner's side, on a map. */
export interface RecallAt {
  matchId: string
  round: number
  side: PlaySide
  /** The map's display name, as plays store it. */
  map: string
  mapUuid: string | null
}

export interface RecallItem {
  play: Play
  card: StratCard | null
  /** This round's "Seen here" link, when there is one. */
  link: StratRound | null
  /** The strat was started from this very round (strategy mode, §2.29). */
  fromRound: boolean
  /** The strat was built from this match. */
  fromMatch: boolean
  /** How many rounds it is marked as seen on. */
  rounds: number
}

const originOf = (doc: PlayDoc | null): ReplayOrigin | null => {
  const raw: unknown = doc?.replay
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<ReplayOrigin>
  return typeof r.matchId === 'string' ? { matchId: r.matchId, round: typeof r.round === 'number' ? r.round : undefined } : null
}

const sameMap = (play: Play, at: RecallAt) =>
  (play.map_uuid && at.mapUuid ? play.map_uuid === at.mapUuid : false) || play.map.toLowerCase() === at.map.toLowerCase()

/**
 * The strats for this round: the same map and side, carrying every tag in
 * `tags`. Those already seen here first, then the ones started from this
 * round, then from this match, then the most seen, then the latest edited.
 */
export function recallStrats(plays: Play[], links: StratRound[], at: RecallAt, tags: string[] = []): RecallItem[] {
  const counts = new Map<string, number>()
  for (const l of links) counts.set(l.play_id, (counts.get(l.play_id) ?? 0) + 1)
  const items = plays
    .filter(p => p.side === at.side && sameMap(p, at))
    .map((play): RecallItem => {
      const origin = originOf(play.play)
      return {
        play,
        card: parseStratCard(play.play?.card),
        link: links.find(l => l.play_id === play.id && l.match_id === at.matchId && l.round === at.round) ?? null,
        fromRound: origin?.matchId === at.matchId && origin.round === at.round,
        fromMatch: origin?.matchId === at.matchId,
        rounds: counts.get(play.id) ?? 0,
      }
    })
    .filter(item => hasTags(item.card, tags))
  const rank = (i: RecallItem) => [i.link ? 1 : 0, i.fromRound ? 1 : 0, i.fromMatch ? 1 : 0, i.rounds]
  return items.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)]
    for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return rb[k] - ra[k]
    return b.play.updated_at.localeCompare(a.play.updated_at)
  })
}

/**
 * The step a strat shows over a round when none is picked: the plan, which is
 * its last step (strategy mode's "The plan" in a two-step strat).
 */
export function defaultRecallStep(doc: PlayDoc | null): number {
  return Math.max(0, (doc?.steps.length ?? 1) - 1)
}

/**
 * What of a strat's step is drawn over a round: everything but the agents
 * kept where another match had them (§2.29), which would only be noise here.
 */
export function recallOverlay(step: PlayStep): PlayStep {
  return { ...step, elements: step.elements.filter(el => !(el.kind === 'agent' && el.seen)) }
}

/**
 * A "Seen here" link as a way back: the page it was marked on, at its moment,
 * named by the match when it is known ("Bind · Nov 17 · R9"), else by the round.
 */
export function roundLinkBack(
  link: StratRound,
  match: { map: string; playedAt: string | null } | null,
): { to: string; label: string; title: string } {
  const at = link.replay_ms === null ? '' : `?at=${link.replay_ms}`
  const day = match?.playedAt ? new Date(match.playedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
  const label = [match?.map, day, `R${link.round}`].filter(Boolean).join(' · ')
  return {
    to: `/${link.page}/${encodeURIComponent(link.match_id)}${at}`,
    label,
    title: `Round ${link.round} on its ${link.page}, at the moment it was marked`,
  }
}

/** The rounds a strat is marked as seen on, in the order they were marked. */
export function roundsOf(links: StratRound[], playId: string): StratRound[] {
  return links.filter(l => l.play_id === playId)
}
