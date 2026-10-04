import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEED_BLOCKS,
  addDays,
  addWeeks,
  adherence,
  averageRating,
  focusFromDrill,
  goalFor,
  goalsTileLine,
  isDate,
  leftToday,
  localDate,
  longDate,
  streak,
  trendWeeks,
  weekDays,
  weekProgress,
  weekRange,
  weekStart,
} from './weeklyPlan.ts'
import type { BlockLog, RoutineBlock, WeeklyGoal } from './types.ts'

// --------------------------------------------------------------------- fixtures

// Monday 29 Sep 2025 – Sunday 5 Oct 2025.
const WEEK = '2025-09-29'

function block(id: string, overrides: Partial<RoutineBlock> = {}): RoutineBlock {
  return {
    id,
    user_id: 'u1',
    name: id,
    weekly_target: 3,
    position: 0,
    archived_at: null,
    created_at: '2025-01-01T00:00:00+00:00',
    ...overrides,
  }
}

let nextLog = 0
function log(blockId: string, loggedOn: string, rating: number | null = null): BlockLog {
  nextLog += 1
  return {
    id: `l${nextLog}`,
    user_id: 'u1',
    block_id: blockId,
    logged_on: loggedOn,
    rating,
    note: null,
    practice_log_id: null,
    created_at: `${loggedOn}T12:00:00+00:00`,
  }
}

/** `n` logs on the first `n` days of the week starting at `start`. */
function days(blockId: string, start: string, n: number): BlockLog[] {
  return weekDays(start)
    .slice(0, n)
    .map(day => log(blockId, day))
}

// ------------------------------------------------------------------------ dates

test('localDate reads the calendar day in the given zone', () => {
  // 17:30 UTC on the 30th is already 01:30 on 1 Oct in Singapore.
  const now = new Date('2025-09-30T17:30:00Z')
  assert.equal(localDate(now, 'UTC'), '2025-09-30')
  assert.equal(localDate(now, 'Asia/Singapore'), '2025-10-01')
})

test('weekStart finds the Monday', () => {
  assert.equal(weekStart('2025-09-29'), '2025-09-29') // a Monday
  assert.equal(weekStart('2025-10-05'), '2025-09-29') // its Sunday
  assert.equal(weekStart('2025-10-06'), '2025-10-06') // the next Monday
  assert.equal(weekStart('2026-01-01'), '2025-12-29') // a Thursday, across the year
  assert.equal(weekStart('2024-03-03'), '2024-02-26') // across a leap day
})

test('weekDays lists Monday to Sunday in order', () => {
  const list = weekDays(WEEK)
  assert.equal(list.length, 7)
  assert.equal(list[0], '2025-09-29')
  assert.equal(list[2], '2025-10-01')
  assert.equal(list[6], '2025-10-05')
  assert.deepEqual([...list].sort(), list)
})

test('addWeeks and addDays move both ways', () => {
  assert.equal(addWeeks(WEEK, 1), '2025-10-06')
  assert.equal(addWeeks(WEEK, -1), '2025-09-22')
  assert.equal(addDays('2025-12-31', 1), '2026-01-01')
  assert.equal(addDays('2024-03-01', -1), '2024-02-29')
})

test('isDate rejects text and dates that do not exist', () => {
  assert.equal(isDate('2025-09-29'), true)
  assert.equal(isDate('2025-02-30'), false)
  assert.equal(isDate('2025-9-29'), false)
  assert.equal(isDate('next week'), false)
})

test('weekRange and longDate read as written on the page', () => {
  assert.equal(weekRange(WEEK), '29 Sep – 5 Oct')
  assert.equal(longDate('2025-09-30'), 'Tuesday 30 September')
})

// --------------------------------------------------------------------- progress

test('weekProgress counts logs inside the week only, in position order', () => {
  const blocks = [block('dm', { position: 1 }), block('range', { position: 0 })]
  const logs = [
    log('dm', '2025-09-28'), // the Sunday before
    log('dm', '2025-09-29'),
    log('dm', '2025-10-05'),
    log('dm', '2025-10-06'), // the Monday after
    log('range', '2025-10-01'),
  ]
  const progress = weekProgress(blocks, logs, WEEK)
  assert.deepEqual(
    progress.map(row => [row.block.id, row.done, row.target]),
    [
      ['range', 1, 3],
      ['dm', 2, 3],
    ],
  )
  assert.deepEqual([...progress[1].loggedDays].sort(), ['2025-09-29', '2025-10-05'])
})

test('weekProgress drops blocks archived before the week ended and keeps later archives', () => {
  const blocks = [
    block('gone', { archived_at: '2025-09-20T10:00:00+00:00' }),
    block('midweek', { archived_at: '2025-10-02T10:00:00+00:00' }),
    block('later', { archived_at: '2025-10-10T10:00:00+00:00' }),
    block('live'),
  ]
  assert.deepEqual(
    weekProgress(blocks, [], WEEK).map(row => row.block.id),
    ['later', 'live'],
  )
})

test('weekProgress leaves a block out of weeks before it was created', () => {
  const blocks = [block('new', { created_at: '2025-10-07T09:00:00+00:00' })]
  assert.equal(weekProgress(blocks, [], WEEK).length, 0)
  assert.equal(weekProgress(blocks, [], '2025-10-06').length, 1)
})

test('adherence caps extra sessions at the target', () => {
  const blocks = [block('a', { weekly_target: 2 }), block('b', { weekly_target: 4 })]
  const logs = [...days('a', WEEK, 5), ...days('b', WEEK, 1)]
  assert.deepEqual(adherence(weekProgress(blocks, logs, WEEK)), { done: 3, planned: 6, ratio: 0.5 })
})

test('adherence is zero with no blocks', () => {
  assert.deepEqual(adherence([]), { done: 0, planned: 0, ratio: 0 })
})

test('leftToday drops blocks ticked today and blocks already at target', () => {
  const today = '2025-10-01' // Wednesday
  const blocks = [
    block('ticked', { position: 0 }),
    block('full', { position: 1, weekly_target: 2 }),
    block('open', { position: 2 }),
  ]
  const logs = [log('ticked', today), log('full', '2025-09-29'), log('full', '2025-09-30'), log('open', '2025-09-29')]
  assert.deepEqual(
    leftToday(weekProgress(blocks, logs, WEEK), today).map(b => b.id),
    ['open'],
  )
})

test('streak is zero with no history', () => {
  assert.equal(streak([block('a')], [], WEEK), 0)
  assert.equal(streak([], [], WEEK), 0)
})

test('streak counts a run of weeks at 80% or more and stops at a break', () => {
  const blocks = [block('a', { weekly_target: 5 })]
  const logs = [
    ...days('a', addWeeks(WEEK, -1), 4), // 80%
    ...days('a', addWeeks(WEEK, -2), 5), // 100%
    ...days('a', addWeeks(WEEK, -3), 3), // 60% — the break
    ...days('a', addWeeks(WEEK, -4), 5),
  ]
  assert.equal(streak(blocks, logs, WEEK), 2)
})

test('streak adds the current week only once it reaches the threshold', () => {
  const blocks = [block('a', { weekly_target: 5 })]
  const before = days('a', addWeeks(WEEK, -1), 5)
  assert.equal(streak(blocks, [...before, ...days('a', WEEK, 3)], WEEK), 1)
  assert.equal(streak(blocks, [...before, ...days('a', WEEK, 4)], WEEK), 2)
  // A current week over the line counts even with nothing behind it.
  assert.equal(streak(blocks, days('a', WEEK, 5), WEEK), 1)
})

test('averageRating ignores unrated logs and other weeks', () => {
  const logs = [
    log('a', '2025-09-29', 4),
    log('a', '2025-09-30', null),
    log('a', '2025-10-01', 3),
    log('a', '2025-10-06', 1), // next week
    log('b', '2025-09-29', 5), // another block
  ]
  assert.equal(averageRating(logs, 'a', WEEK), 3.5)
  assert.equal(averageRating([log('a', '2025-09-29')], 'a', WEEK), null)
  assert.equal(averageRating([], 'a', WEEK), null)
})

test('focusFromDrill joins title and cue, and skips an empty cue', () => {
  assert.equal(focusFromDrill({ title: 'Jiggle the box', cue: 'Stop before you shoot' }), 'Jiggle the box — Stop before you shoot')
  assert.equal(focusFromDrill({ title: 'Jiggle the box', cue: null }), 'Jiggle the box')
  assert.equal(focusFromDrill({ title: 'Jiggle the box', cue: '   ' }), 'Jiggle the box')
})

test('goalFor matches block and week', () => {
  const goal = (blockId: string, week: string): WeeklyGoal => ({
    id: `${blockId}-${week}`,
    user_id: 'u1',
    block_id: blockId,
    week_start: week,
    focus_text: 'x',
    saved_drill_id: null,
    drill_id: null,
    source_review_id: null,
    source_start_seconds: null,
    created_at: `${week}T00:00:00+00:00`,
  })
  const goals = [goal('a', WEEK), goal('a', addWeeks(WEEK, -1)), goal('b', WEEK)]
  assert.equal(goalFor(goals, 'a', addWeeks(WEEK, -1))?.id, 'a-2025-09-22')
  assert.equal(goalFor(goals, 'b', addWeeks(WEEK, -1)), null)
})

test('trendWeeks runs oldest first and leaves out weeks before the first block', () => {
  const blocks = [block('a', { weekly_target: 2, created_at: '2025-09-16T08:00:00+00:00' })]
  const logs = [...days('a', addWeeks(WEEK, -1), 1), ...days('a', WEEK, 2)]
  assert.deepEqual(trendWeeks(blocks, logs, WEEK), [
    { start: '2025-09-15', done: 0, planned: 2, ratio: 0 },
    { start: '2025-09-22', done: 1, planned: 2, ratio: 0.5 },
    { start: '2025-09-29', done: 2, planned: 2, ratio: 1 },
  ])
  assert.equal(trendWeeks([block('old')], [], WEEK).length, 8)
})

test('goalsTileLine reports progress and what is left, or null with no blocks', () => {
  const today = '2025-10-01'
  const blocks = SEED_BLOCKS.map((seed, position) =>
    block(seed.name, { name: seed.name, weekly_target: seed.weeklyTarget, position }),
  )
  assert.equal(goalsTileLine([], today), null)

  const some = [log('Range warm-up', today), log('Deathmatch', '2025-09-29'), log('Aim training', today), log('Ranked', today)]
  assert.equal(
    goalsTileLine(weekProgress(blocks, some, WEEK), today),
    '4 / 20 this week · Left today: Deathmatch, VOD review',
  )

  const all = blocks.map(b => log(b.id, today))
  assert.equal(goalsTileLine(weekProgress(blocks, all, WEEK), today), '5 / 20 this week · Done for today')
})
