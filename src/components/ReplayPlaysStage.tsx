import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import PlayCanvas from './PlayCanvas'
import { parseCanvasSizes, type CanvasSizes } from '../lib/canvasSizes'
import { canvasSkin, type CanvasSkinId } from '../lib/canvasSkins'
import type { GameMap } from '../lib/gameContent'
import { useSightGrid } from '../lib/mapMask'
import type { PlayStep } from '../lib/playDoc'
import type { ReplayBundle, ReplayRound } from '../lib/replayBundle'
import { roundSide, type FrameIds } from '../lib/replayFrame'
import { killMarks } from '../lib/replayKills'
import type { Layers } from '../lib/replayLayers'
import type { ReplayContext } from '../lib/replayMatches'
import { frameMotion, pawnEffectIds, sightBlockers } from '../lib/replayMotion'
import type { ValueStore } from '../lib/valueStore'

/**
 * What draws the map in place of the minimap's own canvas: `node` goes in the
 * map's square, and `show` is called with the replay time and the layer
 * toggles whenever either changes. `controls`, when given, joins the layer
 * toggles under the map.
 */
export interface ReplayStage {
  node: ReactNode
  controls?: ReactNode
  show: (replayMs: number, layers: Layers) => void
}

/** What a bundle's frames are built from, made once per bundle. */
export interface PlaysStageSource extends ReplayContext {
  map: GameMap
  ids: FrameIds
}

/** The frame on screen. */
export interface PlaysStageFrame {
  t: number
  round: ReplayRound
  step: PlayStep
  layers: Layers
}

const noop = () => {}

/** The sizes and labels picked in the Plays editor on this device, so the map is the same map in both places. */
function readLook(): { sizes: CanvasSizes; showCallouts: boolean; showNames: boolean; showKit: boolean } {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const flag = (key: string) => {
    const raw = read(key)
    return raw === null ? true : raw === 'true'
  }
  return {
    sizes: parseCanvasSizes(read('plays.canvasSizes')),
    showCallouts: flag('plays.showCallouts'),
    showNames: flag('plays.showNames'),
    showKit: flag('plays.showKit'),
  }
}

/**
 * The Plays editor's replay canvas, read-only, showing whatever frame is in
 * `store` (docs/plays-editor-v2.md §2.8). `usePlaysStage` owns the store and
 * hands this to the review minimap as its stage.
 */
export default function ReplayPlaysStage({ bundle, open, names, store, skin }: {
  bundle: ReplayBundle
  /** The canvas skin, picked under the map and shared with the Plays editor. */
  skin: CanvasSkinId
  open: PlaysStageSource
  names: ReadonlyMap<string, string>
  store: ValueStore<PlaysStageFrame | null>
}) {
  const shown = useSyncExternalStore(store.subscribe, store.get)
  const [look] = useState(readLook)
  const cones = shown?.layers.cones ?? false
  const trails = shown?.layers.trails ?? false
  const utility = shown?.layers.utility ?? true
  const pawns = shown?.layers.pawns ?? true
  const sight = useSightGrid(cones ? open.map : null)
  const pawnIds = useMemo(() => pawnEffectIds(bundle, open.ids), [bundle, open])
  const abilityVisible = useCallback((id: string) => (pawnIds.has(id) ? pawns : utility), [pawnIds, pawns, utility])

  const motion = useMemo(
    () =>
      shown && (cones || trails)
        ? frameMotion(bundle, shown.t, open.transform, open.ids, {
            cones,
            trails,
            sight,
            blockers: cones ? sightBlockers(shown.step, open.transform) : null,
          })
        : null,
    [bundle, open, shown, cones, trails, sight],
  )
  const kills = useMemo(
    () => (shown ? killMarks(bundle, shown.t, shown.round, open.transform, open.ids, open.lookup, subject => names.get(subject)) : null),
    [bundle, open, shown, names],
  )

  if (!shown) return null
  return (
    <div className="absolute inset-0" style={{ backgroundColor: canvasSkin(skin).back }}>
      <PlayCanvas
        map={open.map}
        // "My side" on: the map turns with the owner's side. Off: attackers at the bottom.
        side={shown.layers.flip ? roundSide(shown.round) : 'attack'}
        step={shown.step}
        previous={null}
        tool="select"
        pending={null}
        selectedId={null}
        showCallouts={look.showCallouts}
        showNames={look.showNames}
        showKit={look.showKit}
        sizes={look.sizes}
        skin={skin}
        motion={motion}
        kills={kills}
        abilityVisible={abilityVisible}
        animate={false}
        onSelect={noop}
        onPendingDone={noop}
      />
    </div>
  )
}
