/**
 * Unit tests for the written half of a match report and its trend summary
 * (docs/match-report.md §4): reading the vault's notes shape, and the stored
 * counts (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { boldRuns, hasReportNotes, parseReportNotes, parseReportSummary, reportSummary, sameSummary, REPORT_SUMMARY_VERSION } from './matchReportNotes.ts'
import type { MatchReport } from './matchReport.ts'

test('anything that is not a notes object reads as nothing written', () => {
  for (const raw of [null, undefined, 'text', 12, [], {}]) {
    const notes = parseReportNotes(raw)
    assert.equal(hasReportNotes(notes), false)
    assert.deepEqual(notes.works, [])
    assert.equal(notes.lede, null)
  }
})

test("the vault's notes.json: snake_case keys, <b> emphasis, its section names", () => {
  const notes = parseReportNotes({
    word: 'Victory',
    lede: '6–6 on defence, then 7–2 on attack.',
    works: [{ title: 'The attack half', body: '7 of 9 rounds won.', link: 'positioning' }, { title: '', body: 'no title' }, 'junk'],
    work: [{ title: 'Calls', body: 'Verdicts on the mic.', link: 'comms' }, { title: 'Deaths', body: 'Moving.', link: 'flow' }],
    paths: [{ round: 9, title: 'The one against one', body: 'Mid Window, then A Crane.' }],
    path_fixes: [{ round: 6, title: 'Down mid', body: 'An eco round.' }, { round: 0, title: 'bad round', body: '' }],
    best_duels: [{ round: 9, kind: 'kill', t: 64.6, title: 'The clutch', body: 'Guardian, 17 m.' }],
    positioning: ['<b>Defence starts at Mid Window.</b> 10 of 12 rounds.', 7, ''],
    economy: ['<b>Attack paid for itself.</b> <i>8,400</i> by round 17.'],
    next: [{ tag: 'Feet', title: 'Stop before the fight', body: 'Eight kills standing.' }, { tag: 'x' }],
  })
  assert.equal(notes.lede, '6–6 on defence, then 7–2 on attack.')
  assert.deepEqual(notes.works, [{ title: 'The attack half', body: '7 of 9 rounds won.', section: 'positioning' }])
  assert.deepEqual(notes.work.map(c => c.section), ['comms', 'rounds'])
  assert.deepEqual(notes.paths, [{ round: 9, title: 'The one against one', body: 'Mid Window, then A Crane.', clockS: null }])
  assert.deepEqual(notes.pathFixes.map(n => n.round), [6])
  assert.deepEqual(notes.bestDuels, [{ round: 9, title: 'The clutch', body: 'Guardian, 17 m.', clockS: 64.6 }])
  assert.deepEqual(notes.positioning, ['**Defence starts at Mid Window.** 10 of 12 rounds.'])
  assert.deepEqual(notes.economy, ['**Attack paid for itself.** 8,400 by round 17.'])
  assert.deepEqual(notes.next, [{ tag: 'Feet', title: 'Stop before the fight', body: 'Eight kills standing.' }])
  assert.equal(hasReportNotes(notes), true)
})

test('bold runs', () => {
  assert.deepEqual(boldRuns('**Standing wins.** 8 of 13.'), [{ text: 'Standing wins.', bold: true }, { text: ' 8 of 13.', bold: false }])
  assert.deepEqual(boldRuns('plain'), [{ text: 'plain', bold: false }])
  assert.deepEqual(boldRuns(''), [])
})

test('the summary keeps the counts the trend shows, and reads back only its own version', () => {
  const totals = {
    rounds: 21, won: 13, kills: 13, deaths: 15, selfDeaths: 1, roundsDied: 13, survivedWon: 8, survived: 8, diedInWon: 5,
    standingKills: 8, movingDeaths: 9, runningDeaths: 4, offCrosshairDeaths: 1, tradedDeaths: 4, tradeKills: 4, openingDeaths: 0, openingKills: 1,
  }
  const summary = reportSummary({ totals } as MatchReport)
  assert.deepEqual(summary, {
    v: REPORT_SUMMARY_VERSION, rounds: 21, won: 13, kills: 13, deaths: 15, roundsDied: 13, standingKills: 8, movingDeaths: 9,
    runningDeaths: 4, untradedDeaths: 11, openingDeaths: 0, tradeKills: 4,
  })
  assert.deepEqual(parseReportSummary(JSON.parse(JSON.stringify(summary))), summary)
  assert.equal(parseReportSummary({ ...summary, v: 0 }), null)
  assert.equal(parseReportSummary({ ...summary, kills: 'many' }), null)
  assert.equal(parseReportSummary({}), null)
  assert.equal(sameSummary(summary, { ...summary }), true)
  assert.equal(sameSummary(summary, { ...summary, kills: 14 }), false)
  assert.equal(sameSummary(null, summary), false)
})
