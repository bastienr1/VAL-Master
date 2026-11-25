/**
 * Fade's Prowler as the game runs it, for the board's animated creature
 * (docs/plays-editor-v2.md §2.28). The figures are read from the game files
 * (13.10): the pawn `Pawn_BountyHunter_4_WolfHound`, its model
 * `AB_BountyHunter_S0_4_TrailCreature_Skelmesh`, and the particle systems it
 * carries, `BH_Cat_TailVFX` and `BH_Cat_Wisker`. Its speed is the replays'.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `prowlerPaint.ts`.
 */

export const PROWLER = {
  /** The model is 1.23 m long and its pawn scales it by 1.5, cm. */
  headCm: 185,
  /** Its idle loop: 57 frames at 30.54 fps. */
  loopMs: 1867,
  /** How high its middle flies over the floor, cm. A reading: it flies (MOVE_Flying) in a capsule 148 cm tall. */
  hoverCm: 85,
  /** The median of 980 Prowlers in the replays, cm/s: what a droplet of ink is thrown along at. */
  speed: 950,
  /** The hard tail: how much of its way it covers, s, and its half-width where it leaves the head, cm. A reading: its shader is compiled. */
  tailS: 0.63,
  tailCm: 45,
  /** The smoke round it: how far back it reaches, s. */
  smokeS: 1.0,
  smokeCm: 68,
  /** BH_Cat_TailVFX, ribbon emitter: lifetime and size. */
  ribbonS: 0.35,
  ribbonCm: 30,
  /** BH_Cat_Wisker: lifetime, and its 10 cm at the pawn's scale. */
  whiskerS: 0.2,
  whiskerCm: 15,
  /** BH_Cat_TailVFX, droplet emitter: rate, lifetime, size, share of its speed carried, drag, spawn box. */
  inkRate: 25,
  inkLife: [1.5, 3],
  inkCm: [5, 15],
  inkCarry: [0.5, 1.2],
  inkDrag: [0, 2],
  inkBox: 30,
} as const

/** The sprite sheets: rows of headings (row 0 faces right, then anticlockwise on a map with y up), columns of frames. */
export const PROWLER_SPRITE = { tile: 192, spanCm: 300, headings: 16, frames: 12 } as const

/** AlphaOverLife and SizeMultiplyLife of the ink droplets; AlphaOverLife of a whisker, thinned. */
export const INK_ALPHA = [0, 0.39, 0.8, 0.99, 1, 1, 1, 0.99, 0.97, 0.93, 0.86, 0.77, 0.64, 0.47, 0.26, 0] as const
export const INK_SIZE = [1, 0.89, 0.57, 0.02] as const
export const WHISKER_ALPHA = [0, 0.97, 0.95, 0.88, 0.76, 0.6, 0.39, 0.16, 0] as const

/** The head is drawn at least this long on screen, px, however far the board is zoomed out. */
export const PROWLER_MIN_PX = 30
/** Past this length on screen, px, it is drawn with everything: its smoke, its ink, its tail at the game's length. */
export const PROWLER_FULL_PX = 70
/** Zoomed out, the tail covers this many times as much of its way, and the smoke is left out: asked for on 2026-11-25. */
export const PROWLER_FAR_REACH = 1.5

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}

/** How the Prowler is drawn for how long its head would be on screen at the game's size. */
export interface ProwlerLook {
  /** How many times its size the head, and the widths of its effects, are drawn. */
  big: number
  /** 0 zoomed out (no smoke, a longer tail), 1 close up (everything, at the game's sizes). */
  detail: number
}

export function prowlerLook(headPx: number): ProwlerLook {
  if (!(headPx > 0)) return { big: 1, detail: 0 }
  return { big: Math.max(1, PROWLER_MIN_PX / headPx), detail: smooth((headPx - PROWLER_MIN_PX) / (PROWLER_FULL_PX - PROWLER_MIN_PX)) }
}

/** One point of its way: where, and how long ago it was there (ms; negative for what is still ahead). */
export interface ProwlerWayPoint {
  x: number
  y: number
  ago: number
}

/** Its way, oldest first, each point passed later than the one before. */
export function prowlerWay(course: readonly ProwlerWayPoint[]): ProwlerWayPoint[] {
  const way: ProwlerWayPoint[] = []
  for (const p of course) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.ago)) continue
    const last = way[way.length - 1]
    if (last && p.ago >= last.ago) continue
    way.push({ x: p.x, y: p.y, ago: p.ago })
  }
  return way
}

/** How long it has been running, ms: since the first point of its way. */
export function prowlerAge(way: readonly ProwlerWayPoint[]): number {
  return way.length > 0 ? Math.max(0, way[0].ago) : 0
}

/**
 * Where it was `ago` ms back, and which way it was heading (radians, on the
 * board's axes). The replay keeps a point of its way every 0.15 s: a smooth
 * curve is laid through them (Catmull-Rom), or its tail would have a corner at
 * every point. Before its first point and after its last it holds its ends.
 */
export function prowlerAt(way: readonly ProwlerWayPoint[], ago: number): { x: number; y: number; heading: number } | null {
  const n = way.length
  if (n === 0) return null
  if (n === 1) return { x: way[0].x, y: way[0].y, heading: 0 }
  let j = 0
  while (j < n - 2 && way[j + 1].ago > ago) j++
  const [p1, p2] = [way[j], way[j + 1]]
  // Past either end the way is carried straight on, so a straight run stays at its speed to its last point.
  const beyond = (a: ProwlerWayPoint, b: ProwlerWayPoint): ProwlerWayPoint => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y, ago: 0 })
  const p0 = j > 0 ? way[j - 1] : beyond(p1, p2)
  const p3 = j + 2 < n ? way[j + 2] : beyond(p2, p1)
  const f = clamp01((p1.ago - ago) / (p1.ago - p2.ago))
  const spline = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f)
  const slope = (a: number, b: number, c: number, d: number) =>
    0.5 * (c - a + 2 * (2 * a - 5 * b + 4 * c - d) * f + 3 * (3 * b - a - 3 * c + d) * f * f)
  let [dx, dy] = [slope(p0.x, p1.x, p2.x, p3.x), slope(p0.y, p1.y, p2.y, p3.y)]
  // Standing still between two points, or at an end: the way from one to the next.
  if (Math.hypot(dx, dy) < 1e-9) [dx, dy] = [p2.x - p1.x, p2.y - p1.y]
  return { x: spline(p0.x, p1.x, p2.x, p3.x), y: spline(p0.y, p1.y, p2.y, p3.y), heading: Math.atan2(dy, dx) }
}

/** The sheet's row for a heading on the board (y down the screen), and the turn left over, radians. */
export function prowlerRow(heading: number): { row: number; turn: number } {
  const step = (Math.PI * 2) / PROWLER_SPRITE.headings
  const row = ((Math.round(-heading / step) % PROWLER_SPRITE.headings) + PROWLER_SPRITE.headings) % PROWLER_SPRITE.headings
  const rest = heading + row * step
  return { row, turn: Math.atan2(Math.sin(rest), Math.cos(rest)) }
}

/** The sheet's column `ageMs` into its run. */
export function prowlerFrame(ageMs: number): number {
  const loop = ((ageMs % PROWLER.loopMs) + PROWLER.loopMs) % PROWLER.loopMs
  return Math.floor((loop / PROWLER.loopMs) * PROWLER_SPRITE.frames) % PROWLER_SPRITE.frames
}

/** A value in 0…1 that is always the same for the same index, so a paused frame does not flicker. */
export function prowlerRandom(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** A curve given as evenly spaced samples over 0…1, as the effects store theirs. */
export function prowlerCurve(table: readonly number[], x: number): number {
  const at = clamp01(x) * (table.length - 1)
  const i = Math.min(table.length - 2, Math.floor(at))
  return table[i] + (table[i + 1] - table[i]) * (at - i)
}

/** True for Fade's Prowler: the C of the agent the game files call BountyHunter. */
export function isProwler(agent: string, slot: string | null): boolean {
  return slot === 'Grenade' && agent.trim().toLowerCase() === 'fade'
}
