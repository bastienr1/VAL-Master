/**
 * Brimstone's Incendiary as the game runs it, for the board's animated molly.
 * Every figure here is read from the game files (13.10): the fire patch
 * `Patch_Sarge_Q_Molotov` and its parents `Patch_Molotovs_Parent` /
 * `Patch_Global_Spreading`, the damage buff `Buff_Sarge_Q_MolotovDamage`, the
 * ground decal `Sarge_Q_Molotov_Decal` (material `Sarge_FireDecal_MAT_Inst_PatchTech`
 * and its `_FOE`), and the effects `Sarge_Q_Molotov_FlamesParticles` and
 * `Sarge_Q_Molotov_Explosion`. The replays agree: a patch actor lives 11.0 s
 * (median 11.003 s over 218), the 8.0 s burn and the 3.0 s fade-out tail.
 *
 * The clock starts when the patch actor appears: the grenade has come to rest.
 * The fire is drawn as the full circle; in the game it stops at walls and ledges.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `incendiaryGl.ts`. The prototype it was ported from:
 * VAL-Master-Plays/prototypes/incendiary.
 */

export const INCENDIARY = {
  /** Where the fire hurts, world cm: Patch_Molotovs_Parent ClampedRadius 450 (overrides Patch_Global_Spreading 700). */
  hurtCm: 450,
  /** The ground decal's box, half-size, world cm: ClampedRadius 450 × DecalRadiusMultiplier 1.111. */
  decalCm: 500,
  /** GroundVolumeAreaVisualization HorizontalFadeOut: the patch's soft edge, cm. */
  edgeFadeCm: 10,
  /** Patch_Global_Spreading SpreadDelay: the grenade lies there this long before the fire starts out. */
  spreadDelayMs: 200,
  /** Patch_Molotovs_Parent SpreadSpeed, cm per second: the whole radius 750 ms after the delay. */
  spreadCmPerS: 600,
  /** Patch_Molotovs_Parent FireActiveDuration, from the patch's spawn: the fire hurts until here. */
  burnMs: 8000,
  /** Patch_Molotovs_Parent FadeOutDuration; FXC_Sarge_Q_Molotov_FadeOut InitialLifeSpan 3.0 (the end sound, no fire). */
  fadeOutMs: 3000,
  /** Sarge_Q_Molotov_Decal Decal_FireGround Lifetime: the ground glows this long (in 0.4 to 1.4 s, out 7.8 to 8.5 s). */
  glowMs: 8500,
  /** Sarge_Q_Molotov_FlamesParticles Flame lifetime, longest: the last flame is gone this long after the burn. */
  flameLifeMs: 700,
  /** Buff_Sarge_Q_MolotovDamage: 1 HP every Period 0.016667 s while inside, no falloff. */
  damagePerS: 60,
  /** Patch_Molotovs_Parent EntranceOverlapHeight: how far above the burning floor it hurts, cm. */
  hurtHeightCm: 80,
  /** Sarge_FireDecal_MAT_Inst_PatchTech DecalRing (300, 30, 3.5), _FOE (300, 10, 3.5): the hot band over the outer 300 cm at power 3.5. */
  rimBandCm: 300,
  /** DecalRing's second value: the sharp line on the edge itself, cm. */
  rimLineCm: { ally: 30, enemy: 10 },
  /** DecalOutlineValueAdd, added to Sarge_Molotov_Mask². */
  outlineAdd: { ally: 0.2, enemy: 0.6 },
  /** PatchFragmentSize 200 cm / PatchVFXDensityMultiple 2: the flame spots are this far apart, cm. */
  spotCm: 100,
} as const

/** Fully spread: the delay and 450 cm at 600 cm/s. */
const FULL_MS = INCENDIARY.spreadDelayMs + (INCENDIARY.hurtCm / INCENDIARY.spreadCmPerS) * 1000
/** The last flame is gone. */
const DARK_MS = INCENDIARY.burnMs + INCENDIARY.flameLifeMs
const TOTAL_MS = INCENDIARY.burnMs + INCENDIARY.fadeOutMs

export type IncendiaryPhase = 'impact' | 'spreading' | 'burning' | 'dying' | 'tail' | 'gone'

/** One sprite of the fire, in world cm about the centre (y down, like the board). */
export interface IncendiarySprite {
  /** 0 flame flipbook, 1 blurred flipbook (lies flat), 2 soft dot, 3 streak, 4 smoke puff. */
  kind: 0 | 1 | 2 | 3 | 4
  x: number
  y: number
  /** Width, cm (and height, but for a streak). */
  size: number
  /** A streak's length, cm. */
  len: number
  rot: number
  /** Flipbook frame, 0…16. */
  frame: number
  alpha: number
  /** Random 0…1: texture offset and flips. */
  noise: number
  /** Row of the colour table, or −1 to use `col` alone. */
  row: number
  /** Where along that row, 0…1. */
  rx: number
  /** Linear HDR colour (a multiplier when `row` is set). */
  col: readonly [number, number, number]
  /** ColorMultiply, ColorPower, AlphaMultiply, Alpha2ndMultiply, Alpha2ndPower of the sprite's material. */
  mat: readonly [number, number, number, number, number]
  /** Stands on the burning floor: kept inside the patch. */
  clip: boolean
  /** Drawing order, low first. */
  order: number
}

export interface IncendiaryState {
  phase: IncendiaryPhase
  /** How far the fire has spread, 0…1 of the hurt radius. */
  spread: number
  /** Whether standing in it hurts now (inside the spread front, until the burn ends). */
  hurting: boolean
  /** The ground decal's glow, 0…1 (its first dynamic parameter). */
  glow: number
  /** The scale of the ground's fire texture, 0.5…1 (second dynamic parameter). */
  glowScale: number
  /** How far the ground has burnt in, 0…1 (fourth dynamic parameter). */
  burn: number
  /** The grenade lying there before the fire starts out, 1…0 over the spread delay. */
  impact: number
  /** The line on the spreading front, opacity 0…1; 0 once it is whole. */
  front: number
  /** The mark of where the fire was, once it is out, opacity 0…1. */
  footprint: number
  /** How far through the tail with no fire, 0…1 (0 while anything burns). */
  fade: number
  /** Seconds the ground's textures have been scrolling. */
  materialTime: number
  /** Every flame, ember and impact sprite alive now, in drawing order. */
  sprites: IncendiarySprite[]
}

const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)

/** Curves from the files, sampled at 33 points over normalised life. */
const CURVES = {
  /** Sarge_Q_Molotov_Decal dynamic parameter 0: the ground's glow. */
  decalGlow: [0, 0, 0.1786, 0.625, 0.9964, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9254, 0.625, 0.3125, 0],
  /** Dynamic parameter 1: the scale of its fire texture. */
  decalScale: [0.5, 0.6562, 0.8125, 0.9688, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  /** Dynamic parameter 3: the burn-in. */
  decalBurn: [0, 0.2083, 0.4167, 0.625, 0.8333, 0.9801, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  /** Flame AlphaScaleOverLife. */
  flameAlpha: [0, 0.0436, 0.0872, 0.1307, 0.2057, 0.2866, 0.3675, 0.423, 0.4666, 0.5102, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531, 0.531],
  /** FlameGroundBirth AlphaOverLife. */
  groundBirthAlpha: [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  /** Sarge_Q_Molotov_Explosion flash SizeMultiplyLife. */
  flashSize: [1, 1.0484, 1.0967, 1.2005, 1.3252, 1.4705, 1.641, 1.8142, 1.9999, 2.1857, 2.3577, 2.5282, 2.6699, 2.7946, 2.8924, 2.9408, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853, 2.9853],
  /** SmokeBurst1 SizeMultiplyLife. */
  smokeSize: [0.3, 0.5917, 0.7797, 0.8965, 0.9746, 1.0464, 1.1386, 1.2441, 1.3428, 1.4329, 1.5148, 1.5888, 1.6554, 1.7147, 1.7672, 1.8134, 1.8538, 1.8888, 1.9187, 1.944, 1.965, 1.9821, 1.9957, 2.0062, 2.014, 2.0194, 2.0229, 2.0248, 2.0257, 2.0259, 2.0259, 2.0259, 2.0259],
} as const

function curveAt(arr: readonly number[], x: number): number {
  const f = clamp01(x) * (arr.length - 1)
  const i = Math.floor(f)
  const j = Math.min(i + 1, arr.length - 1)
  return lerp(arr[i], arr[j], f - i)
}

/** Deterministic random in [0, 1) from integers. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) + 0x9e3779b9
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const rr = (lo: number, hi: number, a: number, b: number, c: number) => lo + (hi - lo) * hash(a, b, c)

/** Seconds, as the files give them, for the sprite timings below. */
const DELAY_S = INCENDIARY.spreadDelayMs / 1000
const ACTIVE_S = INCENDIARY.burnMs / 1000

interface Spot { id: number; x: number; y: number; arrive: number }

/**
 * Flame spots: one per patch cell (100 cm), half of them used ("Percent
 * Particle Locations to Spawn Particle" 0.5), each moved 2–10 cm. The layout
 * is a reconstruction; `arrive` is when the spread front reaches it, seconds.
 */
const SPOTS: readonly Spot[] = (() => {
  const out: Spot[] = []
  const step = INCENDIARY.spotCm
  const n = Math.ceil(INCENDIARY.hurtCm / step)
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.hypot(i * step, j * step) > INCENDIARY.hurtCm - 20) continue
      if (!(i === 0 && j === 0) && hash(i, j, 1) >= 0.5) continue
      const a = hash(i, j, 2) * Math.PI * 2
      const l = rr(2, 10, i, j, 3)
      const x = i * step + Math.cos(a) * l
      const y = j * step + Math.sin(a) * l
      out.push({ id: (i + 50) * 101 + (j + 50), x, y, arrive: DELAY_S + Math.hypot(x, y) / INCENDIARY.spreadCmPerS })
    }
  }
  return out
})()

type Mat = IncendiarySprite['mat']
/** Material settings per sprite type (ColorMultiply, ColorPower, AlphaMultiply, Alpha2ndMultiply, Alpha2ndPower). */
const MAT = {
  /** Sarge_FireFB_Loop_Inst. */
  loop: [1.2, 2.0, 3.0, 1.0, 1.0],
  /** Sarge_FireFB_B_Inst. */
  b: [1.2, 2.0, 3.0, 1.0, 1.0],
  /** Sarge_FireFB_C_Inst. */
  c: [1.2, 1.5, 3.0, 1.0, 1.5],
  /** Sarge_FireFB_Ground_Birth_Inst. */
  ground: [2.6, 4.0, 0.381, 2.0, 0.0],
  plain: [1, 1, 1, 1, 0],
} as const satisfies Record<string, Mat>

const WHITE = [1, 1, 1] as const

function sprite(list: IncendiarySprite[], o: Pick<IncendiarySprite, 'kind' | 'x' | 'y' | 'size'> & Partial<IncendiarySprite>): void {
  list.push({ clip: true, rot: 0, frame: 0, alpha: 1, noise: 0, row: -1, rx: 0, col: WHITE, len: 0, mat: MAT.plain, order: 2, ...o })
}

const live = (t: number, start: number, life: number) => t >= start && t < start + life

/** The rising birth flames: FlameBlueToRedBirth (3–7/s, 230–250 cm, row 1) and FlameBlueBirth (5–7/s, 210–240 cm, row 2). */
const BIRTHS: readonly { tag: number; rate: readonly [number, number]; size: readonly [number, number]; row: 1 | 2; mat: Mat }[] = [
  { tag: 11, rate: [3, 7.05], size: [230, 250], row: 1, mat: MAT.b },
  { tag: 12, rate: [5, 7], size: [210, 240], row: 2, mat: MAT.c },
]

/** A spot catching fire as the spread reaches it: blue, then orange, for 0.3–0.6 s. */
function ignition(L: IncendiarySprite[], p: Spot, t: number): void {
  const { id, arrive: ta } = p
  // Ground birth: one flat blurred flame, blue to orange in 0.4 s.
  if (live(t, ta, 0.4)) {
    const x = (t - ta) / 0.4
    sprite(L, {
      kind: 1, x: p.x, y: p.y, size: 250 * 0.85, rot: hash(id, 7, 1) * 6.283, frame: x * 15, alpha: curveAt(CURVES.groundBirthAlpha, x),
      noise: hash(id, 7, 2), row: 0, rx: Math.min(1, x / 0.75), mat: MAT.ground, order: 0,
    })
  }
  // Rising birth flames, 70 cm around the spot.
  for (const { tag, rate: [rate0, rate1], size: [s0, s1], row, mat } of BIRTHS) {
    const dur = rr(0.3, 0.6, id, tag, 1)
    const rate = rr(rate0, rate1, id, tag, 2)
    for (let k = 0; k * (1 / rate) < dur; k++) {
      const s = ta + k / rate
      const life = rr(0.4, 0.5, id, tag, 10 + k)
      if (!live(t, s, life)) continue
      const x = (t - s) / life
      const a = hash(id, tag, 30 + k) * 6.283
      const rad = 70 * Math.sqrt(hash(id, tag, 50 + k))
      sprite(L, {
        kind: 0, x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad, size: rr(s0, s1, id, tag, 70 + k) * 0.87, rot: hash(id, tag, 90 + k) * 6.283,
        frame: x * 16, alpha: row === 1 ? curveAt(CURVES.groundBirthAlpha, x) : curveAt(CURVES.flameAlpha, x), noise: hash(id, tag, 110 + k),
        row, rx: row === 1 ? Math.min(1, x / 0.75) : x, mat, order: 1,
      })
    }
  }
}

/**
 * A spot burning at `t`: its flames and embers among those that start in
 * [from, to). The fire's own are all of them up to the end of the burn.
 */
function burning(L: IncendiarySprite[], p: Spot, t: number, from: number, to: number): void {
  const { id, arrive: ta } = p
  // Flame: one per loop, loop = delay 0.15–1.0 s + duration 0.1–0.2 s; 135–175 cm, life 0.45–0.7 s.
  let e = ta
  for (let k = 0; k < 80; k++) {
    const s = e + rr(0.15, 1.0, id, 20, k)
    if (s >= to || s > t) break
    const life = rr(0.45, 0.7, id, 21, k)
    if (s >= from && live(t, s, life)) {
      const x = (t - s) / life
      sprite(L, {
        kind: 0, x: p.x, y: p.y, size: rr(135, 175, id, 22, k), rot: hash(id, 23, k) * 6.283, frame: x * 16, alpha: curveAt(CURVES.flameAlpha, x),
        noise: hash(id, 24, k), row: 3, rx: Math.min(1, x / 0.8), mat: MAT.loop, order: 1,
      })
    }
    e = s + rr(0.1, 0.2, id, 25, k)
  }
  // Embers: one every 0.8–2.3 s, drifting within 75 cm, (25, 1, 0.15) × 90 → (20, 4, 4).
  e = ta
  for (let k = 0; k < 40; k++) {
    const s = e + rr(0.5, 2.0, id, 30, k)
    if (s >= to || s > t) break
    const life = rr(0.35, 1.0, id, 31, k)
    if (s >= from && live(t, s, life)) {
      const x = (t - s) / life
      const a = hash(id, 32, k) * 6.283
      const rad = 75 * Math.sqrt(hash(id, 33, k))
      const drift = 30 * x
      const cool = clamp01(x / 0.6)
      sprite(L, {
        kind: 2, x: p.x + Math.cos(a) * (rad + drift), y: p.y + Math.sin(a) * (rad + drift),
        size: rr(8, 15, id, 34, k) * 2.2 * (x < 0.5 ? 1 : 1 - (x - 0.5) / 0.5),
        alpha: 0.3 * 2.5, col: [25 * lerp(90, 20, cool), lerp(90, 4, cool), 0.15 * lerp(90, 4, cool)], order: 3,
      })
    }
    e = s + 0.3
  }
}

/** The impact (Sarge_Q_Molotov_Explosion), as the grenade comes to rest: flash, flame burst, streaks, sparks, smoke. */
function impactBurst(L: IncendiarySprite[], t: number): void {
  if (t >= 0.75) return
  const first = L.length
  // Flash: 1.2–1.5 m × 3 over 0.12 s.
  const flashes = [120, 150]
  flashes.forEach((sz, i) => {
    if (!live(t, 0, 0.12)) return
    const x = t / 0.12
    sprite(L, { kind: 2, x: 0, y: 0, size: sz * curveAt(CURVES.flashSize, x) * 1.6, alpha: 1 - x * x, col: [60 * 4.5, 5 * 4.5, 1 * 4.5], order: 4 + i })
  })
  if (live(t, 0, 0.07)) sprite(L, { kind: 2, x: 0, y: 0, size: 400 * lerp(1, 2, t / 0.07), alpha: 0.02 * 8, col: [60, 5, 1], order: 4 })
  // FlameBirth: 20/s from 0.1 to 0.7 s, 250–350 cm × 0.8.
  for (let k = 0; k < 12; k++) {
    const s = 0.1 + k / 20
    const life = rr(0.3, 0.4, 900, 1, k)
    if (!live(t, s, life)) continue
    const x = (t - s) / life
    const a = hash(900, 2, k) * 6.283
    const rad = 50 * Math.sqrt(hash(900, 3, k))
    sprite(L, {
      kind: 0, x: Math.cos(a) * rad, y: Math.sin(a) * rad, size: rr(250, 350, 900, 4, k) * 0.8, rot: hash(900, 5, k) * 6.283, frame: x * 16, alpha: 1,
      noise: hash(900, 6, k), row: 7, rx: x, mat: MAT.b, order: 2,
    })
  }
  // Streaks: 20 at once, velocity-aligned, 0.15–0.2 s, 3.5–4.8 m.
  for (let k = 0; k < 20; k++) {
    const life = rr(0.15, 0.2, 901, 1, k)
    if (!live(t, 0, life)) continue
    const x = t / life
    const az = hash(901, 2, k) * 6.283
    const el = Math.asin(hash(901, 3, k))
    const len = rr(350, 480, 901, 4, k) * lerp(1, 1.5, x) * Math.cos(el)
    const heat = lerp(15, 5, x)
    sprite(L, { kind: 3, x: 0, y: 0, size: rr(90, 100, 901, 5, k) * 0.5, len, rot: az, alpha: 1 - x, col: [25 * heat, heat, 0.15 * heat], order: 5 })
  }
  // Sparks: 30 from a 50 cm sphere at 15–30 × its radius per second, drag 1–3.
  for (let k = 0; k < 30; k++) {
    const life = rr(0.35, 0.7, 902, 1, k)
    if (!live(t, 0, life)) continue
    const x = t / life
    const az = hash(902, 2, k) * 6.283
    const ca = Math.sqrt(1 - Math.pow(hash(902, 3, k), 2))
    const v = 50 * rr(15, 30, 902, 4, k)
    const drag = rr(1, 3, 902, 5, k)
    const d = (50 + (v / drag) * (1 - Math.exp(-drag * t))) * ca
    const sz = rr(6, 13, 902, 6, k) * (x < 0.5 ? 1 : 1 - (x - 0.5) / 0.5)
    const heat = lerp(200, 1, x)
    sprite(L, {
      kind: 3, x: Math.cos(az) * d, y: Math.sin(az) * d, size: sz * 0.9, len: sz * 4 * ca * Math.max(0.3, Math.exp(-drag * t)) * 3, rot: az, alpha: 0.3 * 3,
      col: [25 * heat, heat, 0.15 * heat], order: 5,
    })
  }
  // Smoke: SmokeBurst1 twice (300 cm, on its size curve) and two quick puffs (180 cm).
  const puffs: readonly { start: number; life: number; size: number; curved: boolean }[] = [
    { start: 0, life: 0.5, size: 300, curved: true },
    { start: 0.25, life: 0.5, size: 300, curved: true },
    { start: 0, life: 0.4, size: 180, curved: false },
    { start: 0, life: 0.4, size: 180, curved: false },
  ]
  puffs.forEach((puff, k) => {
    if (!live(t, puff.start, puff.life)) return
    const x = (t - puff.start) / puff.life
    const grow = puff.curved ? curveAt(CURVES.smokeSize, x) : lerp(0.067, 2.09, easeOut(x * 1.1))
    sprite(L, {
      kind: 4, x: rr(-20, 20, 903, 1, k), y: rr(-20, 20, 903, 2, k), size: puff.size * grow, rot: hash(903, 3, k) * 6.283, alpha: 0.55 * (1 - x),
      noise: hash(903, 4, k), col: [lerp(60, 0.7, x), lerp(10, 0.49, x), lerp(1, 0.35, x)], order: 0,
    })
  })
  // The burst is not on the floor yet: it is not kept inside the patch.
  for (let i = first; i < L.length; i++) L[i].clip = false
}

/** Every sprite alive `t` seconds after the patch actor appeared. */
function spritesAt(t: number): IncendiarySprite[] {
  const L: IncendiarySprite[] = []
  for (const p of SPOTS) {
    if (t < p.arrive) continue
    ignition(L, p, t)
    burning(L, p, t, 0, ACTIVE_S)
  }
  impactBurst(L, t)
  return L.sort((a, b) => a.order - b.order)
}

/** How long a patch actor lives, ms: the burn and the fade-out tail (the replays' 11.0 s). */
export const incendiaryTotalMs = (): number => TOTAL_MS

function blank(ageMs: number): IncendiaryState {
  return {
    phase: 'gone', spread: 0, hurting: false, glow: 0, glowScale: 0.5, burn: 0, impact: 0, front: 0, footprint: 0, fade: 0,
    materialTime: Math.max(0, ageMs) / 1000 || 0, sprites: [],
  }
}

/**
 * The fire `ageMs` after its patch actor appeared (a replay effect's start:
 * the grenade has come to rest). The same age always gives the same picture,
 * so a paused or scrubbed replay shows the fire as it was at that moment.
 */
export function incendiaryState(ageMs: number): IncendiaryState {
  const I = INCENDIARY
  const s = blank(ageMs)
  if (!(ageMs >= 0) || ageMs >= TOTAL_MS) return s
  const t = ageMs / 1000
  s.spread = Math.min(I.hurtCm, Math.max(0, ((ageMs - I.spreadDelayMs) * I.spreadCmPerS) / 1000)) / I.hurtCm
  s.hurting = ageMs >= I.spreadDelayMs && ageMs < I.burnMs
  const xd = ageMs / I.glowMs
  if (xd < 1) {
    s.glow = curveAt(CURVES.decalGlow, xd)
    s.glowScale = curveAt(CURVES.decalScale, xd)
    s.burn = curveAt(CURVES.decalBurn, xd)
  }
  s.sprites = spritesAt(t)
  s.phase = ageMs < I.spreadDelayMs ? 'impact' : ageMs < FULL_MS ? 'spreading' : ageMs < I.burnMs ? 'burning' : ageMs < DARK_MS ? 'dying' : 'tail'
  if (s.phase === 'impact') s.impact = 1 - ageMs / I.spreadDelayMs
  if (s.phase === 'spreading') s.front = 0.85 * (1 - 0.6 * s.spread)
  if (s.phase === 'dying') s.footprint = 0.55 * clamp01((ageMs - I.burnMs) / 400)
  if (s.phase === 'tail') {
    s.fade = (ageMs - DARK_MS) / (TOTAL_MS - DARK_MS)
    s.footprint = 0.55 * (1 - 0.5 * s.fade)
  }
  return s
}

/** A placed fire's flames run round this stretch of the burn, seconds: after the last spot has caught, to the end. */
const IDLE_FROM_S = 2.2
const IDLE_LOOP_S = ACTIVE_S - IDLE_FROM_S

/**
 * An Incendiary with no clock (placed in a strat): fully spread and burning,
 * its ground scrolling and its flames flickering at `seconds`. The flames loop
 * without a seam: one alive as the stretch ends carries on into its start.
 */
export function incendiaryIdle(seconds: number): IncendiaryState {
  const at = seconds >= 0 ? seconds : 0
  const t = IDLE_FROM_S + (at % IDLE_LOOP_S)
  const to = IDLE_FROM_S + IDLE_LOOP_S
  const L: IncendiarySprite[] = []
  for (const p of SPOTS) {
    burning(L, p, t, IDLE_FROM_S, to)
    burning(L, p, t + IDLE_LOOP_S, IDLE_FROM_S, to)
  }
  return {
    ...blank(0), phase: 'burning', spread: 1, hurting: true, glow: 1, glowScale: 1, burn: 1, materialTime: at,
    sprites: L.sort((a, b) => a.order - b.order),
  }
}

/**
 * The time the fire still hurts, for the board's countdown: `life` 1…0 over
 * the 8.0 s burn and the whole seconds left. Null once the burn is over (the
 * actor's last 3 s have no fire) and before it starts.
 */
export function incendiaryClock(ageMs: number): { life: number; seconds: number } | null {
  if (!(ageMs >= 0) || ageMs >= INCENDIARY.burnMs) return null
  const left = INCENDIARY.burnMs - ageMs
  return { life: left / INCENDIARY.burnMs, seconds: Math.ceil(left / 1000) }
}

/** True for Brimstone's Incendiary. */
export function isIncendiary(agent: string, slot: string | null): boolean {
  return slot === 'Ability1' && agent.trim().toLowerCase() === 'brimstone'
}
