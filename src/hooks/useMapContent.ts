import { useMemo } from 'react'
import { studyContentResource } from '../lib/homeData'
import { groupContentByMap, sortMapsForPortal, type PortalMap } from '../lib/mapContent'
import type { GuideCounts } from '../lib/referenceReviews'
import { useGameContent } from './useGameContent'
import { useHomeMatches } from './useHomeStats'
import { useResource } from './useResource'

const NO_GUIDE_COUNTS = new Map<string, GuideCounts>()

/**
 * Per-map study material: playbooks, Pro Study rows and the player's matches,
 * grouped by map name. Read one map with `contentForMap(grouped, name)`.
 */
export function useMapContent() {
  const study = useResource(studyContentResource)
  const { matches, loading: matchesLoading, error: matchesError } = useHomeMatches()

  const grouped = useMemo(
    () =>
      groupContentByMap({
        playbooks: study.data?.playbooks ?? [],
        reviews: study.data?.reviews ?? [],
        matches,
        reviewedMatchIds: study.data?.reviewedMatchIds ?? new Set(),
      }),
    [study.data, matches],
  )

  return {
    grouped,
    matches,
    guideCounts: study.data?.guideCounts ?? NO_GUIDE_COUNTS,
    // First load only: a background refresh keeps showing what it has.
    loading: (study.loading && !study.data) || matchesLoading,
    error: study.error ?? matchesError,
  }
}

/**
 * The maps the portal lists — the competitive pool from the registry, whether
 * or not the player has touched them — with the most study material first.
 *
 * If the registry can't be loaded at all, the maps the player's own content
 * mentions stand in, without art.
 */
export function usePortalMaps() {
  const content = useMapContent()
  const { registry, status } = useGameContent()
  const { grouped, matches } = content

  const maps = useMemo(() => {
    let pool: PortalMap[] = []
    if (registry) {
      pool = [...registry.maps.byId.values()].map(m => ({
        name: m.name,
        uuid: m.uuid,
        listViewIconTall: m.listViewIconTall,
        splash: m.splash,
      }))
    } else if (status === 'error') {
      // Match rows carry the map's display name; that is the best name on hand.
      const names = new Map<string, string>()
      for (const m of matches) names.set(m.map.trim().toLowerCase(), m.map.trim())
      for (const key of grouped.keys()) if (!names.has(key)) names.set(key, key)
      pool = [...names.values()].map(name => ({ name, uuid: null, listViewIconTall: null, splash: null }))
    }
    return sortMapsForPortal(pool, grouped)
  }, [registry, status, grouped, matches])

  return { ...content, maps, loading: content.loading || status === 'loading' }
}
