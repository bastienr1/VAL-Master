/**
 * What each agent ability looks like on the plays board: a utility shape and
 * an area radius in world cm. Hand-written for the current agent pool (see
 * docs/plays-editor-v2.md section 4), covering every playable agent; unknown
 * agents fall back to a generic marker.
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
  astra: { Grenade: ['slow', 300], Ability1: ['stun', 300], Ability2: ['smoke', 320], Ultimate: 'wall' },
  breach: { Grenade: ['molly', 150], Ability1: 'flash', Ability2: ['stun', 400], Ultimate: ['stun', 600] },
  brimstone: { Grenade: ['other', 250], Ability1: ['molly', 220], Ability2: ['smoke', 380], Ultimate: ['molly', 450] },
  chamber: { Grenade: ['trap', 250], Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  clove: { Grenade: 'other', Ability1: ['stun', 250], Ability2: ['smoke', 320], Ultimate: 'ult' },
  cypher: { Grenade: 'trap', Ability1: ['smoke', 250], Ability2: 'recon', Ultimate: 'other' },
  deadlock: { Grenade: 'wall', Ability1: ['trap', 250], Ability2: ['slow', 300], Ultimate: 'ult' },
  fade: { Grenade: 'drone', Ability1: ['molly', 300], Ability2: 'recon', Ultimate: ['stun', 500] },
  gekko: { Grenade: ['molly', 250], Ability1: 'drone', Ability2: 'flash', Ultimate: 'drone' },
  harbor: { Grenade: ['slow', 300], Ability1: 'wall', Ability2: ['smoke', 320], Ultimate: ['stun', 600] },
  // Flashbulb is a thrown flash; Displacement pulls players in and concusses
  // on impact; Flow is a self-reposition; Suspension levitates everyone in a zone.
  hush: { Grenade: 'other', Ability1: 'flash', Ability2: ['stun', 250], Ultimate: ['stun', 400] },
  iso: { Grenade: 'wall', Ability1: 'stun', Ability2: 'other', Ultimate: 'ult' },
  jett: { Grenade: ['smoke', 240], Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  'kay/o': { Grenade: ['molly', 250], Ability1: 'flash', Ability2: ['stun', 350], Ultimate: ['stun', 900] },
  killjoy: { Grenade: ['molly', 220], Ability1: 'trap', Ability2: 'trap', Ultimate: ['stun', 900] },
  // M-Pulse pulses concuss (or heal) around where it lands; Waveform casts
  // smokes; Harmonize is an ally buff; Bassquake is a deafen/knockback/slow zone.
  miks: { Grenade: ['stun', 250], Ability1: 'other', Ability2: ['smoke', 320], Ultimate: ['stun', 600] },
  neon: { Grenade: 'wall', Ability1: ['stun', 250], Ability2: 'other', Ultimate: 'ult' },
  omen: { Grenade: 'other', Ability1: 'flash', Ability2: ['smoke', 380], Ultimate: 'ult' },
  phoenix: { Grenade: 'wall', Ability1: ['molly', 200], Ability2: 'flash', Ultimate: 'ult' },
  raze: { Grenade: 'drone', Ability1: 'other', Ability2: ['molly', 200], Ultimate: ['molly', 300] },
  reyna: { Grenade: 'flash', Ability1: 'other', Ability2: 'other', Ultimate: 'ult' },
  sage: { Grenade: 'wall', Ability1: ['slow', 300], Ability2: 'other', Ultimate: 'ult' },
  skye: { Grenade: 'other', Ability1: 'drone', Ability2: 'flash', Ultimate: 'drone' },
  sova: { Grenade: 'drone', Ability1: ['molly', 200], Ability2: 'recon', Ultimate: 'wall' },
  tejo: { Grenade: 'drone', Ability1: ['stun', 250], Ability2: ['molly', 250], Ultimate: ['molly', 600] },
  // Crosscut is a teleport anchor; Chokehold and Interceptor are placed devices
  // that act on enemies in range; Evolution is a self-buff.
  veto: { Grenade: 'other', Ability1: 'trap', Ability2: 'trap', Ultimate: 'ult' },
  viper: { Grenade: ['molly', 200], Ability1: ['smoke', 350], Ability2: 'wall', Ultimate: ['smoke', 900] },
  vyse: { Grenade: ['slow', 300], Ability1: 'trap', Ability2: 'flash', Ultimate: ['stun', 900] },
  waylay: { Grenade: ['stun', 250], Ability1: 'other', Ability2: 'other', Ultimate: ['stun', 600] },
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
