/**
 * Phoenix's Hot Hands as the game runs it, for the board's animated fire.
 * Every figure here is read from the game files (13.10): the patch actor
 * `Patch_Phoenix_MolotovFire` and its parent `Patch_Molotovs_Parent`, the buffs
 * `Buff_Phoenix_4_FireDamage_NewMolotov` and `Buff_Phoenix_4_HealingFire_Production`,
 * and the effects `Phoenix_4_FireGround` (BirthFlamesGround, LoopFlamesGround),
 * `ps_solarDecal` (Decal_FireGround) and `Phoenix_4_3p_Explosion`. The replays
 * agree: the patch actor lives 7.2 s (median 7.20 s over 297).
 *
 * The clock starts when the patch actor appears: the fireball has just landed.
 * The fire hurts (and heals Phoenix) for the first 4.2 s only; the last 3 s of
 * the actor are its fade. The cooked blueprint has no node graph, so that
 * switch-off point is inferred from FireActiveDuration.
 *
 * Pure and free of imports, so `node --test` can run it; the drawing is in
 * `hotHandsGl.ts`. The prototype it was ported from:
 * VAL-Master-Plays/prototypes/hot-hands.
 */

export const HOT_HANDS = {
  /** Where the fire hurts, world cm: Patch_Phoenix_MolotovFire ClampedRadius 475 (overrides Patch_Molotovs_Parent's 450). */
  radiusCm: 475,
  /** Patch_Molotovs_Parent SpreadSpeed, cm a second: the full radius 0.79 s after landing. */
  spreadCmS: 600,
  /** Patch_Phoenix_MolotovFire FireActiveDuration 4.2 (parent 8.0): damage and heal stop here. */
  burnMs: 4200,
  /** Patch_Molotovs_Parent FadeOutDuration 3.0: then the actor is destroyed. */
  fadeMs: 3000,
  /** ps_solarDecal Decal_FireGround Lifetime 5.0: the glow on the ground. */
  decalLifeMs: 5000,
  /** Its opacity parameter holds 0.7, then falls to 0 over the last 2/7 of its life: from 3.57 s. */
  decalDimFromMs: (5000 * 5) / 7,
  /** Patch_Molotovs_Parent DecalRadiusMultiplier: the decal box is this many radii. */
  decalBox: 1.111,
  /** Phoenix_4_FireGround LoopFlamesGround: EmitterDelay 0.6, a flame every 1.2 s, each living 1.0 to 1.5 s. */
  flameDelayMs: 600,
  flameLoopMs: 1200,
  flameLifeMs: [1000, 1500],
  /** Phoenix_4_FireGround BirthFlamesGround: the first flames live 0.5 to 0.6 s. */
  birthLifeMs: [500, 600],
  /** Phoenix_4_3p_Explosion: the landing flash, a 350 cm sprite growing × 0.2 → 1.2 over 0.4 s. */
  flashMs: 400,
  flashCm: 350,
  /** Patch_Molotovs_Parent spawn settings: flames stand on a 200 cm grid at density 2, each nudged 2 to 10 cm. */
  siteGridCm: 100,
  siteNudgeCm: [2, 10],
  /** Buff_Phoenix_4_FireDamage_NewMolotov: 1 damage per tick, Period 0.016667 s (60 a second), first tick on entry. */
  damagePerS: 60,
  /** Buff_Phoenix_4_HealingFire_Production ← Buff_Phoenix_HealingFire_Production: 1 HP per 0.163 s for Phoenix. */
  healTickMs: 163,
} as const

export type HotHandsPhase = 'spreading' | 'burning' | 'ending' | 'dying' | 'out' | 'gone'

/** One flame, laid flat from its foot outward (from straight above an upright flame is only its top). */
export interface HotHandsFlame {
  /** Its foot, cm from the landing point (+y down the map). */
  x: number
  y: number
  /** Length and width, cm. */
  len: number
  wid: number
  /** The way it lies, radians. */
  ang: number
  /** Texture offset. */
  seed: number
  /** Opacity, 0…1. */
  alpha: number
  /** The erosion that eats it as it ages: 1 whole … 0 gone. */
  outro: number
  /** The erosion that opens it at birth: 1 closed … 0 open. */
  intro: number
  /** 1 for the first flames (BirthFlamesGround), 0 for the looping ones. */
  birth: 0 | 1
}

export interface HotHandsState {
  phase: HotHandsPhase
  /** How far the fire has spread, 0…1 of its radius. */
  spread: number
  /** The spread front, world cm. */
  frontCm: number
  /** Whether it still hurts (and heals Phoenix). */
  burning: boolean
  /** How much of the burn is left, 1…0 over its 4.2 s; 0 once it no longer hurts. */
  burn: number
  /** The ground fire's opacity, 0…1 (the decal's opacity parameter over its 0.7). */
  decal: number
  /** The decal's heat parameter: born at 6.1, 1 at the end of its life. */
  heat: number
  /** The landing flash, 0…1 through its life; −1 when there is none. */
  flash: number
  /** The flames alive now, oldest sites first. */
  flames: HotHandsFlame[]
  /** The actor's fade after the burn, 0…1 over its 3 s; 0 before it. */
  fade: number
  /** Seconds the fire's textures have been scrolling. */
  materialTime: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3

/** An evenly sampled curve from a particle module, read at x in 0…1. */
function sample(table: readonly number[], x: number): number {
  const at = clamp01(x) * (table.length - 1)
  const i = Math.min(table.length - 2, Math.floor(at))
  return lerp(table[i], table[i + 1], at - i)
}

/** ps_solarDecal dynamic parameter 0 (opacity) and 2 (heat) over the decal's life. */
const DECAL_OPACITY = [0.7, 0.7, 0.7, 0.7, 0.7, 0.698, 0.477, 0.0]
const DECAL_HEAT = [6.107, 5.11, 4.104, 3.146, 2.297, 1.616, 1.164, 1.0]
/** LoopFlamesGround and BirthFlamesGround AlphaScaleOverLife. */
const LOOP_ALPHA = [1.0, 0.983, 0.961, 0.901, 0.77, 0.503, 0.165, 0.0]
const BIRTH_ALPHA = [1.0, 0.994, 0.981, 0.829, 0.434, 0.161, 0.062, 0.0]
/** Their AlphaErosionOutro. */
const LOOP_OUTRO = [1.0, 0.839, 0.677, 0.516, 0.355, 0.194, 0.032, 0.0]
const BIRTH_OUTRO = [1.0, 0.667, 0.333, 0.009, 0.0, 0.0, 0.0, 0.0]

/** A value in 0…1 that is always the same for the same inputs. */
function rnd(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}

interface Site { id: number; x: number; y: number; r: number; born: number; ang: number }

const SPREAD_S = HOT_HANDS.radiusCm / HOT_HANDS.spreadCmS
const BURN_S = HOT_HANDS.burnMs / 1000
const FLAME_DELAY_S = HOT_HANDS.flameDelayMs / 1000
const FLAME_LOOP_S = HOT_HANDS.flameLoopMs / 1000
/** The look of a fire with no clock: the burn at its half. */
const IDLE_AT_S = BURN_S / 2

/**
 * Where flames stand: the patch's particle grid, half of the points used, each
 * nudged 2 to 10 cm. A site lights when the spread reaches it.
 */
const SITES: readonly Site[] = (() => {
  const out: Site[] = []
  const grid = HOT_HANDS.siteGridCm
  for (let gx = -4; gx <= 4; gx++) {
    for (let gy = -4; gy <= 4; gy++) {
      const id = (gx + 9) * 31 + (gy + 9)
      if (rnd(id, 1) >= 0.5 && !(gx === 0 && gy === 0)) continue
      const a = rnd(id, 2) * 6.2832
      const off = lerp(HOT_HANDS.siteNudgeCm[0], HOT_HANDS.siteNudgeCm[1], rnd(id, 3))
      const x = gx * grid + Math.cos(a) * off
      const y = gy * grid + Math.sin(a) * off
      const r = Math.hypot(x, y)
      if (r > HOT_HANDS.radiusCm - 40) continue
      out.push({ id, x, y, r, born: r / HOT_HANDS.spreadCmS, ang: Math.atan2(y, x) + (rnd(id, 4) - 0.5) * 0.5 })
    }
  }
  return out
})()

/** How many places a flame can stand; at most two flames burn at one place at a time. */
export const HOT_HANDS_SITES = SITES.length

/**
 * One flame as it is drawn: BirthFlamesGround is 220–250 cm wide, LoopFlamesGround
 * 200 cm; seen from above they are laid down short. Null when the burning
 * area leaves it no room yet.
 */
function flame(site: Site, birth: boolean, age: number, seed: number, frontCm: number): HotHandsFlame | null {
  const grow = birth ? lerp(0.75, 1.15, easeOut(age * 2)) : lerp(0.85, 1.05, Math.sin(age * Math.PI))
  // Flames stay inside the burning area: the spread front, then the patch's edge.
  const room = (frontCm - 12 - site.r) / 0.85
  const len = Math.min(room, (birth ? lerp(150, 175, rnd(seed, 1)) : lerp(120, 165, rnd(seed, 1))) * grow)
  if (len < 24) return null
  const alpha = lerp(0.25, 0.5, rnd(seed, 2)) * (birth ? 2 : 2.8) * sample(birth ? BIRTH_ALPHA : LOOP_ALPHA, age)
  return {
    x: site.x,
    y: site.y,
    len,
    wid: len * (birth ? 0.62 : 0.5),
    ang: site.ang + (rnd(seed, 3) - 0.5) * 0.4,
    seed: rnd(seed, 4) * 7,
    alpha: Math.min(1, alpha),
    outro: sample(birth ? BIRTH_OUTRO : LOOP_OUTRO, age * (birth ? 1 : 0.85)),
    intro: 1 - clamp01(age / 0.12),
    birth: birth ? 1 : 0,
  }
}

/**
 * The flames alive `t` seconds after landing, with the fire out to `frontCm`.
 * No new flame starts once the burn is over (`burnS`).
 */
function flamesAt(t: number, frontCm: number, burnS: number): HotHandsFlame[] {
  const list: HotHandsFlame[] = []
  const push = (f: HotHandsFlame | null) => {
    if (f) list.push(f)
  }
  for (const s of SITES) {
    const age = t - s.born
    if (age < 0) continue
    const bl = lerp(HOT_HANDS.birthLifeMs[0], HOT_HANDS.birthLifeMs[1], rnd(s.id, 5)) / 1000
    if (age < bl) push(flame(s, true, age / bl, s.id, frontCm))
    const k = Math.floor((age - FLAME_DELAY_S) / FLAME_LOOP_S)
    for (let j = k - 1; j <= k; j++) {
      if (j < 0) continue
      const start = s.born + FLAME_DELAY_S + j * FLAME_LOOP_S
      if (start >= burnS) continue
      const life = lerp(HOT_HANDS.flameLifeMs[0], HOT_HANDS.flameLifeMs[1], rnd(s.id, 10 + j)) / 1000
      const a = (t - start) / life
      if (a >= 0 && a < 1) push(flame(s, false, a, s.id * 7 + j, frontCm))
    }
  }
  return list
}

/** How long the patch actor lives, ms: the burn and the fade (7200, as the replays record). */
export function hotHandsTotalMs(): number {
  return HOT_HANDS.burnMs + HOT_HANDS.fadeMs
}

function blank(ageMs: number): HotHandsState {
  return {
    phase: 'gone', spread: 0, frontCm: 0, burning: false, burn: 0, decal: 0, heat: 1, flash: -1, flames: [], fade: 0,
    materialTime: Math.max(0, ageMs) / 1000 || 0,
  }
}

/**
 * The fire `ageMs` after its patch actor appeared (a replay effect's start:
 * the fireball has just landed). The same age always gives the same picture,
 * so a paused or scrubbed replay shows the fire as it was at that moment.
 */
export function hotHandsState(ageMs: number): HotHandsState {
  const H = HOT_HANDS
  const s = blank(ageMs)
  if (!(ageMs >= 0) || ageMs >= hotHandsTotalMs()) return s
  const t = ageMs / 1000
  s.frontCm = Math.min(H.radiusCm, H.spreadCmS * t)
  s.spread = s.frontCm / H.radiusCm
  s.burning = ageMs < H.burnMs
  s.burn = s.burning ? 1 - ageMs / H.burnMs : 0
  s.fade = s.burning ? 0 : clamp01((ageMs - H.burnMs) / H.fadeMs)
  s.flash = ageMs < H.flashMs ? ageMs / H.flashMs : -1
  const dl = ageMs / H.decalLifeMs
  s.decal = dl < 1 ? sample(DECAL_OPACITY, dl) / 0.7 : 0
  s.heat = sample(DECAL_HEAT, dl)
  s.flames = flamesAt(t, s.frontCm, BURN_S)
  // The last flames have burnt out one flame's life after the burn.
  const flamesOutMs = H.burnMs + H.flameLifeMs[1]
  s.phase = t < SPREAD_S ? 'spreading' : ageMs < H.decalDimFromMs ? 'burning' : ageMs < H.burnMs ? 'ending' : ageMs < flamesOutMs ? 'dying' : 'out'
  return s
}

/**
 * A fire with no clock (placed in a strat): fully spread and burning, as it is
 * half-way through its burn, its flames looping and its textures at `seconds`.
 */
export function hotHandsIdle(seconds: number): HotHandsState {
  const at = Math.max(0, seconds) || 0
  return {
    ...blank(0),
    phase: 'burning',
    spread: 1,
    frontCm: HOT_HANDS.radiusCm,
    burning: true,
    burn: 1,
    decal: 1,
    heat: sample(DECAL_HEAT, (IDLE_AT_S * 1000) / HOT_HANDS.decalLifeMs),
    flames: flamesAt(IDLE_AT_S + at, HOT_HANDS.radiusCm, Infinity),
    materialTime: at,
  }
}

/**
 * The time the fire still hurts (and heals Phoenix): `life` 1…0 over the
 * 4.2 s burn and the whole seconds left. Null once the burn is over, though
 * the actor fades for 3 s more, and for a negative age.
 */
export function hotHandsClock(ageMs: number): { life: number; seconds: number } | null {
  if (!(ageMs >= 0) || ageMs >= HOT_HANDS.burnMs) return null
  const left = HOT_HANDS.burnMs - ageMs
  return { life: left / HOT_HANDS.burnMs, seconds: Math.ceil(left / 1000) }
}

/** True for Phoenix's Hot Hands. */
export function isHotHands(agent: string, slot: string | null): boolean {
  return slot === 'Ability1' && agent.trim().toLowerCase() === 'phoenix'
}
