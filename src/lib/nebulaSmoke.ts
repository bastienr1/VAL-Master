/**
 * Astra's Nebula as the game runs it, for the board's animated smoke. Every
 * figure here is read from the game files (13.10): `GameObject_Rift_E_SmokeZone`
 * and `GameObject_Rift_E_SmokeZone_Fake` (Dissipate: the short fake left when a
 * star is recalled), their parent `GameObject_NewSmokeZone_Parent`, the curves
 * `Curve_Rift_4_SmokeExpand` / `Curve_Rift_4_SmokeContract`, and the effects
 * `Nebula` / `Nebula_Outro` (spawned at FXC scale 1.19). The replays agree: a
 * Nebula actor lives 15.5 s (median 15.496 s over 62), a Dissipate 2.25 s
 * (median 2.244 s over 17).
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `nebulaSmokeGl.ts`. The prototype it was ported from:
 * VAL-Master-Plays/prototypes/nebula-smoke.
 */

export type NebulaCast = 'nebula' | 'dissipate'

export const NEBULA = {
  /** The sphere that blocks sight, world cm: HollowVisionBlockingSphere 0.0265 × VisionBlockingSphere 475 × the hollow mesh's 37.32. */
  visionCm: 469.8,
  /** Dissipate keeps the parent's hollow-sphere scale: 0.02683 × 475 × 37.32. */
  dissipateVisionCm: 475.6,
  /** VisionBlockingSphere 1 × 475 (both classes override the parent's 410): the radius the code calls the smoke's. */
  zoneCm: 475,
  /** The shell that is seen, world cm: Sphere_Mesh 44.17 × (10.16 − 1.069) × 1.19. */
  shellCm: 477.9,
  /** The filament rings, world cm: Ring_Mesh 46.58 × (10 − 1.069) × 1.19 (Base_Ring, Halo_Ring and the orbits). */
  ringCm: 495.1,
  /** The rings of the outro: Ring_Mesh 46.58 × (10 − 1.173) × 1.19. */
  outroRingCm: 489.3,
  /** The outro shell: Sphere_Mesh 44.17 × (10.16 − 1.173) × 1.19. */
  outroShellCm: 472.5,
  /** The wreath (Smoke_Ring 175.1…227.5 cm × (3.225 − 1.069) × 1.19), inner and outer edge, world cm. */
  wreathCm: [449.3, 583.6],
  /** The outro wreath is (3.2 − 1.173) × 1.19 instead of 2.566. */
  outroWreathShare: 2.4126 / 2.5655,
  /** The star bursts before the shell drops in: the shells' EmitterDelay. */
  burstMs: 250,
  /** SmokeExpandDuration (SmokeDelayTime is 0: it forms from the first frame). */
  expandMs: 750,
  /** SmokeDuration: 15.0 (parent), 1.75 (_Fake). */
  durationMs: { nebula: 15000, dissipate: 1750 } as Record<NebulaCast, number>,
  /** SmokeContractDuration. */
  contractMs: 500,
  /** The outro shells' life in Nebula_Outro. */
  outroMs: 350,
  /** SmokeEndTelegraphDuration: 1.5 s, none for Dissipate. */
  endWarnMs: { nebula: 1500, dissipate: 0 } as Record<NebulaCast, number>,
} as const

export type NebulaPhase = 'burst' | 'forming' | 'active' | 'ending' | 'out' | 'gone'

export interface NebulaOrbit {
  /** The ring's normal, a unit vector (z up). */
  n: readonly [number, number, number]
  alpha: number
  /** Seconds since it spawned. */
  age: number
}

export interface NebulaState {
  phase: NebulaPhase
  /** How much of its sight-blocking radius is up, 0…1. */
  vision: number
  /** The shell's radius as a share of `shellCm`; 0 draws nothing. */
  scale: number
  /** The material's Glow, Fresnel multiplier and Twirl (dynamic parameters; 1, 1, 1 at rest). */
  glow: number
  fresnel: number
  twirl: number
  /** How much of the shell the outro has eaten, 0 (whole) … 1 (gone). */
  dissolve: number
  /** 1 while the outro shell is drawn. */
  out: 0 | 1
  /** The dark wreath round the shell: size as a share of its own resting size, alpha, and how much colour is left. */
  wreath: { scale: number; alpha: number; dark: number }
  /** The ring that opens (and closes) the smoke: radius as a share of `ringCm`, brightness, alpha. */
  ring: { scale: number; bright: number; alpha: number }
  /** The steady ring on the ground, 0…1. */
  baseRing: number
  /** The tilted filament rings alive now (at most two). */
  orbits: NebulaOrbit[]
  /** The star's burst: flash radius (cm), intensity, flare radius (cm), intensity. */
  flash: readonly [number, number, number, number]
  /** The twisting threads: age 0…1, alpha. */
  threads: readonly [number, number]
  /** The warning before it ends, 0…1; 0 when there is none. */
  warn: number
  /** Seconds the smoke's own textures have been drifting. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/** A cooked Cascade lookup table: index = (f − bias) × scale, linear between entries. */
function table(values: readonly number[], scale: number, bias: number, f: number): number {
  const n = values.length
  const x = Math.min(n - 1, Math.max(0, (f - bias) * scale))
  const i = Math.floor(x)
  return i >= n - 1 ? values[n - 1] : lerp(values[i], values[i + 1], x - i)
}

interface Key { t: number; v: number; mode: 'linear' | 'constant' | 'cubic'; leave: number; arrive: number }

/** An Unreal float curve (linear, constant and cubic keys) as stored in the files. */
function curve(keys: readonly Key[], x: number): number {
  if (x <= keys[0].t) return keys[0].v
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (x > b.t) continue
    const d = b.t - a.t
    const u = (x - a.t) / d
    if (a.mode === 'constant') return a.v
    if (a.mode === 'linear') return lerp(a.v, b.v, u)
    const u2 = u * u
    const u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * d * a.leave + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * d * b.arrive
  }
  return keys[keys.length - 1].v
}

/** `Curve_Rift_4_SmokeExpand`: nothing for the first 32.5 %, then it snaps open. */
const EXPAND: readonly Key[] = [
  { t: 0.325, v: 0, mode: 'cubic', leave: 11.812533, arrive: 11.812533 },
  { t: 0.4, v: 0.35000005, mode: 'linear', leave: 0, arrive: 0 },
  { t: 0.53462887, v: 0.95000005, mode: 'cubic', leave: 4.9535637, arrive: 4.9535637 },
  { t: 1, v: 1, mode: 'cubic', leave: 0.66346663, arrive: 0 },
]

/** `Curve_Rift_4_SmokeContract`: eases to 0.78, then gone at 71.1 %. */
const CONTRACT: readonly Key[] = [
  { t: 0, v: 1, mode: 'linear', leave: 0, arrive: 0 },
  { t: 0.1, v: 1.0000001, mode: 'cubic', leave: -1.3139176, arrive: -1.3139176 },
  { t: 0.71, v: 0.78, mode: 'constant', leave: 0, arrive: 0 },
  { t: 0.711, v: 1.2563301e-8, mode: 'linear', leave: 0, arrive: 0 },
]

export const nebulaExpand = (x: number): number => curve(EXPAND, x)
export const nebulaContract = (x: number): number => curve(CONTRACT, x)

/** Particle curves of `Nebula` / `Nebula_Outro`, as cooked. */
const T = {
  /** Outer_Shell_Intro SizeMultiplyLife (XY), TimeScale 15. */
  introXY: [0.2, 0.2589, 0.4102, 0.6173, 0.8431, 1.0504, 1.2024, 1.2688, 1.2834, 1.2653, 1.2238, 1.1686, 1.1091, 1.0548, 1.0153, 1.0],
  /** FresnelMult, TimeScale 7.7778, bias 0.1. */
  introFres: [0.3, 0.5314, 0.7629, 0.9943, 1.1929, 1.1286, 1.0643, 1.0],
  /** Twirl, TimeScale 31. */
  introTwirl: [-16.3394, -14.7712, -13.3003, -11.9236, -10.6381, -9.4406, -8.328, -7.2972, -6.3451, -5.4686, -4.6645, -3.9299, -3.2617, -2.6566, -2.1115, -1.6231, -1.1885, -0.8046, -0.4681, -0.176, 0.0748, 0.2874, 0.4648, 0.6103, 0.7271, 0.8182, 0.8867, 0.9358, 0.9685, 0.9881, 0.9975, 1.0],
  /** Wreath_Intro SizeMultiplyLife (XY), TimeScale 15. */
  wreathXY: [0.13, 0.1933, 0.3557, 0.5778, 0.8193, 1.0403, 1.2009, 1.2688, 1.2834, 1.2653, 1.2238, 1.1686, 1.1091, 1.0548, 1.0153, 1.0],
  /** Base_Ring_Intro / Halo_Ring_Intro SizeMultiplyLife, TimeScale 15.0623, bias 0.0041. */
  ringInXY: [0.5521, 0.9265, 1.2173, 1.298, 1.3185, 1.3118, 1.2853, 1.2466, 1.2033, 1.163, 1.1331, 1.1057, 1.071, 1.0367, 1.0105, 1.0],
  /** Their AlphaOverLife (and the threads'), TimeScale 31. */
  ringInAlpha: [0.5, 0.5645, 0.629, 0.6935, 0.7581, 0.8226, 0.8871, 0.9516, 1.0161, 1.0806, 1.1452, 1.2097, 1.2742, 1.3387, 1.4032, 1.4677, 1.4613, 1.3839, 1.3065, 1.229, 1.1516, 1.0742, 0.9968, 0.9194, 0.8419, 0.7645, 0.6871, 0.6097, 0.5323, 0.4548, 0.3774, 0.3],
  /** Nebula_Outro shell SizeMultiplyLife (XY), TimeScale 31. */
  outXY: [1.0, 0.9862, 0.9724, 0.9585, 0.9447, 0.9309, 0.9171, 0.9032, 0.8894, 0.8756, 0.8618, 0.8482, 0.8365, 0.8247, 0.8129, 0.8012, 0.7894, 0.7776, 0.7659, 0.7541, 0.7423, 0.7306, 0.7188, 0.707, 0.7326, 0.8136, 0.8947, 0.9757, 1.0568, 1.1379, 1.2189, 1.3],
  /** Its Twirl, TimeScale 15. */
  outTwirl: [1.0, 1.16, 1.6345, 2.4199, 3.5095, 4.899, 6.5825, 8.5551, 10.8113, 13.3458, 16.1535, 19.2287, 22.5667, 26.1614, 30.0086, 34.1016],
  /** The outro ring: SizeMultiplyLife TimeScale 17.5 bias 0.2; AlphaScaleOverLife TimeScale 10.0383 bias 0.3027. */
  ringOutXY: [1.0, 0.9743, 0.9247, 0.9036, 1.0221, 1.2243, 1.4152, 1.5],
  ringOutAlpha: [1.0, 0.9446, 0.8017, 0.6064, 0.3936, 0.1983, 0.0554, 0.0],
  /** The orbit rings' AlphaScaleOverLife, TimeScale 7. */
  orbitAlpha: [0.3, 0.7303, 0.9344, 0.9962, 0.9964, 0.9357, 0.7322, 0.3],
} as const

/** Glow: 0.5 → 19.85 → 1 over the forming shell's life (TimeScale 181.43, bias 0.3). */
const introGlow = (f: number) =>
  f < 0.3 ? 0.5 : f < 0.3 + 36 / 181.4286 ? lerp(0.5, 19.8465, ((f - 0.3) * 181.4286) / 36) : lerp(19.8504, 1, clamp01(((f - 0.3 - 37 / 181.4286) * 181.4286) / 90))
/** Glow: 1 → 18.14 over the outro shell's life (TimeScale 169.87, bias 0.2524). */
const outGlow = (f: number) => {
  const i = (f - 0.2524) * 169.8726
  return i < 8 ? 1 : i < 9 ? lerp(1, 1.3778, i - 8) : lerp(1.3778, 18.1391, Math.min(1, (i - 9) / 118))
}
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** A ring of random tilt every second, 1.5 s each: the filament orbits, `seconds` into the smoke. */
function orbitsAt(seconds: number): NebulaOrbit[] {
  const out: NebulaOrbit[] = []
  for (let k = Math.max(1, Math.floor(seconds - 1.5) + 1); k <= Math.floor(seconds); k++) {
    const age = seconds - k
    if (age < 0 || age >= 1.5) continue
    const th = Math.acos(1 - 2 * hash(k))
    const ph = 6.2831853 * hash(k + 0.5)
    out.push({ n: [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)], alpha: table(T.orbitAlpha, 7, 0, age / 1.5), age })
  }
  return out
}

/** How long a Nebula actor lives, ms: duration and contract (no delay). */
export const nebulaTotalMs = (cast: NebulaCast): number => NEBULA.durationMs[cast] + NEBULA.contractMs

function blank(ageMs: number): NebulaState {
  return {
    phase: 'gone', vision: 0, scale: 0, glow: 1, fresnel: 1, twirl: 1, dissolve: 0, out: 0,
    wreath: { scale: 0, alpha: 0, dark: 0 }, ring: { scale: 0, bright: 0, alpha: 0 }, baseRing: 0,
    orbits: [], flash: [0, 0, 0, 0], threads: [0, 0], warn: 0, materialTime: Math.max(0, ageMs) / 1000,
  }
}

/**
 * The smoke `ageMs` after its actor appeared (a replay effect's start). The
 * same age always gives the same picture, so a paused or scrubbed replay shows
 * the smoke as it was at that moment.
 */
export function nebulaState(ageMs: number, cast: NebulaCast): NebulaState {
  const { burstMs, expandMs, contractMs, outroMs } = NEBULA
  const end = NEBULA.durationMs[cast]
  const endWarn = NEBULA.endWarnMs[cast]
  const s = blank(ageMs)
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return s
  const t = ageMs / 1000
  // The star bursts: two radianite flashes (0 and 0.1 s, 0.4 s each), a flare (0.3 s), twisting threads.
  const flare = (t0: number, life: number, r0: number): [number, number] => {
    const f = (t - t0) / life
    return f < 0 || f >= 1 ? [0, 0] : [r0 * (1 + f), 1 - f * f]
  }
  const a = flare(0, 0.4, 59.5)
  const b = flare(0.1, 0.4, 59.5)
  const c = flare(0, 0.3, 119.2)
  s.flash = [Math.max(a[0], b[0]), 3 * Math.max(a[1], b[1] * 0.8), c[0], 2 * c[1]]
  if (t < 0.75) s.threads = [t / 0.75, table(T.ringInAlpha, 31, 0, t / 0.75)]
  // Base_Ring_Intro + Halo_Ring_Intro: 0.2 s in, 0.6 s life.
  if (t >= 0.2 && t < 0.8) {
    const f = (t - 0.2) / 0.6
    s.ring = { scale: table(T.ringInXY, 15.0623, 0.0041, f), bright: lerp(15, 1, f), alpha: table(T.ringInAlpha, 31, 0, f) }
  }
  if (ageMs < end) {
    s.vision = nebulaExpand(ageMs / expandMs)
    if (ageMs < burstMs) s.phase = 'burst'
    else if (ageMs < expandMs) {
      // Outer_Shell_Intro: drops from 3.5 m as a narrow column, splashes 1.28× wide, settles.
      const f = (ageMs - burstMs) / (expandMs - burstMs)
      s.phase = 'forming'
      s.scale = table(T.introXY, 15, 0, f)
      s.glow = introGlow(f)
      s.fresnel = table(T.introFres, 7.7778, 0.1, f)
      s.twirl = table(T.introTwirl, 31, 0, f)
      s.wreath = { scale: table(T.wreathXY, 15, 0, f), alpha: 0.55 * clamp01((f - 0.1) * 3.3333) * clamp01((f - 0.1) * 2.5), dark: 1 - f }
    } else {
      s.phase = end - ageMs <= endWarn ? 'ending' : 'active'
      s.scale = 1
      if (s.phase === 'ending') s.warn = (ageMs - (end - endWarn)) / endWarn
    }
    if (t >= 0.8) s.baseRing = 1
    s.orbits = orbitsAt(t)
    return s
  }
  // Out: Nebula_Outro for 0.35 s (squeeze, stretch, pop and fade); sight follows the contract curve.
  const y = ageMs - end
  s.phase = 'out'
  s.vision = nebulaContract(y / contractMs)
  s.warn = endWarn > 0 ? 1 : 0
  if (y < outroMs) {
    const f = y / outroMs
    s.scale = table(T.outXY, 31, 0, f) * (NEBULA.outroShellCm / NEBULA.shellCm)
    s.glow = outGlow(f)
    s.fresnel = 1 - f
    s.twirl = table(T.outTwirl, 15, 0, f)
    s.dissolve = f
    s.out = 1
    s.wreath = { scale: table(T.outXY, 31, 0, f) * NEBULA.outroWreathShare, alpha: 0.7714 * clamp01((f - 0.1) * 3.3333), dark: 1 - f }
  }
  const g = y / 600
  s.ring = { scale: table(T.ringOutXY, 17.5, 0.2, g) * (NEBULA.outroRingCm / NEBULA.ringCm), bright: lerp(5, 1, g), alpha: table(T.ringOutAlpha, 10.0383, 0.3027, g) }
  return s
}

/** A Nebula with no clock (placed in a strat): formed and whole, its textures and orbit rings at `seconds`. */
export function nebulaIdle(seconds: number): NebulaState {
  return { ...blank(0), phase: 'active', vision: 1, scale: 1, baseRing: 1, orbits: orbitsAt(seconds), materialTime: seconds }
}

/** True for Astra's Nebula. */
export function isNebula(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'astra'
}
