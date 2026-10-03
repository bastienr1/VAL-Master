import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Bookmark } from 'lucide-react'
import SavedDrillCard, { SAVED_DRILLS_EMPTY } from '../components/SavedDrillCard'
import { useResource } from '../hooks/useResource'
import { UNCATEGORISED, categoryOptions, groupByCategory } from '../lib/drillCategories'
import { mapSlug } from '../lib/mapContent'
import {
  getDrillLogCounts,
  getLiveDrills,
  removeSavedDrill,
  savedDrillsResource,
  setSavedDrillCategory,
} from '../lib/savedDrills'
import { groupSaved, scopeLabel } from '../lib/savedDrillScope'
import type { PracticeDrill, SavedDrill, SavedDrillScopeType } from '../lib/types'

const PLACE_SECTIONS: Array<{ type: SavedDrillScopeType; word: string }> = [
  { type: 'map', word: 'map' },
  { type: 'agent', word: 'agent' },
  { type: 'concept', word: 'skill' },
]

/**
 * `/study/drills` — every saved drill, category first, then place.
 *
 * Category is the axis Bastien reads by ("this one would be Routing"); the
 * place is the second key inside it. The one page where agent and skill
 * saves are listed (the Map Hub only shows a map's). Cards here get the live
 * drill behind the save, loaded in one query, so they can show status,
 * logged sessions and a note that changed.
 */
export default function SavedDrills() {
  const { data, loading, error } = useResource(savedDrillsResource)
  const saved = useMemo(() => data ?? [], [data])

  const [live, setLive] = useState<Map<string, PracticeDrill>>(new Map())
  const [logCounts, setLogCounts] = useState<Map<string, number>>(new Map())
  const [writeError, setWriteError] = useState<string | null>(null)

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

  const byCategory = useMemo(() => groupByCategory(saved), [saved])
  const options = useMemo(() => categoryOptions(saved), [saved])

  const run = async (action: () => Promise<unknown>, what: string) => {
    setWriteError(null)
    try {
      await action()
    } catch (err) {
      setWriteError(`Couldn't ${what} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const card = (row: SavedDrill) => {
    const drill = row.drill_id ? (live.get(row.drill_id) ?? null) : null
    return (
      <SavedDrillCard
        key={row.id}
        saved={row}
        live={drill}
        logCount={row.drill_id ? (logCounts.get(row.drill_id) ?? 0) : 0}
        onRemove={() => run(() => removeSavedDrill(row.id), 'remove the drill')}
        categoryOptions={options}
        onSetCategory={category => run(() => setSavedDrillCategory(row.id, category), 'set the category')}
      />
    )
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

      {(error || writeError) && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          {writeError ?? `Couldn't load saved drills — ${error}`}
        </div>
      )}

      {saved.length === 0 ? (
        <p className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">
          {SAVED_DRILLS_EMPTY}
        </p>
      ) : (
        byCategory.map(([category, rows]) => {
          const places = groupSaved(rows)
          return (
            <section key={category ?? UNCATEGORISED} className="space-y-4">
              <h2 className="font-heading text-lg font-bold tracking-wide">
                {category ?? UNCATEGORISED}
                <span className="ml-2 font-stats text-xs font-normal text-text-muted">{rows.length}</span>
              </h2>
              {PLACE_SECTIONS.map(section =>
                places[section.type].map(([value, placeRows]) => {
                  const label = scopeLabel({ type: section.type, value })
                  return (
                    <div key={`${section.type}:${value}`} className="space-y-2">
                      <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
                        {section.type === 'map' ? (
                          <Link to={`/maps/${mapSlug(value)}`} className="hover:text-val-cyan transition-colors">
                            {label}
                          </Link>
                        ) : (
                          <span>{label}</span>
                        )}
                        <span className="normal-case tracking-normal opacity-70">· {section.word}</span>
                        <span className="font-stats">{placeRows.length}</span>
                      </h3>
                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{placeRows.map(card)}</div>
                    </div>
                  )
                }),
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
