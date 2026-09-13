/**
 * Parses an Obsidian map-analysis note into a playbook + chapters.
 *
 * Pure and dependency-free so it runs in the browser and under `npm test`.
 *
 * The note shape it expects (what the vault's map-analysis notes actually use):
 *
 *   ---
 *   title: Haven Full Guide — …
 *   map: Haven
 *   side: both                 # attack | defense | both (optional)
 *   agent: Cypher              # optional
 *   duration: 01:29:46         # or video_duration; optional
 *   video_url: https://…       # optional — reader shows a "no video" state without it
 *   ---
 *
 *   ### Role 2 — Rotator Smokes (Clove lens) `[12:13–29:47]`
 *   …body…
 *   > [!warning] Bunker means accepting the A retake
 *   > Playing bunker acknowledges…
 *
 * Any ## or ### heading carrying a `[start–end]` range becomes a chapter. The
 * spec's original `## [MM:SS–MM:SS] Title` form is accepted too. A chapter's
 * body runs to the next timestamped heading, or the next heading at the same
 * or a higher level. Headings whose body is empty are section wrappers around
 * timestamped children and are skipped.
 */

export interface ParsedChapter {
  chapter_number: number
  title: string
  subtitle: string | null
  start_seconds: number
  end_seconds: number
  notes_markdown: string
  key_takeaways: string[]
  transcript_excerpt: string
  role_context: string | null
}

export interface ParsedPlaybook {
  title: string
  slug: string
  map: string
  agent: string | null
  side: 'attack' | 'defense' | 'both' | null
  video_url: string | null
  video_duration_seconds: number | null
  description: string | null
  chapters: ParsedChapter[]
}

export type ParseResult =
  | { ok: true; playbook: ParsedPlaybook }
  | { ok: false; error: string }

// ──────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────

const TS = String.raw`\d{1,2}(?::\d{2}){1,2}`
const DASH = String.raw`\s*[–—-]\s*`

// `### Title [12:13–29:47]`, with or without backticks around the range.
const TRAILING_RANGE = new RegExp(String.raw`^(#{2,3})\s+(.+?)\s*\x60?\[(${TS})${DASH}(${TS})\]\x60?\s*$`)
// `## [12:13–29:47] Title` — the format the original spec described.
const LEADING_RANGE = new RegExp(String.raw`^(#{2,3})\s*\x60?\[(${TS})${DASH}(${TS})\]\x60?\s*(.+)$`)
const ANY_HEADING = /^(#{1,6})\s+\S/
const CALLOUT_START = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/

// Callout types that describe the note or ask questions rather than teach.
const NON_TAKEAWAY_CALLOUTS = new Set(['abstract', 'summary', 'tldr', 'question', 'help', 'faq', 'quote', 'cite', 'todo'])

/** "1:29:46", "12:13", "~17:00" → seconds. Null when unparseable. */
export function parseTimestamp(raw: string): number | null {
  const cleaned = raw.trim().replace(/^~/, '')
  if (!/^\d{1,2}(?::\d{1,2}){1,2}$/.test(cleaned)) return null
  const parts = cleaned.split(':').map(Number)
  if (parts.slice(1).some(p => p >= 60)) return null
  return parts.reduce((total, p) => total * 60 + p, 0)
}

/** Seconds → "M:SS" or "H:MM:SS". */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "Haven Full Guide — Five Roles!" → "haven-full-guide-five-roles". */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
    /youtube\.com\/live\/([\w-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function normalizeSide(raw: string | null): ParsedPlaybook['side'] | 'invalid' {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (['attack', 'attacking', 'atk'].includes(v)) return 'attack'
  if (['defense', 'defence', 'defending', 'def'].includes(v)) return 'defense'
  if (['both', 'all'].includes(v)) return 'both'
  return 'invalid'
}

// ──────────────────────────────────────────────────────────────────────────
// Frontmatter — top-level scalar keys only. Lists and nested maps are ignored;
// nothing the importer reads needs them.
// ──────────────────────────────────────────────────────────────────────────

export function parseFrontmatter(markdown: string): { data: Record<string, string>; body: string } | null {
  const text = markdown.replace(/^\uFEFF/, '')
  const match = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!match) return null

  const data: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (value) data[kv[1].toLowerCase()] = value
  }

  return { data, body: text.slice(match[0].length) }
}

// ──────────────────────────────────────────────────────────────────────────
// Callouts
// ──────────────────────────────────────────────────────────────────────────

interface Callout {
  type: string
  title: string
  content: string
  startLine: number
  endLine: number // exclusive
}

function findCallouts(lines: string[]): Callout[] {
  const callouts: Callout[] = []
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].match(CALLOUT_START)
    if (!start) continue
    let j = i + 1
    const content: string[] = []
    while (j < lines.length && lines[j].startsWith('>')) {
      content.push(lines[j].replace(/^>\s?/, ''))
      j++
    }
    callouts.push({
      type: start[1].toLowerCase(),
      title: start[2].trim(),
      content: content.join('\n').trim(),
      startLine: i,
      endLine: j,
    })
    i = j - 1
  }
  return callouts
}

function calloutToTakeaway(c: Callout): string {
  const content = c.content.replace(/\s*\n\s*/g, ' ')
  if (c.title && content) return `**${c.title}** — ${content}`
  return c.title || content
}

function tidy(lines: string[]): string {
  // Drop trailing horizontal rules / blank lines, collapse runs of blank lines.
  const out = [...lines]
  while (out.length && /^\s*(---+)?\s*$/.test(out[out.length - 1])) out.pop()
  while (out.length && /^\s*$/.test(out[0])) out.shift()
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────

interface Heading {
  line: number
  level: number
  timed: { title: string; start: string; end: string } | null
}

function readHeading(line: string): { level: number; timed: Heading['timed'] } | null {
  const trailing = line.match(TRAILING_RANGE)
  if (trailing) return { level: trailing[1].length, timed: { title: trailing[2], start: trailing[3], end: trailing[4] } }
  const leading = line.match(LEADING_RANGE)
  if (leading) return { level: leading[1].length, timed: { title: leading[4].trim(), start: leading[2], end: leading[3] } }
  const plain = line.match(ANY_HEADING)
  if (plain) return { level: plain[1].length, timed: null }
  return null
}

export function parsePlaybookMarkdown(markdown: string): ParseResult {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const fm = parseFrontmatter(normalized)
  if (!fm) {
    return { ok: false, error: 'Missing frontmatter — the note must start with a --- block containing at least title and map.' }
  }

  const lines = fm.body.split('\n')

  // Headings, skipping anything inside fenced code blocks.
  const headings: Heading[] = []
  let inFence = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) return
    const h = readHeading(line)
    if (h) headings.push({ line: i, ...h })
  })

  const title = fm.data.title ?? lines.find(l => /^#\s+\S/.test(l))?.replace(/^#\s+/, '').trim()
  if (!title) return { ok: false, error: 'Missing title — add `title:` to the frontmatter.' }

  const map = fm.data.map
  if (!map) return { ok: false, error: 'Missing map — add `map:` (e.g. `map: Haven`) to the frontmatter.' }

  const side = normalizeSide(fm.data.side ?? null)
  if (side === 'invalid') {
    return { ok: false, error: `Invalid side "${fm.data.side}" — use attack, defense or both.` }
  }

  const videoUrl = fm.data.video_url ?? null
  if (videoUrl && !extractYouTubeId(videoUrl)) {
    return { ok: false, error: `video_url "${videoUrl}" isn't a YouTube link.` }
  }

  const rawDuration = fm.data.video_duration ?? fm.data.duration ?? null
  const videoDuration = rawDuration ? parseTimestamp(rawDuration) : null

  const callouts = findCallouts(lines)
  const calloutsIn = (from: number, to: number) => callouts.filter(c => c.startLine >= from && c.startLine < to)

  const chapters: ParsedChapter[] = []
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h]
    if (!heading.timed) continue

    const next = headings.slice(h + 1).find(n => n.timed || n.level <= heading.level)
    const bodyStart = heading.line + 1
    const bodyEnd = next ? next.line : lines.length
    const bodyLines = lines.slice(bodyStart, bodyEnd)
    const transcript = tidy(bodyLines)
    if (!transcript) continue // section wrapper around timestamped children

    const start = parseTimestamp(heading.timed.start)
    const end = parseTimestamp(heading.timed.end)
    const label = heading.timed.title
    if (start === null || end === null) {
      return { ok: false, error: `Malformed timestamp in "${label}" — use M:SS, MM:SS or H:MM:SS.` }
    }
    if (end <= start) {
      return { ok: false, error: `Chapter "${label}" ends (${heading.timed.end}) before it starts (${heading.timed.start}).` }
    }

    const own = calloutsIn(bodyStart, bodyEnd)
    const keep = bodyLines.filter((_, i) => !own.some(c => bodyStart + i >= c.startLine && bodyStart + i < c.endLine))

    chapters.push({
      chapter_number: chapters.length + 1,
      title: label,
      subtitle: null,
      start_seconds: start,
      end_seconds: end,
      notes_markdown: tidy(keep),
      key_takeaways: own.filter(c => !NON_TAKEAWAY_CALLOUTS.has(c.type)).map(calloutToTakeaway).filter(Boolean),
      transcript_excerpt: transcript,
      role_context: label.match(/\(([^()]*\blens)\)/i)?.[1] ?? null,
    })
  }

  if (chapters.length === 0) {
    return {
      ok: false,
      error: 'No chapters found — add a time range to the end of each chapter heading, e.g. ### Retakes `[12:13–29:47]`.',
    }
  }

  const firstChapterLine = headings.find(h => h.timed)?.line ?? lines.length
  const essence = callouts.find(c => c.startLine < firstChapterLine && ['abstract', 'summary', 'tldr'].includes(c.type))

  return {
    ok: true,
    playbook: {
      title,
      slug: slugify(title),
      map,
      agent: fm.data.agent ?? null,
      side,
      video_url: videoUrl,
      video_duration_seconds: videoDuration,
      description: fm.data.description ?? essence?.content ?? null,
      chapters,
    },
  }
}
