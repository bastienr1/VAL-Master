/**
 * Pools a minimap image's RGBA pixels into the two grids the Plays canvas
 * uses (docs/plays-editor-v2.md §2.9, "Mask"): which cells are playable floor
 * and which hold a wall line.
 *
 * Riot minimaps are transparent off the map, a flat grey floor (with lighter
 * greys for raised ground) and white wall lines, some half transparent. A
 * pixel is *opaque* when its alpha is above 40; an opaque pixel is *wall*
 * when its luminance (0.299R + 0.587G + 0.114B) is 200 or more, else *floor*.
 *
 * - mask: a cell is playable when more than half of its source pixels are floor.
 * - walls: a cell is wall when any of its source pixels is wall, or when none
 *   of them is opaque (the outside of the map is impassable too) (max-pool, so
 *   lines one pixel thin survive).
 *
 * Both grids are row-major [v][u] over the whole image. Source pixel (x, y)
 * belongs to cell (floor(x·n/w), floor(y·n/h)); an image smaller than the grid
 * leaves some cells without pixels, which count as neither.
 *
 * Pure, no DOM: tested with plain arrays.
 */

/** Alpha above this (0..255) makes a pixel part of the map. */
export const PLAYABLE_ALPHA = 40
/** Luminance at or above this makes an opaque pixel a wall line. */
export const WALL_LUMA = 200

export interface PooledPixels {
  /** `maskN * maskN`, 1 = playable floor. */
  mask: Uint8Array
  /** `wallN * wallN`, 1 = a wall line crosses the cell. */
  walls: Uint8Array
}

/** Source column/row → cell index, for `size` source pixels over `n` cells. */
function cellIndex(size: number, n: number): Uint16Array {
  const out = new Uint16Array(size)
  for (let x = 0; x < size; x++) out[x] = Math.min(n - 1, Math.floor((x * n) / size))
  return out
}

/** Pools `w * h` RGBA pixels (`data.length === w * h * 4`) into the playable mask and the walls grid. */
export function poolPixels(
  data: ArrayLike<number>,
  w: number,
  h: number,
  maskN: number,
  wallN: number,
): PooledPixels {
  const mask = new Uint8Array(maskN * maskN)
  const walls = new Uint8Array(wallN * wallN)
  if (w <= 0 || h <= 0 || data.length < w * h * 4) return { mask, walls }
  // Opaque pixels per wall cell: a cell with none is outside the map, and a
  // path search must not slip out through a gap in the outer line, so it
  // counts as wall too.
  const opaque = new Uint32Array(wallN * wallN)

  const floorCount = new Uint32Array(maskN * maskN)
  const total = new Uint32Array(maskN * maskN)
  const maskCol = cellIndex(w, maskN)
  const maskRow = cellIndex(h, maskN)
  const wallCol = cellIndex(w, wallN)
  const wallRow = cellIndex(h, wallN)

  for (let y = 0; y < h; y++) {
    const maskBase = maskRow[y] * maskN
    const wallBase = wallRow[y] * wallN
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const m = maskBase + maskCol[x]
      total[m]++
      if (data[o + 3] <= PLAYABLE_ALPHA) continue
      opaque[wallBase + wallCol[x]]++
      const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
      if (luma >= WALL_LUMA) walls[wallBase + wallCol[x]] = 1
      else floorCount[m]++
    }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = floorCount[i] * 2 > total[i] ? 1 : 0
  for (let i = 0; i < walls.length; i++) if (opaque[i] === 0) walls[i] = 1
  return { mask, walls }
}
