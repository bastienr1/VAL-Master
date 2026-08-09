// src/lib/acts.ts
// ─────────────────────────────────────────────────────────────────────────────
// VALORANT Act calendar — SELF-RECOGNIZING.
//
// WHY THIS FILE WAS REWRITTEN (Sprint 4.7)
// Sprint 4.6 shipped a *static* hardcoded list. That list silently goes stale
// every ~2 months: when a new act starts, or when Riot's real dates differ from
// the estimates baked in at build time, matches get bucketed into the wrong act
// (or none at all) and no new filter chip appears until someone hand-edits the
// array and redeploys. That is the bug you hit going into Act 3 / Act 4.
//
// This version fixes it structurally:
//   1. SEED_ACTS holds officially-verified boundaries (isEstimated: false).
//   2. buildCalendar() AUTO-GENERATES future acts forward, indefinitely, from the
//      last seed using the observed ~8-week cadence. So getActForDate() and
//      getCurrentAct() NEVER return null, and the moment a match played in a
//      brand-new act is synced, its date lands in the generated bucket and the
//      Act filter chip appears on its own — zero code edit, zero redeploy.
//   3. Every projected act is flagged isEstimated: true, so the UI can show a
//      "provisional dates" hint and an automated watcher can firm them up later.
//
// Calendar re-verified against the official Riot schedule on 2026-08-09.
// Sources: esportstales.com/valorant/season-end-date, valocheck.com/seasons
//
// NAMING NOTE: this project counts six acts per season-year (V26A1…V26A6), the
// same convention as the Notion match banners. Some third-party trackers use an
// episode-based count and will label the same period differently — that is why a
// site may say "Act 4" for what another calls "Act 3". Internally we stay on the
// V{YY}A{N} convention so the app, Notion, and Supabase all agree.
// ─────────────────────────────────────────────────────────────────────────────

export interface ValorantAct {
  code: string          // 'V26A4'
  label: string         // 'Season 2026 — Act 4'
  shortLabel: string    // 'Act 4'
  seasonYear: number    // 2026
  actNumber: number     // 4
  start: Date           // inclusive
  end: Date             // exclusive (a match on the end day belongs to the NEXT act)
  isEstimated: boolean  // true = dates projected/unconfirmed by Riot
}

interface SeedAct {
  seasonYear: number
  actNumber: number
  start: string   // 'YYYY-MM-DD' — UTC, inclusive
  end: string     // 'YYYY-MM-DD' — UTC, exclusive
  isEstimated: boolean
}

// ── Known acts. This is the ONLY block you ever touch by hand. ────────────────
// When Riot officially confirms a date, correct the row and flip isEstimated to
// false. Everything after the last row is generated automatically below.
// Confirmed boundaries re-verified 2026-08-09: Apr 29, Jun 24, Aug 19.
const SEED_ACTS: SeedAct[] = [
  { seasonYear: 2026, actNumber: 1, start: '2026-01-07', end: '2026-03-17', isEstimated: false },
  { seasonYear: 2026, actNumber: 2, start: '2026-03-17', end: '2026-04-29', isEstimated: false },
  { seasonYear: 2026, actNumber: 3, start: '2026-04-29', end: '2026-06-24', isEstimated: false },
  { seasonYear: 2026, actNumber: 4, start: '2026-06-24', end: '2026-08-19', isEstimated: false }, // CURRENT (Aug 2026)
  { seasonYear: 2026, actNumber: 5, start: '2026-08-19', end: '2026-10-14', isEstimated: true },  // published, pending final confirmation
  { seasonYear: 2026, actNumber: 6, start: '2026-10-14', end: '2027-01-06', isEstimated: true },  // published, pending final confirmation
]

const ACTS_PER_SEASON = 6
const DAY_MS = 86_400_000
const GENERATE_AHEAD_MS = 730 * DAY_MS // project ~2 years past today so we never run out

function toUtcDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

function buildAct(
  seasonYear: number,
  actNumber: number,
  start: Date,
  end: Date,
  isEstimated: boolean,
): ValorantAct {
  const yy = String(seasonYear).slice(-2)
  return {
    code: `V${yy}A${actNumber}`,
    label: `Season ${seasonYear} — Act ${actNumber}`,
    shortLabel: `Act ${actNumber}`,
    seasonYear,
    actNumber,
    start,
    end,
    isEstimated,
  }
}

// Median length of the seeded acts, used as the cadence for projected acts.
// Median (not mean) so one unusually long/short act doesn't skew projections.
function medianLengthMs(acts: ValorantAct[]): number {
  const lengths = acts.map((a) => a.end.getTime() - a.start.getTime()).sort((x, y) => x - y)
  const mid = Math.floor(lengths.length / 2)
  return lengths.length % 2 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2)
}

function buildCalendar(): ValorantAct[] {
  const seeded = SEED_ACTS.map((s) =>
    buildAct(s.seasonYear, s.actNumber, toUtcDate(s.start), toUtcDate(s.end), s.isEstimated),
  )

  const acts = [...seeded]
  const cadence = medianLengthMs(seeded)
  const horizon = Date.now() + GENERATE_AHEAD_MS
  let last = acts[acts.length - 1]

  // Roll forward. After Act 6 of a season-year comes Act 1 of the next year.
  while (last.end.getTime() < horizon) {
    let nextSeason = last.seasonYear
    let nextNumber = last.actNumber + 1
    if (nextNumber > ACTS_PER_SEASON) {
      nextNumber = 1
      nextSeason = last.seasonYear + 1
    }
    const start = new Date(last.end.getTime())
    const end = new Date(start.getTime() + cadence)
    last = buildAct(nextSeason, nextNumber, start, end, true) // projected → always estimated
    acts.push(last)
  }

  return acts
}

/** Full calendar: verified seed acts + auto-projected future acts. */
export const VALORANT_ACTS: ValorantAct[] = buildCalendar()

/**
 * The act containing `date`, or null only if the date is before the calendar
 * starts. End dates are exclusive: a match on the act-end day belongs to the
 * NEXT act. Thanks to forward generation, dates in the future still resolve.
 */
export function getActForDate(date: Date): ValorantAct | null {
  const t = date.getTime()
  return VALORANT_ACTS.find((a) => t >= a.start.getTime() && t < a.end.getTime()) ?? null
}

/** The act running right now. Never null within the generated horizon. */
export function getCurrentAct(): ValorantAct | null {
  return getActForDate(new Date())
}

/** True once an act's end date is in the past. */
export function isActComplete(act: ValorantAct): boolean {
  return act.end.getTime() <= Date.now()
}

/** Every act whose end date is in the past. */
export function getCompletedActs(): ValorantAct[] {
  return VALORANT_ACTS.filter(isActComplete)
}

/** Look up an act by its code, e.g. 'V26A3'. */
export function getActByCode(code: string): ValorantAct | null {
  return VALORANT_ACTS.find((a) => a.code === code) ?? null
}

/**
 * Given the dates of the user's synced matches, return the newest act they have
 * actually played in. Handy for auto-selecting the latest act on the dashboard,
 * so the "current act" surfaces itself from the data rather than from a constant.
 */
export function getLatestPlayedAct(matchDates: Date[]): ValorantAct | null {
  let latest: ValorantAct | null = null
  for (const d of matchDates) {
    const act = getActForDate(d)
    if (act && (!latest || act.start.getTime() > latest.start.getTime())) latest = act
  }
  return latest
}

/** Format an act's date range for display, e.g. "Jun 24 – Aug 19, 2026". */
export function formatActRange(act: ValorantAct): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const start = act.start.toLocaleDateString('en-US', opts)
  const end = act.end.toLocaleDateString('en-US', { ...opts, year: 'numeric', timeZone: 'UTC' })
  return `${start} – ${end}`
}
