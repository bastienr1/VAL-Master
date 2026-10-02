/**
 * Art slots: the pictures on Home, each swappable without a deploy.
 *
 * A slot is a named place a picture goes (`hero.background`, `tile.stats`,
 * `map.<uuid>`). What it shows is the first of these that exists and loads:
 *
 *   1. override — the user's own image, a row in `art_slots`
 *   2. api      — the game's image, for map and agent slots
 *   3. bundled  — `/art/<slot>.webp`, shipped in `public/art/`
 *   4. gradient — plain CSS, always there, so nothing ever renders broken
 *
 * This file is the pure half: the catalogue and the rules. The Supabase half is
 * `artSlotStore.ts` (migration `20261002_art_slots.sql`).
 */

export interface ArtSlotRow {
  id: string
  user_id: string
  slot_key: string
  image_url: string
  /** Null when `image_url` is an external link rather than a file in the bucket. */
  storage_path: string | null
  /** object-position, 0–1 on each axis. */
  focal_x: number
  focal_y: number
  /** Strength of the scrim between the image and the text over it, 0–1. */
  overlay: number
  /** Hero only: the video behind "Watch Overview". */
  href: string | null
  label: string | null
  active_from: string
  active_until: string | null
  created_at: string
}

export type ArtSource = 'override' | 'api' | 'bundled' | 'gradient'

/** Which way the scrim darkens: towards the side the text sits on. */
export type ScrimDirection = 'left' | 'bottom' | 'radial'

export const DEFAULT_FOCAL = { x: 0.5, y: 0.5 }
export const DEFAULT_OVERLAY = 0.55

// ──────────────────────────────────────────────────────────────────────────
// Catalogue
// ──────────────────────────────────────────────────────────────────────────

export interface SlotSpec {
  key: string
  label: string
  /** Size to generate art at; also the aspect ratio of the admin preview. */
  width: number
  height: number
  /** Where to keep the picture calm so the text over it stays readable. */
  composition: string
  scrim: ScrimDirection
  /** Text the admin preview lays over the image. */
  sample: { title: string; sub: string }
}

export const SLOT_KEYS = {
  hero: 'hero.background',
  tilePlaybook: 'tile.playbook',
  tileStats: 'tile.stats',
  tileProVod: 'tile.provod',
  tileGoals: 'tile.goals',
  banner: 'cta.banner',
} as const

const TILE_COMPOSITION = 'Bottom-left kept clear for title + subline'

/** The fixed slots, in page order. Map and agent slots are per UUID, below. */
export const STATIC_SLOTS: SlotSpec[] = [
  {
    key: SLOT_KEYS.hero,
    label: 'Hero background',
    width: 2560,
    height: 1100,
    composition: 'Subject in the right third. Left 45% calm for the headline',
    scrim: 'left',
    sample: { title: 'Review. Learn. Improve.', sub: 'Same games. Different you.' },
  },
  {
    key: SLOT_KEYS.tilePlaybook,
    label: 'Playbook tile',
    width: 1200,
    height: 600,
    composition: TILE_COMPOSITION,
    scrim: 'bottom',
    sample: { title: 'Playbook', sub: 'Turn insights into habits.' },
  },
  {
    key: SLOT_KEYS.tileStats,
    label: 'Stats tile',
    width: 1200,
    height: 600,
    composition: TILE_COMPOSITION,
    scrim: 'bottom',
    sample: { title: 'Stats', sub: 'Track your growth.' },
  },
  {
    key: SLOT_KEYS.tileProVod,
    label: 'Pro VOD tile',
    width: 1200,
    height: 600,
    composition: TILE_COMPOSITION,
    scrim: 'bottom',
    sample: { title: 'Pro VOD', sub: 'Learn from the best.' },
  },
  {
    key: SLOT_KEYS.tileGoals,
    label: 'Goals tile',
    width: 1200,
    height: 600,
    composition: TILE_COMPOSITION,
    scrim: 'bottom',
    sample: { title: 'Goals', sub: 'Build your next milestone.' },
  },
  {
    key: SLOT_KEYS.banner,
    label: 'Closing banner',
    width: 2400,
    height: 400,
    composition: 'Centre-left calm for the headline',
    scrim: 'left',
    sample: { title: 'From review to improvement.', sub: 'Save patterns. Build habits. Play better.' },
  },
]

export const mapSlotKey = (uuid: string) => `map.${uuid}`
export const agentSlotKey = (uuid: string) => `agent.${uuid}`

export function mapSlotSpec(uuid: string, name: string): SlotSpec {
  return {
    key: mapSlotKey(uuid),
    label: name,
    width: 900,
    height: 1200,
    composition: 'Landmark in the upper half. Lower 40% gets the stats overlay',
    scrim: 'bottom',
    sample: { title: name, sub: '2 guides · 3 pro VODs · 5 your VODs' },
  }
}

export function agentSlotSpec(uuid: string, name: string): SlotSpec {
  return {
    key: agentSlotKey(uuid),
    label: name,
    width: 800,
    height: 800,
    composition: 'Face in the upper-centre',
    scrim: 'bottom',
    sample: { title: name, sub: '57% WR · 12 matches' },
  }
}

/** Where a slot's bundled default lives, whether or not the file is there. */
export function bundledArtUrl(slotKey: string): string {
  return `/art/${slotKey}.webp`
}

// ──────────────────────────────────────────────────────────────────────────
// Which override is showing
// ──────────────────────────────────────────────────────────────────────────

const time = (iso: string) => new Date(iso).getTime()

function isInWindow(row: ArtSlotRow, now: number): boolean {
  return time(row.active_from) <= now && (row.active_until === null || time(row.active_until) > now)
}

/** Newer `active_from` wins; rows saved for the same instant fall back to `created_at`. */
function isNewer(a: ArtSlotRow, b: ArtSlotRow): boolean {
  const byStart = time(a.active_from) - time(b.active_from)
  return byStart !== 0 ? byStart > 0 : time(a.created_at) > time(b.created_at)
}

/**
 * The row showing in each slot right now: the newest by `active_from` among the
 * rows whose window contains `now`. A row dated tomorrow is ignored until
 * tomorrow, which is how art gets scheduled to change with an act.
 */
export function pickActiveSlots(rows: ArtSlotRow[], now: Date = new Date()): Map<string, ArtSlotRow> {
  const t = now.getTime()
  const active = new Map<string, ArtSlotRow>()
  for (const row of rows) {
    if (!isInWindow(row, t)) continue
    const current = active.get(row.slot_key)
    if (!current || isNewer(row, current)) active.set(row.slot_key, row)
  }
  return active
}

export type SlotRowStatus = 'live' | 'scheduled' | 'covered' | 'expired'

/**
 * Where a row stands, for the admin list. `covered` is in its window but under
 * a newer row; it comes back if that one is removed or runs out.
 */
export function slotRowStatus(row: ArtSlotRow, rows: ArtSlotRow[], now: Date = new Date()): SlotRowStatus {
  const t = now.getTime()
  if (time(row.active_from) > t) return 'scheduled'
  if (!isInWindow(row, t)) return 'expired'
  return pickActiveSlots(rows, now).get(row.slot_key)?.id === row.id ? 'live' : 'covered'
}

// ──────────────────────────────────────────────────────────────────────────
// Fallback order
// ──────────────────────────────────────────────────────────────────────────

export interface ArtCandidate {
  src: string
  source: Exclude<ArtSource, 'gradient'>
}

/**
 * The images to try for a slot, best first. `<ArtSlot>` walks down the list as
 * each one fails to load and shows its gradient when the list runs out.
 */
export function artCandidates(
  slotKey: string,
  override: Pick<ArtSlotRow, 'image_url'> | null | undefined,
  apiDefault?: string | null,
): ArtCandidate[] {
  const candidates: ArtCandidate[] = []
  if (override?.image_url) candidates.push({ src: override.image_url, source: 'override' })
  if (apiDefault) candidates.push({ src: apiDefault, source: 'api' })
  candidates.push({ src: bundledArtUrl(slotKey), source: 'bundled' })
  return candidates
}

// ──────────────────────────────────────────────────────────────────────────
// Uploads
// ──────────────────────────────────────────────────────────────────────────

/** Mirrors the `site-art` bucket's own limits, so the refusal is immediate. */
export const MAX_ART_BYTES = 5 * 1024 * 1024

const ART_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

export const ART_ACCEPT = Object.keys(ART_EXTENSIONS).join(',')

/** An error message, or null when the file can be uploaded. */
export function validateArtFile(file: { size: number; type: string }): string | null {
  if (!(file.type in ART_EXTENSIONS)) return 'Use a WebP, PNG or JPEG image.'
  if (file.size > MAX_ART_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`
  }
  return null
}

export function artStoragePath(userId: string, slotKey: string, mimeType: string, now: number = Date.now()): string {
  return `${userId}/${slotKey}/${now}.${ART_EXTENSIONS[mimeType] ?? 'webp'}`
}

/** Clamps a focal point or overlay into the 0–1 the table accepts. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
