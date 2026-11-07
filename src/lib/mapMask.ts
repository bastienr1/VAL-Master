/**
 * Which cells of a map's minimap image are playable ground, and which hold a
 * wall line (docs/plays-editor-v2.md §2.9, "Mask").
 *
 * The Riot minimap is drawn at its native size on an offscreen canvas and its
 * pixels read once; `poolPixels` (mapMaskPixels.ts) derives the 96-cell
 * playable mask (a majority of floor pixels: opaque and not white) and the
 * 128-cell walls grid (any white wall pixel). Row-major [v][u] over the whole
 * image, like the control grid. Cached per map UUID as a promise, so
 * concurrent callers share one load.
 * The image is requested with a `mask=1` query of its own: the canvas' SVG
 * fetches the same minimap without CORS, and a cached copy of that response
 * would fail the CORS load here. When the image fails or taints the canvas,
 * every cell counts as playable, no cell is wall, and a console warning says
 * so, once per map; a mask read from the pixels logs its playable and wall
 * cell counts, once per map.
 *
 * Browser only (Image, canvas).
 */

import { useEffect, useState } from 'react'
import type { GameMap } from './gameContent'
import { CONTROL_N } from './mapControl'
import { poolPixels } from './mapMaskPixels'

/** Cells per side of the walls grid over the whole minimap image (8 px per cell on a 1024 image); a path search runs over it. */
export const WALL_N = 128

type MaskMap = Pick<GameMap, 'uuid' | 'displayIcon'>

/** Wall cells over the whole minimap image, `n * n`, row-major [v][u], 1 = wall. */
export interface WallGrid {
  n: number
  cells: Uint8Array
}

/** A loaded mask and walls grid, and whether they came from the image's pixels (false: the fallback). */
export interface LoadedMapMask {
  mask: Uint8Array
  walls: WallGrid
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
  return { mask: allPlayable(n), walls: { n: WALL_N, cells: new Uint8Array(WALL_N * WALL_N) }, fromPixels: false }
}

function count(cells: Uint8Array): number {
  let total = 0
  for (let i = 0; i < cells.length; i++) total += cells[i]
  return total
}

/** The minimap URL with a query of the mask's own, so the browser cache never hands back the SVG's non-CORS copy. */
function maskUrl(src: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}mask=1`
}

/** The image's pixels at its native size, pooled into the mask and the walls grid. Throws on a tainted canvas. */
function readMask(map: MaskMap, img: HTMLImageElement, n: number): LoadedMapMask {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) throw new Error('empty image')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, w, h) // throws on a tainted canvas
  const { mask, walls } = poolPixels(data, w, h, n, WALL_N)
  console.info(`map mask: ${count(mask)} playable cells, ${count(walls)} wall cells (map ${map.uuid})`)
  return { mask, walls: { n: WALL_N, cells: walls }, fromPixels: true }
}

/** The playable mask of a map's minimap image (`n * n` cells, 1 = playable), its walls grid, and where they came from. Never rejects. */
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
            resolve(readMask(map, img, n))
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

/** The map's loaded mask, walls and where they came from; null while loading and right after the map changes. */
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

/** The map's walls grid (`WALL_N` cells per side) once loaded; null while loading. All zero when the pixels could not be read. */
export function useMapWalls(map: MaskMap | null | undefined): WallGrid | null {
  return useMapMaskInfo(map)?.walls ?? null
}
