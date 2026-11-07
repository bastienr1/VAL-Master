/**
 * Which cells of a map's minimap image are playable ground
 * (docs/plays-editor-v2.md §2.9, "Mask").
 *
 * The Riot minimap is transparent off the map: the image is drawn onto an
 * n x n offscreen canvas scaled to fill it, and a cell is playable when its
 * alpha is above 40. Row-major [v][u] over the whole image, like the control
 * grid. Cached per map UUID as a promise, so concurrent callers share one load.
 * The image is requested with a `mask=1` query of its own: the canvas' SVG
 * fetches the same minimap without CORS, and a cached copy of that response
 * would fail the CORS load here. When the image fails or taints the canvas,
 * every cell counts as playable and a console warning says so, once per map;
 * a mask read from the pixels says how many cells are playable, once per map.
 *
 * Browser only (Image, canvas).
 */

import { useEffect, useState } from 'react'
import type { GameMap } from './gameContent'
import { CONTROL_N } from './mapControl'

/** Alpha above this (0..255) makes a cell playable. */
const PLAYABLE_ALPHA = 40

type MaskMap = Pick<GameMap, 'uuid' | 'displayIcon'>

/** A loaded mask, and whether it came from the image's pixels (false: the every-cell fallback). */
export interface LoadedMapMask {
  mask: Uint8Array
  fromPixels: boolean
}

const cache = new Map<string, Promise<LoadedMapMask>>()
const warned = new Set<string>()

function allPlayable(n: number): Uint8Array {
  return new Uint8Array(n * n).fill(1)
}

function fallback(map: MaskMap, n: number, why: string): LoadedMapMask {
  if (!warned.has(map.uuid)) {
    warned.add(map.uuid)
    console.warn(`mapMask: ${why} for map ${map.uuid}; treating every cell as playable.`)
  }
  return { mask: allPlayable(n), fromPixels: false }
}

function fromPixels(map: MaskMap, mask: Uint8Array): LoadedMapMask {
  let playable = 0
  for (let i = 0; i < mask.length; i++) playable += mask[i]
  console.info(`map mask: ${playable} playable cells (map ${map.uuid})`)
  return { mask, fromPixels: true }
}

/** The minimap URL with a query of the mask's own, so the browser cache never hands back the SVG's non-CORS copy. */
function maskUrl(src: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}mask=1`
}

function readMask(img: HTMLImageElement, n: number): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, n, n)
  const { data } = ctx.getImageData(0, 0, n, n) // throws on a tainted canvas
  const mask = new Uint8Array(n * n)
  for (let i = 0; i < n * n; i++) mask[i] = data[i * 4 + 3] > PLAYABLE_ALPHA ? 1 : 0
  return mask
}

/** The playable mask of a map's minimap image, `n * n` cells, 1 = playable, and where it came from. Never rejects. */
export function loadMapMask(map: MaskMap, n = CONTROL_N): Promise<LoadedMapMask> {
  const key = `${map.uuid}:${n}`
  const hit = cache.get(key)
  if (hit) return hit
  const src = map.displayIcon
  const promise = !src
    ? Promise.resolve(fallback(map, n, 'no minimap image'))
    : new Promise<LoadedMapMask>(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.decoding = 'async'
        img.onload = () => {
          try {
            resolve(fromPixels(map, readMask(img, n)))
          } catch {
            resolve(fallback(map, n, 'the minimap image cannot be read (no CORS)'))
          }
        }
        img.onerror = () => resolve(fallback(map, n, 'the minimap image failed to load'))
        img.src = maskUrl(src)
      })
  cache.set(key, promise)
  return promise
}

/** The map's loaded mask and where it came from; null while loading and right after the map changes. */
export function useMapMaskInfo(map: MaskMap | null | undefined): LoadedMapMask | null {
  const [loaded, setLoaded] = useState<{ uuid: string; info: LoadedMapMask } | null>(null)
  const uuid = map?.uuid
  const displayIcon = map?.displayIcon ?? null
  useEffect(() => {
    if (!uuid) return
    let cancelled = false
    void loadMapMask({ uuid, displayIcon }).then(info => {
      if (!cancelled) setLoaded({ uuid, info })
    })
    return () => {
      cancelled = true
    }
  }, [uuid, displayIcon])
  return loaded && loaded.uuid === uuid ? loaded.info : null
}

/** The map's playable mask once loaded; null while loading and right after the map changes. */
export function useMapMask(map: MaskMap | null | undefined): Uint8Array | null {
  return useMapMaskInfo(map)?.mask ?? null
}
