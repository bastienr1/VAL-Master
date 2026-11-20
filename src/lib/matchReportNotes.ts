/**
 * The written half of a match report, and the few numbers kept for the trend
 * (docs/match-report.md §4).
 *
 * `match_reports.notes` holds what a person wrote about one match: what works,
 * what to work on, the best paths and duels, the next session. It arrives as
 * the vault's `notes.json` (snake_case keys, `<b>` for emphasis), so the shape
 * is read tolerantly: a missing or wrong field is an empty one, never a throw.
 *
 * `match_reports.summary` is a handful of counts from `buildMatchReport`, saved
 * so the trend over recent games is one query instead of one bundle download
 * per game.
 *
 * Pure: no Supabase, no DOM. Covered by `matchReportNotes.test.ts`.
 */

import type { MatchReport } from './matchReport.ts'

/** The sections of the report page a note can point at. */
export type ReportSectionId = 'findings' | 'rounds' | 'positioning' | 'duels' | 'comms' | 'economy' | 'kit' | 'trend' | 'next'

export interface NoteCard {
  title: string
  body: string
  section: ReportSectionId | null
}

export interface RoundNote {
  round: number
  title: string
  body: string
  /** Seconds after the round's barrier drop, when the note is about one moment. */
  clockS: number | null
}

export interface NextNote {
  tag: string
  title: string
  body: string
}

export interface ReportNotes {
  lede: string | null
  works: NoteCard[]
  work: NoteCard[]
  paths: RoundNote[]
  pathFixes: RoundNote[]
  bestDuels: RoundNote[]
  /** Lines of text; `**bold**` marks emphasis. */
  positioning: string[]
  duels: string[]
  economy: string[]
  kit: string[]
  next: NextNote[]
}

/** The vault's section names, on this page. `lobby` has no section here. */
const SECTION_OF: Record<string, ReportSectionId> = {
  short: 'findings',
  flow: 'rounds',
  rounds: 'rounds',
  paths: 'positioning',
  positioning: 'positioning',
  duels: 'duels',
  comms: 'comms',
  economy: 'economy',
  kit: 'kit',
  trend: 'trend',
  next: 'next',
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Text as stored: `<b>` becomes `**`, any other tag is dropped. */
function text(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/<\/?b>/gi, '**').replace(/<[^>]+>/g, '').trim()
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const lines = (v: unknown): string[] => list(v).map(text).filter(Boolean)

function cards(v: unknown): NoteCard[] {
  return list(v).flatMap(item => {
    if (!isRecord(item)) return []
    const title = text(item.title)
    if (!title) return []
    const link = typeof item.link === 'string' ? item.link : typeof item.section === 'string' ? item.section : ''
    return [{ title, body: text(item.body), section: SECTION_OF[link] ?? null }]
  })
}

function roundNotes(v: unknown): RoundNote[] {
  return list(v).flatMap(item => {
    if (!isRecord(item) || typeof item.round !== 'number' || !Number.isInteger(item.round) || item.round < 1) return []
    const title = text(item.title)
    if (!title) return []
    const t = typeof item.t === 'number' && Number.isFinite(item.t) ? item.t : typeof item.clockS === 'number' ? item.clockS : null
    return [{ round: item.round, title, body: text(item.body), clockS: t }]
  })
}

/** What a person wrote about the match; every list empty when `raw` is not a notes object. */
export function parseReportNotes(raw: unknown): ReportNotes {
  const o = isRecord(raw) ? raw : {}
  return {
    lede: text(o.lede) || null,
    works: cards(o.works),
    work: cards(o.work),
    paths: roundNotes(o.paths),
    pathFixes: roundNotes(o.path_fixes ?? o.pathFixes),
    bestDuels: roundNotes(o.best_duels ?? o.bestDuels),
    positioning: lines(o.positioning),
    duels: lines(o.duels),
    economy: lines(o.economy),
    kit: lines(o.kit),
    next: list(o.next).flatMap(item => {
      if (!isRecord(item)) return []
      const title = text(item.title)
      return title ? [{ tag: text(item.tag), title, body: text(item.body) }] : []
    }),
  }
}

/** Whether anything was written. */
export function hasReportNotes(notes: ReportNotes): boolean {
  return (
    notes.lede !== null ||
    [notes.works, notes.work, notes.paths, notes.pathFixes, notes.bestDuels, notes.positioning, notes.duels, notes.economy, notes.kit, notes.next].some(
      l => l.length > 0,
    )
  )
}

/** `**bold**` split into runs, for a renderer that needs no HTML. */
export function boldRuns(line: string): Array<{ text: string; bold: boolean }> {
  return line
    .split('**')
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter(run => run.text.length > 0)
}

/** Bumped when a count changes meaning, so an old row is recomputed, not compared. */
export const REPORT_SUMMARY_VERSION = 1

export interface ReportSummary {
  v: number
  rounds: number
  won: number
  kills: number
  /** Deaths to another player. */
  deaths: number
  roundsDied: number
  standingKills: number
  movingDeaths: number
  runningDeaths: number
  untradedDeaths: number
  openingDeaths: number
  tradeKills: number
}

export function reportSummary(report: MatchReport): ReportSummary {
  const t = report.totals
  return {
    v: REPORT_SUMMARY_VERSION,
    rounds: t.rounds,
    won: t.won,
    kills: t.kills,
    deaths: t.deaths,
    roundsDied: t.roundsDied,
    standingKills: t.standingKills,
    movingDeaths: t.movingDeaths,
    runningDeaths: t.runningDeaths,
    untradedDeaths: t.deaths - t.tradedDeaths,
    openingDeaths: t.openingDeaths,
    tradeKills: t.tradeKills,
  }
}

const SUMMARY_KEYS: Array<keyof ReportSummary> = [
  'v', 'rounds', 'won', 'kills', 'deaths', 'roundsDied', 'standingKills', 'movingDeaths', 'runningDeaths', 'untradedDeaths', 'openingDeaths', 'tradeKills',
]

/** A stored summary of the current version; null for anything else. */
export function parseReportSummary(raw: unknown): ReportSummary | null {
  if (!isRecord(raw) || raw.v !== REPORT_SUMMARY_VERSION) return null
  const out = {} as ReportSummary
  for (const key of SUMMARY_KEYS) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    out[key] = value
  }
  return out
}

export function sameSummary(a: ReportSummary | null, b: ReportSummary): boolean {
  return a !== null && SUMMARY_KEYS.every(key => a[key] === b[key])
}
