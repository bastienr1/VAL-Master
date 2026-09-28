import type { MomentTag } from './types'

/**
 * What an edit changes about a note's moment tags.
 *
 * `current` is the note's applied moment rows; `wanted` is the tag ids selected
 * in the editor when Update is pressed. Pure so both capture panels share it and
 * it can be unit-tested without Supabase.
 */
export interface NoteTagDiff {
  /** Tag ids to apply at the note's timestamp. */
  toAdd: string[]
  /** Moment rows to delete. */
  toRemove: MomentTag[]
}

export function diffNoteTags(current: MomentTag[], wanted: string[]): NoteTagDiff {
  const wantedSet = new Set(wanted)
  const currentTagIds = new Set(current.map(m => m.tag_id))

  return {
    toAdd: [...wantedSet].filter(id => !currentTagIds.has(id)),
    toRemove: current.filter(m => !wantedSet.has(m.tag_id)),
  }
}

/** The tag ids a note starts the editor with — one per tag, in tape order. */
export function seedTagIds(current: MomentTag[]): string[] {
  return [...new Set(current.map(m => m.tag_id))]
}
