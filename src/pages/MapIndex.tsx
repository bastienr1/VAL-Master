import { useMemo } from 'react'
import { Map as MapIcon } from 'lucide-react'
import MapPortalCard from '../components/home/MapPortalCard'
import { usePortalMaps } from '../hooks/useMapContent'
import { contentForMap } from '../lib/mapContent'
import { groupByMap, type StatSummary } from '../lib/homeStats'

/** `/maps` — every map in the competitive pool, each opening its hub. */
export default function MapIndex() {
  const { maps, grouped, matches, loading, error } = usePortalMaps()

  const records = useMemo(() => {
    const byMap = new Map<string, StatSummary>()
    for (const group of groupByMap(matches)) byMap.set(group.name.toLowerCase(), group)
    return byMap
  }, [matches])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-val-cyan" />
          <h1 className="font-heading text-3xl font-bold">Maps</h1>
        </div>
        <p className="text-text-secondary text-sm">Every guide, pro VOD and match of yours, map by map.</p>
      </div>

      {error && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          Couldn't load everything — {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
        </div>
      ) : maps.length === 0 ? (
        <p className="text-sm text-text-muted py-8">Map list unavailable right now — check your connection.</p>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {maps.map(map => (
            <MapPortalCard
              key={map.uuid ?? map.name}
              map={map}
              counts={contentForMap(grouped, map.name).counts}
              record={records.get(map.name.trim().toLowerCase()) ?? null}
              recordLabel="All time"
            />
          ))}
        </div>
      )}
    </div>
  )
}
