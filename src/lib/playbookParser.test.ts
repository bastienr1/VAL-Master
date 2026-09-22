/**
 * Unit tests for the playbook note parser.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`). Fixtures mirror the vault's map-analysis note format.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePlaybookMarkdown,
  parseTimestamp,
  formatTimestamp,
  slugify,
  extractYouTubeId,
  parseFrontmatter,
} from './playbookParser.ts'

const NOTE = `---
title: "Haven Full Guide — Five Roles"
map: Haven
side: both
duration: 01:29:46
video_url: https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10
tags:
  - valorant
---

# Haven Full Guide — Five Roles

> [!abstract] Essence
> Five defenders, one loop.

## Key Takeaways
- Not a chapter.

## Core Concepts

### Structure \`[00:00–02:03]\`

One C, one garage.

---

### Role 1 — C Sentinel (Cypher lens) \`[02:03–12:13]\`

Garage belongs to C.

> [!warning] Bunker means accepting the A retake
> Your job is to not die.

> [!question]- Open loop
> Is window smoke ever right?

## Attack Half \`[54:59–1:29:46]\`

### Defaults \`[1:27:52–1:29:46]\`

Rare on C.

## Practical Application

Not part of any chapter.
`

test('parses frontmatter scalars and ignores lists', () => {
  const fm = parseFrontmatter(NOTE)
  assert.ok(fm)
  assert.equal(fm.data.title, 'Haven Full Guide — Five Roles')
  assert.equal(fm.data.map, 'Haven')
  assert.equal(fm.data.tags, undefined)
})

test('timestamps accept M:SS, MM:SS and H:MM:SS', () => {
  assert.equal(parseTimestamp('2:03'), 123)
  assert.equal(parseTimestamp('12:13'), 733)
  assert.equal(parseTimestamp('1:29:46'), 5386)
  assert.equal(parseTimestamp('01:29:46'), 5386)
  assert.equal(parseTimestamp('~17:00'), 1020)
  assert.equal(parseTimestamp('12:75'), null)
  assert.equal(parseTimestamp('soon'), null)
  assert.equal(formatTimestamp(5386), '1:29:46')
  assert.equal(formatTimestamp(733), '12:13')
})

test('slugify and YouTube id extraction', () => {
  assert.equal(slugify('Haven Full Guide — Five Roles!'), 'haven-full-guide-five-roles')
  assert.equal(slugify('Café Défense'), 'cafe-defense')
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractYouTubeId('https://vimeo.com/1'), null)
})

test('builds chapters from timestamped headings in the vault format', () => {
  const r = parsePlaybookMarkdown(NOTE)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const p = r.playbook

  assert.equal(p.slug, 'haven-full-guide-five-roles')
  assert.equal(p.side, 'both')
  assert.equal(p.video_duration_seconds, 5386)
  assert.equal(p.description, 'Five defenders, one loop.')

  // "Attack Half" has no body of its own but does carry a timestamped child, so
  // it is kept as that child's parent. An *untimestamped* wrapper is still
  // skipped — `## Core Concepts` never becomes a chapter.
  assert.deepEqual(p.chapters.map(c => c.title), [
    'Structure',
    'Role 1 — C Sentinel (Cypher lens)',
    'Attack Half',
    'Defaults',
  ])
  assert.deepEqual(p.chapters.map(c => c.chapter_number), [1, 2, 3, 4])
  assert.deepEqual([p.chapters[3].start_seconds, p.chapters[3].end_seconds], [5272, 5386])

  const structure = p.chapters[0]
  assert.equal(structure.transcript_excerpt, 'One C, one garage.') // trailing --- dropped

  const role1 = p.chapters[1]
  assert.equal(role1.role_context, 'Cypher lens')
  assert.deepEqual(role1.key_takeaways, ['**Bunker means accepting the A retake** — Your job is to not die.'])
  assert.equal(role1.notes_markdown, 'Garage belongs to C.')
  assert.ok(role1.transcript_excerpt.includes('[!warning]'))

  // Chapter body stops at the next same-level heading.
  assert.ok(!p.chapters[3].transcript_excerpt.includes('Practical'))
})

test('a timestamped heading under another becomes a sub-chapter', () => {
  const r = parsePlaybookMarkdown(NOTE)
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.deepEqual(r.playbook.chapters.map(c => c.depth), [1, 1, 1, 2])
  assert.deepEqual(r.playbook.chapters.map(c => c.parent_chapter_number), [null, null, null, 3])
})

test('an all-same-level note produces no sub-chapters', () => {
  const flat = `---
title: Flat
map: Bind
---

### One \`[00:00–01:00]\`
Body one.

### Two \`[01:00–02:00]\`
Body two.
`
  const r = parsePlaybookMarkdown(flat)
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.deepEqual(r.playbook.chapters.map(c => c.depth), [1, 1])
  assert.deepEqual(r.playbook.chapters.map(c => c.parent_chapter_number), [null, null])
})

test('a leading ### with no ## above it stays depth 1', () => {
  const leading = `---
title: Leading
map: Split
---

### First \`[00:00–01:00]\`
Body.

## Second \`[01:00–02:00]\`
Also a body.
`
  const r = parsePlaybookMarkdown(leading)
  assert.equal(r.ok, true)
  if (!r.ok) return

  // The `##` is shallower than the open `###`, so it opens its own chapter
  // rather than adopting anything.
  assert.deepEqual(r.playbook.chapters.map(c => c.depth), [1, 1])
})

test('a timestamped parent with an empty body is kept, an untimestamped one is not', () => {
  const wrapped = `---
title: Wrapped
map: Lotus
---

## Untimestamped wrapper

### Real chapter \`[00:00–01:00]\`
Body.

## Timestamped parent \`[01:00–05:00]\`

### Child \`[01:00–02:00]\`
Child body.
`
  const r = parsePlaybookMarkdown(wrapped)
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.deepEqual(r.playbook.chapters.map(c => c.title), [
    'Real chapter',
    'Timestamped parent',
    'Child',
  ])
  assert.deepEqual(r.playbook.chapters.map(c => c.depth), [1, 1, 2])
  assert.equal(r.playbook.chapters[2].parent_chapter_number, 2)
  // The parent keeps its empty body rather than inheriting the child's.
  assert.equal(r.playbook.chapters[1].transcript_excerpt, '')
})

// The shape the valorant-map-analysis skill writes for a both-sides video.
const BOTH_HALVES = `---
title: Both Halves
map: Haven
side: both
---

## Core Concepts

### Comp and loose positions \`[00:00–02:03]\`
Comp.

## Defense Half — Five Roles \`[02:03–12:13]\`
**Frame:** five defenders.

### Role 1 — C Sentinel (Cypher lens) \`[02:03–11:59]\`
**Job:** stop the C rush.

#### Early info, then rotate \`[03:29–06:01]\`
- **Cam C long, jiggle** — then decide.

## Attack Half — Lurk \`[12:13–20:00]\`
**Frame:** entry order.

### Attack shape \`[12:13–20:00]\`
Shape.

## Practical Application

### Timed but after the halves \`[20:00–21:00]\`
Not a child of the attack half.
`

test('both halves nest their chapters; the frame line stays with the half', () => {
  const r = parsePlaybookMarkdown(BOTH_HALVES)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const c = r.playbook.chapters

  assert.deepEqual(c.map(x => [x.chapter_number, x.depth, x.parent_chapter_number]), [
    [1, 1, null], // Comp — before any half
    [2, 1, null], // Defense Half
    [3, 2, 2], //    Role 1
    [4, 1, null], // Attack Half
    [5, 2, 4], //    Attack shape
    [6, 1, null], // after an untimestamped ## — not adopted by the attack half
  ])
  assert.equal(c[1].transcript_excerpt, '**Frame:** five defenders.')
  // Moments (####) stay inside the chapter body.
  assert.ok(c[2].transcript_excerpt.includes('#### Early info, then rotate'))
})

test("accepts the spec's leading-range heading and [!key] callouts", () => {
  const r = parsePlaybookMarkdown(`---
title: Bind Retakes
map: Bind
---
## [00:30-04:10] Hookah retake
Go through short.
> [!key] Trade the first contact
`)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.playbook.chapters[0].title, 'Hookah retake')
  assert.equal(r.playbook.chapters[0].start_seconds, 30)
  assert.deepEqual(r.playbook.chapters[0].key_takeaways, ['Trade the first contact'])
  assert.equal(r.playbook.video_url, null)
})

test('handles CRLF line endings', () => {
  const r = parsePlaybookMarkdown(NOTE.replace(/\n/g, '\r\n'))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.playbook.chapters.length, 4)
})

test('rejects malformed notes with a clear reason', () => {
  const fail = (md: string) => {
    const r = parsePlaybookMarkdown(md)
    assert.equal(r.ok, false)
    return r.ok ? '' : r.error
  }
  assert.match(fail('# no frontmatter'), /frontmatter/)
  assert.match(fail('---\ntitle: X\n---\n### A `[0:10–0:20]`\nbody'), /map/)
  assert.match(fail('---\ntitle: X\nmap: Bind\n---\n### Untimed\nbody'), /No chapters/)
  assert.match(fail('---\ntitle: X\nmap: Bind\nside: mid\n---\n'), /side/)
  assert.match(fail('---\ntitle: X\nmap: Bind\nvideo_url: https://vimeo.com/1\n---\n'), /YouTube/)
  assert.match(fail('---\ntitle: X\nmap: Bind\n---\n### Backwards `[5:00–4:00]`\nbody'), /before it starts/)
})
