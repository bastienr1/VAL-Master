import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Bookmark } from 'lucide-react'
import SavedDrillCard, { SAVED_DRILLS_EMPTY } from '../components/SavedDrillCard'
import { useResource } from '../hooks/useResource'
import { mapSlug } from '../lib/mapContent'
import { getDrillLogCounts, getLiveDrills, removeSavedDrill, savedDrillsResource } from '../lib/savedDrills'
import { groupSaved, scopeLabel } from '../lib/savedDrillScope'
import type { PracticeDrill, SavedDrill, SavedDrillScopeType } from '../lib/types'

const SECTIONS: Array<{ type: SavedDrillScopeType; heading: string }> = [
  { type: 'map', heading: 'Map' },
  { type: 'agent', heading: 'Agent' },
  { type: 'concept', heading: 'Skill' },
]

/**
 * `/study/drills` — every saved drill, by place.
 *
 * The one page where agent and skill saves are listed (the Map Hub only shows
 * a map's). Cards here get the live drill behind the save, loaded in one
 * query, so they can show status, logged sessions and a note that changed.
 */
export default function SavedDrills() {
  const { data, loading, error } = useResource(savedDrillsResource)
  const saved = useMemo(() => data ?? [], [data])

  const [live, setLive] = useState<Map<string, PracticeDrill>>(new Map())
  const [logCounts, setLogCounts] = useState<Map<string, number>>(new Map())
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Keyed on the ids as a string so a refetch with the same saves is a no-op.
  const drillIds = useMemo(
    () => saved.map(row => row.drill_id).filter((id): id is string => id !== null),
    [saved],
  )
  const idsKey = drillIds.join(',')
  useEffect(() => {
    let cancelled = false
    const ids = idsKey === '' ? [] : idsKey.split(',')
    Promise.all([getLiveDrills(ids), getDrillLogCounts(ids)])
      .then(([drills, counts]) => {
        if (cancelled) return
        setLive(drills)
        setLogCounts(counts)
      })
      .catch((err: Error) => console.error('Failed to load live drills:', err))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  const groups = useMemo(() => groupSaved(saved), [saved])

  const remove = async (row: SavedDrill) => {
    setRemoveError(null)
    try {
      await removeSavedDrill(row.id)
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading && data === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/study"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-val-cyan transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Pro Study
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-val-yellow" />
          <h1 className="font-heading text-xl font-bold tracking-wide">Saved drills</h1>
          <span className="font-stats text-text-muted text-xs ml-1">{saved.length}</span>
        </div>
      </div>

      {(error || removeError) && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          {removeError ? `Couldn't remove the drill — ${removeError}` : `Couldn't load saved drills — ${error}`}
        </div>
      )}

      {saved.length === 0 ? (
        <p className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">
          {SAVED_DRILLS_EMPTY}
        </p>
      ) : (
        SECTIONS.map(section => {
          const buckets = groups[section.type]
          if (buckets.length === 0) return null
          return (
            <section key={section.type} className="space-y-4">
              <h2 className="font-heading text-lg font-bold tracking-wide">
                {section.heading}
                <span className="ml-2 font-stats text-xs font-normal text-text-muted">
                  {buckets.reduce((sum, [, rows]) => sum + rows.length, 0)}
                </span>
              </h2>
              {buckets.map(([value, rows]) => {
                const label = scopeLabel({ type: section.type, value })
                return (
                  <div key={value} className="space-y-2">
                    <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
                      {section.type === 'map' ? (
                        <Link to={`/maps/${mapSlug(value)}`} className="hover:text-val-cyan transition-colors">
                          {label}
                        </Link>
                      ) : (
                        <span>{label}</span>
                      )}
                      <span className="font-stats">{rows.length}</span>
                    </h3>
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {rows.map(row => {
                        const drill = row.drill_id ? (live.get(row.drill_id) ?? null) : null
                        return (
                          <SavedDrillCard
                            key={row.id}
                            saved={row}
                            live={drill}
                            logCount={row.drill_id ? (logCounts.get(row.drill_id) ?? 0) : 0}
                            onRemove={() => remove(row)}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })
      )}
    </div>
  )
}
