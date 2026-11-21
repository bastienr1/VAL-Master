/**
 * Draws Sova's Shock Bolt from straight above (docs/plays-editor-v2.md §2.22):
 * the arming and the blast, built from the game's own emitters with the game's
 * two sprite sheets (`src/assets/shock`: `Ether_Spark_Anim`, the spark, 4 × 4
 * frames, and `Shockbolt_Arm_Grayscale`, the arms of the blast, 7 × 3). Sizes
 * and lifetimes are the emitters'; the colours are theirs too, blue for an
 * ally's and red for an enemy's.
 *
 * In the game the three arms stand 4.5 m tall on the ball of the blast. From
 * above they are laid from the centre to its edge, so they read on a map.
 * Plain 2D canvas, drawn additively: no WebGL.
 */

import armUrl from '../assets/shock/arm.png'
import sparkUrl from '../assets/shock/spark.png'
import { SHOCK, sampleCurve, shockRandom, type ShockState } from './shockDart.ts'

/** The picture's half-width in blast radii: room for the first flash. */
export const SHOCK_EXTENT = 1.1

type Palette = readonly [core: string, hot: string, main: string, deep: string]
/** The emitters' ally colour is (0.1, 1, 10), which blooms to white; the enemy's is (10, 0.2, 0.1). */
const ALLY: Palette = ['#F2FAFF', '#8FD0FF', '#2F7DFF', '#1247E6']
const ENEMY: Palette = ['#FFF5F2', '#FF9C8F', '#FF3D2E', '#C81414']

/** The game's hot colour for a team, for the lines drawn round the picture. */
export const shockHot = (enemy: boolean): string => (enemy ? ENEMY : ALLY)[1]

const SHEETS = { spark: [4, 4], arm: [7, 3] } as const
type SheetName = keyof typeof SHEETS

export type ShockStatus = 'loading' | 'ready' | 'failed'

let status: ShockStatus = 'loading'
let started = false
const sheets = new Map<string, HTMLCanvasElement>()
const listeners = new Set<() => void>()

function setStatus(next: ShockStatus) {
  if (status === next) return
  status = next
  listeners.forEach(listener => listener())
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Shock Dart sprite did not load: ${url}`))
    image.src = url
  })
}

const channels = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const rgba = (hex: string, alpha: number) => `rgba(${channels(hex).join(',')},${alpha})`

/** A grey sheet as one colour, its grey become its alpha. */
function tint(image: HTMLImageElement, color: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const [r, g, b] = channels(color)
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i + 3] = pixels.data[i]
    pixels.data[i] = r
    pixels.data[i + 1] = g
    pixels.data[i + 2] = b
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function start() {
  if (started || typeof document === 'undefined') return
  started = true
  Promise.all([loadImage(sparkUrl), loadImage(armUrl)])
    .then(([spark, arm]) => {
      for (const color of [...ALLY, ...ENEMY]) {
        const sparkSheet = tint(spark, color)
        const armSheet = tint(arm, color)
        if (!sparkSheet || !armSheet) throw new Error('No 2D canvas')
        sheets.set(`spark:${color}`, sparkSheet)
        sheets.set(`arm:${color}`, armSheet)
      }
      setStatus('ready')
    })
    .catch(() => setStatus('failed'))
}

/** Whether the dart can be drawn yet; asking starts the sprites loading. */
export function shockStatus(): ShockStatus {
  start()
  return status
}

export function subscribeShock(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const TURN = Math.PI * 2
/** The effects' own fade: in over the first third, then easing off. */
const FADE_IN_OUT = [0, 0.333, 0.667, 0.988, 0.917, 0.833, 0.75, 0.667]

/** One frame of a sheet, `w` × `h` cm about the origin, turned by `rot`; `hung` draws it from its bottom edge. */
function sprite(ctx: CanvasRenderingContext2D, name: SheetName, color: string, frame: number, w: number, h: number, rot: number, alpha: number, hung = false) {
  const sheet = sheets.get(`${name}:${color}`)
  if (!sheet || !(alpha > 0)) return
  const [cols, rows] = SHEETS[name]
  const count = cols * rows
  const f = ((Math.floor(frame) % count) + count) % count
  const fw = sheet.width / cols
  const fh = sheet.height / rows
  ctx.save()
  ctx.rotate(rot)
  ctx.globalAlpha = clamp01(alpha)
  ctx.drawImage(sheet, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, -w / 2, hung ? -h : -h / 2, w, h)
  ctx.restore()
}

function glow(ctx: CanvasRenderingContext2D, r: number, inner: string, outer: string, edge: string, alpha: number) {
  if (!(r > 0) || !(alpha > 0)) return
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  fill.addColorStop(0, inner)
  fill.addColorStop(0.35, outer)
  fill.addColorStop(1, rgba(edge, 0))
  ctx.globalAlpha = clamp01(alpha)
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TURN)
  ctx.fill()
  ctx.globalAlpha = 1
}

/** A see-through ball from above: faint in the middle, bright at its edge. */
function ball(ctx: CanvasRenderingContext2D, r: number, main: string, hot: string, alpha: number) {
  if (!(alpha > 0)) return
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  fill.addColorStop(0, rgba(main, 0.16))
  fill.addColorStop(0.72, rgba(main, 0.3))
  fill.addColorStop(0.95, rgba(hot, 0.95))
  fill.addColorStop(1, rgba(hot, 0))
  ctx.globalAlpha = clamp01(alpha)
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TURN)
  ctx.fill()
  ctx.globalAlpha = 1
}

/** The dart on the ground and its blast, about the origin, one unit a centimetre. */
function draw(ctx: CanvasRenderingContext2D, state: ShockState, seed: number, [core, hot, main, deep]: Palette) {
  if (state.phase === 'armed') {
    // Hunter_4_AOE_Radius_VFX: the reach it will have, a swelling core and a spark growing from 1 m to 4 m.
    const p = state.arm * 0.8
    ball(ctx, SHOCK.warnCm, main, hot, 0.55 * sampleCurve(FADE_IN_OUT, p))
    glow(ctx, 48 * (1 + 5 * p ** 1.2), core, main, deep, 0.9)
    const w = 100 * (1 + 3 * p)
    const rot = shockRandom(seed, 1) * TURN
    sprite(ctx, 'spark', main, state.spark * 16, w * 1.15, w * 1.15, rot, 0.9)
    sprite(ctx, 'spark', core, state.spark * 16, w, w, rot, 1)
    return
  }
  if (state.phase !== 'blast') return
  // Hunter_4_AOE_Revised_Vfx.
  const t = state.blast
  glow(ctx, 300, core, hot, deep, 1 - t / 0.07) // its first frames are white
  // Two glowing balls, 0.3 s: 2.43 m and 0.99 m, each growing by 60 %.
  const q = t / 0.3
  if (q < 1) {
    const a = sampleCurve([1, 0.423, 0.1, 0], q)
    glow(ctx, 243 * (1 + 0.6 * q), hot, main, deep, a * 0.75)
    glow(ctx, 139 * (1 + 0.6 * q), core, hot, deep, a)
  }
  // The ball of the blast: 4.03 m, from 0.1 s for 0.2 s.
  const s = (t - 0.1) / 0.2
  if (s >= 0 && s < 1) {
    ctx.save()
    const swell = sampleCurve([0.98, 1.036, 1.02], s)
    ctx.scale(swell, swell)
    ball(ctx, SHOCK.ballCm, main, hot, sampleCurve(FADE_IN_OUT, s))
    ctx.restore()
  }
  // Three arms of lightning, 0.325 s, each starting somewhere else in its flipbook.
  const a = t / 0.325
  if (a < 1) {
    for (let i = 0; i < 3; i++) {
      const rot = shockRandom(seed, 10 + i) * TURN
      const frame = ((shockRandom(seed, 20 + i) + a * 0.55) % 1) * 21
      const alpha = Math.min(1, 1.2 * (1 - a))
      sprite(ctx, 'arm', a < 0.5 ? main : deep, frame, 392, 420, rot, alpha, true)
      sprite(ctx, 'arm', main, frame, 374, 410, rot, alpha * 0.8, true)
      sprite(ctx, 'arm', a < 0.45 ? core : hot, frame, 356, 400, rot, alpha, true)
    }
  }
  // The spark, 0.4 s, 2.2 m growing to 4.4 m.
  const f = t / 0.4
  if (f < 1) {
    const w = 109 * (2 + 2 * f)
    const rot = shockRandom(seed, 2) * TURN
    sprite(ctx, 'spark', main, f * 16, w * 1.12, w * 1.12, rot, 1 - f * 0.5)
    sprite(ctx, 'spark', core, f * 16, w, w, rot, 1)
  }
  // The shell at its edge, from 0.15 s.
  const d = (t - 0.15) / 0.275
  if (d >= 0 && d < 1) {
    ctx.globalAlpha = clamp01(0.55 * (1 - d / 0.45))
    ctx.strokeStyle = hot
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.arc(0, 0, SHOCK.outerCm, 0, TURN)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/**
 * Paints the dart in `state` onto `target`, a square canvas, filling it with
 * `SHOCK_EXTENT` blast radii either side of the centre. False when it could
 * not (sprites not in yet, no 2D canvas): the caller keeps its fallback.
 */
export function paintShock(target: HTMLCanvasElement, state: ShockState, seed: number, enemy: boolean): boolean {
  const ctx = target.getContext('2d')
  if (!ctx || status !== 'ready') return false
  const size = target.width
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, size, size)
  if (size <= 0) return true
  const scale = size / (2 * SHOCK.outerCm * SHOCK_EXTENT)
  ctx.setTransform(scale, 0, 0, scale, size / 2, size / 2)
  ctx.globalCompositeOperation = 'lighter'
  draw(ctx, state, seed, enemy ? ENEMY : ALLY)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return true
}
