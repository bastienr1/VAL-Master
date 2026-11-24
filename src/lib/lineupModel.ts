/**
 * A line-up: one throw of one ability, with where to stand, where it lands,
 * how it is thrown, its three pictures and its clip (`/plays/lineups`,
 * migration `20261124_lineups.sql`).
 *
 * This file is the rules and stays free of Supabase and the DOM so
 * `node --test` can run it; reading and writing are in `lineups.ts`.
 */

import { abilityShape } from './agentAbilities.ts'
import { MAX_THROW_VIA, type AbilityElement, type AbilitySlot, type MapCallout, type MarkerElement, type PlayElement, type PlayStep } from './playDoc.ts'
import { worldToImage, type MapTransform } from './replayScene.ts'
import { extractYouTubeId } from './youtubeId.ts'

export const LINEUP_PURPOSES = ['execute', 'post-plant', 'retake', 'deny', 'info', 'other'] as const
export const LINEUP_STANCES = ['standing', 'crouched'] as const
export const LINEUP_MOVEMENTS = ['still', 'walking', 'running', 'jump', 'run-jump'] as const
export const LINEUP_CLICKS = ['left', 'right', 'both'] as const
/** The three pictures, in the order they are looked at. */
export const LINEUP_IMAGE_SLOTS = ['stand', 'aim', 'result'] as const

export type LineupPurpose = (typeof LINEUP_PURPOSES)[number]
export type LineupStance = (typeof LINEUP_STANCES)[number]
export type LineupMovement = (typeof LINEUP_MOVEMENTS)[number]
export type LineupClick = (typeof LINEUP_CLICKS)[number]
export type LineupImageSlot = (typeof LINEUP_IMAGE_SLOTS)[number]
export type LineupSide = 'attack' | 'defense'

export const PURPOSE_LABELS: Record<LineupPurpose, string> = {
  execute: 'Execute',
  'post-plant': 'Post-plant',
  retake: 'Retake',
  deny: 'Deny',
  info: 'Info',
  other: 'Other',
}
export const STANCE_LABELS: Record<LineupStance, string> = { standing: 'Standing', crouched: 'Crouched' }
export const MOVEMENT_LABELS: Record<LineupMovement, string> = {
  still: 'Still',
  walking: 'Walking',
  running: 'Running',
  jump: 'Jump',
  'run-jump': 'Run and jump',
}
export const CLICK_LABELS: Record<LineupClick, string> = { left: 'Left click', right: 'Right click', both: 'Both' }
export const IMAGE_SLOT_LABELS: Record<LineupImageSlot, { title: string; hint: string }> = {
  stand: { title: 'Stand', hint: 'Where your feet go' },
  aim: { title: 'Aim', hint: 'Where the crosshair goes' },
  result: { title: 'Result', hint: 'Where it lands' },
}

/** A place on the minimap, in image units (0…1 on each axis). */
export interface LineupPoint {
  u: number
  v: number
}

/** A row of `lineups`. */
export interface Lineup {
  id: string
  user_id: string
  title: string
  map: string
  map_uuid: string | null
  side: LineupSide
  agent: string
  slot: AbilitySlot
  stand: LineupPoint
  land: LineupPoint
  /** Where the throw bounces or bends on its way, in order. */
  via: LineupPoint[]
  /** The line through them: one smooth curve, or straight from point to point. */
  curved: boolean
  /** The colour of the line on the map, `#RRGGBB`; null for the ability's own. */
  line_color: string | null
  stand_callout: string | null
  land_callout: string | null
  purpose: LineupPurpose | null
  stance: LineupStance | null
  movement: LineupMovement | null
  click: LineupClick | null
  bounces: number | null
  charge: number | null
  note: string
  /** Paths in the `lineup-media` bucket. */
  stand_image: string | null
  aim_image: string | null
  result_image: string | null
  video_url: string | null
  video_start: number | null
  video_end: number | null
  patch: string | null
  verified_on: string | null
  source: unknown
  created_at: string
  updated_at: string
}

/** The columns a page writes. */
export type LineupInput = Omit<Lineup, 'id' | 'user_id' | 'created_at' | 'updated_at'>

/** The column that holds a picture slot's path. */
export const imageColumn = (slot: LineupImageSlot) => `${slot}_image` as const

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A stored point, or null when it is not one (a hand-edited row). */
export function parseLineupPoint(raw: unknown): LineupPoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { u, v } = raw as { u?: unknown; v?: unknown }
  return finite(u) && finite(v) ? { u, v } : null
}

/** The callout nearest an image point; null when the map has none. */
export function nearestCallout(point: LineupPoint, callouts: readonly MapCallout[], transform: MapTransform): MapCallout | null {
  let best: MapCallout | null = null
  let near = Infinity
  for (const callout of callouts) {
    const [u, v] = worldToImage(transform, callout.x, callout.y)
    const d = Math.hypot(u - point.u, v - point.v)
    if (d < near) {
      near = d
      best = callout
    }
  }
  return best
}

/** The name a line-up gets from its two places: "B Site from B Main". */
export function lineupTitle(land: string | null, stand: string | null, ability: string): string {
  if (land && stand) return land === stand ? `${ability}, ${land}` : `${land} from ${stand}`
  if (land) return `${ability} to ${land}`
  if (stand) return `${ability} from ${stand}`
  return ability
}

/** What of a line-up the board draws. */
export type DrawnLineup = Pick<Lineup, 'id' | 'agent' | 'slot' | 'stand' | 'land' | 'via' | 'curved' | 'line_color' | 'title'>

/** The colours offered for a line: told apart on every skin, and from each other. */
export const LINE_COLORS = [
  { value: '#FFFFFF', name: 'White' },
  { value: '#FFCA3A', name: 'Yellow' },
  { value: '#FF7A3D', name: 'Orange' },
  { value: '#FF4655', name: 'Red' },
  { value: '#FF6BD6', name: 'Pink' },
  { value: '#B28DFF', name: 'Purple' },
  { value: '#3DA5FF', name: 'Blue' },
  { value: '#2EE6C5', name: 'Teal' },
  { value: '#7CFF6B', name: 'Green' },
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A colour as the table keeps it, `#RRGGBB` in capitals, or null when it is not one. */
export function parseLineColor(raw: unknown): string | null {
  return typeof raw === 'string' && HEX_COLOR.test(raw.trim()) ? raw.trim().toUpperCase() : null
}

/** A stored list of bends: the points among them, no more than a throw may have. */
export function parseLineupVia(raw: unknown): LineupPoint[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parseLineupPoint).filter((point): point is LineupPoint => point !== null).slice(0, MAX_THROW_VIA)
}

/** The id of the pin that marks where to stand for a line-up. */
export const standPinId = (lineupId: string) => `stand:${lineupId}`

/** Where to stand, as the board draws it: a pin with the agent's icon in its head, its tip the exact place. */
export function standPin(id: string, agent: string, stand: LineupPoint): MarkerElement {
  return { kind: 'marker', id, type: 'pin', agent, at: { u: stand.u, v: stand.v } }
}

/** The line-up as the plays board draws a thrown ability: at its landing, thrown from where you stand, through its bends. */
export function lineupElement(lineup: DrawnLineup): AbilityElement {
  const { shape, radius } = abilityShape(lineup.agent, lineup.slot)
  return {
    kind: 'ability',
    id: lineup.id,
    agent: lineup.agent,
    slot: lineup.slot,
    shape,
    radius,
    at: { u: lineup.land.u, v: lineup.land.v },
    from: { u: lineup.stand.u, v: lineup.stand.v },
    ...(lineup.via.length > 0 ? { via: lineup.via.map(({ u, v }) => ({ u, v })) } : {}),
    curved: lineup.curved,
    ...(lineup.line_color ? { lineColor: lineup.line_color } : {}),
    label: lineup.title,
    team: 'ally',
  }
}

/**
 * Every line-up shown, as one step for the board: each its ability and the
 * pin where you stand; `extra` goes on top (the pin of one being placed).
 */
export function lineupsStep(lineups: readonly DrawnLineup[], extra: PlayElement[] = []): PlayStep {
  const elements = lineups.flatMap((lineup): PlayElement[] => [lineupElement(lineup), standPin(standPinId(lineup.id), lineup.agent, lineup.stand)])
  return { id: 'lineups', name: 'Line-ups', caption: '', elements: [...elements, ...extra] }
}

/** Two points that are the same place for a line-up: a drag that did not move it writes nothing. */
const samePoint = (a: LineupPoint, b: LineupPoint) => Math.abs(a.u - b.u) < 1e-6 && Math.abs(a.v - b.v) < 1e-6

/**
 * What the board changed of `lineup` in `step`: its landing dragged, its pin
 * or the hand it is thrown from, a bend moved, put in or taken out. The new
 * points, or null when it is as it was or no longer drawn.
 */
export function movedLineup(step: PlayStep, lineup: Pick<Lineup, 'id' | 'stand' | 'land' | 'via'>): { stand: LineupPoint; land: LineupPoint; via: LineupPoint[] } | null {
  const el = step.elements.find(e => e.id === lineup.id)
  if (!el || el.kind !== 'ability') return null
  const land = parseLineupPoint(el.at) ?? lineup.land
  const hand = parseLineupPoint(el.from) ?? lineup.stand
  const pin = step.elements.find(e => e.id === standPinId(lineup.id))
  const pinned = pin?.kind === 'marker' ? parseLineupPoint(pin.at) : null
  // The pin and the hand are one place: whichever was dragged is where you stand now.
  const stand = pinned && !samePoint(pinned, lineup.stand) ? pinned : hand
  const via = parseLineupVia(el.via ?? [])
  const sameVia = via.length === lineup.via.length && via.every((point, i) => samePoint(point, lineup.via[i]))
  return samePoint(land, lineup.land) && samePoint(stand, lineup.stand) && sameVia ? null : { stand, land, via }
}

/** "1:23" or "83" as seconds; null for anything else. */
export function parseClock(text: string): number | null {
  const said = text.trim()
  if (!said) return null
  const parts = said.split(':')
  if (parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null
  return parts.reduce((total, p) => total * 60 + Number(p), 0)
}

/** Seconds as "1:23". */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ''
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The clip as a YouTube embed that starts and stops where the line-up is; null when the link is not a YouTube video. */
export function clipEmbedUrl(url: string | null, start: number | null, end: number | null): string | null {
  const id = url ? extractYouTubeId(url) : null
  if (!id) return null
  const params = new URLSearchParams({ rel: '0' })
  if (start !== null && start > 0) params.set('start', String(Math.floor(start)))
  if (end !== null && end > (start ?? 0)) params.set('end', String(Math.ceil(end)))
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

/** The recipe in one line, what is known of it: "Standing · Still · Left click · 1 bounce". */
export function recipeLine(lineup: Pick<Lineup, 'stance' | 'movement' | 'click' | 'bounces' | 'charge'>): string {
  const parts: string[] = []
  if (lineup.stance) parts.push(STANCE_LABELS[lineup.stance])
  if (lineup.movement) parts.push(MOVEMENT_LABELS[lineup.movement])
  if (lineup.click) parts.push(CLICK_LABELS[lineup.click])
  if (lineup.charge !== null) parts.push(`${lineup.charge} ${lineup.charge === 1 ? 'bar' : 'bars'}`)
  if (lineup.bounces !== null) parts.push(lineup.bounces === 0 ? 'No bounce' : `${lineup.bounces} ${lineup.bounces === 1 ? 'bounce' : 'bounces'}`)
  return parts.join(' · ')
}

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Why a picture cannot be stored, or null when it can. */
export function validateLineupImage(file: { size: number; type: string }): string | null {
  if (!(file.type in IMAGE_EXTENSIONS)) return 'Use a WebP, PNG or JPEG image.'
  if (file.size > MAX_IMAGE_BYTES) {
    return `That image is ${(Math.ceil((file.size / 1024 / 1024) * 10) / 10).toFixed(1)} MB. The limit is 5 MB.`
  }
  return null
}

/** Where a picture is stored: the first folder is its owner, which the bucket's rules key on. */
export function lineupImagePath(userId: string, lineupId: string, slot: LineupImageSlot, mimeType: string, now: number = Date.now()): string {
  return `${userId}/${lineupId}/${slot}-${now}.${IMAGE_EXTENSIONS[mimeType] ?? 'webp'}`
}

/** How many of its three pictures a line-up has. */
export function pictureCount(lineup: Pick<Lineup, 'stand_image' | 'aim_image' | 'result_image'>): number {
  return LINEUP_IMAGE_SLOTS.filter(slot => lineup[imageColumn(slot)]).length
}

/** The ids of the line-ups hidden from the map, as kept on the device: a JSON list of strings, anything else none. */
export function parseHiddenIds(raw: string | null): ReadonlySet<string> {
  if (!raw) return new Set()
  try {
    const list: unknown = JSON.parse(raw)
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** `set` with `ids` put in (`on`) or taken out: the same set when nothing changes. */
export function toggled(set: ReadonlySet<string>, ids: readonly string[], on: boolean): ReadonlySet<string> {
  if (ids.every(id => set.has(id) === on)) return set
  const next = new Set(set)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  return next
}

/** The abilities in the order of their keys: C, Q, E, X. */
const SLOT_ORDER: readonly AbilitySlot[] = ['Grenade', 'Ability1', 'Ability2', 'Ultimate']

/** The line-ups of one ability. */
export interface AbilityGroup<T> {
  agent: string
  slot: AbilitySlot
  rows: T[]
}

/**
 * Line-ups by ability, for the list: agents by name, each agent's abilities
 * in the order of their keys, and an ability's line-ups by name.
 */
export function groupByAbility<T extends Pick<Lineup, 'agent' | 'slot' | 'title'>>(rows: readonly T[]): AbilityGroup<T>[] {
  const groups = new Map<string, AbilityGroup<T>>()
  for (const row of rows) {
    const key = `${row.agent}\n${row.slot}`
    const group = groups.get(key) ?? { agent: row.agent, slot: row.slot, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.title.localeCompare(b.title))
  return [...groups.values()].sort((a, b) => a.agent.localeCompare(b.agent) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
}

/**
 * The line colour a group of line-ups shares: that colour, null when they all
 * take their ability's own, undefined when they do not agree (or there are
 * none).
 */
export function sharedLineColor(rows: ReadonlyArray<Pick<Lineup, 'line_color'>>): string | null | undefined {
  if (rows.length === 0) return undefined
  const first = rows[0].line_color
  return rows.every(row => row.line_color === first) ? first : undefined
}
