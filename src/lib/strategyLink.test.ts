import test from 'node:test'
import assert from 'node:assert/strict'
import { originBack, parseReplayTime, parseStratPage, strategizeHref } from './strategyLink.ts'

test('a strategy link names the match, the round, the time in whole ms and the page', () => {
  assert.equal(strategizeHref('a b', 7, 61234.6, 'review'), '/plays/new?replay=a%20b&round=7&t=61235&strat=review')
  assert.equal(strategizeHref('m', 1, -5, 'report'), '/plays/new?replay=m&round=1&t=0&strat=report')
})

test('the page of a strategy link is review or report, nothing else', () => {
  assert.equal(parseStratPage('review'), 'review')
  assert.equal(parseStratPage('report'), 'report')
  for (const bad of [null, '', '1', 'Review', 'plays']) assert.equal(parseStratPage(bad), null, String(bad))
})

test('a replay time is a whole number of ms of at least 0', () => {
  assert.equal(parseReplayTime('61235'), 61235)
  assert.equal(parseReplayTime(' 0 '), 0)
  for (const bad of [null, '', '-1', '1.5', '1e3', 'abc', '99999999999999999999']) assert.equal(parseReplayTime(bad), null, String(bad))
})

test('a strat started from a page links back to it at its moment', () => {
  assert.deepEqual(originBack({ matchId: 'm 1', round: 7, ms: 61235, page: 'review' }), {
    to: '/review/m%201?at=61235',
    label: 'R7 review',
    title: 'Back to the review of round 7, at the moment this strat was started',
  })
  assert.equal(originBack({ matchId: 'm', ms: 0, page: 'report' })?.label, 'Match report')
})

test('a play from a replay without a page or a time has no back link', () => {
  assert.equal(originBack(null), null)
  assert.equal(originBack({ matchId: 'm' }), null)
  assert.equal(originBack({ matchId: 'm', round: 3, page: 'review' }), null)
  assert.equal(originBack({ matchId: 'm', round: 3, ms: 100 }), null)
})
