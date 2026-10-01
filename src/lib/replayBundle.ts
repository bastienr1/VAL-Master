/**
 * The minimap bundle — schema 1.
 *
 * `scripts/replay/vrf_to_minimap.py` reduces a VALORANT `.vrf` replay to one
 * gzipped JSON file per match. This module is the browser's side of that
 * contract: the types, and the pure decode/validate step. Nothing here touches
 * Supabase, so it runs under `npm test`.
 *
 * Times are replay milliseconds. Positions are world centimetres; the map
 * transform is applied at render time (`getMapTransform`), never baked in.
 * Players are referenced by PUUID (`subject`). The schema and every decision
 * behind it are in the vault note
 * `2026-10-01-Replay-Engine-Phase2-Minimap-Bundle-Spec`.
 */

export const REPLAY_BUNDLE_SCHEMA = 1

export type ReplayTeam = 'ALLY' | 'ENEMY'
export type ReplaySide = 'attacker' | 'defender'

export interface ReplayPlayer {
  subject: string
  agentId: string | null
  /** Relative to the player the bundle was built for (`isMe`). */
  team: ReplayTeam
  /** Henrik's "Red" / "Blue", for joining with `match_rounds`. */
  teamName: string | null
  body: number
  isMe: boolean
}

export interface ReplayRound {
  n: number
  buyStartMs: number
  /** Measured from the game's round timer: 45 s after buy start on the first round of a half, ~30 s otherwise. */
  barrierMs: number | null
  /** When the round was decided, not when the next one starts. */
  endMs: number | null
  /** The bundle owner's team's side this round. */
  side: ReplaySide | null
  winner: ReplayTeam | null
  /** The game's own string: 'elimination', 'defuse', … */
  how: string | null
  plant: number | null
  defuse: number | null
}

export interface ReplayWeapon {
  /** Stable identity, e.g. `AssaultRifle_AK_C`. */
  cls: string
  /** vrfkit's display name; null for abilities and for guns its table does not know yet. */
  name: string | null
  cat: string | null
}

/** `[t, x, y, yaw, alive, weapon]` — `weapon` indexes `weapons`, `alive` is 0 | 1. */
export type ReplayTrackSample = [number, number, number, number, 0 | 1, number | null]

export interface ReplayKill {
  t: number
  round: number
  killer: string | null
  /** Equal to `killer` on a self-death (e.g. Clove's ult running out). */
  victim: string | null
  weapon: number | null
  kx: number | null
  ky: number | null
  vx: number | null
  vy: number | null
}

export interface ReplayCast {
  t: number
  round: number
  player: string
  /** 'C' | 'Q' | 'E' | 'X', or '?n' for a slot value the reducer could not map. */
  slot: string
  x: number | null
  y: number | null
}

export interface ReplayEffect {
  start: number
  /** Null when the actor never closed: treat as "until the round ends". */
  end: number | null
  kind: string
  agent: string | null
  cls: string
  x: number
  y: number
  owner: string | null
}

export interface ReplaySpike {
  carriers: Array<{ from: number; to: number; player: string }>
  plants: Array<{ t: number; round: number; site: string | null; x: number | null; y: number | null; player: string | null }>
  defuses: Array<{ t: number; round: number; player: string | null }>
}

/** `[t, x, y, yaw]` */
export type ReplayPawnSample = [number, number, number, number]

export interface ReplayPawn {
  cls: string
  owner: string | null
  from: number
  to: number
  samples: ReplayPawnSample[]
}

export interface ReplayBundle {
  schema: typeof REPLAY_BUNDLE_SCHEMA
  parser: { vrfkit: string | null; reducer: string }
  match: {
    matchId: string
    mapUuid: string | null
    mapUrl: string
    build: string
    recordedAt: string
    durationMs: number
  }
  players: ReplayPlayer[]
  rounds: ReplayRound[]
  weapons: ReplayWeapon[]
  tracks: {
    hz: number
    fields: string[]
    byPlayer: Record<string, ReplayTrackSample[]>
  }
  kills: ReplayKill[]
  casts: ReplayCast[]
  effects: ReplayEffect[]
  spike: ReplaySpike
  pawns: { fields: string[]; items: ReplayPawn[] }
}

/** A file that is not a usable bundle. The message is written for the person who picked it. */
export class ReplayBundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayBundleError'
  }
}

/** `<user id>/<match id>/minimap.v1.json.gz` — the first folder is the owner (Storage policies key on it). */
export function replayStoragePath(userId: string, matchId: string): string {
  return `${userId}/${matchId}/minimap.v${REPLAY_BUNDLE_SCHEMA}.json.gz`
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Gunzips and validates a bundle. Checks the shape the app relies on, not every
 * field: enough that a wrong or truncated file fails here with a clear reason
 * instead of deep inside a render.
 */
export async function parseReplayBundle(file: Blob): Promise<ReplayBundle> {
  let text: string
  try {
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  } catch {
    throw new ReplayBundleError('Not a gzip file. Pick the minimap.v1.json.gz written by the replay scripts.')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ReplayBundleError('The file unzipped, but its content is not JSON.')
  }

  if (!isRecord(raw)) throw new ReplayBundleError('The file is not a minimap bundle.')
  if (raw.schema !== REPLAY_BUNDLE_SCHEMA) {
    throw new ReplayBundleError(
      `This app reads bundle schema ${REPLAY_BUNDLE_SCHEMA}; the file is schema ${String(raw.schema)}.`,
    )
  }

  const match = raw.match
  if (!isRecord(match) || typeof match.matchId !== 'string' || !match.matchId) {
    throw new ReplayBundleError('The bundle has no match id.')
  }

  for (const key of ['players', 'rounds', 'weapons', 'kills', 'casts', 'effects'] as const) {
    if (!Array.isArray(raw[key])) throw new ReplayBundleError(`The bundle has no "${key}" list.`)
  }
  const tracks = raw.tracks
  if (!isRecord(tracks) || !isRecord(tracks.byPlayer)) {
    throw new ReplayBundleError('The bundle has no player tracks.')
  }
  if (!isRecord(raw.spike) || !isRecord(raw.pawns)) {
    throw new ReplayBundleError('The bundle is missing its spike or pawns section.')
  }

  const bundle = raw as unknown as ReplayBundle
  if (bundle.players.length === 0 || bundle.rounds.length === 0) {
    throw new ReplayBundleError('The bundle has no players or no rounds.')
  }
  const untracked = bundle.players.filter(p => !Array.isArray(bundle.tracks.byPlayer[p.subject]))
  if (untracked.length > 0) {
    throw new ReplayBundleError(`The bundle has no track for ${untracked.length} of its players.`)
  }

  return bundle
}

/** Guards against attaching one match's replay to another match's review. */
export function assertBundleForMatch(bundle: ReplayBundle, matchId: string): void {
  if (bundle.match.matchId !== matchId) {
    throw new ReplayBundleError(
      `This bundle is for match ${bundle.match.matchId.slice(0, 8)}…, not for this match (${matchId.slice(0, 8)}…).`,
    )
  }
}

export interface ReplayBundleSummary {
  players: number
  rounds: number
  kills: number
  /** Rounds won by the bundle owner's team, then by the other. */
  score: [number, number]
  build: string
}

export function summarizeReplayBundle(bundle: ReplayBundle): ReplayBundleSummary {
  const won = bundle.rounds.filter(r => r.winner === 'ALLY').length
  const lost = bundle.rounds.filter(r => r.winner === 'ENEMY').length
  return {
    players: bundle.players.length,
    rounds: bundle.rounds.length,
    kills: bundle.kills.length,
    score: [won, lost],
    build: bundle.match.build,
  }
}
