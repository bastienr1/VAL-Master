import { useState, useEffect, useCallback } from 'react'
import { loadGameContent, getLoadedGameContent } from '../lib/gameContent'
import type { GameContentRegistry } from '../lib/gameContent'

export type GameContentStatus = 'loading' | 'ready' | 'degraded' | 'error'

interface UseGameContent {
  registry: GameContentRegistry | null
  /** 'degraded' means we fell back off valorant-api — images or roles may be missing. */
  status: GameContentStatus
  source: GameContentRegistry['source'] | null
  error: Error | null
  reload: () => void
}

const statusFor = (registry: GameContentRegistry): GameContentStatus =>
  registry.source === 'valorant-api' ? 'ready' : 'degraded'

/**
 * Reads the shared registry. Fetching is memoised inside loadGameContent, so
 * mounting this hook in several components triggers at most one network load.
 */
export function useGameContent(): UseGameContent {
  const alreadyLoaded = getLoadedGameContent()

  const [registry, setRegistry] = useState<GameContentRegistry | null>(alreadyLoaded)
  const [status, setStatus] = useState<GameContentStatus>(
    alreadyLoaded ? statusFor(alreadyLoaded) : 'loading',
  )
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    loadGameContent()
      .then(next => {
        if (cancelled) return
        setRegistry(next)
        setStatus(statusFor(next))
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const reload = useCallback(() => {
    // Only blank the view if there is nothing cached to keep showing.
    if (!getLoadedGameContent()) setStatus('loading')
    setAttempt(n => n + 1)
  }, [])

  return { registry, status, source: registry?.source ?? null, error, reload }
}

interface UseGameContentNames {
  mapNames: string[]
  agentNames: string[]
  status: GameContentStatus
  /** True until there is something real to put in a picker. */
  loading: boolean
}

/** Sorted display names for map/agent pickers. */
export function useGameContentNames(): UseGameContentNames {
  const { registry, status } = useGameContent()

  const mapNames = registry ? [...registry.maps.byId.values()].map(m => m.name).sort() : []
  const agentNames = registry ? [...registry.agents.byId.values()].map(a => a.name).sort() : []

  return { mapNames, agentNames, status, loading: status === 'loading' }
}
