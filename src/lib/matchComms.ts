/**
 * A match's communication file (docs/match-report.md §6).
 *
 * What was said in a match is worked out on the PC from the recording's own
 * audio tracks and written next to the match's replay bundle as
 * `comms.v1.json` (`Valorant/_scripts/match_valmaster_comms.py` in the vault).
 * The report page reads that file from the linked replay folder, on this
 * device, and never sends it anywhere: there is no table for it.
 *
 * This is the file's shape and its tolerant reading. Times are seconds after
 * the round's barrier drop; a negative one is in the buy phase.
 *
 * Pure: no Supabase, no DOM. Covered by `matchComms.test.ts`.
 */

export const COMMS_FILE = 'comms.v1.json'
export const COMMS_SCHEMA = 1

export interface CommsLine {
  round: number
  /** Seconds after the round's barrier drop. */
  t: number
  who: 'me' | 'team'
  text: string
}

export type SiteCount = Record<'A' | 'B' | 'C' | 'spawn', number>

export interface CommsCheck {
  round: number
  t: number
  text: string
  /** Where the enemies were when it was said, and eight seconds later. */
  then: SiteCount
  later: SiteCount
  verdict: 'right' | 'partly' | 'wrong'
}

export interface MatchComms {
  matchId: string
  mine: { lines: number; words: number; buyPct: number; alivePct: number; deadPct: number; swears: number }
  team: { lines: number }
  /** Deaths, and how many were followed by information. */
  afterDeath: { deaths: number; useful: number }
  checks: CommsCheck[]
  lines: CommsLine[]
  notes: { verdict: string | null; works: string[]; work: string[] }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** Text as stored: `<b>` becomes `**`, any other tag is dropped. */
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/<\/?b>/gi, '**').replace(/<[^>]+>/g, '').trim() : '')

function sites(v: unknown): SiteCount {
  const o = isRecord(v) ? v : {}
  return { A: num(o.A), B: num(o.B), C: num(o.C), spawn: num(o.spawn) }
}

/**
 * The file's content for match `matchId`; null when it is not a communication
 * file of this schema, or is another match's.
 */
export function parseMatchComms(raw: unknown, matchId: string): MatchComms | null {
  if (!isRecord(raw) || raw.schema !== COMMS_SCHEMA || raw.matchId !== matchId) return null
  const mine = isRecord(raw.mine) ? raw.mine : {}
  const phases = isRecord(mine.wordsByPhase) ? mine.wordsByPhase : {}
  const words = num(mine.words)
  const pct = (n: unknown) => (words > 0 ? Math.round((100 * num(n)) / words) : 0)
  const after = list(raw.afterDeath).filter(isRecord)
  const notes = isRecord(raw.notes) ? raw.notes : {}
  return {
    matchId,
    mine: { lines: num(mine.lines), words, buyPct: pct(phases.buy), alivePct: pct(phases.alive), deadPct: pct(phases.dead), swears: num(mine.swears) },
    team: { lines: num(isRecord(raw.team) ? raw.team.lines : 0) },
    afterDeath: { deaths: after.length, useful: after.filter(a => a.useful === true).length },
    checks: list(raw.checks).flatMap(item => {
      if (!isRecord(item) || typeof item.round !== 'number') return []
      const verdict = item.verdict === 'right' || item.verdict === 'wrong' ? item.verdict : 'partly'
      return [{ round: item.round, t: num(item.t), text: text(item.text), then: sites(item.then), later: sites(item.later), verdict }]
    }),
    lines: list(raw.lines).flatMap(item => {
      if (!isRecord(item) || typeof item.round !== 'number' || typeof item.t !== 'number') return []
      const said = text(item.text)
      return said ? [{ round: item.round, t: item.t, who: item.who === 'me' ? ('me' as const) : ('team' as const), text: said }] : []
    }),
    notes: {
      verdict: text(notes.verdict) || null,
      works: list(notes.works).map(text).filter(Boolean),
      work: list(notes.work).map(text).filter(Boolean),
    },
  }
}

/** "A 3, B 1" for a count by site, leaving out the empty ones. */
export function siteCountLabel(count: SiteCount): string {
  const parts = (['A', 'B', 'C', 'spawn'] as const).filter(site => count[site] > 0).map(site => `${site} ${count[site]}`)
  return parts.length > 0 ? parts.join(', ') : 'none seen'
}
