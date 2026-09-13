/**
 * Unit tests for the map fundamentals choice ↔ row mapping.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { toFundamentalsRow, fromFundamentalsRow } from './fundamentalsChoice.ts'

const PLAYBOOK_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

test('none deletes the row', () => {
  assert.equal(toFundamentalsRow({ kind: 'none' }), null)
})

test('url choices are normalized and carry no playbook', () => {
  assert.deepEqual(toFundamentalsRow({ kind: 'url', url: '  valorant.fandom.com/wiki/Haven ' }), {
    url: 'https://valorant.fandom.com/wiki/Haven',
    playbook_id: null,
  })
})

test('blank or unsafe urls delete the row', () => {
  assert.equal(toFundamentalsRow({ kind: 'url', url: '' }), null)
  assert.equal(toFundamentalsRow({ kind: 'url', url: 'javascript:alert(1)' }), null)
  assert.equal(toFundamentalsRow({ kind: 'url', url: 'haven' }), null)
})

test('playbook choices carry no url', () => {
  assert.deepEqual(toFundamentalsRow({ kind: 'playbook', playbookId: PLAYBOOK_ID }), {
    url: null,
    playbook_id: PLAYBOOK_ID,
  })
  assert.equal(toFundamentalsRow({ kind: 'playbook', playbookId: '' }), null)
})

test('rows map back to choices', () => {
  assert.deepEqual(fromFundamentalsRow(null), { kind: 'none' })
  assert.deepEqual(fromFundamentalsRow({ url: null, playbook_id: null }), { kind: 'none' })
  assert.deepEqual(fromFundamentalsRow({ url: 'https://a.gg/', playbook_id: null }), { kind: 'url', url: 'https://a.gg/' })
  assert.deepEqual(fromFundamentalsRow({ url: null, playbook_id: PLAYBOOK_ID }), { kind: 'playbook', playbookId: PLAYBOOK_ID })
  // Defensive: the constraint forbids both, but the playbook wins if it happens.
  assert.deepEqual(fromFundamentalsRow({ url: 'https://a.gg/', playbook_id: PLAYBOOK_ID }), { kind: 'playbook', playbookId: PLAYBOOK_ID })
})

test('choices round-trip through a row', () => {
  for (const choice of [
    { kind: 'url', url: 'https://a.gg/' },
    { kind: 'playbook', playbookId: PLAYBOOK_ID },
  ] as const) {
    assert.deepEqual(fromFundamentalsRow(toFundamentalsRow(choice)), choice)
  }
})
