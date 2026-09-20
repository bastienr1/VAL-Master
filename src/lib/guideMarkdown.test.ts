/**
 * Unit tests for the Obsidian-markdown cleanup applied to chapter bodies.
 *
 * Runs on Node's built-in test runner (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { guideMarkdown } from './guideMarkdown.ts'

test('wikilinks become their display text', () => {
  assert.equal(guideMarkdown('See [[Crosshair Placement]].'), 'See Crosshair Placement.')
  assert.equal(guideMarkdown('See [[2026-09-19-note|the mechanics guide]].'), 'See the mechanics guide.')
  assert.equal(
    guideMarkdown('Two: [[A]] and [[B|bee]].'),
    'Two: A and bee.',
  )
})

test('image embeds are dropped, since the vault is not served', () => {
  assert.equal(guideMarkdown('Before ![[diagram.png]] after'), 'Before  after')
})

test('callout markers become a bold title, keeping the blockquote', () => {
  assert.equal(guideMarkdown('> [!warning] Watch the timing'), '> **Watch the timing**')
  assert.equal(guideMarkdown('> [!question]- Open Loops'), '> **Open Loops**')
  // No title: keep the quote, name the type rather than invent a heading.
  assert.equal(guideMarkdown('> [!note]'), '> **Note**')
})

test('nested callout markers keep their quote depth', () => {
  assert.equal(guideMarkdown('>> [!tip] Nested'), '>> **Nested**')
})

test('ordinary markdown is left alone', () => {
  const body = ['**Bold** and `code`.', '', '- a list item', '| a | table |'].join('\n')
  assert.equal(guideMarkdown(body), body)
})

test('a quote that is not a callout is untouched', () => {
  assert.equal(guideMarkdown('> "A real quotation." — Coach'), '> "A real quotation." — Coach')
})
