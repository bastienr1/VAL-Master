import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatTimestamp } from '../lib/playbookParser'
import { useGameContent } from '../hooks/useGameContent'
import { usePlaybooks } from '../hooks/usePlaybooks'
import PlaybookImportButton from '../components/PlaybookImportButton'
import PlaybookMapCard from '../components/PlaybookMapCard'
import PlaybookLibrary from '../components/PlaybookLibrary'
import type { PlaybookWithCount } from '../lib/types'

/** Match counts per map name, for the signed-in user. */
function useMatchCountsByMap() {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.from('matches').select('map').eq('user_id', user.id)
      if (cancelled) return
      if (error) {
        console.error('[PlaybookIndex] match counts failed', error)
        return
      }
      const next = new Map<string, number>()
      for (const row of data ?? []) next.set(row.map, (next.get(row.map) ?? 0) + 1)
      setCounts(next)
    }
    load()
    return () => { cancelled = true }
  }, [])

  return counts
}

export default function PlaybookIndex() {
  const { playbooks, loading, error, reload } = usePlaybooks()
  const { registry } = useGameContent()
  const matchCounts = useMatchCountsByMap()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedMap = searchParams.get('map')
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())

  const playbooksByMap = useMemo(() => {
    const byMap = new Map<string, PlaybookWithCount[]>()
    for (const p of playbooks) byMap.set(p.map, [...(byMap.get(p.map) ?? []), p])
    return byMap
  }, [playbooks])

  // The registry is the source of map names (competitive pool). Until it loads,
  // fall back to whatever maps the user's playbooks and matches mention.
  const maps = useMemo(() => {
    const names = registry
      ? [...registry.maps.byId.values()].map(m => m.name)
      : [...new Set([...playbooksByMap.keys(), ...matchCounts.keys()])]
    return names.sort((a, b) => a.localeCompare(b))
  }, [registry, playbooksByMap, matchCounts])

  useEffect(() => {
    if (!selectedMap) return
    cardRefs.current.get(selectedMap)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedMap, maps])

  const selectedPlaybooks = selectedMap ? playbooksByMap.get(selectedMap) ?? [] : []

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold">Playbook</h1>
          <p className="text-text-secondary text-sm">Structured knowledge indexed to your VODs</p>
        </div>
        <PlaybookImportButton onImportComplete={reload} />
      </div>

      {error && (
        <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">
          Couldn't load playbooks: {error}
        </div>
      )}

      <PlaybookLibrary playbooks={playbooks} loading={loading} />

      {selectedMap && selectedPlaybooks.length > 0 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">
              {selectedMap} · {selectedPlaybooks.length} playbooks
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="text-text-muted hover:text-text-secondary"
              aria-label="Clear map filter"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-bg-elevated/60">
            {selectedPlaybooks.map(p => (
              <Link
                key={p.id}
                to={`/playbook/${p.slug}`}
                className="flex items-center gap-3 py-2 hover:text-val-cyan transition-colors"
              >
                <BookOpen className="w-4 h-4 text-val-cyan shrink-0" />
                <span className="flex-1 truncate text-sm">{p.name}</span>
                {p.side && <span className="text-[10px] uppercase tracking-wider text-text-muted">{p.side}</span>}
                {p.video_duration_seconds != null && (
                  <span className="font-stats text-xs text-text-muted">{formatTimestamp(p.video_duration_seconds)}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {loading && maps.length === 0 ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {maps.map(map => {
            const onMap = playbooksByMap.get(map) ?? []
            return (
              <PlaybookMapCard
                key={map}
                ref={el => {
                  if (el) cardRefs.current.set(map, el)
                  else cardRefs.current.delete(map)
                }}
                map={map}
                playbookCount={onMap.length}
                matchCount={matchCounts.get(map) ?? 0}
                firstPlaybookSlug={onMap.length === 1 ? onMap[0].slug : null}
                highlighted={map === selectedMap}
                onSelectMap={m => setSearchParams({ map: m })}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
