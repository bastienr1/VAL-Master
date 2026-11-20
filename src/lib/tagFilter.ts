/**
 * Filtering a review by several moment tags at once.
 *
 * A review's tag chips used to be a radio: one tag, or none. They are now a
 * set, with a mode. "All" keeps what carries every chosen tag (KILL and B and
 * DEFENSE: kills on B on defence); "any" keeps what carries at least one (KILL
 * or DEATH: every duel). One chosen tag reads the same in both.
 *
 * What a filter is applied to is a moment in the review: a note with the tags
 * captured on it, or the tags dropped on one second with no note (a quick-drop,
 * or the kills the match report tags). `looseMoments` groups the second kind so
 * they can be listed beside the notes; before this they showed only as dots on
 * the timeline.
 *
 * Pure: no Supabase, no DOM. Covered by `tagFilter.test.ts`.
 */

import type { MomentTag } from './types'

export type TagFilterMode = 'all' | 'any'

export interface TagFilter {
  /** Tag ids, in the order they were chosen. */
  ids: string[]
  mode: TagFilterMode
}

export const NO_TAG_FILTER: TagFilter = { ids: [], mode: 'all' }

export const isFiltering = (filter: TagFilter) => filter.ids.length > 0

/** Adds the tag to the filter, or takes it out if it is there. */
export function toggleTag(filter: TagFilter, tagId: string): TagFilter {
  return filter.ids.includes(tagId)
    ? { ...filter, ids: filter.ids.filter(id => id !== tagId) }
    : { ...filter, ids: [...filter.ids, tagId] }
}

/** The filter without a tag that no longer exists. The same object when it was not in it. */
export function withoutTag(filter: TagFilter, tagId: string): TagFilter {
  return filter.ids.includes(tagId) ? { ...filter, ids: filter.ids.filter(id => id !== tagId) } : filter
}

/** Whether something carrying `tagIds` passes. No chosen tag passes everything. */
export function matchesTagFilter(filter: TagFilter, tagIds: Iterable<string>): boolean {
  if (filter.ids.length === 0) return true
  const carried = tagIds instanceof Set ? (tagIds as Set<string>) : new Set(tagIds)
  return filter.mode === 'all' ? filter.ids.every(id => carried.has(id)) : filter.ids.some(id => carried.has(id))
}

type Moment = Pick<MomentTag, 'id' | 'tag_id' | 'video_ts' | 'note_id'>

export interface LooseMoment<M extends Moment = Moment> {
  videoTs: number
  /** The tags dropped on that second, in the order given. */
  moments: M[]
}

/** The tagged seconds that belong to no note, in tape order. */
export function looseMoments<M extends Moment>(moments: ReadonlyArray<M>): Array<LooseMoment<M>> {
  const bySecond = new Map<number, M[]>()
  for (const moment of moments) {
    if (moment.note_id) continue
    const bucket = bySecond.get(moment.video_ts)
    if (bucket) bucket.push(moment)
    else bySecond.set(moment.video_ts, [moment])
  }
  return [...bySecond].sort((a, b) => a[0] - b[0]).map(([videoTs, group]) => ({ videoTs, moments: group }))
}

/**
 * The ids of the moment tags that belong to something the filter keeps: every
 * tag of a matching note, every tag of a matching second. For the timeline
 * lane, which dims the rest. Null when nothing is being filtered.
 */
export function momentsKept(moments: ReadonlyArray<Moment>, filter: TagFilter): Set<string> | null {
  if (!isFiltering(filter)) return null
  const groups = new Map<string, Moment[]>()
  for (const moment of moments) {
    const key = moment.note_id ? `note:${moment.note_id}` : `second:${moment.video_ts}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(moment)
    else groups.set(key, [moment])
  }
  const kept = new Set<string>()
  for (const group of groups.values()) {
    if (!matchesTagFilter(filter, group.map(m => m.tag_id))) continue
    for (const moment of group) kept.add(moment.id)
  }
  return kept
}
