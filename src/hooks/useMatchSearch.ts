import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Match } from '../lib/types'

export function useMatchSearch() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('user_id', user.id)
        .order('match_date', { ascending: false })

      if (cancelled) return
      if (!error && data) setMatches(data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useCallback((query: string): Match[] => {
    const q = query.trim().toLowerCase()
    if (!q) return matches
    return matches.filter(m => {
      const haystack = `${m.map} ${m.agent} ${m.score}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [matches])

  return { matches, filtered, loading }
}
