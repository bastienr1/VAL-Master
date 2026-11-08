/**
 * What each agent ability looks like on the plays board: a utility shape and
 * an area radius in world cm. Hand-written for the current agent pool (see
 * docs/plays-editor-v2.md section 4), covering every playable agent; unknown
 * agents fall back to a generic marker.
 *
 * Area radii from valorant.fandom.com, checked 2026-11-08: the ability's
 * "Radius" stat (the outer one when it has two), or half the width for lines,
 * waves and cones. Values marked "not found, estimate" are not on the wiki.
 *
 * Kept free of gameContent.ts (and Vite) so `node --test` can run it.
 */

// These mirror `AbilitySlot` and `UtilityKind` in playDoc.ts; they are
// declared here so this file has no dependency on it.
export type AbilitySlot = 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'
export type Shape =
  | 'smoke' | 'flash' | 'molly' | 'recon' | 'wall' | 'trap'
  | 'drone' | 'stun' | 'slow' | 'ult' | 'other'

export interface AbilityShape {
  shape: Shape
  radius: number
}

/** In-game keybind for each slot, in the order they sit on the HUD. */
export const SLOT_KEYS: Record<AbilitySlot, 'C' | 'Q' | 'E' | 'X'> = {
  Grenade: 'C',
  Ability1: 'Q',
  Ability2: 'E',
  Ultimate: 'X',
}

export const SLOT_ORDER: AbilitySlot[] = ['Grenade', 'Ability1', 'Ability2', 'Ultimate']

/** Radius used when the table names a shape but no size. */
const DEFAULT_RADIUS: Record<Shape, number> = {
  smoke: 350,
  flash: 120,
  molly: 200,
  recon: 80,
  wall: 500,
  trap: 100,
  drone: 150,
  stun: 300,
  slow: 300,
  ult: 200,
  other: 120,
}

type Entry = Shape | [Shape, number]

/**
 * Lower-cased agent name → slot → shape (optionally with a radius). Slots are
 * valorant-api's `abilities[].slot` for the named ability (= the C/Q/E/X key),
 * e.g. Jett's Cloudburst is `Grenade` and Sova's Shock Bolt is `Ability1`.
 * Every playable agent has all four slots; 'other' is kept for movement and
 * buffs, 'ult' for ultimates that are not an area.
 */
const TABLE: Record<string, Record<AbilitySlot, Entry>> = {
  // Gravity Well 4.75 m, Nova Pulse 4.75 m, Nebula 4.75 m.
  astra: { Grenade: ['slow', 475], Ability1: ['stun', 475], Ability2: ['smoke', 475], Ultimate: 'wall' },
  // Aftershock 3 m cylinder radius; Fault Line 8 m wide and Rolling Thunder
  // 18 m wide (lines: half the width).
  breach: { Grenade: ['molly', 300], Ability1: 'flash', Ability2: ['stun', 400], Ultimate: ['stun', 900] },
  // Incendiary 4.5 m, Sky Smoke 4.15 m, Orbital Strike 9 m.
  brimstone: { Grenade: ['other', 250], Ability1: ['molly', 450], Ability2: ['smoke', 415], Ultimate: ['molly', 900] },
  chamber: { Grenade: ['trap', 250], Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  // Meddle 4 m, Ruse 4 m.
  clove: { Grenade: 'other', Ability1: ['stun', 400], Ability2: ['smoke', 400], Ultimate: 'ult' },
  // Cyber Cage 3.72 m.
  cypher: { Grenade: 'trap', Ability1: ['smoke', 372], Ability2: 'recon', Ultimate: 'other' },
  // GravNet 6.5 m.
  deadlock: { Grenade: 'wall', Ability1: ['trap', 250], Ability2: ['slow', 650], Ultimate: 'ult' },
  // Seize 6.58 m; Nightfall 20 m wide (half the width).
  fade: { Grenade: 'drone', Ability1: ['molly', 658], Ability2: 'recon', Ultimate: ['stun', 1000] },
  // Mosh Pit 6.2 m outer.
  gekko: { Grenade: ['molly', 620], Ability1: 'drone', Ability2: 'flash', Ultimate: 'drone' },
  // Storm Surge 6 m, Cove 4.6 m; Reckoning a wave 21 m wide (half the width).
  harbor: { Grenade: ['slow', 600], Ability1: 'wall', Ability2: ['smoke', 460], Ultimate: ['stun', 1050] },
  // Flashbulb is a thrown flash; Displacement pulls players in and concusses
  // on impact; Flow is a self-reposition; Suspension levitates everyone in a zone.
  // Not on the wiki yet: Displacement and Suspension are estimates.
  hush: { Grenade: 'other', Ability1: 'flash', Ability2: ['stun', 250], Ultimate: ['stun', 400] }, // not found, estimate
  iso: { Grenade: 'wall', Ability1: 'stun', Ability2: 'other', Ultimate: 'ult' },
  // Cloudburst 3.35 m.
  jett: { Grenade: ['smoke', 335], Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  // FRAG/ment 4 m outer, ZERO/point 15 m, NULL/cmd 42.5 m.
  'kay/o': { Grenade: ['molly', 400], Ability1: 'flash', Ability2: ['stun', 1500], Ultimate: ['stun', 4250] },
  // Nanoswarm 4.5 m, Lockdown 32.5 m.
  killjoy: { Grenade: ['molly', 450], Ability1: 'trap', Ability2: 'trap', Ultimate: ['stun', 3250] },
  // M-Pulse pulses concuss (or heal) around where it lands; Waveform casts
  // smokes; Harmonize is an ally buff; Bassquake is a deafen/knockback/slow zone.
  // M-Pulse 5.5 m, Waveform 4.72 m; Bassquake is a 40 m, 60 degree cone with
  // no single radius.
  miks: { Grenade: ['stun', 550], Ability1: 'other', Ability2: ['smoke', 472], Ultimate: ['stun', 600] }, // Bassquake: not found, estimate
  // Relay Bolt 5 m.
  neon: { Grenade: 'wall', Ability1: ['stun', 500], Ability2: 'other', Ultimate: 'ult' },
  // Dark Cover 4.1 m.
  omen: { Grenade: 'other', Ability1: 'flash', Ability2: ['smoke', 410], Ultimate: 'ult' },
  // Hot Hands 4.5 m.
  phoenix: { Grenade: 'wall', Ability1: ['molly', 450], Ability2: 'flash', Ultimate: 'ult' },
  // Paint Shells 5.5 m outer, Showstopper 7 m outer.
  raze: { Grenade: 'drone', Ability1: 'other', Ability2: ['molly', 550], Ultimate: ['molly', 700] },
  reyna: { Grenade: 'flash', Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  // The wiki gives Slow Orb no radius: estimated from the other slows (6 to 6.5 m).
  sage: { Grenade: 'wall', Ability1: ['slow', 600], Ability2: 'other', Ultimate: 'ult' }, // not found, estimate
  skye: { Grenade: 'other', Ability1: 'drone', Ability2: 'flash', Ultimate: 'drone' },
  // Shock Bolt 4 m outer.
  sova: { Grenade: 'drone', Ability1: ['molly', 400], Ability2: 'recon', Ultimate: 'wall' },
  // Special Delivery 5.25 m outer, Guided Salvo 4.5 m outer; Armageddon a
  // strip 12 m wide (half the width).
  tejo: { Grenade: 'drone', Ability1: ['stun', 525], Ability2: ['molly', 450], Ultimate: ['molly', 600] },
  // Crosscut is a teleport anchor; Chokehold and Interceptor are placed devices
  // that act on enemies in range; Evolution is a self-buff.
  veto: { Grenade: 'other', Ability1: 'trap', Ability2: 'trap', Ultimate: 'ult' },
  // Snake Bite 4.5 m, Poison Cloud 4.5 m, Viper's Pit 9 m maximum.
  viper: { Grenade: ['molly', 450], Ability1: ['smoke', 450], Ability2: 'wall', Ultimate: ['smoke', 900] },
  // Razorvine 6.25 m, Steel Garden 28 m.
  vyse: { Grenade: ['slow', 625], Ability1: 'trap', Ability2: 'flash', Ultimate: ['stun', 2800] },
  // Saturate 6 m; Convergent Paths 36 x 13.5 m (half the width).
  waylay: { Grenade: ['stun', 600], Ability1: 'other', Ability2: 'other', Ultimate: ['stun', 675] },
  yoru: { Grenade: 'drone', Ability1: 'flash', Ability2: 'other', Ultimate: 'ult' },
}

/** True when the table has its own entry for this pair (no fallback). */
export function hasAbilityShape(agentName: string, slot: AbilitySlot): boolean {
  return TABLE[agentName.trim().toLowerCase()]?.[slot] !== undefined
}

/** The board shape for one ability. Unknown pairs → other 120; unlisted ultimates → ult 200. */
export function abilityShape(agentName: string, slot: AbilitySlot): AbilityShape {
  const entry = TABLE[agentName.trim().toLowerCase()]?.[slot]
  if (entry === undefined) {
    return slot === 'Ultimate' ? { shape: 'ult', radius: DEFAULT_RADIUS.ult } : { shape: 'other', radius: DEFAULT_RADIUS.other }
  }
  if (typeof entry === 'string') return { shape: entry, radius: DEFAULT_RADIUS[entry] }
  return { shape: entry[0], radius: entry[1] }
}
