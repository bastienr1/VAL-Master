import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { PLAYBOOKS_CHANGED_EVENT, listPlaybooks, type PlaybookFilters } from '../lib/playbooks'
import type { Playbook, PlaybookChapter, PlaybookWithCount } from '../lib/types'

/**
 * The signed-in user's playbooks (RLS scopes the rows), newest first, with
 * chapter counts. Reloads itself whenever any playbook is imported, renamed
 * or deleted.
 */
export function usePlaybooks({ map, agent, side }: PlaybookFilters = {}) {
  const [playbooks, setPlaybooks] = useState<PlaybookWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt(n => n + 1), [])

  useEffect(() => {
    window.addEventListener(PLAYBOOKS_CHANGED_EVENT, reload)
    return () => window.removeEventListener(PLAYBOOKS_CHANGED_EVENT, reload)
  }, [reload])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await listPlaybooks({ map, agent, side })
        if (cancelled) return
        setPlaybooks(rows)
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('[usePlaybooks] load failed', err)
        setError(err instanceof Error ? err.message : String(err))
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [map, agent, side, attempt])

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
