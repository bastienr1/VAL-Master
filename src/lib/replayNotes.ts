/**
 * Where a match's notes and quick-dropped moment tags sit on the replay's clock.
 * They are stored in video seconds, as the VOD review wrote them.
 *
 * Pure: no Supabase, no DOM. Covered by `replayNotes.test.ts`.
 */

import type { ReplayBundle } from './replayBundle.ts'
import { videoSecondsToReplayMs } from './replaySync.ts'
import type { MomentTag, ReviewTag, VodComment } from './types.ts'

/** A dot over the replay's scrubber. */
export interface ReplayNoteMark {
  id: string
  /** Replay time, ms. */
  t: number
  label: string
  /** The tag's colour on a quick-dropped moment; null on a note. */
  color: string | null
}

const LABEL_MAX = 80

const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]
  return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1).trimEnd()}…` : line
}

/**
 * One mark per note, and one per moment tag no note owns: a tag on a note is
 * already on its card.
 */
export function replayNoteMarks(
  bundle: ReplayBundle,
  barrierOffset: number,
  comments: readonly VodComment[],
  moments: readonly MomentTag[],
  tags: readonly ReviewTag[],
): ReplayNoteMark[] {
  const at = (seconds: number) => videoSecondsToReplayMs(bundle, barrierOffset, seconds)
  const tagOf = new Map(tags.map(t => [t.id, t]))
  return [
    ...comments.map(c => ({
      id: c.id,
      t: at(c.timestamp_seconds),
      label: c.free_text ? firstLine(c.free_text) : (c.tags ?? []).join(', ') || 'Note',
      color: null,
    })),
    ...moments
      .filter(m => !m.note_id)
      .map(m => ({
        id: m.id,
        t: at(m.video_ts),
        label: tagOf.get(m.tag_id)?.name ?? 'Tag',
        color: tagOf.get(m.tag_id)?.color ?? null,
      })),
  ]
}
