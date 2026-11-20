/**
 * Which moment tags a match report's duels become (docs/match-report.md §5).
 *
 * One click on the report tags every kill and death on the match's video: what
 * it was (KILL, DEATH), the side (ATTACK, DEFENSE), the site (A, B, C, MID) and
 * the place when the vocabulary has a tag named like the callout. The tags are
 * found by name in the user's own vocabulary; one that is not there is skipped
 * and reported, never created.
 *
 * A tag sits five seconds before its duel, so opening it shows the fight
 * coming. A death lands on the note written for it when there is one at that
 * second; a kill is moved off a second a note already holds, because a tag at a
 * note's second belongs to that note.
 *
 * Pure: no Supabase, no DOM. Covered by `matchReportTags.test.ts`.
 */

import type { ReportDuel } from './matchReport.ts'

/** How long before the duel its tags sit. */
export const TAG_LEAD_S = 5
/**
 * A tag of the same name this close to a duel's second is that duel's tag
 * already. Tags put on by hand or by a script on another clock land a second
 * to either side, and a second press must not double them.
 */
export const SAME_MOMENT_S = 1

export interface TagPlanRow {
  tagId: string
  videoTs: number
  noteId: string | null
}

export interface TagPlan {
  /** The rows to insert: nothing already on the review, nothing twice. */
  rows: TagPlanRow[]
  /** Duels that got at least one new tag. */
  kills: number
  deaths: number
  /** Tags the duels call for that were on the review already. */
  already: number
  /** Names the duels call for that the vocabulary does not have, most wanted first. */
  missing: string[]
}

interface PlanInput {
  duels: ReadonlyArray<ReportDuel>
  /** The video second of a replay time. */
  videoSecond: (replayMs: number) => number
  /** The user's vocabulary. Names are matched without regard to case. */
  tags: ReadonlyArray<{ id: string; name: string }>
  /** The review's notes, to attach a death to its note and keep kills off them. */
  notes: ReadonlyArray<{ id: string; timestamp_seconds: number }>
  /** What the review carries already. */
  existing: ReadonlyArray<{ tag_id: string; video_ts: number }>
}

/** The names a duel calls for, in the order they are reported. */
export function duelTagNames(duel: ReportDuel): string[] {
  const names = [duel.kind === 'kill' ? 'KILL' : 'DEATH']
  if (duel.side) names.push(duel.side === 'attacker' ? 'ATTACK' : 'DEFENSE')
  const where = duel.where?.trim()
  if (where) {
    const site = /^([ABC])\s/.exec(where)?.[1] ?? (/^mid\b/i.test(where) ? 'MID' : null)
    if (site) names.push(site)
    names.push(where.toUpperCase())
  }
  return names
}

export function planDuelTags({ duels, videoSecond, tags, notes, existing }: PlanInput): TagPlan {
  const tagByName = new Map(tags.map(t => [t.name.trim().toLowerCase(), t.id]))
  const noteAt = new Map(notes.map(n => [n.timestamp_seconds, n.id]))
  const onReview = new Set(existing.map(e => `${e.tag_id}@${e.video_ts}`))
  const planned = new Set<string>()
  const isThere = (tagId: string, ts: number) => {
    if (planned.has(`${tagId}@${ts}`)) return true
    for (let d = -SAME_MOMENT_S; d <= SAME_MOMENT_S; d++) {
      if (onReview.has(`${tagId}@${ts + d}`)) return true
    }
    return false
  }
  const missing = new Map<string, number>()
  const rows: TagPlanRow[] = []
  let kills = 0
  let deaths = 0
  let already = 0

  for (const duel of [...duels].sort((a, b) => a.t - b.t)) {
    let ts = Math.max(0, Math.floor(videoSecond(duel.t) - TAG_LEAD_S))
    let noteId: string | null = null
    if (duel.kind === 'death') noteId = noteAt.get(ts) ?? null
    else while (noteAt.has(ts)) ts++

    let added = 0
    const names = duelTagNames(duel)
    for (const [i, name] of names.entries()) {
      const tagId = tagByName.get(name.toLowerCase())
      if (!tagId) {
        // A callout with no tag of its name is the usual case, not something to report.
        const isPlace = i === names.length - 1 && duel.where?.trim().toUpperCase() === name && i > 0 && !['A', 'B', 'C', 'MID'].includes(name)
        if (!isPlace) missing.set(name, (missing.get(name) ?? 0) + 1)
        continue
      }
      if (isThere(tagId, ts)) {
        already++
        continue
      }
      planned.add(`${tagId}@${ts}`)
      rows.push({ tagId, videoTs: ts, noteId })
      added++
    }
    if (added > 0) {
      if (duel.kind === 'kill') kills++
      else deaths++
    }
  }

  return {
    rows,
    kills,
    deaths,
    already,
    missing: [...missing].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
  }
}
