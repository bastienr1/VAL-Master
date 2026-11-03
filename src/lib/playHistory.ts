/**
 * Undo and redo for the Plays editor (docs/plays-editor-v2.md §2.5).
 *
 * A history is the value shown now, the values before it (oldest first) and
 * the values undone since (next redo last). Every committed change pushes the
 * old value and clears the redo side; the past is capped so a long session
 * does not keep every keystroke.
 *
 * A push may carry a coalescing key: a push with the same key as the one
 * before it replaces the present instead of pushing, so typing a caption is
 * one undo step rather than one per letter. Undo, redo and any push without
 * that key end the run.
 *
 * Pure and generic, no React: the page keeps a `History<PlayDoc>` in state.
 */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** The coalescing key of the last push, null when the run is over. */
  lastKey: string | null
}

/** How many past values are kept. */
export const HISTORY_CAP = 50

/** A history with nothing to undo or redo. */
export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null }
}

/**
 * The history with `next` as the present. The same value as the present is
 * no change and gives the history back as is. With `key` equal to the last
 * push's key, `next` replaces the present and nothing is pushed.
 */
export function pushHistory<T>(history: History<T>, next: T, key: string | null = null, cap = HISTORY_CAP): History<T> {
  if (next === history.present) return history
  if (key !== null && key === history.lastKey) return { ...history, present: next, future: [] }
  const past = [...history.past, history.present]
  return { past: past.length > cap ? past.slice(past.length - cap) : past, present: next, future: [], lastKey: key }
}

export const canUndo = <T>(history: History<T>) => history.past.length > 0
export const canRedo = <T>(history: History<T>) => history.future.length > 0

/** One step back; the history as is when there is nothing to undo. */
export function undoHistory<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [...history.future, history.present],
    lastKey: null,
  }
}

/** One step forward again; the history as is when there is nothing to redo. */
export function redoHistory<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history
  return {
    past: [...history.past, history.present],
    present: history.future[history.future.length - 1],
    future: history.future.slice(0, -1),
    lastKey: null,
  }
}
