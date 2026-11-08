/**
 * The replay map's layer toggles, shared by the VOD review's minimap and the
 * Plays replay panel: one choice, remembered per device.
 */

export const LAYERS = [
  { key: 'cones', label: 'View', title: 'Where each player is looking' },
  { key: 'utility', label: 'Utility', title: 'Smokes, walls, traps and other placed abilities' },
  { key: 'pawns', label: 'Pawns', title: 'Cameras, drones and other things agents control' },
  { key: 'trails', label: 'Trails', title: 'The last 3 seconds of each player’s path' },
  { key: 'flip', label: 'My side', title: 'On: your team always starts from the bottom, so the map turns when sides change. Off: attackers always start from the bottom' },
] as const
export type LayerKey = (typeof LAYERS)[number]['key']
export type Layers = Record<LayerKey, boolean>

const LAYERS_KEY = 'vodReview.mapLayers'
const DEFAULT_LAYERS: Layers = { cones: true, utility: true, pawns: true, trails: false, flip: true }

export function readLayers(): Layers {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_LAYERS
  }
}

export function writeLayers(layers: Layers): void {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers))
  } catch {
    /* a full or blocked store only costs the preference */
  }
}
