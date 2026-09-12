/**
 * Unit tests for the URL helpers.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrl, isSafeUrl, isEmbeddableValoplantUrl } from './url.ts'

test('normalizeUrl prepends https and rejects non-http schemes', () => {
  assert.equal(normalizeUrl('valoplant.gg'), 'https://valoplant.gg/')
  assert.equal(normalizeUrl('  valoplant.gg  '), 'https://valoplant.gg/')
  assert.equal(normalizeUrl('javascript:alert(1)'), null)
  assert.equal(normalizeUrl('ascent'), null) // bare word, no real host
  assert.equal(normalizeUrl(''), null)
})

test('isSafeUrl treats blank as "nothing to save"', () => {
  assert.equal(isSafeUrl(''), true)
  assert.equal(isSafeUrl('   '), true)
  assert.equal(isSafeUrl('https://valoplant.gg'), true)
  assert.equal(isSafeUrl('javascript:alert(1)'), false)
})

test('isEmbeddableValoplantUrl accepts valoplant.gg and its subdomains', () => {
  assert.equal(isEmbeddableValoplantUrl('https://valoplant.gg/anything'), true)
  assert.equal(isEmbeddableValoplantUrl('https://valoplant.gg'), true)
  assert.equal(isEmbeddableValoplantUrl('http://valoplant.gg'), true) // http survives normalization
  assert.equal(isEmbeddableValoplantUrl('valoplant.gg/replay/abc'), true) // scheme added
  assert.equal(isEmbeddableValoplantUrl('https://www.valoplant.gg/x'), true)
  assert.equal(isEmbeddableValoplantUrl('HTTPS://VALOPLANT.GG/X'), true) // host case-insensitive
})

test('isEmbeddableValoplantUrl rejects look-alike and hostile hosts', () => {
  // The bypasses a substring check would let through:
  assert.equal(isEmbeddableValoplantUrl('https://valoplant.gg.evil.com'), false)
  assert.equal(isEmbeddableValoplantUrl('https://evil.com/?next=valoplant.gg'), false)
  assert.equal(isEmbeddableValoplantUrl('https://evil.com/valoplant.gg'), false)
  assert.equal(isEmbeddableValoplantUrl('https://notvaloplant.gg'), false)
  assert.equal(isEmbeddableValoplantUrl('https://valoplant.gg@evil.com'), false) // userinfo trick
})

test('isEmbeddableValoplantUrl rejects empty and unparseable input', () => {
  assert.equal(isEmbeddableValoplantUrl(''), false)
  assert.equal(isEmbeddableValoplantUrl('   '), false)
  assert.equal(isEmbeddableValoplantUrl('not a url'), false)
  assert.equal(isEmbeddableValoplantUrl('javascript:alert(1)'), false)
  assert.equal(isEmbeddableValoplantUrl('http://'), false)
})
