/**
 * Unit tests for the replay effect class table (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_KNOWN_CLASSES, classInfo, type EffectRole } from './utilityClasses.ts'

const ROLES: EffectRole[] = ['projectile', 'landing', 'placed', 'pawn', 'ignore']
const SHAPES = ['smoke', 'flash', 'molly', 'recon', 'wall', 'trap', 'drone', 'stun', 'slow', 'ult', 'other']
const SLOTS = ['Grenade', 'Ability1', 'Ability2', 'Ultimate']

test('the table labels the 68 classes seen in the bundles', () => {
  assert.equal(ALL_KNOWN_CLASSES.length, 68)
  assert.equal(new Set(ALL_KNOWN_CLASSES).size, ALL_KNOWN_CLASSES.length)
})

test('every class in the table has a role and a shape, and a valid slot and radius when it has one', () => {
  for (const cls of ALL_KNOWN_CLASSES) {
    const info = classInfo(cls)
    assert.ok(ROLES.includes(info.role), cls)
    assert.ok(SHAPES.includes(info.shape), cls)
    if (info.slot !== undefined) assert.ok(SLOTS.includes(info.slot), cls)
    if (info.radius !== undefined) assert.ok(Number.isFinite(info.radius) && info.radius > 0, cls)
    // vrfkit's kind never overrides the table.
    assert.deepEqual(classInfo(cls, 'smoke'), info, cls)
  }
})

test('every projectile in the table has a landing class of the same agent to pair with', () => {
  const agentOf = (cls: string) => cls.replace(/^(Projectile|GameObject|Patch|Zone|Pawn)_/, '').replace(/^E_/, '').split('_')[0]
  const landings = new Set(ALL_KNOWN_CLASSES.filter(c => classInfo(c).role === 'landing').map(agentOf))
  for (const cls of ALL_KNOWN_CLASSES.filter(c => classInfo(c).role === 'projectile')) {
    assert.ok(cls.startsWith('Projectile_'), cls)
    // Breach's flash is the one throw with no landing actor.
    if (cls !== 'Projectile_Breach_Q_ThroughWalls_Flash_C') assert.ok(landings.has(agentOf(cls)), cls)
  }
})

test('the hand labels: throws, slots from the casts, Sage\'s wall segments', () => {
  assert.deepEqual(classInfo('Projectile_Phoenix_4_Molotov_Production_C'), { role: 'projectile', shape: 'molly', slot: 'Ability1' })
  assert.deepEqual(classInfo('Patch_Phoenix_MolotovFire_C'), { role: 'landing', shape: 'molly', slot: 'Ability1' })
  assert.deepEqual(classInfo('GameObject_Smonk_Q_DecayExplosion_C').role, 'landing')
  // Omen's smoke is cast on E although its class says 4.
  assert.equal(classInfo('Zone_Wraith_4_Smoke_C').slot, 'Ability2')
  assert.deepEqual(classInfo('GameObject_Thorne_E_Wall_Segment_Fortifying_C'), { role: 'placed', shape: 'wall', slot: 'Grenade', line: true })
  // Only wall segments are lines.
  assert.deepEqual(ALL_KNOWN_CLASSES.filter(c => classInfo(c).line), ['GameObject_Thorne_E_Wall_Segment_Fortifying_C'])
})

test('ignore classes: ult orbs, Chamber\'s gun, managers and emitters another class already draws', () => {
  for (const cls of [
    'UltPointOrb_C',
    'Gun_Deadeye_X_Giantslayer_Prototype_FireRatePrototype_C',
    'GameObject_Sarge_4_SmokeManager_Production_C',
    'GameObject_Thorne_E_Wall_Fortifying_C',
    'Projectile_Phoenix_Q_FlameWall_ThroughWall_C',
  ]) {
    assert.equal(classInfo(cls).role, 'ignore', cls)
  }
  // Blaze's manager is the only actor of the wall: drawn.
  assert.equal(classInfo('GameObject_Phoenix_Q_FlameWallManager_Production_C').role, 'placed')
  // Unknown ones by prefix too.
  assert.equal(classInfo('UltPointOrb_Big_C').role, 'ignore')
  assert.equal(classInfo('Gun_Someone_X_Thing_C', 'damage_zone').role, 'ignore')
})

test('an unknown class falls back on its prefix, with the shape from vrfkit\'s kind', () => {
  assert.deepEqual(classInfo('Projectile_New_Q_Thing_C', 'smoke'), { role: 'projectile', shape: 'smoke' })
  assert.deepEqual(classInfo('Patch_New_Q_Fire_C', 'damage_zone'), { role: 'landing', shape: 'molly' })
  assert.deepEqual(classInfo('Zone_New_E_Slow_C', 'slow'), { role: 'landing', shape: 'slow' })
  assert.deepEqual(classInfo('GameObject_New_C_Trap_C', 'trap'), { role: 'placed', shape: 'trap' })
  assert.deepEqual(classInfo('Pawn_New_Q_Drone_C', 'recon'), { role: 'pawn', shape: 'recon' })
  assert.deepEqual(classInfo('GameObject_New_X_Wall_C', 'wall'), { role: 'placed', shape: 'wall' })
  // An unknown kind, or none, is "other"; an unknown prefix is put down where it is.
  assert.deepEqual(classInfo('GameObject_New_E_Orb_C', 'orb'), { role: 'placed', shape: 'other' })
  assert.deepEqual(classInfo('Projectile_New_C'), { role: 'projectile', shape: 'other' })
  assert.deepEqual(classInfo('Smoke_C', 'smoke'), { role: 'placed', shape: 'smoke' })
})
