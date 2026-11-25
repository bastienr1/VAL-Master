/**
 * Draws Fade's Prowler (docs/plays-editor-v2.md §2.28): its head from sprite
 * sheets rendered out of the game's own model, animation and textures, and
 * the effects the game hangs on it, drawn here: the tail, the smoke round it,
 * the whiskers and the ink.
 *
 * The sheets (`src/assets/prowler`) show the head from 50° above the ground,
 * from the bottom of the map, at 16 headings and 12 frames of its idle loop;
 * yours with the material's ally rim tint, the enemy's with its enemy one. The
 * effects are drawn from the same place: right behind the head, depth up and
 * down the screen is drawn shorter, and height shows as a lift up the screen,
 * with a shadow left on the floor. The map itself stays flat.
 *
 * What is the game's: the model, its animation and textures, the colour
 * tables (`Fade_Lut`, `Fade_Foe_LUT`), the smoke texture streaming along the
 * tail (`BH_SmokeTexture`), the ink droplets' shapes and figures, the
 * whiskers' figures. What is a reading, its shaders being compiled: the
 * tail's shape and length, how high it flies, the light and the shadow.
 *
 * Plain 2D canvas: no WebGL.
 */

import allyUrl from '../assets/prowler/ally.webp'
import enemyUrl from '../assets/prowler/enemy.webp'
import inkUrl from '../assets/prowler/ink.png'
import lutFoeUrl from '../assets/prowler/lut-foe.png'
import lutUrl from '../assets/prowler/lut.png'
import smokeUrl from '../assets/prowler/smoke.png'
import {
  INK_ALPHA,
  INK_SIZE,
  PROWLER,
  PROWLER_FAR_REACH,
  PROWLER_SPRITE,
  WHISKER_ALPHA,
  prowlerAge,
  prowlerAt,
  prowlerCurve,
  prowlerFrame,
  prowlerRandom,
  prowlerRow,
  type ProwlerWayPoint,
} from './prowler.ts'

/** The picture shows this far either side of the head, world cm: its tail zoomed out, and room for its smoke. */
export const PROWLER_EXTENT_CM = 1300

export interface ProwlerView {
  enemy: boolean
  /** How many times its size the head, and the widths of its effects, are drawn. */
  big: number
  /** 0 zoomed out (no smoke, a longer tail), 1 close up (everything, at the game's sizes). */
  detail: number
  /** No weaving and no loop when the user asked for less motion. */
  still: boolean
}

type Rgb = readonly [number, number, number]
type Point = [number, number]
type Team = 'ally' | 'enemy'

interface TeamArt {
  sheet: HTMLImageElement
  lut: Rgb[]
  ink: HTMLCanvasElement
  streaksLight: HTMLCanvasElement
  streaksDark: HTMLCanvasElement
  puffs: HTMLCanvasElement[]
}

export type ProwlerStatus = 'loading' | 'ready' | 'failed'

let status: ProwlerStatus = 'loading'
let started = false
const art: Partial<Record<Team, TeamArt>> = {}
const listeners = new Set<() => void>()
let layer: HTMLCanvasElement | null = null

function setStatus(next: ProwlerStatus) {
  if (status === next) return
  status = next
  listeners.forEach(listener => listener())
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (x: number) => {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`
const lighter = ([r, g, b]: Rgb, k: number): Rgb => [Math.round(lerp(r, 255, k)), Math.round(lerp(g, 255, k)), Math.round(lerp(b, 255, k))]
const shade = ([r, g, b]: Rgb, k: number): Rgb => [Math.round(r * k), Math.round(g * k), Math.round(b * k)]
const blend = (a: Rgb, b: Rgb, k: number): Rgb => {
  const c = clamp01(k)
  return [Math.round(lerp(a[0], b[0], c)), Math.round(lerp(a[1], b[1], c)), Math.round(lerp(a[2], b[2], c))]
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Prowler picture did not load: ${url}`))
    image.src = url
  })
}

function sheetOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas')
  return [canvas, ctx]
}

/** The game's colour table as a list of colours, left to right. */
function readLut(image: HTMLImageElement): Rgb[] {
  const [, ctx] = sheetOf(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, Math.floor(image.height / 2), image.width, 1).data
  const out: Rgb[] = []
  for (let i = 0; i < image.width; i++) out.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
  return out
}

/** The ink flipbook (white blobs, 4 × 4) in one colour, its brightness become its alpha. */
function tintInk(image: HTMLImageElement, [r, g, b]: Rgb): HTMLCanvasElement {
  const [canvas, ctx] = sheetOf(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i + 3] = pixels.data[i]
    pixels.data[i] = r
    pixels.data[i + 1] = g
    pixels.data[i + 2] = b
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * The smoke texture as wisps of one colour: what is lighter than its middle
 * grey (or darker, for `dark`) becomes its alpha. Twice across, so a slice may
 * run off its edge.
 */
function makeStreaks(image: HTMLImageElement, [r, g, b]: Rgb, dark: boolean): HTMLCanvasElement {
  const size = 256
  const [canvas, ctx] = sheetOf(size * 2, size)
  ctx.drawImage(image, 0, 0, size, size)
  const pixels = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey = pixels.data[i] / 255
    pixels.data[i + 3] = Math.round(255 * clamp01((dark ? 0.46 - grey : grey - 0.5) * 7))
    pixels.data[i] = r
    pixels.data[i + 1] = g
    pixels.data[i + 2] = b
  }
  ctx.putImageData(pixels, 0, 0)
  ctx.putImageData(pixels, size, 0)
  return canvas
}

/** Four puffs of smoke: round, torn by the game's smoke texture, lit from the upper left. */
function makePuffs(image: HTMLImageElement, light: Rgb, dark: Rgb): HTMLCanvasElement[] {
  const size = 96
  const out: HTMLCanvasElement[] = []
  for (let k = 0; k < 4; k++) {
    const [, noise] = sheetOf(size, size)
    noise.translate(size / 2, size / 2)
    noise.rotate(k * 1.3 + 0.4)
    const from = image.width / 1024
    noise.drawImage(image, (120 + k * 190) * from, (90 + k * 170) * from, 230 * from, 230 * from, -size, -size, size * 2, size * 2)
    const grain = noise.getImageData(0, 0, size, size).data
    const [canvas, ctx] = sheetOf(size, size)
    const pixels = ctx.createImageData(size, size)
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const i = (py * size + px) * 4
        const [dx, dy] = [(px + 0.5) / (size / 2) - 1, (py + 0.5) / (size / 2) - 1]
        const grey = grain[i] / 255
        const body = smooth((1 - Math.hypot(dx, dy)) * 1.5) * clamp01(0.35 + (grey - 0.38) * 3.2)
        const colour = blend(dark, light, 0.5 - 0.45 * dx - 0.6 * dy + (grey - 0.5) * 0.8)
        pixels.data[i] = colour[0]
        pixels.data[i + 1] = colour[1]
        pixels.data[i + 2] = colour[2]
        pixels.data[i + 3] = Math.round(255 * clamp01(body))
      }
    }
    ctx.putImageData(pixels, 0, 0)
    out.push(canvas)
  }
  return out
}

const pick = (lut: Rgb[], u: number): Rgb => lut[Math.round(clamp01(u) * (lut.length - 1))]

function start() {
  if (started || typeof document === 'undefined') return
  started = true
  Promise.all([allyUrl, enemyUrl, inkUrl, lutUrl, lutFoeUrl, smokeUrl].map(loadImage))
    .then(([ally, enemy, ink, table, tableFoe, smoke]) => {
      for (const [team, sheet, source] of [['ally', ally, table], ['enemy', enemy, tableFoe]] as const) {
        const lut = readLut(source)
        art[team] = {
          sheet,
          lut,
          // ColorOverLife 0, 0.024, 0.146 for yours; the enemy's from its table. Lifted a little, or ink this dark is lost on a dark map.
          ink: tintInk(ink, team === 'ally' ? lighter([0, 42, 107], 0.18) : lighter(pick(lut, 0.3), 0.1)),
          streaksLight: makeStreaks(smoke, lighter(pick(lut, 0.34), 0.4), false),
          streaksDark: makeStreaks(smoke, shade(pick(lut, 0.7), 0.35), true),
          puffs: makePuffs(smoke, lighter(pick(lut, 0.4), 0.2), shade(pick(lut, 0.62), 0.5)),
        }
      }
      setStatus('ready')
    })
    .catch(() => setStatus('failed'))
}

/** Whether the Prowler can be drawn yet; asking starts its pictures loading. */
export function prowlerStatus(): ProwlerStatus {
  start()
  return status
}

export function subscribeProwler(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The head's picture is taken from 50° above the ground: depth is drawn shorter by this, and 1 cm of height lifts by RISE. */
const TILT = Math.sin((50 * Math.PI) / 180)
const RISE = Math.cos((50 * Math.PI) / 180)
/** Where the light comes from (x right, y down the screen, z up), and where the camera is. */
const LIGHT: readonly [number, number, number] = (() => {
  const v = [-0.3, -0.5, 0.82]
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n] as const
})()
const TO_CAMERA: readonly [number, number, number] = [0, RISE, TILT]
/** Across the tube, from its far edge to its near one. */
const ACROSS = [-1, -0.92, -0.76, -0.54, -0.28, 0, 0.28, 0.54, 0.76, 0.92, 1] as const
const PUFF = { rate: 46, life: 1.15 } as const

function quad(ctx: CanvasRenderingContext2D, a: Point, b: Point, c: Point, d: Point, fill: string, seam = 0) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.lineTo(c[0], c[1])
  ctx.lineTo(d[0], d[1])
  ctx.closePath()
  ctx.fill()
  if (seam > 0) {
    ctx.strokeStyle = fill
    ctx.lineWidth = seam
    ctx.stroke()
  }
}

/** The whole picture about the head's place on the floor, one unit a centimetre, y down the screen. */
function draw(ctx: CanvasRenderingContext2D, way: readonly ProwlerWayPoint[], { enemy, big, detail, still }: ProwlerView, team: TeamArt) {
  const t = prowlerAge(way) / 1000
  /** What weaves and loops goes by this; held when the user asked for less motion. */
  const beat = still ? 0 : t
  /** Where it was at second `when` of its run. */
  const at = (when: number) => prowlerAt(way, (t - when) * 1000) ?? { x: 0, y: 0, heading: 0 }
  const head = at(t)
  const lut = (u: number) => pick(team.lut, u)
  const rimTint: Rgb = enemy ? [255, 44, 0] : [174, 205, 206]
  const scale = ctx.getTransform().a

  /** Right behind the head the effects are drawn the way the head is; they settle onto the map over the next third of a second of trail. */
  const lean = (x: number, y: number, back: number): Point => {
    const k = 1 - smooth((back - 0.08 * big) / (0.34 * big))
    return [x, head.y + (y - head.y) * lerp(1, TILT, k)]
  }
  /** A point of the scene in the picture: where it is on the map, lifted by its height. */
  const place = (x: number, y: number, z: number, back: number): Point => {
    const [lx, ly] = lean(x, y, back)
    return [lx, ly - z * RISE]
  }

  // Zoomed out the tail covers more of its way and keeps its width further back; it is never longer than the run so far.
  const tailS = Math.min(PROWLER.tailS * lerp(PROWLER_FAR_REACH, 1, detail), t)
  const from = 0.02 * big
  const hasTail = tailS > from + 0.03
  const taper = (u: number, pow: number) => Math.min(1, 0.82 + u * 3) * Math.pow(1 - u, pow)
  /** Its edge is eaten by a texture that scrolls back along it: here, two waves that do. */
  const ragged = (u: number, k: number) => 1 + 0.16 * Math.sin(u * 19 - beat * 9 + k) + 0.1 * Math.sin(u * 41 - beat * 15 + k * 2.3)
  const tailRadius = (u: number) => PROWLER.tailCm * big * taper(u, lerp(0.7, 1, detail)) * ragged(u, 0)
  /** How high the tail flies `u` of the way along it: it sinks a little and weaves. */
  const tailHeight = (u: number) => big * (PROWLER.hoverCm * (1 - 0.32 * u) + 11 * Math.sin(u * 8 - beat * 5.5) * Math.min(1, u * 4))

  /** A flat ribbon along the way it came, `z(u)` over the floor: from `start` to `end` seconds back. */
  const trail = (start: number, end: number, steps: number, width: (u: number) => number, paint: (u: number) => string, offset: ((u: number) => number) | null, z: (u: number) => number, ahead = 0) => {
    const left: Point[] = []
    const right: Point[] = []
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const back = lerp(start, end, u) - ahead
      const p = at(t - back)
      const [nx, ny] = [-Math.sin(p.heading), Math.cos(p.heading)]
      const off = offset ? offset(u) : 0
      const w = width(u) / 2
      left.push(place(p.x + nx * (off + w), p.y + ny * (off + w), z(u), back))
      right.push(place(p.x + nx * (off - w), p.y + ny * (off - w), z(u), back))
    }
    for (let i = 0; i < steps; i++) quad(ctx, left[i], left[i + 1], right[i + 1], right[i], paint((i + 0.5) / steps))
  }

  // ── What it throws on the floor: the one thing that says it flies above it ──
  ctx.filter = `blur(${(13 * big * scale).toFixed(1)}px)`
  if (hasTail) {
    for (let i = 0; i < 26; i++) {
      const [u, v] = [i / 26, (i + 1) / 26]
      const [a, b] = [at(t - lerp(from, tailS, u)), at(t - lerp(from, tailS, v))]
      const [wa, wb] = [tailRadius(u) * 0.9, tailRadius(v) * 0.9]
      const [ax, ay, bx, by] = [-Math.sin(a.heading), Math.cos(a.heading), -Math.sin(b.heading), Math.cos(b.heading)]
      quad(ctx, [a.x + ax * wa, a.y + ay * wa], [b.x + bx * wb, b.y + by * wb], [b.x - bx * wb, b.y - by * wb], [a.x - ax * wa, a.y - ay * wa], `rgba(0,0,0,${(0.42 * (1 - u)).toFixed(3)})`)
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.beginPath()
  ctx.ellipse(head.x, head.y, 78 * big, 46 * big, head.heading, 0, Math.PI * 2)
  ctx.fill()
  ctx.filter = 'none'

  // ── Ink: thrown from round the head at its height, then left hanging ──
  if (detail > 0) {
    const cell = team.ink.width / 4
    const first = Math.max(0, Math.floor((t - PROWLER.inkLife[1]) * PROWLER.inkRate))
    for (let i = first; i <= Math.floor(t * PROWLER.inkRate); i++) {
      const born = i / PROWLER.inkRate
      const life = lerp(PROWLER.inkLife[0], PROWLER.inkLife[1], prowlerRandom(i, 1))
      const age = t - born
      if (age < 0 || age >= life) continue
      const source = at(born)
      const carry = lerp(PROWLER.inkCarry[0], PROWLER.inkCarry[1], prowlerRandom(i, 2)) * PROWLER.speed
      const drag = lerp(PROWLER.inkDrag[0], PROWLER.inkDrag[1], prowlerRandom(i, 3))
      const gone = drag > 1e-3 ? (1 - Math.exp(-drag * age)) / drag : age
      const [vx, vy] = [Math.cos(source.heading) * carry + (prowlerRandom(i, 4) - 0.5) * 10, Math.sin(source.heading) * carry + (prowlerRandom(i, 5) - 0.5) * 10]
      const high = big * (PROWLER.hoverCm + (prowlerRandom(i, 10) - 0.5) * 2 * PROWLER.inkBox)
      const [x, y] = place(source.x + (prowlerRandom(i, 6) - 0.5) * 2 * PROWLER.inkBox + vx * gone, source.y + (prowlerRandom(i, 7) - 0.5) * 2 * PROWLER.inkBox + vy * gone, high, age)
      const size = lerp(PROWLER.inkCm[0], PROWLER.inkCm[1], prowlerRandom(i, 8)) * prowlerCurve(INK_SIZE, age / life) * big * 1.5
      const frame = Math.floor(prowlerRandom(i, 9) * 16)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(source.heading)
      ctx.globalAlpha = prowlerCurve(INK_ALPHA, age / life) * detail
      ctx.drawImage(team.ink, (frame % 4) * cell, Math.floor(frame / 4) * cell, cell, cell, -size / 2, -size / 2, size, size)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  /** The smoke round the tail as puffs with a lit side and a dark one: behind the tube, in front of it, and the youngest over the back of the head. */
  const puffs = (pass: 'behind' | 'front' | 'over') => {
    if (!(detail > 0)) return
    const first = Math.max(0, Math.floor((t - PUFF.life) * PUFF.rate))
    for (let i = first; i <= Math.floor(t * PUFF.rate); i++) {
      const born = i / PUFF.rate
      const age = t - born
      if (age < 0 || age >= PUFF.life) continue
      const which = age < 0.17 * big && i % 2 === 0 ? 'over' : i % 3 === 0 ? 'front' : 'behind'
      if (which !== pass) continue
      const a = age / PUFF.life
      const p = at(born)
      const side = (prowlerRandom(i, 21) - 0.5) * 2 * (20 + 62 * a) * big
      const z = tailHeight(Math.min(1, age / PROWLER.smokeS)) + big * (28 * a + (prowlerRandom(i, 22) - 0.5) * 40)
      const [x, y] = place(p.x - Math.sin(p.heading) * side, p.y + Math.cos(p.heading) * side, z, age)
      const r = (32 + 64 * a) * big * (0.8 + 0.4 * prowlerRandom(i, 23))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((prowlerRandom(i, 24) - 0.5) * 0.9 + (still ? 0 : age * (prowlerRandom(i, 25) - 0.5)))
      ctx.globalAlpha = 0.62 * smooth(a / 0.11) * Math.pow(1 - a, 1.25) * (which === 'over' ? 0.75 : 1) * detail
      ctx.drawImage(team.puffs[i & 3], -r, -r, r * 2, r * 2)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  if (detail > 0 && hasTail) {
    // A soft glow of the tail's colour under the smoke: what holds it together.
    ctx.filter = `blur(${(15 * big * scale).toFixed(1)}px)`
    trail(from, Math.min(PROWLER.smokeS, t), 30, u => PROWLER.smokeCm * 1.7 * big * taper(u, 0.8), u => rgba(lut(0.5 + 0.4 * u), 0.5 * (1 - u) * detail), null, u => tailHeight(u) * 0.9)
    ctx.filter = 'none'
  }
  puffs('behind')

  // ── The hard tail: a tube, its top lit, its underside dark, its far edge in the light the head has on its outline ──
  if (hasTail) {
    const target = ctx.canvas
    if (!layer) layer = document.createElement('canvas')
    if (layer.width !== target.width || layer.height !== target.height) {
      layer.width = target.width
      layer.height = target.height
    }
    const sheet = layer.getContext('2d')
    if (sheet) {
      sheet.setTransform(1, 0, 0, 1, 0, 0)
      sheet.globalCompositeOperation = 'source-over'
      sheet.globalAlpha = 1
      sheet.clearRect(0, 0, layer.width, layer.height)
      sheet.setTransform(ctx.getTransform())
      const steps = 60
      const seam = 1.2 / scale
      const bodyAt = (u: number) => lut(0.38 + 0.4 * u)
      const rows: Array<{ u: number; lat: Point; pts: Point[]; under: [Point, Point] }> = []
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        const back = lerp(from, tailS, u)
        const p = at(t - back)
        const lat: Point = [-Math.sin(p.heading), Math.cos(p.heading)]
        const [r, zc] = [tailRadius(u), tailHeight(u)]
        rows.push({
          u,
          lat,
          pts: ACROSS.map(s => place(p.x + lat[0] * s * r, p.y + lat[1] * s * r, zc + 0.62 * r * Math.sqrt(1 - s * s), back)),
          under: [place(p.x - lat[0] * r * 0.9, p.y - lat[1] * r * 0.9, zc - 0.55 * r, back), place(p.x + lat[0] * r * 0.9, p.y + lat[1] * r * 0.9, zc - 0.55 * r, back)],
        })
      }
      // Its underside, in one piece: seen below the tube wherever it runs across the screen.
      sheet.fillStyle = rgba(shade(bodyAt(0.4), 0.3), 0.97)
      sheet.beginPath()
      rows.forEach((row, i) => (i ? sheet.lineTo(row.under[0][0], row.under[0][1]) : sheet.moveTo(row.under[0][0], row.under[0][1])))
      for (let i = rows.length - 1; i >= 0; i--) sheet.lineTo(rows[i].under[1][0], rows[i].under[1][1])
      sheet.closePath()
      sheet.fill()
      for (let i = 0; i < steps; i++) {
        const u = (i + 0.5) / steps
        const body = bodyAt(u)
        const rim = blend(rimTint, lighter(lut(0.36), 0.22), smooth(u / 0.5))
        const { lat } = rows[i]
        for (let j = 0; j < ACROSS.length - 1; j++) {
          const s = (ACROSS[j] + ACROSS[j + 1]) / 2
          const n = [lat[0] * s, lat[1] * s, Math.sqrt(1 - s * s)]
          const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
          const facing = Math.max(0, n[1] * TO_CAMERA[1] + n[2] * TO_CAMERA[2])
          const colour = blend(blend(shade(body, 0.5), lighter(body, 0.16), lit), rim, 0.7 * Math.pow(1 - facing, 3.4))
          quad(sheet, rows[i].pts[j], rows[i + 1].pts[j], rows[i + 1].pts[j + 1], rows[i].pts[j + 1], rgba(colour, 0.97), seam)
        }
      }
      // The game's smoke texture streaming back along the tube: dark wisps and light ones, only where the tube is.
      const last = ACROSS.length - 1
      sheet.globalCompositeOperation = 'source-atop'
      for (const [tex, strength, speed] of [[team.streaksDark, 0.6, 0.7], [team.streaksLight, 0.55, 1.1]] as const) {
        const wide = tex.width / 2
        for (let i = 0; i < rows.length - 1; i++) {
          const [a, b] = [rows[i], rows[i + 1]]
          const o = a.pts[0]
          const slice = (((a.u * 1.4 - beat * speed) % 1) + 1) % 1
          sheet.save()
          sheet.transform(b.pts[0][0] - o[0], b.pts[0][1] - o[1], a.pts[last][0] - o[0], a.pts[last][1] - o[1], o[0], o[1])
          sheet.globalAlpha = strength * (1 - a.u * 0.6)
          sheet.drawImage(tex, slice * wide, 0, (b.u - a.u) * 1.4 * wide, tex.height * 0.45, 0, -0.25, 1.03, 1.5)
          sheet.restore()
        }
      }
      sheet.globalAlpha = 1
      sheet.globalCompositeOperation = 'source-over'
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer, 0, 0)
      ctx.restore()
    }
    // The particle ribbon and the core line run along its top.
    const top = (u: number) => tailHeight(u) + 0.62 * tailRadius(u)
    trail(from, Math.min(PROWLER.ribbonS, tailS), 16, u => PROWLER.ribbonCm * 0.8 * big * (1 - 0.5 * u), u => rgba(enemy ? [22, 2, 5] : [0, 10, 25], 0.55 * (1 - u)), null, top)
    trail(from, tailS * 0.9, 26, u => 8 * big * (1 - u), () => rgba(enemy ? [170, 14, 24] : [130, 6, 26], 0.95), null, top)
  }
  puffs('front')

  // ── Whiskers: four red streaks from the jaws, a glow at each root ──
  const red: Rgb = [204, 12, 12]
  const ahead = (35 * big) / PROWLER.speed
  for (const side of [-1, 1]) {
    for (const jaw of [0, 1]) {
      const lateral = side * (27 + jaw * 9) * big
      const wave = (u: number) => lateral + side * 14 * big * u * Math.sin(u * 7 - beat * 11 + jaw * 2 + side)
      const high = (u: number) => big * (PROWLER.hoverCm + (jaw ? -14 : 12) - 26 * u + 9 * Math.sin(u * 6 - beat * 9 + jaw * 3))
      trail(0, Math.min(PROWLER.whiskerS, t + ahead), 14, u => PROWLER.whiskerCm * big * (1 - 0.6 * u), u => rgba(jaw ? shade(red, 0.72) : red, 0.95 * prowlerCurve(WHISKER_ALPHA, u)), wave, high, ahead)
      const p = at(t + ahead)
      const [gx, gy] = place(p.x - Math.sin(p.heading) * lateral, p.y + Math.cos(p.heading) * lateral, high(0), 0)
      // BH_Cat_Glow: a soft red light 20 cm across at its root (30 at the pawn's scale).
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 15 * big)
      glow.addColorStop(0, 'rgba(255,40,30,0.5)')
      glow.addColorStop(1, 'rgba(255,8,8,0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(gx, gy, 15 * big, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  // ── The head ──
  const { row, turn } = prowlerRow(head.heading)
  const frame = still ? 0 : prowlerFrame(t * 1000)
  const size = PROWLER_SPRITE.spanCm * big
  const tile = team.sheet.width / PROWLER_SPRITE.frames
  const [hx, hy] = place(head.x, head.y, PROWLER.hoverCm * big, 0)
  ctx.save()
  ctx.translate(hx, hy)
  ctx.rotate(turn)
  ctx.drawImage(team.sheet, frame * tile, row * tile, tile, tile, -size / 2, -size / 2, size, size)
  ctx.restore()

  puffs('over')
}

/**
 * Paints the Prowler onto `target`, a square canvas that shows
 * `PROWLER_EXTENT_CM` either side of its centre. `way` is in world cm about
 * that centre, which is where the Prowler is on the floor now, with y down the
 * screen. False when it could not (pictures not in yet, no 2D canvas): the
 * caller keeps its fallback.
 */
export function paintProwler(target: HTMLCanvasElement, way: readonly ProwlerWayPoint[], view: ProwlerView): boolean {
  const ctx = target.getContext('2d')
  const team = art[view.enemy ? 'enemy' : 'ally']
  if (!ctx || status !== 'ready' || !team) return false
  const size = target.width
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.clearRect(0, 0, size, size)
  if (size <= 0 || way.length < 2) return true
  const scale = size / (2 * PROWLER_EXTENT_CM)
  ctx.setTransform(scale, 0, 0, scale, size / 2, size / 2)
  draw(ctx, way, view, team)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  return true
}
