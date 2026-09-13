/**
 * Moments — labelled timestamps inside a chapter body (Sprint 6c).
 *
 * Derived from the stored transcript_excerpt at render time, so existing
 * playbooks get them without a migration or re-import. Pure: runs under
 * `npm test`.
 *
 * A moment is a timestamp attached to a bold label, e.g.
 *   **Style A — early info, then rotate (~03:29–06:00)**
 *   **Garage start (~17:01–18:29):** use only one smoke…
 *   - **C `[1:14:06–1:19:15]`:** shock the trip…
 * or to a sub-heading inside the chapter (#### Retake `[12:00–13:10]`).
 * Unlabelled mid-sentence times ("… (~02:37)") are not moments, but
 * linkifyTimestamps / splitTimestamps make every timestamp clickable in text.
 */

import { parseTimestamp } from './playbookParser.ts'

export interface ChapterMoment {
  label: string
  start_seconds: number
  /** Null for a single point in time. */
  end_seconds: number | null
}

const TS = String.raw`\d{1,2}(?::\d{2}){1,2}`
const DASH = String.raw`\s*[–—-]\s*`

// "(~03:29–06:00)", "(~02:57)", "(`~06:43–10:13`)", "`[13:00–18:38]`", "[13:00–18:38]"
const STAMP = String.raw`(?:\(\x60?~?(${TS})(?:${DASH}~?(${TS}))?\x60?\)|\x60?\[~?(${TS})(?:${DASH}~?(${TS}))?\]\x60?)`

// **Label STAMP** or **Label STAMP:** anywhere on the line.
const BOLD_LABEL = new RegExp(String.raw`\*\*([^*]+?)\s*${STAMP}\s*:?\s*\*\*`, 'g')
// #### Label STAMP (sub-headings inside the chapter body).
const HEADING_LABEL = new RegExp(String.raw`^#{3,6}\s+(.+?)\s*${STAMP}\s*$`)
// A line that opens with a bold label ("- **Fall back to the smoke** — …"),
// optionally after a list marker or quote marker.
const BOLD_LEAD = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*([^*]+)\*\*/
// First timestamp anywhere on a line: "~07:14–07:53", "`~06:43`", "[1:14:06–1:19:15]".
const FIRST_STAMP = new RegExp(String.raw`\x60?\[~?(${TS})(?:${DASH}~?(${TS}))?\]\x60?|~(${TS})(?:${DASH}~?(${TS}))?`)

function cleanLabel(raw: string): string {
  return raw
    .replace(/[*_\x60]/g, '')
    .replace(/[\s:–—-]+$/, '')
    .trim()
}

function toMoment(label: string, groups: (string | undefined)[]): ChapterMoment | null {
  // STAMP has two alternatives, each with a start and optional end group.
  const [a1, a2, b1, b2] = groups
  const start = parseTimestamp(a1 ?? b1 ?? '')
  if (start === null || !label) return null
  const endRaw = a1 ? a2 : b2
  const end = endRaw ? parseTimestamp(endRaw) : null
  return { label, start_seconds: start, end_seconds: end !== null && end > start ? end : null }
}

/**
 * Labelled moments in a chapter body, in time order. When a chapter range is
 * given, moments starting outside it are dropped (they reference other parts
 * of the video and would jump somewhere unexpected).
 */
export function extractMoments(
  body: string | null | undefined,
  range?: { start_seconds: number; end_seconds: number },
): ChapterMoment[] {
  if (!body) return []
  const found: ChapterMoment[] = []
  let inFence = false

  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue

    const heading = line.match(HEADING_LABEL)
    if (heading) {
      const m = toMoment(cleanLabel(heading[1]), heading.slice(2, 6))
      if (m) found.push(m)
      continue
    }

    // 1. Timestamp inside the bold label itself.
    let matched = false
    for (const match of line.matchAll(BOLD_LABEL)) {
      const m = toMoment(cleanLabel(match[1]), match.slice(2, 6))
      if (m) {
        found.push(m)
        matched = true
      }
    }
    if (matched) continue

    const stamp = line.match(FIRST_STAMP)
    if (!stamp) continue

    // 2. Table row: the first cell is the label, the row's first timestamp the time.
    if (/^\s*\|/.test(line)) {
      const firstCell = line.split('|')[1] ?? ''
      if (/^[\s:-]*$/.test(firstCell)) continue // separator row
      const m = toMoment(cleanLabel(firstCell), stamp.slice(1, 5))
      if (m) found.push(m)
      continue
    }

    // 3. Line that opens with a bold label, timestamp later on the same line.
    const lead = line.match(BOLD_LEAD)
    if (lead) {
      const m = toMoment(cleanLabel(lead[1]), stamp.slice(1, 5))
      if (m) found.push(m)
    }
  }

  const seen = new Set<string>()
  return found
    .filter(m => !range || (m.start_seconds >= range.start_seconds && m.start_seconds <= range.end_seconds))
    .filter(m => {
      const key = `${m.start_seconds}|${m.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((x, y) => x.start_seconds - y.start_seconds)
}

// Any timestamp in running text, with or without a label. Group 1 or 2 = start.
// Surrounding backticks are part of the match so a code span becomes a plain link.
const ANY_STAMP = new RegExp(String.raw`\x60?\[~?(${TS})(?:${DASH}~?${TS})?\]\x60?|\x60?~(${TS})(?:${DASH}~?${TS})?\x60?`, 'g')

export type TextSegment = { text: string } | { text: string; seconds: number }

/** Splits plain text so every timestamp can be rendered as a jump link. */
export function splitTimestamps(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(ANY_STAMP)) {
    const seconds = parseTimestamp(match[1] ?? match[2] ?? '')
    if (seconds === null || match.index === undefined) continue
    if (match.index > last) segments.push({ text: text.slice(last, match.index) })
    segments.push({ text: match[0], seconds })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

/** Link target used for timestamps inside rendered markdown. */
export const TIMESTAMP_HREF_PREFIX = '#t='

/**
 * Rewrites timestamps in markdown as links (`[~02:37](#t=157)`) so the Notes
 * tab can turn them into jumps. Code-span ranges lose their backticks, since
 * links don't render inside code.
 */
export function linkifyTimestamps(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
      if (inFence) return line
      return line.replace(ANY_STAMP, (whole, a, b) => {
        const seconds = parseTimestamp(a ?? b ?? '')
        if (seconds === null) return whole
        const label = whole.replace(/^\x60|\x60$/g, '').replace(/[[\]]/g, '')
        return `[${label}](${TIMESTAMP_HREF_PREFIX}${seconds})`
      })
    })
    .join('\n')
}
