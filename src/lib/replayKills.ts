/**
 * Who killed whom at a replay's instant (docs/plays-editor-v2.md §2.16). Kept
 * out of the frame, like the view cones, so a captured step holds none of it.
 *
 * Pure, so `node --test` can check it.
 */

import type { AbilitySlot } from './playDoc.ts'
import type { ReplayBundle, ReplayRound } from './replayBundle.ts'
import type { FrameIds, ReplayAgentLookup } from './replayFrame.ts'
import { worldToImage, type MapTransform } from './replayScene.ts'
import { classInfo } from './utilityClasses.ts'

/** The tracer reaches the victim this fast: a shot, not a drawing. */
export const KILL_TRACER_MS = 90
/** The tracer has closed up onto the victim by this long after the kill. */
export const KILL_LINE_MS = 520
/** The blast on the victim, from the moment the tracer lands. */
export const KILL_IMPACT_MS = 850
/** The ring on the killer, so it stays readable who did it once the tracer has gone. */
export const KILL_RING_MS = 2200
/** The mark where they fell is bright for this long, then settles. */
export const KILL_FRESH_MS = 3000
/** How long a kill stays in the feed. */
export const KILL_FEED_MS = 7000
/** The feed holds this many at most, the latest ones. */
export const KILL_FEED_MAX = 5

export interface KillPerson {
  agent: string
  /** The Riot name, else the agent's. */
  name: string
  team: 'ally' | 'enemy'
}

export interface KillMark {
  key: string
  killer: KillPerson | null
  victim: KillPerson
  /** Agent element id of the killer, to find their tile. */
  killerId: string | null
  /** The gun or ability, null when the replay does not say. */
  weapon: string | null
  /** Where the killer stood, null for a death nobody dealt. */
  from: { u: number; v: number } | null
  /** Where the victim fell. */
  to: { u: number; v: number }
  /** Milliseconds since the kill. */
  age: number
  /** How much of its time in the feed is left, 1…0; 0 once it has gone. */
  feed: number
}

const left = (age: number, span: number) => Math.max(0, 1 - age / span)

/** The kills of this round so far, oldest first. */
export function killMarks(
  bundle: ReplayBundle,
  t: number,
  round: ReplayRound,
  transform: MapTransform,
  ids: FrameIds,
  lookup: ReplayAgentLookup,
  playerName: (subject: string) => string | undefined,
): KillMark[] {
  const players = new Map(bundle.players.map(p => [p.subject, p]))
  const person = (subject: string | null): KillPerson | null => {
    const player = subject ? players.get(subject) : undefined
    if (!subject || !player) return null
    const agent = lookup(player.agentId)?.name.trim() || 'Agent'
    return { agent, name: playerName(subject) || agent, team: player.team === 'ALLY' ? 'ally' : 'enemy' }
  }
  const image = (x: number, y: number) => {
    const [u, v] = worldToImage(transform, x, y)
    return { u, v }
  }
  const marks: KillMark[] = []
  bundle.kills.forEach((kill, index) => {
    if (kill.round !== round.n || kill.t > t || kill.vx === null || kill.vy === null) return
    const victim = person(kill.victim)
    if (!victim) return
    const age = t - kill.t
    const dealt = kill.killer !== null && kill.killer !== kill.victim
    marks.push({
      key: `${kill.t}:${index}`,
      killer: dealt ? person(kill.killer) : null,
      victim,
      killerId: dealt && kill.killer ? ids.forSubject(kill.killer) : null,
      weapon: weaponName(bundle, kill.weapon, kill.killer ? players.get(kill.killer)?.agentId ?? null : null, lookup),
      from: dealt && kill.kx !== null && kill.ky !== null ? image(kill.kx, kill.ky) : null,
      to: image(kill.vx, kill.vy),
      age,
      feed: left(age, KILL_FEED_MS),
    })
  })
  return marks
}

/** The gun's name, else the ability's when its class says which key it is on. */
function weaponName(bundle: ReplayBundle, weapon: number | null, agentId: string | null, lookup: ReplayAgentLookup): string | null {
  if (weapon === null) return null
  const entry = bundle.weapons[weapon]
  if (!entry) return null
  if (entry.name) return entry.name
  const slot: AbilitySlot | undefined = classInfo(entry.cls).slot
  const ability = slot ? lookup(agentId)?.abilities.find(a => a.slot === slot)?.name : undefined
  return ability ?? 'Ability'
}
