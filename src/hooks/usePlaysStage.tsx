import { useCallback, useEffect, useMemo, useState } from 'react'
import SkinPicker from '../components/play/SkinPicker'
import ReplayPlaysStage, { type PlaysStageFrame, type PlaysStageSource, type ReplayStage } from '../components/ReplayPlaysStage'
import { useGameContent } from './useGameContent'
import { canvasSkin, type CanvasSkinId } from '../lib/canvasSkins'
import { isDeathmatchBundle, type ReplayBundle } from '../lib/replayBundle'
import { createFrameIds, frameStep, roundAt } from '../lib/replayFrame'
import type { Layers } from '../lib/replayLayers'
import { replayContext } from '../lib/replayMatches'
import { fetchPlayerNames } from '../lib/replayNames'
import { createValueStore } from '../lib/valueStore'

const NO_NAMES: ReadonlyMap<string, string> = new Map()

// The Plays editor's own key: one skin on this device, wherever the map is drawn.
const SKIN_KEY = 'plays.canvasSkin'

function readSkin(): CanvasSkinId {
  try {
    return canvasSkin(localStorage.getItem(SKIN_KEY)).id
  } catch {
    return canvasSkin(null).id
  }
}

const SKIN_BUTTON = 'inline-flex items-center gap-1 text-text-muted hover:text-val-cyan transition-colors'

/**
 * The Plays editor's replay map for a match, to stand in for the review
 * minimap's canvas: abilities in their real shapes, kills with their tracer and
 * mark, health, armour and what each agent has left. It is the same canvas and
 * the same frame builder the Plays replay mode uses (docs/plays-editor-v2.md
 * §2.8), read-only: the wheel zooms and a drag pans.
 *
 * Null without a bundle, and when the map cannot be drawn that way (the registry is still loading or
 * came from the fallback source without callouts, or the bundle is a
 * Deathmatch): the caller then keeps the minimap's own canvas.
 */
export function usePlaysStage(bundle: ReplayBundle | null | undefined): ReplayStage | null {
  const { registry } = useGameContent()
  const [store] = useState(() => createValueStore<PlaysStageFrame | null>(null))
  const [named, setNamed] = useState<{ bundle: ReplayBundle; names: ReadonlyMap<string, string> } | null>(null)
  const [skin, setSkin] = useState<CanvasSkinId>(readSkin)
  const pickSkin = useCallback((next: CanvasSkinId) => {
    setSkin(next)
    try {
      localStorage.setItem(SKIN_KEY, next)
    } catch {
      /* a skin is not worth an error */
    }
  }, [])

  const open = useMemo<PlaysStageSource | null>(() => {
    if (!bundle || !registry || isDeathmatchBundle(bundle)) return null
    const map = bundle.match.mapUuid ? registry.maps.byId.get(bundle.match.mapUuid) : undefined
    if (!map?.transform || map.callouts.length === 0) return null
    try {
      return { ...replayContext(bundle, registry), map, ids: createFrameIds() }
    } catch {
      return null
    }
  }, [bundle, registry])

  // Who played each agent, from Henrik, kept per device by `fetchPlayerNames`. A failure leaves the agent names.
  useEffect(() => {
    if (!open || !bundle) return
    let cancelled = false
    fetchPlayerNames(bundle.match.matchId, import.meta.env.VITE_HENRIK_API_KEY).then(
      names => { if (!cancelled && names.size > 0) setNamed({ bundle, names }) },
      () => {},
    )
    return () => { cancelled = true }
  }, [open, bundle])
  const names = named && named.bundle === bundle ? named.names : NO_NAMES

  const show = useCallback(
    (t: number, layers: Layers) => {
      if (!open || !bundle) return
      const round = roundAt(bundle, t)
      store.set({ t, round, layers, step: frameStep(bundle, t, open.lookup, open.transform, open.ids, round, subject => names.get(subject)) })
    },
    [bundle, open, names, store],
  )

  return useMemo(
    () =>
      open && bundle
        ? {
            show,
            node: <ReplayPlaysStage bundle={bundle} open={open} names={names} store={store} skin={skin} />,
            controls: <SkinPicker skin={skin} onPick={pickSkin} buttonClass={SKIN_BUTTON} cycleKey={false} />,
          }
        : null,
    [open, show, bundle, names, store, skin, pickSkin],
  )
}
