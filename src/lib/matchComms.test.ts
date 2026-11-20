/**
 * Unit tests for reading a match's local communication file
 * (docs/match-report.md §6) (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMS_SCHEMA, parseMatchComms, siteCountLabel } from './matchComms.ts'

const FILE = {
  schema: COMMS_SCHEMA,
  matchId: 'm-1',
  mine: { lines: 230, words: 1000, wordsByPhase: { buy: 450, alive: 430, dead: 110, 'after round': 10 }, swears: 5 },
  team: { lines: 202 },
  afterDeath: [{ round: 1, useful: false }, { round: 2, useful: true }, { round: 3, useful: true }, 'junk'],
  checks: [
    { round: 3, t: 11.1, text: '3 on B, 3 on B', then: { A: 2, B: 3, C: 0, spawn: 0 }, later: { A: 1, B: 3, spawn: 1 }, verdict: 'right' },
    { round: 9, t: 20, text: 'they rotate', then: {}, later: {}, verdict: 'unsure' },
    { t: 5, text: 'no round' },
  ],
  lines: [
    { round: 1, t: -33.7, who: 'me', text: 'here. here' },
    { round: 1, t: 12, who: 'team', text: '<b>one</b> B <i>main</i>' },
    { round: 2, t: 3, who: 'someone', text: 'x' },
    { round: 2, t: 4, who: 'me', text: '' },
    { round: 2, who: 'me', text: 'no time' },
  ],
  notes: { verdict: 'Specific and almost always right.', works: ['<b>Site calls on time.</b> B at 0:26.'], work: ['Places over here.', 7] },
}

test('a file of another schema, another match or another kind reads as nothing', () => {
  assert.equal(parseMatchComms(null, 'm-1'), null)
  assert.equal(parseMatchComms([], 'm-1'), null)
  assert.equal(parseMatchComms({ ...FILE, schema: 2 }, 'm-1'), null)
  assert.equal(parseMatchComms(FILE, 'm-2'), null)
})

test('counts, shares of words by phase, and deaths followed by information', () => {
  const comms = parseMatchComms(FILE, 'm-1')
  assert.ok(comms)
  assert.deepEqual(comms.mine, { lines: 230, words: 1000, buyPct: 45, alivePct: 43, deadPct: 11, swears: 5 })
  assert.deepEqual(comms.team, { lines: 202 })
  assert.deepEqual(comms.afterDeath, { deaths: 3, useful: 2 })
})

test('checks and lines are read tolerantly', () => {
  const comms = parseMatchComms(FILE, 'm-1')
  assert.ok(comms)
  assert.deepEqual(comms.checks, [
    { round: 3, t: 11.1, text: '3 on B, 3 on B', then: { A: 2, B: 3, C: 0, spawn: 0 }, later: { A: 1, B: 3, C: 0, spawn: 1 }, verdict: 'right' },
    { round: 9, t: 20, text: 'they rotate', then: { A: 0, B: 0, C: 0, spawn: 0 }, later: { A: 0, B: 0, C: 0, spawn: 0 }, verdict: 'partly' },
  ])
  assert.deepEqual(comms.lines, [
    { round: 1, t: -33.7, who: 'me', text: 'here. here' },
    { round: 1, t: 12, who: 'team', text: '**one** B main' },
    { round: 2, t: 3, who: 'team', text: 'x' },
  ])
  assert.deepEqual(comms.notes, { verdict: 'Specific and almost always right.', works: ['**Site calls on time.** B at 0:26.'], work: ['Places over here.'] })
})

test('an empty file of the right schema is an empty report, not nothing', () => {
  const comms = parseMatchComms({ schema: COMMS_SCHEMA, matchId: 'm-1' }, 'm-1')
  assert.ok(comms)
  assert.equal(comms.mine.words, 0)
  assert.equal(comms.mine.buyPct, 0)
  assert.deepEqual(comms.lines, [])
  assert.equal(comms.notes.verdict, null)
})

test('site counts as text', () => {
  assert.equal(siteCountLabel({ A: 2, B: 3, C: 0, spawn: 0 }), 'A 2, B 3')
  assert.equal(siteCountLabel({ A: 0, B: 0, C: 0, spawn: 0 }), 'none seen')
})
