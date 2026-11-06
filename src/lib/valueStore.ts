/**
 * One value that changes faster than a page should render, shaped for
 * `useSyncExternalStore`: the writer sets it, and only the components that
 * read it render again. The Plays replay mode keeps its frame (every
 * animation frame) and its clock (a few times a second) in two of these, so
 * the editor around the canvas and the transport stays still while a match
 * plays (docs/plays-editor-v2.md §2.8).
 */

export interface ValueStore<T> {
  get(): T
  /** Notifies the subscribers when the value is a different one. */
  set(next: T): void
  subscribe(listener: () => void): () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
