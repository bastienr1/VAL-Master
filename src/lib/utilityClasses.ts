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
 * there, including (reducer 0.2.0) the ability actors vrfkit's own effects
 * table leaves out, such as Sova's bolts, Raze's grenades and KAY/O's knife.
 * Slots come from the casts that precede each class (the `_4_` / `_Q_`
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
  // Gravity Well and Nova Pulse, where they went off (owner often not recorded).
  GameObject_Rift_4_BlackHole_C: placed('slow', C),
  GameObject_Rift_Q_FlashBurst_C: placed('stun', Q),
  // Ultimate's aiming markers.
  GameObject_Rift_X_Markers_C: ignore(),

  // Breach. Flashpoint spawns in the hand and has no landing actor: not drawn, the cast badge stands for it.
  Projectile_Breach_Q_ThroughWalls_Flash_C: p('flash', Q),
  // Aftershock: the charge flies to the wall, the blast lands where it was stuck.
  Projectile_Breach_4_FusionBlast_C: p('molly', C),
  GameObject_Breach_4_FusionBlast_C: l('molly', C),
  // Fault Line and Rolling Thunder: where the quake went off.
  GameObject_Breach_E_SweetSpotFissure_C: placed('stun', E),
  GameObject_Breach_X_Shockwave_C: placed('stun', X),

  // Brimstone (Sarge)
  Projectile_Sarge_Q_Molotov_Production_C: p('molly', Q),
  Patch_Sarge_Q_Molotov_Production_C: l('molly', Q),
  GameObject_Sarge_4_Smoke_ProductionNEW_C: placed('smoke', E),
  // One per Sky Smoke call, starting with and on top of its first smoke: the smokes draw it.
  GameObject_Sarge_4_SmokeManager_Production_C: ignore('smoke'),
  GameObject_Sarge_X_OrbitalStrike_Production_C: placed('molly', X),
  // Stim Beacon, thrown on C.
  Projectile_Sarge_E_SpeedStim_C: p('other', C),
  GameObject_Sarge_E_SpeedStim_C: l('other', C),

  // Chamber (Deadeye)
  // Trademark, cast on C despite the `_E_`.
  GameObject_Deadeye_E_Trap_C: placed('trap', C),
  // Fired by a triggered Trademark (about 1.4 m from it, 23 ms) into its slow: `from` is the trap.
  Projectile_Deadeye_4_Trap_Dart_C: p('slow', C),
  Patch_Deadeye_E_Slow_Large_C: l('slow', C),
  // Tour de Force, the gun itself.
  Gun_Deadeye_X_Giantslayer_Prototype_FireRatePrototype_C: ignore(),
  // Rendezvous' anchor, while it is down.
  GameObject_Deadeye_E_Teleporter_Tether_C: placed('other', E),

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
  // Trapwire: the anchor drawn, the far end left out. Cast on C in both forms.
  GameObject_Gumshoe_4_TripWire_C: placed('trap', C),
  GameObject_Gumshoe_4_TripWire_SecondWire_C: ignore('trap'),
  GameObject_Gumshoe_E_TripWire_C: placed('trap', C),
  GameObject_Gumshoe_E_TripWire_SecondWire_C: ignore('trap'),
  // Spycam, where it sits (cast on E in both forms).
  Pawn_Gumshoe_E_PossessableCamera_C: pawn('recon', E),
  Pawn_Gumshoe_Q_PossessableCamera_C: pawn('recon', E),
  // The camera's tracking dart (no owner, ~0.1 s) and the dart stuck on an enemy.
  Projectile_Gumshoe_E_CameraTrackingDart_C: ignore('recon'),
  Projectile_Gumshoe_Q_CameraTrackingDart_C: ignore('recon'),
  GameObject_RemovableObject_GumshoeTrackingDart_C: ignore('recon'),
  // Neural Theft, on the body it reads.
  GameObject_Gumshoe_X_InterrogateHat_C: placed('other', X),

  // Deadlock (Cable)
  GameObject_StealthingTrap_SoundSensor_C: placed('trap', Q),
  // Annihilation's cocoon.
  GameObject_FishingHook_CageSphere_C: placed('ult', X),
  // Barrier Mesh: thrown, then the deployer where it lands (the root duplicates it).
  Projectile_CableJam_InAir_C: p('wall', C),
  GameObject_CableJam_CableDeployer_Precomputed_C: l('wall', C),
  GameObject_CableJamRoot_C: ignore('wall'),
  // GravNet, both forms.
  Projectile_NetToss_C: p('slow', E),
  Patch_NetToss_C: l('slow', E),
  Projectile_Cable_4_NetToss_C: p('slow', E),
  Patch_Cable_4_NetToss_C: l('slow', E),
  GameObject_Cable_4_RemovableNet_C: ignore('slow'),
  // Sonic Sensor going off.
  GameObject_SoundSensor_SweetSpotFissure_C: placed('stun', Q),
  // Annihilation's aiming line and its node.
  GameObject_FishingHook_BouncingTrajectoryWarning_C: ignore(),
  GameObject_FishingHook_EndOfTrajectoryWarning_C: ignore(),
  GameObject_Spline_C: ignore(),
  GameObject_MotherNode_C: ignore(),

  // Fade (BountyHunter)
  // Haunt: the eye flies, then reveals from where it stops.
  Projectile_E_BountyHunter_Divebomb_C: p('recon', E),
  GameObject_BountyHunter_E_LoSReveal_Source_Reactivate_C: l('recon', E),
  // Seize: the orb flies, the tether lands.
  Projectile_Q_BountyHunter_TetherGrenade_SphereExpansion_C: p('molly', Q),
  GameObject_Q_BountyHunter_Tether_SphereExpansion_C: l('molly', Q),
  // Prowler, where it was sent from.
  Pawn_BountyHunter_4_WolfHound_C: pawn('drone', C),
  // Nightfall's wave.
  GameObject_BountyHunter_X_WaveForm_C: placed('stun', X),

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
  // Mosh Pit: thrown, then the patch where it lands.
  Projectile_Aggrobot_C_ExplodeyPatch_C: p('molly', C),
  Patch_Aggrobot_C_ExplodeyPatch_C: l('molly', C),
  // Wingman and Thrash, where they were sent from.
  Pawn_Aggrobot_SeekerNade_C: pawn('drone', Q),
  Pawn_Aggrobot_RollyPolly_C: pawn('drone', X),
  // Dizzy's own flight and its shots: the glob above draws Dizzy.
  Projectile_E_Aggrobot_DiscTurret_PowerWave_C: ignore('flash'),
  Projectile_Aggrobot_Zamboni_Rocket_C: ignore('flash'),

  // Harbor (Mage)
  Projectile_Mage_E_WorldSmoke_C: p('smoke', E),
  GameObject_Mage_E_WorldSmoke_C: l('smoke', E),
  // High Tide's emitter: starts with the wall manager and never lands.
  Projectile_Mage_Q_Wall_C: ignore('wall'),
  // The wall, at the cast point (its base): the only actor that draws it.
  GameObject_Mage_Q_WallManager_C: placed('wall', Q),
  // Storm Surge.
  Projectile_Mage_4_SplashGrenade_C: p('slow', C),
  GameObject_Mage_4_SplashGrenade_C: l('slow', C),
  // Reckoning: the wave's origin; its chunks are left out.
  GameObject_Mage_X_TidalWave_C: placed('stun', X),
  GameObject_Mage_X_TidalWave_Chunk_C: ignore('stun'),

  // Iso (Sequoia)
  // Contingency, cast on C.
  GameObject_Sequoia_4_MovingCover_Slower_C: placed('wall', C),
  GameObject_Sequoia_4_MovingCover_AltFireSlower_C: placed('wall', C),
  // Double Tap's orb (about 1 s).
  GameObject_Sequoia_E_Orb_C: placed('other', E),
  GameObject_Sequoia_4_MovingCover_C: placed('wall', C),
  // Double Tap's shield on Iso himself, Undercut's flight and its aiming line (no landing recorded).
  GameObject_Sequoia_E_Shield_C: ignore(),
  Projectile_Sequoia_Q_FragileMissile_C: p('stun', Q),
  GameObject_Sequoia_Q_FragileMissile_TrajectoryWarning_C: ignore(),
  // Kill Contract's capture line.
  GameObject_Sequoia_X_LineCapture_C: placed('ult', X),

  // Jett (Wushu). The smoke forms ~1.5 s before the projectile actor closes.
  Projectile_Wushu_4_Smoke_C: p('smoke', C),
  GameObject_Wushu_4_SmokeZone_C: l('smoke', C),

  // Killjoy
  Pawn_Killjoy_Q_StealthAlarmbot_C: pawn('trap', Q),
  // Nanoswarm: the grenade lies hidden for its whole life (often 30 s), so its flight is not
  // drawn; the swarm is drawn where it goes off.
  Projectile_Killjoy_4_RemoteBees_MultiDetonate_C: ignore('molly'),
  GameObject_Killjoy_4_BeeSwarm_Damage_C: placed('molly', C),
  Pawn_Killjoy_E_Turret_C: pawn('trap', E),
  GameObject_Killjoy_X_Bomb_C: placed('stun', X),
  GameObject_Killjoy_X_Shockwave_C: ignore('stun'),

  // Miks (Iris)
  GameObject_Iris_E_Smoke_C: placed('smoke', E),
  // M-pulse in its two forms: thrown, then the pulse where it lands.
  Projectile_Thumper_Concuss_C: p('stun', C),
  GameObject_Thumper_Concuss_C: l('stun', C),
  Projectile_Thumper_Heal_C: p('other', C),
  GameObject_Thumper_Heal_C: l('other', C),
  GameObject_Thumper_ConcussPulse_C: ignore('stun'),
  GameObject_Iris_X_SonicWave_C: placed('stun', X),

  // Omen (Wraith). Cast on E; the smoke forms ~500 ms before the projectile closes.
  Projectile_Wraith_4_Smoke_C: p('smoke', E),
  Zone_Wraith_4_Smoke_C: l('smoke', E),
  // Paranoia flies straight and has no landing actor; its aiming line is left out.
  Projectile_Wraith_Q_NearsightMissile_C: p('flash', Q),
  GameObject_Wraith_Q_NearsightMissile_TrajectoryWarning_C: ignore(),

  // Phoenix
  Projectile_Phoenix_4_Molotov_Production_C: p('molly', Q),
  Patch_Phoenix_MolotovFire_C: l('molly', Q),
  // Blaze's leading edge: starts with the manager and never lands.
  Projectile_Phoenix_Q_FlameWall_ThroughWall_C: ignore('wall'),
  // The wall, at the cast point (its base): the only actor that draws it, so not ignored.
  GameObject_Phoenix_Q_FlameWallManager_Production_C: placed('wall', C),
  // Curveball (both hands): no landing actor.
  Projectile_Phoenix_E_FlareCurve_Synced_C: p('flash', E),
  Projectile_Phoenix_E_FlareCurve_Synced_Right_C: p('flash', E),
  // Run it Back's marker, where Phoenix comes back.
  GameObject_Phoenix_X_ResTarget_Production_C: placed('ult', X),

  // Sage (Thorne)
  Projectile_Thorne_4_SlowFIeld_Production_C: p('slow', Q),
  Patch_Thorne_4_SlowField_Production_C: l('slow', Q),
  // ~4 segments make the wall.
  GameObject_Thorne_E_Wall_Segment_Fortifying_C: { role: 'placed', shape: 'wall', slot: C, line: true },
  // One per wall, at its middle, with the segments: they draw it.
  GameObject_Thorne_E_Wall_Fortifying_C: ignore('wall'),

  // Raze (Clay)
  // Blast Pack: thrown and armed, then the blast.
  Projectile_Clay_Q_Satchel_Arming_C: p('other', Q),
  GameObject_Clay_Q_Explosion_C: l('other', Q),
  // Paint Shells: the grenade, then the spawner where it pops; the bomblets are left out.
  Projectile_Clay_4_Projectile_Primary_C: p('molly', E),
  Projectile_Clay_4_ProjectilePrimary_C: p('molly', E),
  Projectile_Clay_4_Projectile_SecondarySpawner_C: l('molly', E),
  Projectile_Clay_4_SecondarySpawner_C: l('molly', E),
  Projectile_Clay_4_Projectile_Secondary_C: ignore('molly'),
  Projectile_Clay_4_ProjectileSecondary_C: ignore('molly'),
  // Boom Bot, where it was sent from.
  Pawn_Clay_E_Boomba_C: pawn('drone', C),
  // Showstopper's rocket: no landing actor.
  Projectile_Clay_X_Rocket_C: p('molly', X),

  // Reyna (Vampire). Leer: thrown, then the eye where it stops. Soul orbs are left out.
  Projectile_Vampire_4_NearsightAoE_C: p('flash', C),
  GameObject_Vampire_4_NearsightAOE_Source_C: l('flash', C),
  GameObject_Vampire_Q_Heal_HealPool_AutoActivate_C: ignore(),
  GameObject_Vampire_Q_Heal_HealPool_High_C: ignore(),

  // Skye (Guide)
  Pawn_Guide_Q_PossessableScout_C: pawn('drone', Q),
  // Guiding Light: the hawk flies, the flash goes off where it ends.
  Projectile_Guide_E_HawkFlash_C: p('flash', E),
  GameObject_Guide_E_HawkFlash_FlashSource_C: l('flash', E),
  GameObject_Guide_4_Heal_AOE_C: placed('other', C),
  Pawn_Guide_X_Pack_C: pawn('drone', X),

  // Sova (Hunter)
  // Owl Drone, cast on C.
  Pawn_Hunter_E_Drone_C: pawn('drone', C),
  // The Owl Drone's marking dart.
  GameObject_Hunter_E_Drone_RevealDart_C: placed('recon', C),
  // Shock Bolt: the bolt flies (and bounces), the blast lands where it stops. Two builds of it.
  Projectile_Hunter_4_ExplosiveBolt_C: p('molly', Q),
  GameObject_Hunter_4_ExplosiveBolt_Explosion_C: l('molly', Q),
  Projectile_Hunter_4_ExplosiveBolt_PrototypeBalance_C: p('molly', Q),
  GameObject_Hunter_4_ExplosiveBolt_Explosion_PrototypeBalance_C: l('molly', Q),
  // Recon Bolt, cast on E: the bolt flies, the sonar sits where it sticks; its pings are left out.
  Projectile_Hunter_Q_RevealBolt_C: p('recon', E),
  GameObject_Hunter_Q_SonarBolt_C: l('recon', E),
  GameObject_Hunter_Q_SonarPing_C: ignore('recon'),

  // Tejo (Cashew)
  Pawn_Cashew_4_Spider_LockOn_C: pawn('drone', C),
  GameObject_Cashew_4_SonarPing_C: ignore('recon'),
  // Special Delivery: thrown (or bounced), then the stun.
  Projectile_Cashew_Q_ShellShockGrenade_C: p('stun', Q),
  Projectile_Cashew_Q_ShellShockGrenade_Bounce_C: p('stun', Q),
  GameObject_Cashew_Q_ShellShockGrenade_C: l('stun', Q),
  // Guided Salvo: one strike per missile; the target markers and the blasts are left out.
  GameObject_Cashew_E_AirStrikeMortar_C: placed('molly', E),
  GameObject_Cashew_E_MapMissileMarker_C: ignore('molly'),
  GameObject_Cashew_E_MapMissileMarker_SecondRocket_C: ignore('molly'),
  GameObject_Cashew_E_Explosion_C: ignore('molly'),
  // Armageddon's segments; their manager is left out.
  GameObject_Cashew_X_Segment_C: placed('molly', X),
  GameObject_Cashew_X_SegmentManager_C: ignore('molly'),

  // KAY/O (Grenadier)
  // ZERO/point: the knife flies, the pulse goes off where it sticks.
  Projectile_Grenadier_E_SuppressionBlade_C: p('stun', E),
  Gameobject_Grenadier_E_SuppressionPulse_C: l('stun', E),
  // FLASH/drive (both throws) and FRAG/ment: no landing actor.
  Projectile_C_Grenadier_Flash_C: p('flash', Q),
  Projectile_C_Grenadier_Flash_Underhand_C: p('flash', Q),
  Projectile_Grenadier_Q_SemtexBasic_C: p('molly', C),
  // NULL/cmd, on KAY/O; its pulses and the recharge point are left out.
  Gameobject_Grenadier_X_UltPulseManager_C: placed('stun', X),
  Gameobject_Grenadier_X_UltPulse_C: ignore('stun'),
  Gameobject_Grenadier_X_RechargeUsable_C: ignore(),

  // Hush (Paprika)
  GameObject_Paprika_4_PullBlast_C: placed('other', C),
  // Displacement: thrown (or rolled), then the pull where it lands.
  Projectile_Paprika_E_RedirectPull_C: p('stun', E),
  Projectile_Paprika_E_RedirectPull_Underhand_C: p('stun', E),
  GameObject_Paprika_E_RedirectPullArea_C: l('stun', E),
  // Flashbulb: no landing actor.
  Projectile_Paprika_Q_RedirectFlash_C: p('flash', Q),
  Projectile_Paprika_Q_RedirectFlash_Underhand_C: p('flash', Q),
  // Suspension.
  Projectile_Paprika_X_FullBendPop_C: p('stun', X),
  GameObject_Paprika_X_LevitateZone_C: l('stun', X),
  GameObject_Paprika_X_ForceProxyManager_C: ignore(),

  // Neon (Sprinter)
  // Fast Lane, at its start; the runners are left out.
  GameObject_Sprinter_4_Tunnel_C: placed('wall', C),
  Projectile_Neon_C_Tunnel_C: ignore('wall'),
  Projectile_Neon_C_Tunnel_Cosmetic_C: ignore('wall'),
  // Relay Bolt: thrown, then the sphere where it comes down.
  Projectile_Sprinter_4_GroundStrike_C: p('stun', Q),
  GameObject_Sprinter_Q_ElectricSphere_C: l('stun', Q),

  // Yoru (Stealth)
  Pawn_Stealth_4_Decoy_V2_C: pawn('drone', C),
  GameObject_Stealth_DecoySpawner_C: ignore(),
  // Gatecrash's tether, moving or set down.
  Pawn_Stealth_E_TeleporterMoving_FakeTP_C: pawn('other', E),
  Pawn_Stealth_E_TeleporterStationary_FakeTP_C: pawn('other', E),
  // Blindside: no landing actor.
  Projectile_Stealth_Q_BounceFlash_C: p('flash', Q),

  // Veto (Pine)
  Projectile_Pine_Q_TrapGrenade_C: p('trap', Q),
  Projectile_Pine_Q_TrapGrenadeUnderhand_C: p('trap', Q),
  GameObject_Pine_Q_SeizeTrap_C: l('trap', Q),
  // Chokehold going off: the trap above draws it.
  GameObject_Pine_Q_Tether_SphereExpansion_C: ignore('trap'),
  // Crosscut's teleport point.
  GameObject_Pine_4_UsableTeleport_C: placed('other', C),
  // Interceptor: thrown, then the interceptor where it lands.
  Projectile_Pine_E_RadEaterSpawner_C: p('trap', E),
  Pawn_Pine_E_RadEater_C: l('trap', E),

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
  // Snake Bite's canister: its flight to the acid above.
  Projectile_Pandemic_Q_AcidGrenade_C: p('molly', C),
  // Viper's Pit.
  Patch_Pandemic_X_Circular_C: placed('smoke', X),

  // Vyse (Nox)
  // Arc Rose.
  GameObject_Nox_StealthingTrap_Flash_2_C: placed('flash', E),
  // Shear, armed.
  GameObject_Nox_WallTrap_C: placed('trap', Q),
  // Shear's wall, where the armed trap was, when it ends.
  GameObject_Nox_Wall_C: placed('wall', Q),
  // Razorvine: thrown, then the vines where they land; the patch when triggered is left out.
  Projectile_Nox_BarbedWire_C: p('slow', C),
  GameObject_Nox_BarbedWire_C: l('slow', C),
  Patch_Nox_BarbedWire_C: ignore('slow'),
  Gameobject_Nox_DisarmPulse_C: placed('stun', X),

  // Waylay (Terra). Saturate hinders.
  Projectile_Terra_C_TimeSlowGrenade_C: p('slow', C),
  GameObject_Terra_C_TimeSlowGrenade_Explosion_C: l('slow', C),
  // Refract's anchor (two builds); the observer copies are left out.
  GameObject_Terra_E_RewindTime_RewindTarget_C: placed('other', E),
  GameObject_Terra_E_Rewind_RewindTarget_C: placed('other', E),
  Projectile_Terra_E_RewindTime_ForObservers_C: ignore(),
  Projectile_Terra_E_Rewind_ForObservers_C: ignore(),
  GameObject_Terra_X_DelayedBeam_Beam_C: placed('stun', X),

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
