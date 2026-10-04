/**
 * A fetch result several components can share.
 *
 * Home, the Map Hub and the art slots each read the same few queries from many
 * components at once. One of these holds the result, hands every subscriber the
 * same object, and refetches when told the data changed, so a page costs one
 * query however many pieces of it are mounted.
 *
 * Shaped for `useSyncExternalStore` (see `hooks/useResource.ts`). Free of React
 * and Supabase so it can be unit-tested.
 */

export interface ResourceState<T> {
  /** Last good result. Kept while a refresh runs, and after a failed one. */
  data: T | null
  error: string | null
  /** A fetch is running, or nothing has been fetched yet. */
  loading: boolean
}

export interface Resource<T> {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ResourceState<T>
  /** The data changed: refetch now if anything is mounted, else on next use. */
  invalidate: () => void
  /**
   * Replace the held data at once, for a write shown before the server
   * answers. Drops any fetch in flight, whose result would predate the write.
   * Does nothing before the first result.
   */
  mutate: (update: (data: T) => T) => void
  /** Forget everything, e.g. because a different user signed in. */
  reset: () => void
}

interface ResourceOptions {
  /**
   * How long a result stays fresh. A component mounting after this shows the
   * cached data at once and refreshes it in the background. Default: forever,
   * i.e. only `invalidate()` refetches.
   */
  maxAgeMs?: number
}

export function createResource<T>(fetcher: () => Promise<T>, options: ResourceOptions = {}): Resource<T> {
  const maxAgeMs = options.maxAgeMs ?? Infinity
  const initial: ResourceState<T> = { data: null, error: null, loading: true }

  let state = initial
  let fetchedAt = 0
  let stale = true
  let inFlight = false
  // Bumped per fetch so a superseded one cannot overwrite a newer result.
  let run = 0
  const listeners = new Set<() => void>()

  const set = (next: ResourceState<T>) => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  const load = () => {
    const mine = ++run
    inFlight = true
    stale = false
    if (!state.loading) set({ ...state, loading: true })

    fetcher().then(
      data => {
        if (mine !== run) return
        inFlight = false
        fetchedAt = Date.now()
        set({ data, error: null, loading: false })
      },
      (err: unknown) => {
        if (mine !== run) return
        inFlight = false
        stale = true // so the next mount retries
        set({ data: state.data, error: err instanceof Error ? err.message : String(err), loading: false })
      },
    )
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!inFlight && (stale || Date.now() - fetchedAt > maxAgeMs)) load()
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    invalidate() {
      stale = true
      if (listeners.size > 0) load()
    },
    mutate(update) {
      if (state.data === null) return
      run++
      inFlight = false
      stale = true // the dropped fetch is made up on the next mount
      set({ data: update(state.data), error: state.error, loading: false })
    },
    reset() {
      run++
      inFlight = false
      stale = true
      fetchedAt = 0
      set(initial)
      if (listeners.size > 0) load()
    },
  }
}
