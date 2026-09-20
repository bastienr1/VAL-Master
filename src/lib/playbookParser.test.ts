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

  // "Attack Half" wraps a timestamped child with no body of its own → skipped.
  assert.deepEqual(p.chapters.map(c => c.title), [
    'Structure',
    'Role 1 — C Sentinel (Cypher lens)',
    'Defaults',
  ])
  assert.deepEqual(p.chapters.map(c => c.chapter_number), [1, 2, 3])
  assert.deepEqual([p.chapters[2].start_seconds, p.chapters[2].end_seconds], [5272, 5386])

  const structure = p.chapters[0]
  assert.equal(structure.transcript_excerpt, 'One C, one garage.') // trailing --- dropped

  const role1 = p.chapters[1]
  assert.equal(role1.role_context, 'Cypher lens')
  assert.deepEqual(role1.key_takeaways, ['**Bunker means accepting the A retake** — Your job is to not die.'])
  assert.equal(role1.notes_markdown, 'Garage belongs to C.')
  assert.ok(role1.transcript_excerpt.includes('[!warning]'))

  // Chapter body stops at the next same-level heading.
  assert.ok(!p.chapters[2].transcript_excerpt.includes('Practical'))
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
  if (r.ok) assert.equal(r.playbook.chapters.length, 3)
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
