import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Playbook, PlaybookChapter } from '../lib/types'

interface PlaybookFilters {
  map?: string
  agent?: string
  side?: Playbook['side']
}

/** The signed-in user's playbooks (RLS scopes the rows), newest first. */
export function usePlaybooks({ map, agent, side }: PlaybookFilters = {}) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      let query = supabase.from('playbooks').select('*').order('updated_at', { ascending: false })
      if (map) query = query.eq('map', map)
      if (agent) query = query.eq('agent', agent)
      if (side) query = query.eq('side', side)

      const { data, error } = await query
      if (cancelled) return
      if (error) {
        console.error('[usePlaybooks] load failed', error)
        setError(error.message)
      } else {
        setPlaybooks(data ?? [])
        setError(null)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [map, agent, side, attempt])

  const reload = useCallback(() => setAttempt(n => n + 1), [])

  return { playbooks, loading, error, reload }
}

interface Loaded<T> {
  key: string | undefined
  data: T
  error: string | null
}

/** One playbook by slug, or null once loading finishes without a hit. */
export function usePlaybookBySlug(slug: string | undefined) {
  // Loading is derived: the result is stale until it was fetched for this slug.
  const [result, setResult] = useState<Loaded<Playbook | null> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!slug) {
        setResult({ key: slug, data: null, error: null })
        return
      }
      const { data, error } = await supabase.from('playbooks').select('*').eq('slug', slug).maybeSingle()
      if (cancelled) return
      if (error) console.error('[usePlaybookBySlug] load failed', error)
      setResult({ key: slug, data: data ?? null, error: error?.message ?? null })
    }

    load()
    return () => { cancelled = true }
  }, [slug])

  const current = result?.key === slug ? result : null
  return { playbook: current?.data ?? null, loading: !current, error: current?.error ?? null }
}

const NO_CHAPTERS: PlaybookChapter[] = []

export function usePlaybookChapters(playbookId: string | undefined) {
  const [result, setResult] = useState<Loaded<PlaybookChapter[]> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!playbookId) {
        setResult({ key: playbookId, data: NO_CHAPTERS, error: null })
        return
      }
      const { data, error } = await supabase
        .from('playbook_chapters')
        .select('*')
        .eq('playbook_id', playbookId)
        .order('chapter_number', { ascending: true })
      if (cancelled) return
      if (error) console.error('[usePlaybookChapters] load failed', error)
      setResult({ key: playbookId, data: data ?? NO_CHAPTERS, error: error?.message ?? null })
    }

    load()
    return () => { cancelled = true }
  }, [playbookId])

  const current = result?.key === playbookId ? result : null
  return { chapters: current?.data ?? NO_CHAPTERS, loading: !current, error: current?.error ?? null }
}
