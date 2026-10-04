import { createResource } from './resourceStore'
import { savedDrillsResource } from './savedDrills'
import { scopeToUser, sessionUserId } from './sessionScope'
import { supabase } from './supabase'
import { SEED_BLOCKS, TREND_WEEKS, addWeeks, goalFor, localDate, weekStart } from './weeklyPlan'
import type { BlockLog, RoutineBlock, SavedDrill, WeeklyGoal } from './types'

/**
 * The Weekly Plan — the Supabase side of `weeklyPlan.ts`.
 *
 * One shared resource feeds `/plan` and the home Goals tile. Every write
 * changes the held copy first and the database second, so a tick shows at
 * once; a write that fails refetches, which puts the page back to what the
 * database holds.
 *
 * No `user_id` filter: the three tables are owner-only under RLS, and
 * `user_id` defaults to `auth.uid()` on insert.
 */

export interface PlanData {
  /** Every block, archived ones included, in `position` order. */
  blocks: RoutineBlock[]
  goals: WeeklyGoal[]
  logs: BlockLog[]
}

// Shown at once from cache when a page mounts, then refreshed if older than
// this: a saved drill removed on another page nulls a goal's link with no
// event to announce it.
const REFRESH_AFTER_MS = 15_000

const EMPTY_PLAN: PlanData = { blocks: [], goals: [], logs: [] }

async function fetchPlan(): Promise<PlanData> {
  if (!(await sessionUserId())) return EMPTY_PLAN

  // The trend's weeks plus one, so its oldest week can still show the focus
  // carried in from the week before. The browser's zone is close enough for a
  // cutoff with a week of slack.
  const today = localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  const since = addWeeks(weekStart(today), -(TREND_WEEKS + 1))

  const [blocks, goals, logs] = await Promise.all([
    supabase.from('routine_blocks').select('*').order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('weekly_goals').select('*').gte('week_start', since),
    supabase.from('block_logs').select('*').gte('logged_on', since),
  ])

  const error = blocks.error ?? goals.error ?? logs.error
  if (error) throw new Error(error.message)
  return {
    blocks: (blocks.data ?? []) as RoutineBlock[],
    goals: (goals.data ?? []) as WeeklyGoal[],
    logs: (logs.data ?? []) as BlockLog[],
  }
}

export const planResource = scopeToUser(createResource(fetchPlan, { maxAgeMs: REFRESH_AFTER_MS }))

/** A row shown ahead of the database's answer; it has no real id to write against yet. */
const PENDING = 'pending-'
export function isPending(row: { id: string }): boolean {
  return row.id.startsWith(PENDING)
}

function current(): PlanData {
  return planResource.getSnapshot().data ?? EMPTY_PLAN
}

/**
 * Runs one write: `optimistic` changes the held plan first, `settle` folds the
 * database's answer in. A failure refetches — the rollback — and rethrows.
 */
async function write<T>(
  optimistic: ((plan: PlanData) => PlanData) | null,
  action: () => Promise<T>,
  settle?: (plan: PlanData, result: T) => PlanData,
): Promise<T> {
  if (optimistic) planResource.mutate(optimistic)
  try {
    const result = await action()
    if (settle) planResource.mutate(plan => settle(plan, result))
    return result
  } catch (err) {
    planResource.invalidate()
    throw err
  }
}

// ----------------------------------------------------------------------- blocks

export async function createBlock(name: string, weeklyTarget: number): Promise<RoutineBlock> {
  const position = Math.max(-1, ...current().blocks.map(block => block.position)) + 1
  return write(
    null,
    async () => {
      const { data, error } = await supabase
        .from('routine_blocks')
        .insert({ name: name.trim(), weekly_target: weeklyTarget, position })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as RoutineBlock
    },
    (plan, block) => ({ ...plan, blocks: [...plan.blocks, block] }),
  )
}

/** The starter routine, in one insert. */
export async function createSeedBlocks(): Promise<RoutineBlock[]> {
  return write(
    null,
    async () => {
      const { data, error } = await supabase
        .from('routine_blocks')
        .insert(SEED_BLOCKS.map((seed, position) => ({ name: seed.name, weekly_target: seed.weeklyTarget, position })))
        .select('*')
      if (error) throw new Error(error.message)
      return ((data ?? []) as RoutineBlock[]).sort((a, b) => a.position - b.position)
    },
    (plan, blocks) => ({ ...plan, blocks: [...plan.blocks, ...blocks] }),
  )
}

type BlockPatch = Partial<Pick<RoutineBlock, 'name' | 'weekly_target' | 'position' | 'archived_at'>>

function patchBlock(id: string, patch: BlockPatch): Promise<void> {
  return write(
    plan => ({ ...plan, blocks: plan.blocks.map(block => (block.id === id ? { ...block, ...patch } : block)) }),
    async () => {
      const { error } = await supabase.from('routine_blocks').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    },
  )
}

export function updateBlock(
  id: string,
  patch: Partial<Pick<RoutineBlock, 'name' | 'weekly_target' | 'position'>>,
): Promise<void> {
  return patchBlock(id, patch)
}

/** Takes a block out of the routine from now on; its past weeks keep it. */
export function archiveBlock(id: string): Promise<void> {
  return patchBlock(id, { archived_at: new Date().toISOString() })
}

export function restoreBlock(id: string): Promise<void> {
  return patchBlock(id, { archived_at: null })
}

/** Renumbers `position` to follow `orderedIds`, writing only the blocks that moved. */
export async function reorderBlocks(orderedIds: string[]): Promise<void> {
  const before = new Map(current().blocks.map(block => [block.id, block.position]))
  const moved = orderedIds.map((id, position) => ({ id, position })).filter(row => before.get(row.id) !== row.position)
  if (moved.length === 0) return

  const next = new Map(moved.map(row => [row.id, row.position]))
  await write(
    plan => ({
      ...plan,
      blocks: plan.blocks
        .map(block => (next.has(block.id) ? { ...block, position: next.get(block.id) as number } : block))
        .sort((a, b) => a.position - b.position),
    }),
    async () => {
      const results = await Promise.all(
        moved.map(row => supabase.from('routine_blocks').update({ position: row.position }).eq('id', row.id)),
      )
      const failed = results.find(result => result.error)
      if (failed?.error) throw new Error(failed.error.message)
    },
  )
}

/** Deletes a block for real; its goals and check-ins go with it (cascade). */
export function deleteBlock(id: string): Promise<void> {
  return write(
    plan => ({
      blocks: plan.blocks.filter(block => block.id !== id),
      goals: plan.goals.filter(goal => goal.block_id !== id),
      logs: plan.logs.filter(log => log.block_id !== id),
    }),
    async () => {
      const { error } = await supabase.from('routine_blocks').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  )
}

// ------------------------------------------------------------------------ goals

/** The drill a goal points at: what the practice log and "Open in guide" need. */
export type GoalLink = Pick<WeeklyGoal, 'saved_drill_id' | 'drill_id' | 'source_review_id' | 'source_start_seconds'>

const NO_LINK: GoalLink = { saved_drill_id: null, drill_id: null, source_review_id: null, source_start_seconds: null }

export function linkFromSaved(saved: SavedDrill): GoalLink {
  return {
    saved_drill_id: saved.id,
    drill_id: saved.drill_id,
    source_review_id: saved.reference_review_id,
    source_start_seconds: saved.source_start_seconds,
  }
}

/** A goal's own link, to carry into the next week or back into the picker; null when it has none. */
export function linkFromGoal(goal: WeeklyGoal): GoalLink | null {
  if (goal.saved_drill_id === null && goal.drill_id === null) return null
  return {
    saved_drill_id: goal.saved_drill_id,
    drill_id: goal.drill_id,
    source_review_id: goal.source_review_id,
    source_start_seconds: goal.source_start_seconds,
  }
}

/**
 * Sets a block's focus for a week, replacing the one it had. `saved` links the
 * goal to a saved drill; `link` carries an existing goal's link over (Keep).
 * With neither, the goal is plain text.
 */
export function setGoal(
  blockId: string,
  week: string,
  { focusText, saved, link }: { focusText: string; saved?: SavedDrill; link?: GoalLink | null },
): Promise<WeeklyGoal> {
  const row = {
    block_id: blockId,
    week_start: week,
    focus_text: focusText.trim(),
    ...(saved ? linkFromSaved(saved) : (link ?? NO_LINK)),
  }
  const others = (plan: PlanData) => plan.goals.filter(goal => !(goal.block_id === blockId && goal.week_start === week))

  return write(
    plan => ({
      ...plan,
      goals: [...others(plan), { ...row, id: `${PENDING}${blockId}`, user_id: '', created_at: new Date().toISOString() }],
    }),
    async () => {
      const { data, error } = await supabase
        .from('weekly_goals')
        .upsert(row, { onConflict: 'block_id,week_start' })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as WeeklyGoal
    },
    (plan, goal) => ({ ...plan, goals: [...others(plan), goal] }),
  )
}

export function clearGoal(id: string): Promise<void> {
  return write(
    plan => ({ ...plan, goals: plan.goals.filter(goal => goal.id !== id) }),
    async () => {
      const { error } = await supabase.from('weekly_goals').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  )
}

// ------------------------------------------------------------------------- logs

/** Ticks a block on a day. A second tick for the same day is the same tick. */
export async function tick(blockId: string, date: string): Promise<void> {
  const pendingId = `${PENDING}${blockId}:${date}`
  const saved = await write(
    plan => ({
      ...plan,
      logs: [
        ...plan.logs,
        {
          id: pendingId,
          user_id: '',
          block_id: blockId,
          logged_on: date,
          rating: null,
          note: null,
          practice_log_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    }),
    async () => {
      const { data, error } = await supabase
        .from('block_logs')
        .upsert({ block_id: blockId, logged_on: date }, { onConflict: 'block_id,logged_on', ignoreDuplicates: true })
        .select('*')
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data as BlockLog | null
    },
    (plan, log) => (log ? { ...plan, logs: plan.logs.map(row => (row.id === pendingId ? log : row)) } : plan),
  )
  // Already ticked from another tab: the insert was skipped and returned
  // nothing, so fetch the row that is there.
  if (!saved) planResource.invalidate()
}

function practiceNote(rating: number, note: string | null): string {
  return note ? `Weekly plan · ${rating}/5 — ${note}` : `Weekly plan · ${rating}/5`
}

export const DRILL_LOG_SKIPPED = 'Check-in saved; drill log skipped'

/**
 * Saves a check-in's rating and note.
 *
 * The first rating on a drill-linked focus also writes the drill's own
 * `practice_logs` row, so the saved-drill card's count and the plan cannot
 * disagree. That second write failing does not undo the check-in: the
 * function then returns DRILL_LOG_SKIPPED for the page to show. Otherwise null.
 */
export async function updateLog(
  id: string,
  { rating, note }: { rating: number | null; note: string | null },
): Promise<string | null> {
  const plan = current()
  const before = plan.logs.find(log => log.id === id)
  if (!before) throw new Error('Check-in not found')
  const cleanNote = note?.trim() || null

  await write(
    held => ({ ...held, logs: held.logs.map(log => (log.id === id ? { ...log, rating, note: cleanNote } : log)) }),
    async () => {
      const { error } = await supabase.from('block_logs').update({ rating, note: cleanNote }).eq('id', id)
      if (error) throw new Error(error.message)
    },
  )
  if (rating === null) return null

  // Already paired: keep the drill log's note in step with the check-in.
  if (before.practice_log_id) {
    const { error } = await supabase
      .from('practice_logs')
      .update({ note: practiceNote(rating, cleanNote) })
      .eq('id', before.practice_log_id)
    return error ? DRILL_LOG_SKIPPED : null
  }

  const drillId = goalFor(plan.goals, before.block_id, weekStart(before.logged_on))?.drill_id
  if (before.rating !== null || !drillId) return null

  // `outcome` stays unset: a 1–5 rating of the focus is not a hit or a miss.
  const { data, error } = await supabase
    .from('practice_logs')
    .insert({ drill_id: drillId, logged_at: before.logged_on, note: practiceNote(rating, cleanNote) })
    .select('id')
    .single()
  if (error || !data) return DRILL_LOG_SKIPPED

  const practiceLogId = data.id as string
  const paired = await supabase.from('block_logs').update({ practice_log_id: practiceLogId }).eq('id', id)
  if (paired.error) {
    // Unpaired, the drill log could never be removed with its check-in.
    await supabase.from('practice_logs').delete().eq('id', practiceLogId)
    return DRILL_LOG_SKIPPED
  }

  planResource.mutate(held => ({
    ...held,
    logs: held.logs.map(log => (log.id === id ? { ...log, practice_log_id: practiceLogId } : log)),
  }))
  savedDrillsResource.invalidate()
  return null
}

/** Removes a check-in, and first the drill log it wrote, if any. */
export async function untick(id: string): Promise<void> {
  const before = current().logs.find(log => log.id === id)

  await write(
    plan => ({ ...plan, logs: plan.logs.filter(log => log.id !== id) }),
    async () => {
      if (before?.practice_log_id) {
        const paired = await supabase.from('practice_logs').delete().eq('id', before.practice_log_id)
        if (paired.error) throw new Error(paired.error.message)
      }
      const { error } = await supabase.from('block_logs').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  )
  if (before?.practice_log_id) savedDrillsResource.invalidate()
}
