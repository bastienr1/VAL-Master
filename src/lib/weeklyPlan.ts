import type { BlockLog, RoutineBlock, SavedDrill, WeeklyGoal } from './types.ts'

/**
 * The Weekly Plan's arithmetic: weeks, adherence, what is left today, the
 * streak. Pure: the Supabase side is `weeklyPlanStore.ts`.
 *
 * Dates are plain 'YYYY-MM-DD' strings, which sort as text. Nothing here reads
 * the clock — every function takes the date it needs — and the day maths is
 * done on day counts rather than `Date`, so no time zone can shift a result.
 */

export const SEED_BLOCKS: Array<{ name: string; weeklyTarget: number }> = [
  { name: 'Range warm-up', weeklyTarget: 5 },
  { name: 'Deathmatch', weeklyTarget: 5 },
  { name: 'Aim training', weeklyTarget: 4 },
  { name: 'Ranked', weeklyTarget: 4 },
  { name: 'VOD review', weeklyTarget: 2 },
]
export const STREAK_THRESHOLD = 0.8
export const TREND_WEEKS = 8

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ------------------------------------------------------------------------ dates

/** Days since 1970-01-01 for a 'YYYY-MM-DD' (proleptic Gregorian). */
function toDays(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function fromDays(days: number): string {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 0 for Monday … 6 for Sunday. 1970-01-01 was a Thursday. */
function mondayIndex(date: string): number {
  return (((toDays(date) + 3) % 7) + 7) % 7
}

/** 'YYYY-MM-DD' for `now` in an IANA time zone. */
export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** True for a real calendar date written 'YYYY-MM-DD'. */
export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDays(toDays(value)) === value
}

export function addDays(date: string, n: number): string {
  return fromDays(toDays(date) + n)
}

/** Monday of the week containing `date` ('YYYY-MM-DD' in, 'YYYY-MM-DD' out). */
export function weekStart(date: string): string {
  return addDays(date, -mondayIndex(date))
}

/** The seven dates Mon..Sun of the week starting at `start`. */
export function weekDays(start: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(start, i))
}

export function addWeeks(start: string, n: number): string {
  return addDays(start, n * 7)
}

/** '30 Sep' — the short form for column heads and the week range. */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${day} ${MONTHS[month - 1].slice(0, 3)}`
}

/** 'Tuesday 30 September' — the spoken form for a day cell's label. */
export function longDate(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${WEEKDAYS[mondayIndex(date)]} ${day} ${MONTHS[month - 1]}`
}

/** 'Mon' … 'Sun'. */
export function weekdayShort(date: string): string {
  return WEEKDAYS[mondayIndex(date)].slice(0, 3)
}

/** '29 Sep – 5 Oct' for the week starting at `start`. */
export function weekRange(start: string): string {
  return `${shortDate(start)} – ${shortDate(addDays(start, 6))}`
}

// --------------------------------------------------------------------- progress

export interface BlockProgress {
  block: RoutineBlock
  done: number
  target: number
  loggedDays: Set<string>
}

/**
 * Whether a block belongs to the week starting at `start`: not archived by the
 * time it ended, and already created by then — so a block added today does not
 * show up, unticked, in the weeks before it existed.
 */
function inWeek(block: RoutineBlock, start: string): boolean {
  const sunday = addDays(start, 6)
  if (block.created_at.slice(0, 10) > sunday) return false
  return block.archived_at === null || block.archived_at.slice(0, 10) > sunday
}

/** Active blocks only (archived_at null, or archived after the week ended), in `position` order. */
export function weekProgress(blocks: RoutineBlock[], logs: BlockLog[], start: string): BlockProgress[] {
  const sunday = addDays(start, 6)
  return blocks
    .filter(block => inWeek(block, start))
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .map(block => {
      const loggedDays = new Set(
        logs
          .filter(log => log.block_id === block.id && log.logged_on >= start && log.logged_on <= sunday)
          .map(log => log.logged_on),
      )
      return { block, done: loggedDays.size, target: block.weekly_target, loggedDays }
    })
}

/** sum(min(done, target)) / sum(target); 0 when there are no targets. */
export function adherence(progress: BlockProgress[]): { done: number; planned: number; ratio: number } {
  let done = 0
  let planned = 0
  for (const row of progress) {
    done += Math.min(row.done, row.target)
    planned += row.target
  }
  return { done, planned, ratio: planned === 0 ? 0 : done / planned }
}

/** Blocks not ticked on `today` and still under target. */
export function leftToday(progress: BlockProgress[], today: string): RoutineBlock[] {
  return progress.filter(row => !row.loggedDays.has(today) && row.done < row.target).map(row => row.block)
}

/** Consecutive weeks at or above STREAK_THRESHOLD, counting back from the week before `currentStart`; the current week adds one only once it reaches the threshold. */
export function streak(blocks: RoutineBlock[], logs: BlockLog[], currentStart: string): number {
  const reached = (start: string) => {
    const { planned, ratio } = adherence(weekProgress(blocks, logs, start))
    return planned > 0 && ratio >= STREAK_THRESHOLD
  }

  let count = 0
  // Ends at the first week under the line, which every history has: no block
  // counts in a week before it was created.
  for (let start = addWeeks(currentStart, -1); reached(start); start = addWeeks(start, -1)) count += 1
  return reached(currentStart) ? count + 1 : count
}

/** Mean rating of a block's rated logs in a week, or null. */
export function averageRating(logs: BlockLog[], blockId: string, start: string): number | null {
  const sunday = addDays(start, 6)
  const ratings = logs
    .filter(log => log.block_id === blockId && log.logged_on >= start && log.logged_on <= sunday)
    .map(log => log.rating)
    .filter((rating): rating is number => rating !== null)
  if (ratings.length === 0) return null
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
}

/** Focus text for a saved drill: title, then ' — ' + cue when the cue is non-empty. */
export function focusFromDrill(saved: Pick<SavedDrill, 'title' | 'cue'>): string {
  const cue = saved.cue?.trim() ?? ''
  return cue === '' ? saved.title : `${saved.title} — ${cue}`
}

/** The goal a block has in the week starting at `start`, or null. */
export function goalFor(goals: WeeklyGoal[], blockId: string, start: string): WeeklyGoal | null {
  return goals.find(goal => goal.block_id === blockId && goal.week_start === start) ?? null
}

export interface TrendWeek {
  start: string
  done: number
  planned: number
  ratio: number
}

/**
 * The last TREND_WEEKS weeks up to `currentStart`, oldest first. Weeks in
 * which no block existed yet are left out.
 */
export function trendWeeks(blocks: RoutineBlock[], logs: BlockLog[], currentStart: string): TrendWeek[] {
  const weeks: TrendWeek[] = []
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    const start = addWeeks(currentStart, -i)
    const week = adherence(weekProgress(blocks, logs, start))
    if (week.planned > 0) weeks.push({ start, ...week })
  }
  return weeks
}

/**
 * The home Goals tile's line — '9 / 14 this week · Left today: Deathmatch, VOD
 * review' — or null with no active block, when the tile keeps its old text.
 */
export function goalsTileLine(progress: BlockProgress[], today: string): string | null {
  if (progress.length === 0) return null
  const { done, planned } = adherence(progress)
  const left = leftToday(progress, today).map(block => block.name)
  return `${done} / ${planned} this week · ${left.length > 0 ? `Left today: ${left.join(', ')}` : 'Done for today'}`
}
