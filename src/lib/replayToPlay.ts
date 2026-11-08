/**
 * One round of a replay as a play document (docs/plays-editor-v2.md §2.7).
 *
 * "I played this comp; load the round and edit it into the next strategy."
 * The round is snapshotted at a few moments (barrier drop, first contact,
 * plant, end); each snapshot is the replay frame at that moment
 * (`frameStep`, §2.8) with every agent's move to the next snapshot added.
 *
 * Pure, no React, no Supabase: the caller supplies the agent lookup (built
 * from the registry) and the map transform. Must not import `gameContent.ts`,
 * so that `node --test` can type-check and run it.
 */

import type { ReplayBundle, ReplayKill, ReplayPlayer, ReplayRound } from './replayBundle.ts'
import type { MapTransform } from './replayScene.ts'
import { parsePlayDoc, type AgentElement, type PlayDoc } from './playDoc.ts'
import {
  createFrameIds,
  frameStep,
  roundBarrier,
  roundPlant,
  roundSide,
  type ReplayAgentInfo,
  type ReplayAgentLookup,
} from './replayFrame.ts'

export type { ReplayAgentInfo, ReplayAgentLookup }
export interface ReplayPlay { doc: PlayDoc; side: 'attack' | 'defense'; mapUuid: string | null; title: string }

/** Without an end or a kill, the round is taken to run its full 100 s timer. */
const ROUND_TIMER_MS = 100_000
/** Snapshots closer together than this say the same thing twice. */
const MIN_STEP_GAP_MS = 4_000
/** An agent that moved less than this (image units) between two steps stays put. */
const MOVE_THRESHOLD = 0.02
const MAX_COMP = 5
const UNKNOWN_AGENT = 'Agent'

/**
 * Map display names by the codename in the map's asset path (`/Game/Maps/Jam/Jam`
 * is Lotus). The bundle carries no display name, and the registry lives in
 * `gameContent.ts`, which this module may not import. An unlisted map shows
 * its codename.
 */
const MAP_NAMES: Record<string, string> = {
  ascent: 'Ascent',
  duality: 'Bind',
  triad: 'Haven',
  bonsai: 'Split',
  port: 'Icebox',
  foxtrot: 'Breeze',
  canyon: 'Fracture',
  pitt: 'Pearl',
  jam: 'Lotus',
  juliett: 'Sunset',
  infinity: 'Abyss',
  rook: 'Corrode',
  range: 'The Range',
  hurm_alley: 'District',
  hurm_bowl: 'Kasbah',
  hurm_helix: 'Drift',
  hurm_yard: 'Piazza',
  hurm_hightide: 'Glitch',
}

function mapName(mapUrl: string): string {
  const code = mapUrl.split('/').filter(Boolean).pop() ?? ''
  return MAP_NAMES[code.toLowerCase()] ?? (code || 'Unknown map')
}

function roundKills(bundle: ReplayBundle, round: ReplayRound): ReplayKill[] {
  return bundle.kills.filter(k => k.round === round.n).sort((a, b) => a.t - b.t)
}

function endOf(round: ReplayRound, kills: ReplayKill[]): number {
  const barrier = roundBarrier(round)
  const end = round.endMs ?? (kills.length > 0 ? kills[kills.length - 1].t : barrier + ROUND_TIMER_MS)
  return Math.max(end, barrier)
}

/**
 * The moments a round is snapshotted at, in replay ms, in time order: barrier
 * drop, first kill after it, plant, end. A moment closer than 4 s to the one
 * kept before it is dropped; the barrier and the end always remain (when the
 * end comes too soon after a middle moment, that moment gives way).
 */
export function replayStepTimes(bundle: ReplayBundle, round: ReplayRound): { t: number; name: string }[] {
  const barrier = roundBarrier(round)
  const kills = roundKills(bundle, round)
  const end = endOf(round, kills)

  const middle: { t: number; name: string }[] = []
  const firstKill = kills.find(k => k.t > barrier)
  if (firstKill) middle.push({ t: firstKill.t, name: 'First contact' })
  const plant = roundPlant(bundle, round).t
  if (plant !== null) middle.push({ t: plant, name: 'Plant' })

  const steps = [{ t: barrier, name: 'Barrier drop' }]
  for (const m of middle.filter(m => m.t > barrier && m.t < end).sort((a, b) => a.t - b.t)) {
    if (m.t - steps[steps.length - 1].t >= MIN_STEP_GAP_MS) steps.push(m)
  }
  while (steps.length > 1 && end - steps[steps.length - 1].t < MIN_STEP_GAP_MS) steps.pop()
  steps.push({ t: end, name: 'End' })
  return steps
}

/** "0:12" */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The play for round `roundNumber` of the replay. Throws an `Error` when the
 * bundle has no such round. The document has been through `parsePlayDoc`.
 */
export function roundToPlay(
  bundle: ReplayBundle,
  roundNumber: number,
  lookup: ReplayAgentLookup,
  transform: MapTransform,
): ReplayPlay {
  const round = bundle.rounds.find(r => r.n === roundNumber)
  if (!round) {
    const numbers = bundle.rounds.map(r => r.n)
    const range = numbers.length > 0 ? ` (it has rounds ${Math.min(...numbers)} to ${Math.max(...numbers)})` : ''
    throw new Error(`Round ${roundNumber} is not in this replay${range}.`)
  }

  const playerBySubject = new Map(bundle.players.map(p => [p.subject, p]))
  const infoOf = (player: ReplayPlayer | undefined) => (player ? lookup(player.agentId) : null)
  const nameOf = (subject: string | null) => infoOf(subject ? playerBySubject.get(subject) : undefined)?.name ?? UNKNOWN_AGENT

  // The comp: ally agents in player order, one entry per name, at most five.
  const comp: string[] = []
  for (const player of bundle.players) {
    if (player.team !== 'ALLY') continue
    const name = infoOf(player)?.name ?? UNKNOWN_AGENT
    if (comp.length < MAX_COMP && !comp.some(c => c.toLowerCase() === name.toLowerCase())) comp.push(name)
  }
  const inComp = (name: string) => comp.some(c => c.toLowerCase() === name.toLowerCase())

  const side = roundSide(round)
  const map = mapName(bundle.match.mapUrl)
  const date = bundle.match.recordedAt.slice(0, 10)

  const kills = roundKills(bundle, round)
  const barrier = roundBarrier(round)
  const times = replayStepTimes(bundle, round)
  const plant = roundPlant(bundle, round)
  const firstKill = kills.find(k => k.t > barrier) ?? null

  const site = plant.record?.site ?? null

  const winner = round.winner === 'ALLY' ? 'your team' : round.winner === 'ENEMY' ? 'the enemy' : null
  const how = round.how ? round.how.replace(/_/g, ' ').toLowerCase() : null
  const outcome = winner ? `${winner} won${how ? ` by ${how}` : ''}` : null

  const facts: Record<string, string> = {
    'First contact': firstKill ? `${nameOf(firstKill.killer)} killed ${nameOf(firstKill.victim)}.` : '',
    Plant: `Spike planted${site ? ` on ${site}` : ''}.`,
    End: outcome ? `${capitalize(outcome)}.` : 'Round over.',
  }

  // Every snapshot is the frame at its time; ids are shared so the editor animates them.
  const ids = createFrameIds()
  const frames = times.map(step => frameStep(bundle, step.t, lookup, transform, ids, round))
  const steps = times.map((step, i) => {
    const next = frames[i + 1] ?? null
    const elements = frames[i].elements.filter(el => el.kind !== 'agent' || el.team !== 'ally' || inComp(el.agent))
    for (const el of elements) {
      if (el.kind !== 'agent' || !next) continue
      // The move to where the agent stands at the next snapshot, alive then.
      const then = next.elements.find((e): e is AgentElement => e.kind === 'agent' && e.id === el.id)
      if (!then || el.at.u === undefined || el.at.v === undefined || then.at.u === undefined || then.at.v === undefined) continue
      if (Math.hypot(then.at.u - el.at.u, then.at.v - el.at.v) > MOVE_THRESHOLD) el.moveTo = { u: then.at.u, v: then.at.v }
    }
    const since = `${clock(step.t - barrier)} after barrier`
    const fact = facts[step.name]
    return { ...frames[i], id: slugOf(step.name), name: step.name, caption: fact ? `${since}. ${fact}` : `${since}.`, elements }
  })

  const summary = `Round ${round.n} from the replay${outcome ? `: ${outcome}` : ''}`

  const doc = parsePlayDoc({ version: 2, summary, comp, steps, assumptions: [] })
  return { doc, side, mapUuid: bundle.match.mapUuid, title: `Round ${round.n} · ${map} · ${date}` }
}
