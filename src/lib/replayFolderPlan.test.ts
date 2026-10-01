/**
 * Unit tests for choosing which bundles in a linked folder to attach (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { BUNDLE_FILE, bundleFolderPrefix, planFolderSync } from './replayFolderPlan.ts'

const LOTUS = '00931947-d697-48fb-99e6-2f73620e41ab'
const ASCENT = '2de69be2-6e0c-4b29-9feb-28db49167aae'
const SPLIT = '3a4e10c3-ff7f-47dc-943f-d5d1cd1080e8'

const folder = (name: string, size = 1_400_000) => ({ folderName: name, size, item: name })
const none = new Map<string, number | null>()

test('bundle folders are recognised by name', () => {
  assert.equal(bundleFolderPrefix('00931947-derived'), '00931947')
  assert.equal(bundleFolderPrefix('2DE69BE2-derived'), '2de69be2')
  assert.equal(bundleFolderPrefix('00931947'), null) // the full export beside it
  assert.equal(bundleFolderPrefix('cache'), null)
  assert.equal(bundleFolderPrefix('0093194-derived'), null)
})

test('only bundle files are picked up', () => {
  assert.ok(BUNDLE_FILE.test('minimap.v1.json.gz'))
  assert.ok(BUNDLE_FILE.test('minimap.v2.json.gz'))
  assert.ok(!BUNDLE_FILE.test('minimap.v1.json.gz.rejected')) // a bundle that failed its checks
  assert.ok(!BUNDLE_FILE.test('spike_carrier.parquet'))
})

test('a bundle for an unattached library match is attached', () => {
  const plan = planFolderSync([folder('00931947-derived')], [LOTUS, ASCENT], none)
  assert.deepEqual(plan, {
    attach: [{ matchId: LOTUS, item: '00931947-derived', replaces: false }],
    linked: 0,
    notInLibrary: 0,
  })
})

test('a match that already has this bundle is left alone', () => {
  const plan = planFolderSync(
    [folder('00931947-derived', 1_415_000), folder('2de69be2-derived')],
    [LOTUS, ASCENT],
    new Map([[LOTUS, 1_415_000]]),
  )
  assert.deepEqual(plan.attach.map(a => a.matchId), [ASCENT])
  assert.equal(plan.linked, 1)
})

test('a bundle converted again with a different result replaces the stored one', () => {
  const plan = planFolderSync([folder('00931947-derived', 1_420_000)], [LOTUS], new Map([[LOTUS, 1_415_000]]))
  assert.deepEqual(plan.attach, [{ matchId: LOTUS, item: '00931947-derived', replaces: true }])
  assert.equal(plan.linked, 0)
})

test('a stored bundle of unknown size is not replaced', () => {
  const plan = planFolderSync([folder('00931947-derived')], [LOTUS], new Map([[LOTUS, null]]))
  assert.deepEqual(plan.attach, [])
  assert.equal(plan.linked, 1)
})

test('a bundle whose match is not in the library is counted, not attached', () => {
  const plan = planFolderSync([folder('3a4e10c3-derived'), folder('notes')], [LOTUS], none)
  assert.deepEqual(plan.attach, [])
  assert.equal(plan.notInLibrary, 2)
})

test('the same match found twice is attached once', () => {
  const plan = planFolderSync([folder('3a4e10c3-derived'), folder('3A4E10C3-derived')], [SPLIT], none)
  assert.equal(plan.attach.length, 1)
  assert.equal(plan.linked, 1)
})

test('two library matches with the same first eight characters are not guessed between', () => {
  const twin = '00931947-0000-0000-0000-000000000000'
  const plan = planFolderSync([folder('00931947-derived')], [LOTUS, twin], none)
  assert.deepEqual(plan.attach, [])
  assert.equal(plan.notInLibrary, 1)
})
