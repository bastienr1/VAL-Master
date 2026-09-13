import { useState, useCallback } from 'react'
import { useProfile, profileToPlayer } from '../lib/profile'
import { loadLatestMatches } from '../lib/loadLatest'

export function useLoadLatest() {
  const { profile } = useProfile()
  const player = profileToPlayer(profile)
  const [syncing, setSyncing] = useState(false)

  const sync = useCallback(async () => {
    if (!player) return
    setSyncing(true)
    try {
      await loadLatestMatches(player)
    } catch (err) {
      console.error('Failed to sync matches:', err)
    } finally {
      setSyncing(false)
    }
  }, [player])

  return { sync, syncing, player }
}
