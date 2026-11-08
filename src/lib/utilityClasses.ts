/**
 * What each replay effect class is on the plays board (docs/plays-editor-v2.md
 * §2.10): its role in a throw, the shape it is drawn as, and the ability slot
 * when the class tells it.
 *
 * A thrown ability is two effect actors in the replay: a `Projectile_*` that
 * spawns in the thrower's hand and lives for the flight, and a landing actor
 * that starts when it ends. `replayFrame.ts` pairs the two by owner and time;
 * this table says which classes are which.
 *
 * Hand-labelled from the 68 converted bundles (2026-11-08): every class seen
 * there. Slots come from the casts that precede each class (the `_4_` / `_Q_`
 * / `_E_` in a class name is not a reliable key: Omen's `Wraith_4_Smoke` is
 * cast on E, Phoenix's `Phoenix_4_Molotov` on Q, Chamber's `Deadeye_E_Trap`
 * on C) and were checked against `agentAbilities.ts`. No radius is given here:
 * the bundles carry no sizes, so `abilityShape`'s radius applies when it
 * names the same shape, else the shape's default.
 *
 * Pure, no imports beyond types, so `node --test` can type-check it.
 */

import type { AbilitySlot, UtilityKind } from './playDoc.ts'

/**
 * - `projectile`: in flight; drawn only when paired with its landing.
 * - `landing`: what a projectile turns into; may be paired with one.
 * - `placed`: put down or activated without a throw of its own; never paired.
 * - `pawn`: a thing the agent controls (drone, alarmbot); drawn where it spawned.
 * - `ignore`: never drawn (ult orbs, a manager that duplicates a visible zone).
 */
export type EffectRole = 'projectile' | 'landing' | 'placed' | 'pawn' | 'ignore'

export interface EffectClassInfo {
  role: EffectRole
  shape: UtilityKind
  /** World cm, when known; else the slot's table radius or the shape's default. */
  radius?: number
  slot?: AbilitySlot
  /** One segment of a wall: segments of one cast are drawn as one `path`. */
  line?: boolean
}

const C: AbilitySlot = 'Grenade'
const Q: AbilitySlot = 'Ability1'
const E: AbilitySlot = 'Ability2'
const X: AbilitySlot = 'Ultimate'

const p = (shape: UtilityKind, slot?: AbilitySlot): EffectClassInfo => (slot ? { role: 'projectile', shape, slot } : { role: 'projectile', shape })
const l = (shape: UtilityKind, slot?: AbilitySlot): EffectClassInfo => (slot ? { role: 'landing', shape, slot } : { role: 'landing', shape })
const placed = (shape: UtilityKind, slot?: AbilitySlot): EffectClassInfo => (slot ? { role: 'placed', shape, slot } : { role: 'placed', shape })
const pawn = (shape: UtilityKind, slot?: AbilitySlot): EffectClassInfo => (slot ? { role: 'pawn', shape, slot } : { role: 'pawn', shape })
const ignore = (shape: UtilityKind = 'other'): EffectClassInfo => ({ role: 'ignore', shape })

/** Every effect class seen in the bundles. Codenames: the agent in the comment. */
const TABLE: Record<string, EffectClassInfo> = {
  // Astra (Rift)
  GameObject_Rift_E_SmokeZone_C: placed('smoke', E),
  // Nebula dissipated into a fake (~2 s).
  GameObject_Rift_E_SmokeZone_Fake_C: placed('smoke', E),
  // Cosmic Divide: a map-long wall, one point.
  GameObject_Rift_X_GlobalWall_C: placed('wall', X),

  // Breach. Flashpoint spawns in the hand and has no landing actor: not drawn, the cast badge stands for it.
  Projectile_Breach_Q_ThroughWalls_Flash_C: p('flash', Q),

  // Brimstone (Sarge)
  Projectile_Sarge_Q_Molotov_Production_C: p('molly', Q),
  Patch_Sarge_Q_Molotov_Production_C: l('molly', Q),
  GameObject_Sarge_4_Smoke_ProductionNEW_C: placed('smoke', E),
  // One per Sky Smoke call, starting with and on top of its first smoke: the smokes draw it.
  GameObject_Sarge_4_SmokeManager_Production_C: ignore('smoke'),
  GameObject_Sarge_X_OrbitalStrike_Production_C: placed('molly', X),

  // Chamber (Deadeye)
  // Trademark, cast on C despite the `_E_`.
  GameObject_Deadeye_E_Trap_C: placed('trap', C),
  // Fired by a triggered Trademark (about 1.4 m from it, 23 ms) into its slow: `from` is the trap.
  Projectile_Deadeye_4_Trap_Dart_C: p('slow', C),
  Patch_Deadeye_E_Slow_Large_C: l('slow', C),
  // Tour de Force, the gun itself.
  Gun_Deadeye_X_Giantslayer_Prototype_FireRatePrototype_C: ignore(),

  // Clove (Smonk)
  GameObject_Smonk_NewSmoke_C: placed('smoke', E),
  // Ruse cast after death.
  GameObject_Smonk_NewSmoke_PDS_C: placed('smoke', E),
  Projectile_Smonk_DecayNade_C: p('stun', Q),
  // Meddle's burst; drawn as the board's Meddle (stun), not as a molly.
  GameObject_Smonk_Q_DecayExplosion_C: l('stun', Q),

  // Cypher (Gumshoe). Cyber Cage comes in two forms in these bundles, both cast on Q.
  Projectile_Gumshoe_Q_CageTrap_C: p('trap', Q),
  // The cage canister lying in wait (median 20 s), until it is activated.
  GameObject_Gumshoe_Q_CageTrap_C: l('trap', Q),
  // The activated cage, on the canister it replaces: not a throw's landing.
  Zone_Gumshoe_Q_Cage_C: placed('smoke', Q),
  Projectile_Gumshoe_4_CageTrap_C: p('smoke', Q),
  Zone_Gumshoe_4_Cage_C: l('smoke', Q),

  // Deadlock (Cable)
  GameObject_StealthingTrap_SoundSensor_C: placed('trap', Q),
  // Annihilation's cocoon.
  GameObject_FishingHook_CageSphere_C: placed('ult', X),

  // Gekko (AggroBot). The reclaim orbs are the globs left on the floor.
  // Spat out where Dizzy finishes (not from Gekko's hand) and lands as Dizzy's glob.
  Projectile_E_Aggrobot_OrbSpawner_C: p('other', E),
  GameObject_Aggrobot_Reclaim_Orb_Turret_C: l('other', E),
  GameObject_Aggrobot_Reclaim_Orb_SeekerNade_C: placed('other', Q),
  // Wingman's glob after a plant or defuse.
  GameObject_Aggrobot_Reclaim_Orb_SeekerNadePlantSuccessful_C: placed('other', Q),
  GameObject_Aggrobot_X_Reclaim_Orb_C: placed('other', X),
  // A glob whose ability the casts do not settle (E 7, Q 6): no slot.
  GameObject_Aggrobot_Reclaim_Orb_ExplodeyPatch_C: placed('other'),

  // Harbor (Mage)
  Projectile_Mage_E_WorldSmoke_C: p('smoke', E),
  GameObject_Mage_E_WorldSmoke_C: l('smoke', E),
  // High Tide's emitter: starts with the wall manager and never lands.
  Projectile_Mage_Q_Wall_C: ignore('wall'),
  // The wall, at the cast point (its base): the only actor that draws it.
  GameObject_Mage_Q_WallManager_C: placed('wall', Q),

  // Iso (Sequoia)
  // Contingency, cast on C.
  GameObject_Sequoia_4_MovingCover_Slower_C: placed('wall', C),
  GameObject_Sequoia_4_MovingCover_AltFireSlower_C: placed('wall', C),
  // Double Tap's orb (about 1 s).
  GameObject_Sequoia_E_Orb_C: placed('other', E),

  // Jett (Wushu). The smoke forms ~1.5 s before the projectile actor closes.
  Projectile_Wushu_4_Smoke_C: p('smoke', C),
  GameObject_Wushu_4_SmokeZone_C: l('smoke', C),

  // Killjoy
  Pawn_Killjoy_Q_StealthAlarmbot_C: pawn('trap', Q),

  // Miks (Iris)
  GameObject_Iris_E_Smoke_C: placed('smoke', E),

  // Omen (Wraith). Cast on E; the smoke forms ~500 ms before the projectile closes.
  Projectile_Wraith_4_Smoke_C: p('smoke', E),
  Zone_Wraith_4_Smoke_C: l('smoke', E),

  // Phoenix
  Projectile_Phoenix_4_Molotov_Production_C: p('molly', Q),
  Patch_Phoenix_MolotovFire_C: l('molly', Q),
  // Blaze's leading edge: starts with the manager and never lands.
  Projectile_Phoenix_Q_FlameWall_ThroughWall_C: ignore('wall'),
  // The wall, at the cast point (its base): the only actor that draws it, so not ignored.
  GameObject_Phoenix_Q_FlameWallManager_Production_C: placed('wall', C),

  // Sage (Thorne)
  Projectile_Thorne_4_SlowFIeld_Production_C: p('slow', Q),
  Patch_Thorne_4_SlowField_Production_C: l('slow', Q),
  // ~4 segments make the wall.
  GameObject_Thorne_E_Wall_Segment_Fortifying_C: { role: 'placed', shape: 'wall', slot: C, line: true },
  // One per wall, at its middle, with the segments: they draw it.
  GameObject_Thorne_E_Wall_Fortifying_C: ignore('wall'),

  // Skye (Guide)
  Pawn_Guide_Q_PossessableScout_C: pawn('drone', Q),

  // Sova (Hunter)
  // Owl Drone, cast on C.
  Pawn_Hunter_E_Drone_C: pawn('drone', C),
  // The Owl Drone's marking dart.
  GameObject_Hunter_E_Drone_RevealDart_C: placed('recon', C),

  // Veto (Pine)
  Projectile_Pine_Q_TrapGrenade_C: p('trap', Q),
  Projectile_Pine_Q_TrapGrenadeUnderhand_C: p('trap', Q),
  GameObject_Pine_Q_SeizeTrap_C: l('trap', Q),

  // Viper (Pandemic)
  // Poison Cloud's emitter: recorded at the hand, then lies on the ground for its whole life (median 51 s), so no flight to draw.
  Projectile_Pandemic_4_SmokeGrenade_C: ignore('smoke'),
  // The cloud while it is up, cast on Q despite the `_4_`.
  GameObject_Pandemic_4_SmokeZone_C: placed('smoke', Q),
  // Toxic Screen's emitters: start with the manager and never land.
  Projectile_Pandemic_E_SmokeScreen_NoCollision_C: ignore('wall'),
  // The screen, at the cast point (its base).
  GameObject_Pandemic_E_SmokeScreenManager_C: placed('wall', E),
  // Snake Bite (no projectile recorded).
  Patch_Pandemic_AcidMolotov_NewMolotov_C: l('molly', C),

  // Vyse (Nox)
  // Arc Rose.
  GameObject_Nox_StealthingTrap_Flash_2_C: placed('flash', E),
  // Shear, armed.
  GameObject_Nox_WallTrap_C: placed('trap', Q),
  // Shear's wall, where the armed trap was, when it ends.
  GameObject_Nox_Wall_C: placed('wall', Q),

  // Waylay (Terra). Saturate hinders.
  Projectile_Terra_C_TimeSlowGrenade_C: p('slow', C),
  GameObject_Terra_C_TimeSlowGrenade_Explosion_C: l('slow', C),

  // Not an ability: the ultimate point orbs on the map.
  UltPointOrb_C: ignore(),
}

// Shared by every caller: never to be changed.
for (const info of Object.values(TABLE)) Object.freeze(info)

/** The table's keys: every class it labels by hand. */
export const ALL_KNOWN_CLASSES: readonly string[] = Object.keys(TABLE)

/** vrfkit's coarse `kind` as a shape, for classes the table does not know. */
const KIND_SHAPES: Record<string, UtilityKind> = {
  smoke: 'smoke',
  wall: 'wall',
  trap: 'trap',
  slow: 'slow',
  damage_zone: 'molly',
  recon: 'recon',
}

function roleByPrefix(cls: string): EffectRole {
  if (cls.startsWith('Projectile_')) return 'projectile'
  if (cls.startsWith('Patch_') || cls.startsWith('Zone_')) return 'landing'
  if (cls.startsWith('Pawn_')) return 'pawn'
  if (cls.startsWith('UltPointOrb') || cls.startsWith('Gun_')) return 'ignore'
  // `GameObject_` and anything else: an area put down where it is.
  return 'placed'
}

/** What an effect class is: the table first, else its prefix, with the shape from vrfkit's `kind`. */
export function classInfo(cls: string, kind?: string): EffectClassInfo {
  const known = TABLE[cls]
  if (known) return known
  return { role: roleByPrefix(cls), shape: (kind !== undefined ? KIND_SHAPES[kind] : undefined) ?? 'other' }
}
