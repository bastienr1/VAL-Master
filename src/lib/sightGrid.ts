/**
 * What blocks sight on a map, read from its minimap art
 * (docs/plays-editor-v2.md §2.12): off the map (transparent) or a wall (the
 * art's bright outlines). The published minimaps are 1024 px, about 14 cm a
 * pixel, so the grid keeps that resolution.
 *
 * Pure, no imports, so `node --test` can check it.
 */

export const SIGHT_N = 1024

/** Alpha below this is off the map. */
const SOLID_ALPHA = 128
/** Luminance above this (0..255) is a wall line; the floor sits at about 110–190. */
const WALL_LUMINANCE = 225

export interface SightGrid {
  n: number
  /** Row-major [v][u], 1 = sight stops here. */
  blocked: Uint8Array
}

/** The grid of an `n * n` RGBA image. */
export function sightGridFromPixels(rgba: Uint8ClampedArray | Uint8Array, n: number): SightGrid {
  const blocked = new Uint8Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const o = i * 4
    const luminance = 0.3 * rgba[o] + 0.59 * rgba[o + 1] + 0.11 * rgba[o + 2]
    blocked[i] = rgba[o + 3] < SOLID_ALPHA || luminance > WALL_LUMINANCE ? 1 : 0
  }
  return { n, blocked }
}

/** A ray's step in cells: under one, so a 2-pixel wall line cannot be stepped over. */
const STEP_CELLS = 0.75
/** A player drawn on a wall line sees out only if free space is this close along the ray. */
const ESCAPE_CELLS = 8

/**
 * Where a ray from image point (u, v) in direction (du, dv) stops: the last
 * free point before a wall or the edge of the image. A ray that starts inside
 * a wall first walks up to `ESCAPE_CELLS` to reach free space; if there is
 * none it stops where it started.
 */
export function castRay(grid: SightGrid, u: number, v: number, du: number, dv: number): { u: number; v: number } {
  const { n, blocked } = grid
  const length = Math.hypot(du, dv)
  if (length === 0) return { u, v }
  const stepU = (du / length / n) * STEP_CELLS
  const stepV = (dv / length / n) * STEP_CELLS
  const isBlocked = (pu: number, pv: number) => {
    const cu = Math.floor(pu * n)
    const cv = Math.floor(pv * n)
    return cu < 0 || cv < 0 || cu >= n || cv >= n || blocked[cv * n + cu] === 1
  }

  let pu = u
  let pv = v
  if (isBlocked(pu, pv)) {
    let escaped = false
    for (let i = 0; i < ESCAPE_CELLS / STEP_CELLS; i++) {
      pu += stepU
      pv += stepV
      if (!isBlocked(pu, pv)) {
        escaped = true
        break
      }
    }
    if (!escaped) return { u, v }
  }
  // At most the image's diagonal.
  const limit = Math.ceil((n * Math.SQRT2) / STEP_CELLS)
  for (let i = 0; i < limit; i++) {
    const nextU = pu + stepU
    const nextV = pv + stepV
    if (isBlocked(nextU, nextV)) break
    pu = nextU
    pv = nextV
  }
  return { u: pu, v: pv }
}
