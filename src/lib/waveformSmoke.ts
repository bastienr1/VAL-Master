/**
 * Miks's Waveform smoke as the game runs it, for the board's animated smoke.
 * Every figure here is read from the game files (13.10): `GameObject_Iris_E_Smoke`
 * (Miks is Iris in the files), its parent `GameObject_NewSmokeZone_Parent`, the
 * curves `Curve_Iris_E_Smoke_SmokeExpand` / `_SmokeContract`, and the effects
 * `IRIS_E_introSmoke_PS` (the announcement), `IRIS_E_SmokeProxy5_PS` (the smoke),
 * `IRIS_E_OutroSmoke_PS` and `PS_SmokeWarn` (the ending), all at the FXC's 0.82
 * scale. The replays agree: a Waveform actor lives 18.25 s on 13.05 to 13.10
 * (418 smokes; builds before 13.05 lived 17.75 s). There is one mode only: no
 * after-death variant in the files.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `waveformSmokeGl.ts`, prototyped in VAL-Master-Plays/prototypes/waveform-smoke.
 */

export const WAVEFORM = {
  /** The sphere that blocks sight, world cm: HollowVisionBlockingSphere 0.026 × VisionBlockingSphere 410 × mesh radius 37.32. */
  visionCm: 397.8,
  /** The shell that is seen, world cm: Exterior_Sphere, Wraith_Dome 50.05 cm × size 10 × 0.82. */
  shellCm: 410.4,
  /** The wave-line shell, world cm: OuterLines, Wraith_Dome × 10.2 × 0.82. */
  linesCm: 418.6,
  /** The rim sparks' orbit, world cm: PentaBokeh Orbit 475 to 525 × 0.82. */
  sparkCm: [389.5, 430.5] as readonly [number, number],
  /** The ending's outer warning triangles, world cm: EndTelegraph Extra Triangle Radius (no 0.82). */
  warnTriangleCm: 460,
  /** SmokeDelayTime: it is announced, not yet there. */
  delayMs: 1000,
  /** SmokeExpandDuration. */
  expandMs: 750,
  /** SmokeDuration, from the end of the delay. */
  durationMs: 16250,
  /** SmokeContractDuration. */
  contractMs: 1000,
  /** SmokeEndTelegraphDuration (parent): the warning before it goes. */
  endWarnMs: 1500,
  /** Curve_Iris_E_Smoke_SmokeExpand: nothing until 40 % of the expand, full at 45 %. */
  sightOn: 0.4,
  sightFull: 0.45,
  /** Curve_Iris_E_Smoke_SmokeContract: whole until 62 % of the contract, then gone. */
  sightOff: 0.62,
  /** Exterior_Sphere Dissolve −1 → 1 over this long (table TimeScale 1/0.85). */
  dissolveInMs: 850,
  /** OuterLines: EmitterDelay 0.4 s, Bands −4 → 1 over 0.85 s, alpha 0 → 1 over 3 % of a 60 s life. */
  linesDelayMs: 400,
  linesBandsMs: 850,
  linesFadeInMs: 1800,
  /** PS_SmokeWarn lives 2.45 s (FXC Lifetime). */
  warnLifeMs: 2450,
} as const

export type WaveformPhase = 'incoming' | 'forming' | 'active' | 'ending' | 'dissolving' | 'gone'

/** A torus ring of the announcement, world cm. */
export interface WaveformRing { r: number; width: number; opacity: number; /** 0…1 of its life: gold at 0, purple at 1. */ life: number }
/** One of the ending's cyan triangles, world cm and degrees. */
export interface WaveformTriangle { x: number; y: number; size: number; rotate: number; opacity: number }

export interface WaveformState {
  phase: WaveformPhase
  /** How much of its sight-blocking radius is up, 0…1. */
  vision: number
  /** 1 while there is anything to paint, 0 when there is nothing. */
  scale: number
  /** The shell's Dissolve parameter: −1 none of it, 1 all of it. */
  dissolve: number
  /** The warning before it ends, 0…1; 0 when there is none. */
  warn: number
  /** The landing glow (GlowGrow), 1…0; 0 when there is none. */
  flash: number
  /** Seconds the smoke's own textures have been drifting. */
  materialTime: number
  /** The bright wipe band: radius in shell radii (−1 none), strength, 1 outward (forming) or −1 inward (ending). */
  wipeR: number
  wipeA: number
  wipeDir: 1 | -1
  /** The wave lines: strength 0…1 and the Bands reveal −4…1. */
  linesA: number
  bands: number
  /** The announcement's indicator sphere: radius in shell radii and strength. */
  ind: number
  indA: number
  /** The landing shockwave on the ground: radius in shell radii and strength. */
  shockR: number
  shockA: number
  /** The landing glow's radius in shell radii and strength. */
  glowR: number
  glowA: number
  /** The smoke-edge decal on the ground: growth 0…1 and strength. */
  decalR: number
  decalA: number
  /** The cyan warning dome (PS_SmokeWarn), 0…1. */
  warnGlow: number
  rings: WaveformRing[]
  triangles: WaveformTriangle[]
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const hash = (i: number, k: number) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return s - Math.floor(s)
}
/** A Cascade lookup table: values spread evenly over [0, 1] of the particle's life. */
function table(values: readonly number[], f: number): number {
  const at = clamp01(f) * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(at))
  return lerp(values[i], values[i + 1], at - i)
}

const IND_SIZE = [0.006, 0.404, 0.694, 0.873, 0.966, 1.013, 1.03, 1.032]
const IND_ALPHA = [1, 0.631, 0.259, 0.064, 0.038, 0.017, 0.005, 0]
const DECAL_GROW = [0, 0.324, 0.571, 0.751, 0.875, 0.951, 0.989, 1]
const SHOCK_SIZE = [0.5, 0.667, 0.833, 0.996, 1.008, 1.017, 1.025, 1.033, 1.042, 1.05, 1.058, 1.067, 1.075, 1.083, 1.092, 1.1]
const SHOCK_ALPHA = [0, 0.069, 0.212, 0.331, 0.331, 0.212, 0.069, 0]
const GLOW_SIZE = [0, 0.055, 0.198, 0.394, 0.606, 0.802, 0.945, 1]
const WARN_DOME = [0.04, 0.086, 0.246, 0.491, 0.789, 1.11, 1.423, 1.696]

/** `Curve_Iris_E_Smoke_SmokeExpand`, x as a share of the expand. */
export function waveformExpand(x: number): number {
  if (x < WAVEFORM.sightOn) return 0
  return x >= WAVEFORM.sightFull ? 1 : (x - WAVEFORM.sightOn) / (WAVEFORM.sightFull - WAVEFORM.sightOn)
}

/** `Curve_Iris_E_Smoke_SmokeContract`, x as a share of the contract. */
export const waveformContract = (x: number): number => (x <= WAVEFORM.sightOff ? 1 : 0)

/** How long a Waveform actor lives, ms: delay, duration, contract. */
export const waveformTotalMs = (): number => WAVEFORM.delayMs + WAVEFORM.durationMs + WAVEFORM.contractMs

function blank(materialTime: number): WaveformState {
  return {
    phase: 'gone', vision: 0, scale: 0, dissolve: -1, warn: 0, flash: 0, materialTime,
    wipeR: -1, wipeA: 0, wipeDir: 1, linesA: 0, bands: -4, ind: 0, indA: 0, shockR: 0, shockA: 0,
    glowR: 0, glowA: 0, decalR: 0, decalA: 0, warnGlow: 0, rings: [], triangles: [],
  }
}

/**
 * The smoke `ageMs` after its actor appeared (a replay effect's start). The
 * same age always gives the same picture, so a paused or scrubbed replay shows
 * the smoke as it was at that moment.
 */
export function waveformState(ageMs: number): WaveformState {
  const { delayMs, expandMs, durationMs, contractMs, endWarnMs, shellCm, linesCm } = WAVEFORM
  const end = delayMs + durationMs
  const t = ageMs / 1000
  const s = blank(Math.max(0, t))
  if (!(ageMs >= 0) || ageMs >= end + contractMs) return s
  s.scale = 1
  const linesR = linesCm / shellCm

  // IRIS_E_introSmoke_PS, from the actor's start: two torus rings from 0.1 s (sizes 25 and 50).
  for (const [size, life] of [[25, 1.0], [50, 1.15]] as const) {
    const f = (t - 0.1) / life
    if (f < 0 || f >= 1) continue
    const m = f < 0.2 ? f * 4 : 0.8 + (f - 0.2) * 5.25
    s.rings.push({ r: 0.5 * size * m * 0.82, width: 0.1 * size * m * 0.82, opacity: 1 - f, life: f })
  }
  if (t >= 0.8 && t < 1.5) {
    // Inverse_Depth: the indicator sphere grows out to the footprint.
    const f = (t - 0.8) / 0.7
    s.ind = table(IND_SIZE, f)
    s.indA = f < 0.5 ? 1 : table(IND_ALPHA, (f - 0.5) / 0.5)
  }
  if (t >= 1.0 && t < 1.5) {
    // GlowGrow, the InnerDecal shockwave and the OuterDecal edge, as it lands.
    const f = (t - 1.0) / 0.5
    s.glowR = (82 / shellCm) * table(GLOW_SIZE, f / 0.2)
    s.glowA = 0.25 * (2 - table(GLOW_SIZE, f)) * (f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2)
    s.flash = 1 - f
    s.shockR = (410 / shellCm) * table(SHOCK_SIZE, f)
    s.shockA = table(SHOCK_ALPHA, f) * (1 - f)
    s.decalR = table(DECAL_GROW, f)
    s.decalA = lerp(1, 0.4, f)
  }

  if (ageMs < delayMs) {
    s.phase = 'incoming'
    return s
  }

  if (ageMs < end) {
    // IRIS_E_SmokeProxy5_PS, from the end of the delay.
    const sinceMs = ageMs - delayMs
    const e = sinceMs / 1000
    s.vision = waveformExpand(sinceMs / expandMs)
    s.phase = sinceMs < expandMs ? 'forming' : ageMs >= end - endWarnMs ? 'ending' : 'active'
    s.dissolve = lerp(-1, 1, clamp01(sinceMs / WAVEFORM.dissolveInMs))
    if (e < 0.5) {
      s.wipeR = linesR * clamp01((lerp(-0.8, 1.5, e) + 0.8) / 1.15)
      s.wipeA = e < 0.4 ? 1 : 1 - (e - 0.4) / 0.1
    }
    if (sinceMs >= WAVEFORM.linesDelayMs) {
      const le = sinceMs - WAVEFORM.linesDelayMs
      s.linesA = clamp01(le / WAVEFORM.linesFadeInMs)
      s.bands = lerp(-4, 1, clamp01(le / WAVEFORM.linesBandsMs))
    }
    if (e >= 0.3) {
      s.decalR = 1
      s.decalA = 1
    }
    if (s.phase === 'ending') s.warn = (ageMs - (end - endWarnMs)) / endWarnMs
  } else {
    // IRIS_E_OutroSmoke_PS: the shell dissolves back over the contract.
    const o = (ageMs - end) / contractMs
    s.phase = 'dissolving'
    s.vision = waveformContract(o)
    s.dissolve = lerp(1, -1, o)
    s.wipeR = linesR * clamp01((lerp(1.35, -1, o) + 0.8) / 1.15)
    s.wipeA = o < 0.85 ? 1 : (1 - o) / 0.15
    s.wipeDir = -1
    s.linesA = clamp01(1 - o / 0.5)
    s.bands = 1
    s.decalR = 1
    s.decalA = clamp01(1 - (ageMs - end) / 600)
    s.warn = 1
  }

  // FXC_Iris_E_GameObject_Smoke_EndTelegraph (PS_SmokeWarn), from end − 1.5 s for 2.45 s.
  const w = (ageMs - (end - endWarnMs)) / 1000
  if (w >= 0) {
    s.warnGlow = table(WARN_DOME, w / (WAVEFORM.warnLifeMs / 1000)) / 1.696
    // The two Extra Triangles emitters: a burst of 10 each, then one a second; the inner ones sit inside the shell.
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 12; i++) {
        const born = 0.1 + (i < 10 ? 0 : i - 9)
        const id = k * 31 + i
        const life = 1 + 0.9 * hash(id, 21)
        const f = (w - born) / life
        if (f < 0 || f >= 1) continue
        const cz = 2 * hash(id, 22) - 1
        const angle = 6.2832 * hash(id, 23)
        const drag = k ? 2.55 : 1.5
        const tau = w - born
        const rr = (WAVEFORM.warnTriangleCm + (80 / drag) * (1 - Math.exp(-drag * tau))) * Math.sqrt(1 - cz * cz)
        s.triangles.push({
          x: rr * Math.cos(angle),
          y: rr * Math.sin(angle),
          size: (35 + 15 * hash(id, 24)) * lerp(0.2, 1.1, f),
          rotate: 360 * (hash(id, 25) + (k ? 1 : -1) * (0.1 + 0.3 * hash(id, 26)) * tau),
          opacity: Math.min(1, 0.75 * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85)),
        })
      }
    }
  }
  return s
}

/** A Waveform with no clock (placed in a strat): formed and whole, its textures at `seconds`. */
export function waveformIdle(seconds: number): WaveformState {
  return { ...blank(seconds), phase: 'active', vision: 1, scale: 1, dissolve: 1, linesA: 1, bands: 1, decalR: 1, decalA: 1 }
}

/** True for Miks's Waveform. */
export function isWaveform(agent: string, slot: string | null): boolean {
  return slot === 'Ability2' && agent.trim().toLowerCase() === 'miks'
}
