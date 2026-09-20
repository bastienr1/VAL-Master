/**
 * Obsidian VOD-library note → study guide rows.
 *
 * The `valorant-vod-library` skill writes notes with a fixed shape: frontmatter,
 * a chapter container (`## Core Breakdown` / `## Core Concepts`, plus `## …
 * Half` blocks on the older map guides) whose `###` headings each carry a
 * `` `[MM:SS–MM:SS]` `` range, and — on the newer notes — a `## Practice
 * Extraction` table. This module turns that text into rows; the import script
 * around it does the file walking and the Supabase writes.
 *
 * Kept DOM-free and dependency-free in `src/lib` for two reasons: `npm test`
 * only looks at `src/**`, and this frontmatter is simple enough that a
 * `gray-matter` dependency would buy nothing — the same call the seed script's
 * hand-rolled `.env` reader made.
 */

// ------------------------------------------------------------------ frontmatter

/** A frontmatter value is a scalar or a `- ` list; nothing here nests deeper. */
export type FrontmatterValue = string | string[]
export type Frontmatter = Record<string, FrontmatterValue>

function unquote(raw: string): string {
  const value = raw.trim()
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  return quoted && value.length >= 2 ? value.slice(1, -1) : value
}

/**
 * Splits a note into frontmatter and body.
 *
 * Only the two shapes these notes use are recognised — `key: value`, and a
 * `key:` followed by indented `- item` lines. An indented line that is not a
 * list item is skipped rather than guessed at, so a future nested block cannot
 * silently land in the wrong key.
 */
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  // A byte-order mark ahead of the opening `---` would hide the frontmatter.
  // Compared by code point rather than matched as a literal, which would be an
  // invisible character sitting in the source.
  const normalised = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const lines = normalised.split(/\r?\n/)

  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: normalised }

  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (closing === -1) return { frontmatter: {}, body: normalised }

  const frontmatter: Frontmatter = {}
  let currentKey: string | null = null

  for (const line of lines.slice(1, closing)) {
    const listItem = line.match(/^\s+-\s+(.*)$/)
    if (listItem && currentKey) {
      const existing = frontmatter[currentKey]
      const item = unquote(listItem[1])
      if (Array.isArray(existing)) existing.push(item)
      else frontmatter[currentKey] = [item]
      continue
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/)
    if (!pair) continue // comment, blank, or an indented shape we don't read

    const [, key, rest] = pair
    currentKey = key
    // An empty value may open a list — or may just be an empty field. Store the
    // empty string; a following `- item` replaces it with the array.
    frontmatter[key] = unquote(rest)
  }

  return { frontmatter, body: lines.slice(closing + 1).join('\n') }
}

/** First value of a field, whether it was written as a scalar or a list. */
export function firstValue(value: FrontmatterValue | undefined): string | null {
  if (value === undefined) return null
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = (first ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Every value of a field as a list, dropping blanks. */
export function listValue(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  return items.map(v => v.trim()).filter(v => v !== '')
}

// ------------------------------------------------------------------------ time

/**
 * `MM:SS` / `HH:MM:SS` → seconds.
 *
 * Tolerates the approximation marks the vault carries (`~17:00`) and any
 * trailing comment, because a duration is metadata — a malformed one should not
 * cost the note its chapters.
 */
export function parseClock(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null

  const [, a, b, c] = match
  return c === undefined
    ? Number(a) * 60 + Number(b) // MM:SS
    : Number(a) * 3600 + Number(b) * 60 + Number(c) // HH:MM:SS
}

/** En dash, em dash or hyphen — the vault has used all three. */
const RANGE_BODY = '\\[\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?)\\s*[–—-]\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?)\\s*\\]'
/** A range in backticks at the very end of a heading. */
const TRAILING_RANGE = new RegExp('`' + RANGE_BODY + '`\\s*$')
/** The first range anywhere in a cell — Source cells sometimes list two. */
const ANY_RANGE = new RegExp(RANGE_BODY)

export interface TimeRange {
  start_seconds: number
  end_seconds: number
}

/** The first `[MM:SS–MM:SS]` anywhere in the text. */
export function findRange(text: string): TimeRange | null {
  const match = text.match(ANY_RANGE)
  if (!match) return null
  const start = parseClock(match[1])
  const end = parseClock(match[2])
  if (start === null || end === null) return null
  return { start_seconds: start, end_seconds: end }
}

// -------------------------------------------------------------------- sections

export interface ParsedSection {
  position: number
  heading: string
  start_seconds: number | null
  end_seconds: number | null
  map: string | null
  agent: string | null
  body_md: string
}

/**
 * H2s whose `###` children are chapters. Matched by *prefix*, not equality:
 * `2026-09-19-mada-mechanics-peek-trace-commit` writes its container as
 * ``## Core Breakdown `[01:51–10:32]` `` and an exact match finds no chapters
 * at all in that note.
 */
const CHAPTER_CONTAINERS = [
  /^core breakdown\b/i,
  /^core concepts\b/i,
  /^(attack|defen[cs]e)\s+half\b/i,
]

function isChapterContainer(headingText: string): boolean {
  const bare = headingText.replace(TRAILING_RANGE, '').trim()
  return CHAPTER_CONTAINERS.some(pattern => pattern.test(bare))
}

/** `Sunset · Raze (defense) — mid delay` → map, agent, heading. */
function splitHeading(text: string): { heading: string; map: string | null; agent: string | null } {
  const match = text.match(/^(.+?)\s+·\s+(.+?)\s+—\s+(.+)$/)
  if (!match) return { heading: text, map: null, agent: null }

  const [, map, rawAgent, rest] = match
  // A side in the agent slot describes the chapter, not the agent's name.
  const side = rawAgent.match(/^(.+?)\s*\((attack|defen[cs]e)\)$/i)
  return side
    ? { heading: `${rest} (${side[2].toLowerCase()})`, map, agent: side[1].trim() }
    : { heading: rest, map, agent: rawAgent }
}

export interface ParsedSections {
  sections: ParsedSection[]
  /** Chapter headings the note left unranged — `--strict` refuses these. */
  unranged: string[]
}

/**
 * Every `###` under a chapter container, in note order.
 *
 * An unranged heading is still imported, with null seconds: whole sections of
 * the older map guides are written that way, and skipping them would import
 * those guides as empty. The rail renders such rows unclickable, and the import
 * reports them so the note can be retrofitted.
 */
export function parseSections(body: string): ParsedSections {
  const lines = body.split(/\r?\n/)
  const sections: ParsedSection[] = []
  const unranged: string[] = []

  let inContainer = false
  let current: ParsedSection | null = null
  let bodyLines: string[] = []

  const closeCurrent = () => {
    if (!current) return
    current.body_md = bodyLines.join('\n').trim()
    sections.push(current)
    current = null
    bodyLines = []
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/)
    if (h2) {
      closeCurrent()
      inContainer = isChapterContainer(h2[1])
      continue
    }

    const h3 = line.match(/^###\s+(.*)$/)
    if (h3) {
      closeCurrent()
      if (!inContainer) continue

      const rawHeading = h3[1].trim()
      const range = rawHeading.match(TRAILING_RANGE)
      const withoutRange = rawHeading.replace(TRAILING_RANGE, '').trim()
      if (!range) unranged.push(withoutRange)

      const { heading, map, agent } = splitHeading(withoutRange)
      current = {
        position: sections.length + 1,
        heading,
        start_seconds: range ? parseClock(range[1]) : null,
        end_seconds: range ? parseClock(range[2]) : null,
        map,
        agent,
        body_md: '',
      }
      continue
    }

    if (current) bodyLines.push(line)
  }

  closeCurrent()
  return { sections, unranged }
}

// ---------------------------------------------------------------------- drills

export interface ParsedDrill {
  position: number
  title: string
  venue: string | null
  cue: string | null
  success_signal: string | null
  source_start_seconds: number | null
  source_end_seconds: number | null
  target_sessions: number | null
}

function splitCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

const SEPARATOR_ROW = /^\|?[\s:-]+\|[\s:|-]*$/

/**
 * `3 per session` → 3, `10 full clears` → 10, `15 min` → nothing.
 *
 * A minute count is a length, not a number of repetitions, so it must not become
 * a target — the Practice panel's progress line counts sessions.
 */
export function parseTargetSessions(venue: string | null): number | null {
  if (!venue) return null

  const pattern = /(\d+)\s+((?:[\w'’-]+\s+){0,2}?)(round|session|fight|clear|rep|min|minute|hour)s?\b/gi
  for (const match of venue.matchAll(pattern)) {
    const unit = match[3].toLowerCase()
    if (unit === 'min' || unit === 'minute' || unit === 'hour') continue
    return Number(match[1])
  }
  return null
}

export interface ParsedDrills {
  drills: ParsedDrill[]
  warnings: string[]
}

/**
 * The Practice Extraction table.
 *
 * Columns are located by header text rather than by index, so a note that adds
 * or reorders one still imports. Position comes from row order, not from the `#`
 * cell: position is a drill's identity across re-imports, and a note that
 * renumbers its rows badly should not re-point a user's logs.
 */
export function parseDrills(body: string): ParsedDrills {
  const lines = body.split(/\r?\n/)

  const start = lines.findIndex(line => /^##\s+practice extraction\b/i.test(line))
  if (start === -1) return { drills: [], warnings: ['no Practice Extraction section'] }

  const end = lines.findIndex((line, i) => i > start && /^##\s+/.test(line))
  const block = lines.slice(start + 1, end === -1 ? lines.length : end)

  const headerIndex = block.findIndex(
    (line, i) => line.trim().startsWith('|') && SEPARATOR_ROW.test(block[i + 1] ?? ''),
  )
  if (headerIndex === -1) {
    return { drills: [], warnings: ['Practice Extraction has no table'] }
  }

  const header = splitCells(block[headerIndex]).map(cell => cell.toLowerCase())
  const columnFor = (...prefixes: string[]) =>
    header.findIndex(cell => prefixes.some(prefix => cell.startsWith(prefix)))

  const titleIdx = columnFor('drill', 'rep')
  const venueIdx = columnFor('where', 'venue')
  const cueIdx = columnFor('cue')
  const successIdx = columnFor('success')
  const sourceIdx = columnFor('source')

  if (titleIdx === -1) {
    return {
      drills: [],
      warnings: [`Practice Extraction table has no Drill column (${header.join(' | ')})`],
    }
  }

  const drills: ParsedDrill[] = []
  for (const row of block.slice(headerIndex + 2)) {
    if (!row.trim().startsWith('|')) break // the table ends at the first non-row
    const cells = splitCells(row)
    const title = cells[titleIdx]?.trim()
    if (!title) continue

    const venue = venueIdx === -1 ? null : cells[venueIdx]?.trim() || null
    const range = findRange(sourceIdx === -1 ? '' : cells[sourceIdx] ?? '')

    drills.push({
      position: drills.length + 1,
      title,
      venue,
      cue: cueIdx === -1 ? null : cells[cueIdx]?.trim() || null,
      success_signal: successIdx === -1 ? null : cells[successIdx]?.trim() || null,
      source_start_seconds: range?.start_seconds ?? null,
      source_end_seconds: range?.end_seconds ?? null,
      target_sessions: parseTargetSessions(venue),
    })
  }

  return {
    drills,
    warnings: drills.length === 0 ? ['Practice Extraction table has no rows'] : [],
  }
}

// ----------------------------------------------------------------- whole notes

/** `Mada (NRG)` → player and team; the vault writes them in one field. */
export function splitPlayerAndTeam(raw: string | null): { player: string | null; team: string | null } {
  if (!raw) return { player: null, team: null }
  const match = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  return match
    ? { player: match[1].trim(), team: match[2].trim() }
    : { player: raw.trim(), team: null }
}

const CONTENT_TYPES = ['map-guide', 'pro-review', 'agent-guide', 'mechanics', 'mindset'] as const
export type ParsedContentType = (typeof CONTENT_TYPES)[number]

/** Folder name → content type, for the notes written before the field existed. */
const FOLDER_CONTENT_TYPES: Record<string, ParsedContentType> = {
  'map-analysis': 'map-guide',
  'pro-reviews': 'pro-review',
  'agent-guides': 'agent-guide',
  mechanics: 'mechanics',
  mindset: 'mindset',
}

/**
 * `content-type` from frontmatter, falling back to the folder.
 *
 * The map guides predate the field and sit in per-map subfolders
 * (`Map-Analysis/Abyss/…`), so the fallback reads the first path segment rather
 * than matching a two-segment prefix.
 */
export function contentTypeFor(
  relativePath: string,
  frontmatter: Frontmatter,
): ParsedContentType | null {
  const declared = firstValue(frontmatter['content-type'])?.toLowerCase()
  if (declared && (CONTENT_TYPES as readonly string[]).includes(declared)) {
    return declared as ParsedContentType
  }

  const folder = relativePath.split('/')[0]?.toLowerCase() ?? ''
  return FOLDER_CONTENT_TYPES[folder] ?? null
}

export interface ParsedGuide {
  frontmatter: Frontmatter
  sections: ParsedSection[]
  drills: ParsedDrill[]
  /** Everything worth printing in the import summary for this note. */
  warnings: string[]
  unranged: string[]
}

/** One note, parsed. Read-only — every write decision belongs to the script. */
export function parseGuideNote(raw: string): ParsedGuide {
  const { frontmatter, body } = parseFrontmatter(raw)
  const { sections, unranged } = parseSections(body)
  const { drills, warnings } = parseDrills(body)

  const all = [...warnings]
  if (sections.length === 0) {
    all.push('no chapters found (looked under Core Breakdown / Core Concepts / … Half)')
  }
  if (unranged.length > 0) {
    all.push(
      `${unranged.length} chapter heading${unranged.length === 1 ? '' : 's'} with no [MM:SS–MM:SS] range`,
    )
  }

  return { frontmatter, sections, drills, warnings: all, unranged }
}
