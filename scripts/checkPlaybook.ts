/**
 * Prints the chapter → moment tree VAL Master will show for a vault note, and
 * checks the note against the valorant-map-analysis playbook contract.
 *
 * Run:  npm run check:playbook -- <note.md> [more notes…]
 *
 * Uses the app's own parser and moment extractor, so the tree is exactly what
 * the playbook reader renders — this is the ground truth the skill's bundled
 * `check_moments.py` is compared against. Reads files only; touches nothing.
 *
 * Exit code 1 when any note has an error. Warnings never fail.
 *
 * Contracts: vault `2026-09-21-VAL-Master-Map-Analysis-Skill-Moments-Spec` and
 * `2026-09-21-VAL-Master-Playbook-Skill-Spec`.
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { formatTimestamp as f, parseFrontmatter, parsePlaybookMarkdown, parseTimestamp } from '../src/lib/playbookParser'
import { extractMoments } from '../src/lib/playbookMoments'

const TS = String.raw`\d{1,2}(?::\d{2}){1,2}`
/** The one moment syntax the skill writes: #### Title `[a–b]`. */
const MOMENT_HEADING = new RegExp(String.raw`^####\s+(.+?)\s*\x60\[(${TS})\s*[–—-]\s*(${TS})\]\x60\s*$`)
/** A time inside parentheses with no `~` — neither a moment nor clickable. */
const BARE_TIME = new RegExp(String.raw`\((${TS})(?:\s*[–—-]\s*${TS})?\)`)
const TIMED_CHAPTER = new RegExp(String.raw`^#{2,3}\s.*\[${TS}\s*[–—-]\s*${TS}\]`)
const WEAK_TITLES = /^(tips?|misc|example( \d+)?|other|notes?|job|standard|[a-c]|mid)$/i

function check(path: string): boolean {
  const raw = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
  const errors: string[] = []
  const warnings: string[] = []

  const parsed = parsePlaybookMarkdown(raw)
  console.log(`\n━━ ${basename(path)}`)
  if (!parsed.ok) {
    console.log(`  ✖ ${parsed.error}`)
    return false
  }
  const { playbook } = parsed
  const fm = parseFrontmatter(raw)?.data ?? {}

  // ── Frontmatter ─────────────────────────────────────────────────────────
  if (fm['video-link'] !== undefined) errors.push('frontmatter has `video-link:` — the app reads `video_url:`')
  if (!playbook.video_url) errors.push('no `video_url:` — the reader will show "No video linked"')
  if (!/^(attack|defense|both)$/.test(fm.side ?? '')) warnings.push('`side:` should be attack, defense or both')

  // ── Chapters ────────────────────────────────────────────────────────────
  const chapters = playbook.chapters
  const byNumber = new Map(chapters.map(c => [c.chapter_number, c]))
  const parents = chapters.filter(c => chapters.some(k => k.parent_chapter_number === c.chapter_number))

  if (playbook.side === 'both') {
    if (parents.length < 2) {
      errors.push(`side is both but ${parents.length} half parent(s) found — both halves need a timed \`##\` with \`###\` chapters under it`)
    }
  } else if (parents.length > 0) {
    warnings.push(`side is ${playbook.side ?? 'unset'} but the note nests chapters under ${parents.map(p => `"${p.title}"`).join(', ')}`)
  }

  for (const c of chapters) {
    if (c.depth !== 2) continue
    const parent = byNumber.get(c.parent_chapter_number!)!
    if (c.start_seconds < parent.start_seconds || c.end_seconds > parent.end_seconds) {
      errors.push(`"${c.title}" [${f(c.start_seconds)}–${f(c.end_seconds)}] lies outside its half "${parent.title}" [${f(parent.start_seconds)}–${f(parent.end_seconds)}]`)
    }
  }

  const leaves = chapters.filter(c => !parents.includes(c))
  for (let i = 1; i < leaves.length; i++) {
    if (leaves[i].start_seconds < leaves[i - 1].end_seconds) {
      errors.push(`"${leaves[i].title}" starts before "${leaves[i - 1].title}" ends`)
    }
  }

  // Untimed ## / ### between the first and last chapter heading end a chapter body early.
  const lines = raw.split('\n')
  const chapterLines = lines.flatMap((l, i) => (TIMED_CHAPTER.test(l) ? [i] : []))
  let inFence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence
    if (inFence || i <= chapterLines[0] || i >= chapterLines[chapterLines.length - 1]) return
    if (/^#{2,3}\s/.test(l) && !TIMED_CHAPTER.test(l)) {
      errors.push(`line ${i + 1}: untimed heading "${l.trim()}" between chapters — the text under it is lost`)
    }
  })

  // ── Moments ─────────────────────────────────────────────────────────────
  let momentTotal = 0
  console.log(`  ${playbook.title}  ·  ${chapters.length} chapters  ·  ${playbook.video_url ? 'video ✓' : 'video ✗'}`)

  for (const c of chapters) {
    const moments = extractMoments(c.transcript_excerpt, c)
    momentTotal += moments.length
    const indent = c.depth === 2 ? '    ' : ''
    const lens = c.role_context ? ` · ${c.role_context}` : ''
    console.log(`  ${indent}${c.chapter_number} ▶ ${c.title}  ${f(c.start_seconds)}-${f(c.end_seconds)}${lens}`)
    for (const m of moments) {
      console.log(`  ${indent}      ↳ ${m.label}  ${f(m.start_seconds)}${m.end_seconds !== null ? `-${f(m.end_seconds)}` : ''}`)
    }

    const body = c.transcript_excerpt ?? ''
    const headingMoments = new Map<string, { start: number; end: number }>()
    for (const line of body.split('\n')) {
      const h = line.match(MOMENT_HEADING)
      if (h) headingMoments.set(h[1].replace(/[*_\x60]/g, '').trim(), { start: parseTimestamp(h[2])!, end: parseTimestamp(h[3])! })
      if (BARE_TIME.test(line) && !/^#/.test(line)) warnings.push(`"${c.title}": time without \`~\` is not clickable — ${line.trim().slice(0, 70)}`)
    }

    if (parents.includes(c)) {
      if (moments.length) errors.push(`half "${c.title}" has moments — a half carries only its **Frame:** line`)
      continue
    }

    // Anything the app lists that isn't a `#### Title [a–b]` line: a timed bold
    // label, bold-led line or table row, or a #### with a single time.
    // Unranged, so a timed bold line pointing outside the chapter is caught too —
    // the app drops it silently, but it is still the wrong syntax.
    const accidental = extractMoments(body)
      .filter(m => !headingMoments.has(m.label))
      .map(m => `"${m.label}"`)
    if (accidental.length) {
      errors.push(`"${c.title}": ${accidental.length} moment(s) not written as \`#### Title [a–b]\` — ${accidental.join(', ')}`)
    }
    for (const m of moments) {
      if (WEAK_TITLES.test(m.label)) errors.push(`"${c.title}": moment title "${m.label}" is a topic label, not a situation`)
    }

    for (const [label, r] of headingMoments) {
      if (r.start < c.start_seconds || r.start > c.end_seconds) {
        errors.push(`"${c.title}": moment "${label}" starts outside the chapter — VAL Master drops it`)
      }
      if (r.end > c.end_seconds) errors.push(`"${c.title}": moment "${label}" ends after the chapter`)
    }

    const ordered = [...headingMoments.values()]
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].start < ordered[i - 1].start) errors.push(`"${c.title}": moments are out of order`)
      else if (ordered[i].start < ordered[i - 1].end) errors.push(`"${c.title}": moments overlap`)
    }

    const labels = [...headingMoments.keys()]
    if (new Set(labels).size !== labels.length) errors.push(`"${c.title}": duplicate moment titles`)

    if (c.end_seconds - c.start_seconds > 120 && moments.length < 2) {
      warnings.push(`"${c.title}" runs ${f(c.end_seconds - c.start_seconds)} with ${moments.length} moment(s)`)
    }
  }

  // ── Counts ──────────────────────────────────────────────────────────────
  if (fm.chapters !== undefined && Number(fm.chapters) !== chapters.length) {
    errors.push(`frontmatter chapters: ${fm.chapters}, parsed ${chapters.length}`)
  }
  if (fm.moments !== undefined && Number(fm.moments) !== momentTotal) {
    errors.push(`frontmatter moments: ${fm.moments}, parsed ${momentTotal}`)
  }
  if (fm.chapters === undefined || fm.moments === undefined) warnings.push('frontmatter is missing `chapters:` / `moments:`')

  console.log(`  ${chapters.length} chapters · ${momentTotal} moments`)
  for (const e of errors) console.log(`  ✖ ${e}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  if (!errors.length) console.log('  ✔ contract satisfied')
  return errors.length === 0
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('Usage: npm run check:playbook -- <note.md> [more notes…]')
  process.exit(2)
}
const results = files.map(check)
process.exit(results.every(Boolean) ? 0 : 1)
