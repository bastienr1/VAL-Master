/**
 * Unit tests for the VOD-library note parser.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 *
 * The fixtures below are trimmed copies of the real vault shapes, including the
 * two that have bitten this parser: a `## Core Breakdown` with a range appended
 * to the container heading, and a map guide whose `###` headings carry no range
 * at all.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contentTypeFor,
  findRange,
  firstValue,
  listValue,
  parseClock,
  parseDrills,
  parseFrontmatter,
  parseGuideNote,
  parseSections,
  parseTargetSessions,
  splitPlayerAndTeam,
} from './vodLibraryParser.ts'

// --------------------------------------------------------------------- fixtures

const MECHANICS_NOTE = `---
title: Mada's Mechanics — Peek, Trace, Commit
date: 2026-09-19
type: transcript
content-type: mechanics
player: mada (NRG)
series-order: 7
creator: Zasko
duration: 00:10:48
focus:
  - mechanics
  - aim
---

## Key Takeaways
- Not a chapter.

## Core Breakdown \`[01:51–10:32]\`

### Governing rule — be deliberate when you are NOT fighting \`[01:51–02:06]\`
Body line one.
Body line two.

### Abyss · Raze (defense) — mid delay with Sage wall \`[02:06–03:12]\`
Second body.

## Practice Extraction
| # | Drill / rep | Where (custom, DM, ranked) | Cue to watch for | Success signal | Source \`[range]\` |
|---|---|---|---|---|---|
| 1 | **Peek–trace–peek route walk**: walk one route slowly. | Custom (no bots), 3 per session | Crosshair leaving the wall edge | Crosshair never floats in open space | \`[02:06–03:12]\` |
| 2 | **Four-beat peek**: wall – peek – stop – shoot. | DM, 10 min | Extra key presses | 8 of 10 peeks are one clean strafe | \`[03:12–04:28]\` · \`[05:00–05:30]\` |

**Habit cues:**
- Not a drill row.

## Notable Quotes
> "Not a chapter."
`

const MAP_GUIDE_NOTE = `---
title: Ascent Attacking Guide
type: transcript
map: Ascent
series-order: 1
creator:
duration: ~17:00
---

## Core Concepts

### Ascent is defender-sided (at least at pro level)
Unranged body.

### The three lanes and four choke points
More body.

## Attack Half — Defaults, Rushes, Post-Plants \`[56:00–1:23:01]\`

### Default setup off spawn \`[56:00–58:10]\`
Half body.

## Practical Application
**Solo-queue checklist:**
1. No table here.

## Notable Quotes
> "Still not a chapter."
`

// ------------------------------------------------------------------ frontmatter

test('parseFrontmatter reads scalars, lists and quoted values with inner colons', () => {
  const { frontmatter, body } = parseFrontmatter(MECHANICS_NOTE)

  assert.equal(frontmatter.title, "Mada's Mechanics — Peek, Trace, Commit")
  assert.equal(frontmatter['content-type'], 'mechanics')
  assert.deepEqual(frontmatter.focus, ['mechanics', 'aim'])
  assert.ok(body.startsWith('\n## Key Takeaways'))
})

test('parseFrontmatter keeps a colon-bearing quoted value intact', () => {
  const { frontmatter } = parseFrontmatter(
    ['---', 'creator: "Unknown (names in chat: Darius, Jason)"', '---', 'body'].join('\n'),
  )
  assert.equal(frontmatter.creator, 'Unknown (names in chat: Darius, Jason)')
})

test('parseFrontmatter returns the whole note as body when there is no frontmatter', () => {
  const { frontmatter, body } = parseFrontmatter('# Just a heading\n')
  assert.deepEqual(frontmatter, {})
  assert.equal(body, '# Just a heading\n')
})

test('firstValue and listValue normalise the scalar-or-list fields', () => {
  assert.equal(firstValue(['Abyss', 'Split']), 'Abyss')
  assert.equal(firstValue('Bind'), 'Bind')
  assert.equal(firstValue(''), null) // an empty `creator:` is not a creator
  assert.equal(firstValue(undefined), null)
  assert.deepEqual(listValue(['Abyss', 'Split']), ['Abyss', 'Split'])
  assert.deepEqual(listValue('Bind'), ['Bind'])
  assert.deepEqual(listValue(undefined), [])
})

// ------------------------------------------------------------------------ time

test('parseClock reads MM:SS, HH:MM:SS and the vault approximation mark', () => {
  assert.equal(parseClock('10:48'), 648)
  assert.equal(parseClock('00:10:48'), 648)
  assert.equal(parseClock('01:27:00'), 5220)
  assert.equal(parseClock('~17:00'), 1020)
  assert.equal(parseClock('nonsense'), null)
  assert.equal(parseClock(null), null)
})

test('findRange accepts en dash, em dash and hyphen, and takes the first range', () => {
  assert.deepEqual(findRange('`[01:51–02:06]`'), { start_seconds: 111, end_seconds: 126 })
  assert.deepEqual(findRange('`[01:51—02:06]`'), { start_seconds: 111, end_seconds: 126 })
  assert.deepEqual(findRange('`[01:51-02:06]`'), { start_seconds: 111, end_seconds: 126 })
  assert.deepEqual(findRange('`[06:58–09:23]` · `[17:03–18:27]`'), {
    start_seconds: 418,
    end_seconds: 563,
  })
  assert.equal(findRange('no range here'), null)
})

// -------------------------------------------------------------------- sections

test('parseSections finds chapters under a container whose own heading has a range', () => {
  const { sections, unranged } = parseSections(parseFrontmatter(MECHANICS_NOTE).body)

  assert.equal(sections.length, 2)
  assert.equal(unranged.length, 0)
  assert.equal(sections[0].position, 1)
  assert.equal(sections[0].heading, 'Governing rule — be deliberate when you are NOT fighting')
  assert.equal(sections[0].start_seconds, 111)
  assert.equal(sections[0].end_seconds, 126)
  assert.equal(sections[0].body_md, 'Body line one.\nBody line two.')
})

test('parseSections splits a `Map · Agent — heading` and moves a side into the heading', () => {
  const { sections } = parseSections(parseFrontmatter(MECHANICS_NOTE).body)

  assert.equal(sections[1].map, 'Abyss')
  assert.equal(sections[1].agent, 'Raze')
  assert.equal(sections[1].heading, 'mid delay with Sage wall (defense)')
})

test('parseSections keeps unranged headings and reports them', () => {
  const { sections, unranged } = parseSections(parseFrontmatter(MAP_GUIDE_NOTE).body)

  // Two unranged under Core Concepts, one ranged under the Attack Half block.
  assert.equal(sections.length, 3)
  assert.deepEqual(unranged, [
    'Ascent is defender-sided (at least at pro level)',
    'The three lanes and four choke points',
  ])
  assert.equal(sections[0].start_seconds, null)
  assert.equal(sections[2].heading, 'Default setup off spawn')
  assert.equal(sections[2].start_seconds, 3360)
})

test('parseSections ignores headings outside a chapter container', () => {
  const body = ['## Notable Quotes', '### Not a chapter `[00:10–00:20]`', 'body'].join('\n')
  assert.deepEqual(parseSections(body).sections, [])
})

// ---------------------------------------------------------------------- drills

test('parseDrills reads the table, locating columns by header text', () => {
  const { drills, warnings } = parseDrills(parseFrontmatter(MECHANICS_NOTE).body)

  assert.deepEqual(warnings, [])
  assert.equal(drills.length, 2)
  assert.equal(drills[0].position, 1)
  assert.match(drills[0].title, /Peek–trace–peek route walk/)
  assert.equal(drills[0].venue, 'Custom (no bots), 3 per session')
  assert.equal(drills[0].cue, 'Crosshair leaving the wall edge')
  assert.equal(drills[0].success_signal, 'Crosshair never floats in open space')
  assert.equal(drills[0].source_start_seconds, 126)
  assert.equal(drills[0].source_end_seconds, 192)
})

test('parseDrills stops at the first non-row and ignores the prose after it', () => {
  const { drills } = parseDrills(parseFrontmatter(MECHANICS_NOTE).body)
  assert.equal(drills.length, 2)
  assert.equal(drills[1].source_start_seconds, 192) // first of two ranges in the cell
})

test('parseDrills warns rather than throws when there is no Practice Extraction', () => {
  const { drills, warnings } = parseDrills(parseFrontmatter(MAP_GUIDE_NOTE).body)
  assert.deepEqual(drills, [])
  assert.deepEqual(warnings, ['no Practice Extraction section'])
})

test('parseTargetSessions counts reps but not minutes', () => {
  assert.equal(parseTargetSessions('Custom (no bots), 3 per session'), 3)
  assert.equal(parseTargetSessions('Custom (Bind A Showers), 10 full clears; then DM'), 10)
  assert.equal(parseTargetSessions('ranked experiment: log 10 rounds'), 10)
  assert.equal(parseTargetSessions('DM, 10 min'), null)
  assert.equal(parseTargetSessions('KovaaK’s / Aim Lab — tracking session'), null)
  assert.equal(parseTargetSessions(null), null)
})

// ----------------------------------------------------------------- whole notes

test('splitPlayerAndTeam lifts the team out of the player field', () => {
  assert.deepEqual(splitPlayerAndTeam('Mada (NRG)'), { player: 'Mada', team: 'NRG' })
  assert.deepEqual(splitPlayerAndTeam('Zasko'), { player: 'Zasko', team: null })
  assert.deepEqual(splitPlayerAndTeam(null), { player: null, team: null })
})

test('contentTypeFor prefers frontmatter and falls back to the top folder', () => {
  assert.equal(contentTypeFor('Mechanics/note.md', { 'content-type': 'mechanics' }), 'mechanics')
  // The map guides predate the field and nest one level deeper.
  assert.equal(contentTypeFor('Map-Analysis/Abyss/note.md', {}), 'map-guide')
  assert.equal(contentTypeFor('Pro-Reviews/note.md', {}), 'pro-review')
  assert.equal(contentTypeFor('Warm-Up/note.md', {}), null)
  // A typo in the field must not become an invalid enum value in Postgres.
  assert.equal(contentTypeFor('Mechanics/note.md', { 'content-type': 'mechanic' }), 'mechanics')
})

test('parseGuideNote reports the shortfalls of a legacy map guide', () => {
  const parsed = parseGuideNote(MAP_GUIDE_NOTE)

  assert.equal(parsed.sections.length, 3)
  assert.equal(parsed.drills.length, 0)
  assert.equal(parsed.unranged.length, 2)
  assert.ok(parsed.warnings.some(w => w.includes('no Practice Extraction')))
  assert.ok(parsed.warnings.some(w => w.includes('no [MM:SS–MM:SS] range')))
})

test('parseGuideNote is clean on a well-formed note', () => {
  const parsed = parseGuideNote(MECHANICS_NOTE)
  assert.deepEqual(parsed.warnings, [])
  assert.equal(parsed.sections.length, 2)
  assert.equal(parsed.drills.length, 2)
})
