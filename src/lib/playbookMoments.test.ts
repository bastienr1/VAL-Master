/**
 * Unit tests for chapter moments and timestamp links.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`). Fixture lines are copied from the Haven vault note.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { extractMoments, splitTimestamps, linkifyTimestamps } from './playbookMoments.ts'

const BODY = `**The job:** C control, C-long info, and **garage control** — "the connector from mid to C" (~02:37).

**Utility logic (~02:57):** you *can* trip garage, or you can leave garage empty.

**Style A — early info, then rotate (~03:29–06:00)**

| Method | Notes |
|---|---|
| **Jump-spot C long** | The old standard (~04:10) |

**Rotating into a C hit \`[13:00–18:38]\`**

Any second agent. **Aggro short (~35:16):** shift-walk down.

- **C \`[1:14:06–1:19:15]\`:** shock the trip
- **B \`[1:19:27–1:21:00]\`:** insta-dart top B

#### Retake \`[12:00–12:30]\`

\`\`\`
**Not a moment (~09:00)**
\`\`\`
`

test('extracts labelled moments in time order', () => {
  assert.deepEqual(extractMoments(BODY), [
    { label: 'The job', start_seconds: 157, end_seconds: null },
    { label: 'Utility logic', start_seconds: 177, end_seconds: null },
    { label: 'Style A — early info, then rotate', start_seconds: 209, end_seconds: 360 },
    { label: 'Jump-spot C long', start_seconds: 250, end_seconds: null },
    { label: 'Retake', start_seconds: 720, end_seconds: 750 },
    { label: 'Rotating into a C hit', start_seconds: 780, end_seconds: 1118 },
    { label: 'Aggro short', start_seconds: 2116, end_seconds: null },
    { label: 'C', start_seconds: 4446, end_seconds: 4755 },
    { label: 'B', start_seconds: 4767, end_seconds: 4860 },
  ])
})

// Lines copied from the Abyss vault note, which puts the time at the end of a labelled line.
const ABYSS = `| Role | Early | Late |
|---|---|---|
| Initiator (Sova) | Early shock dart A main, fall back (~00:41) | Commit the A flank (~03:28) |
| A player is a **duelist** | Contest A main with them (~10:26–11:04) |

> Sentinel sits back-site A, they play a slow round and end B (~05:38).

**A site hold — the fall-back is the key (\`~06:43–10:13\`):**
- **Fall back to the smoke, not heaven** — only go into heaven with recon util (~07:14–07:53).
- **Drone changes everything**: overstay to break the drone (~08:03–09:13).
Plain sentence with a time (~09:20) but no label.`

test('labels at the start of a line or table row carry the line’s first timestamp', () => {
  assert.deepEqual(extractMoments(ABYSS), [
    { label: 'Initiator (Sova)', start_seconds: 41, end_seconds: null },
    { label: 'A site hold — the fall-back is the key', start_seconds: 403, end_seconds: 613 },
    { label: 'Fall back to the smoke, not heaven', start_seconds: 434, end_seconds: 473 },
    { label: 'Drone changes everything', start_seconds: 483, end_seconds: 553 },
    { label: 'A player is a duelist', start_seconds: 626, end_seconds: 664 },
  ])
})

test('unlabelled times, quotes, header rows and code blocks are not moments', () => {
  const labels = [...extractMoments(BODY), ...extractMoments(ABYSS)].map(m => m.label)
  assert.ok(!labels.some(l => l.includes('connector') || l.includes('Sentinel sits') || l.includes('Plain sentence')))
  assert.ok(!labels.includes('Role'))
  assert.ok(!labels.includes('Not a moment'))
})

test('drops moments outside the chapter range', () => {
  const inRange = extractMoments(BODY, { start_seconds: 123, end_seconds: 733 })
  assert.deepEqual(inRange.map(m => m.label), ['The job', 'Utility logic', 'Style A — early info, then rotate', 'Jump-spot C long', 'Retake'])
})

test('empty bodies have no moments', () => {
  assert.deepEqual(extractMoments(null), [])
  assert.deepEqual(extractMoments('No timestamps here.'), [])
})

test('splitTimestamps marks every timestamp, labelled or not', () => {
  assert.deepEqual(splitTimestamps('mid to C (~02:37). Then `[13:00–18:38]` done'), [
    { text: 'mid to C (' },
    { text: '~02:37', seconds: 157 },
    { text: '). Then ' },
    { text: '`[13:00–18:38]`', seconds: 780 },
    { text: ' done' },
  ])
  assert.deepEqual(splitTimestamps('plain'), [{ text: 'plain' }])
})

test('linkifyTimestamps turns timestamps into jump links outside code blocks', () => {
  assert.equal(
    linkifyTimestamps('**Utility logic (~02:57):** see `[13:00–18:38]`'),
    '**Utility logic ([~02:57](#t=177)):** see [13:00–18:38](#t=780)',
  )
  assert.equal(linkifyTimestamps('```\n(~02:57)\n```'), '```\n(~02:57)\n```')
  // A backticked time inside parentheses loses its code span so the link renders.
  assert.equal(linkifyTimestamps('key (`~06:43–10:13`):'), 'key ([~06:43–10:13](#t=403)):')
})
