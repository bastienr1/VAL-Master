// Valorant Act calendar — Season 2026
// Source: https://valorant.fandom.com/wiki/Season_2026
// End dates are EXCLUSIVE (a match on the end date belongs to the next act).
// Times are stored as UTC; region offsets are ignored — the live Riot calendar smooths this out.

export interface ValorantAct {
  code: string         // 'V26A2'
  label: string        // 'Season 2026 — Act 2'
  shortLabel: string   // 'Act 2'
  start: Date
  end: Date
  isEstimated: boolean // true for acts whose dates haven't been officially confirmed yet
}

// Hardcoded calendar. Append rows here when Riot announces new acts.
const RAW_ACTS: Array<Omit<ValorantAct, 'start' | 'end'> & { start: string; end: string }> = [
  { code: 'V26A1', label: 'Season 2026 — Act 1', shortLabel: 'Act 1', start: '2026-01-07', end: '2026-03-18', isEstimated: false },
  { code: 'V26A2', label: 'Season 2026 — Act 2', shortLabel: 'Act 2', start: '2026-03-18', end: '2026-04-29', isEstimated: false },
  { code: 'V26A3', label: 'Season 2026 — Act 3', shortLabel: 'Act 3', start: '2026-04-29', end: '2026-06-23', isEstimated: false },
  { code: 'V26A4', label: 'Season 2026 — Act 4', shortLabel: 'Act 4', start: '2026-06-23', end: '2026-08-18', isEstimated: true },
  { code: 'V26A5', label: 'Season 2026 — Act 5', shortLabel: 'Act 5', start: '2026-08-18', end: '2026-10-13', isEstimated: true },
  { code: 'V26A6', label: 'Season 2026 — Act 6', shortLabel: 'Act 6', start: '2026-10-13', end: '2027-01-06', isEstimated: true },
]

export const VALORANT_ACTS: ValorantAct[] = RAW_ACTS.map((a) => ({
  ...a,
  start: new Date(a.start + 'T00:00:00Z'),
  end: new Date(a.end + 'T00:00:00Z'),
}))

/**
 * Returns the act that contains the given date, or null if outside the known calendar.
 * End dates are exclusive: a match on the act-end day belongs to the NEXT act.
 */
export function getActForDate(date: Date): ValorantAct | null {
  const t = date.getTime()
  return VALORANT_ACTS.find((a) => t >= a.start.getTime() && t < a.end.getTime()) ?? null
}

/** Returns the currently-running act (or null between acts / outside the calendar). */
export function getCurrentAct(): ValorantAct | null {
  return getActForDate(new Date())
}

/** Returns whether an act has finished (its end date is in the past). */
export function isActComplete(act: ValorantAct): boolean {
  return act.end.getTime() <= Date.now()
}

/** All acts whose end date is in the past. */
export function getCompletedActs(): ValorantAct[] {
  return VALORANT_ACTS.filter(isActComplete)
}

/** Format an act's date range for display, e.g. "Mar 18 – Apr 29, 2026" */
export function formatActRange(act: ValorantAct): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const start = act.start.toLocaleDateString('en-US', opts)
  // Display end is one day BEFORE the exclusive end date for human readability
  const displayEnd = new Date(act.end.getTime() - 1)
  const end = displayEnd.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${start} – ${end}`
}
