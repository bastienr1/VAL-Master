/**
 * Unit tests for the canvas size options (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CANVAS_SIZES, agentScale, calloutUnits, parseCanvasSizes } from './canvasSizes.ts'

test('nothing stored, or something broken, is the defaults', () => {
  assert.deepEqual(parseCanvasSizes(null), DEFAULT_CANVAS_SIZES)
  assert.deepEqual(parseCanvasSizes('not json'), DEFAULT_CANVAS_SIZES)
  assert.deepEqual(parseCanvasSizes('"text"'), DEFAULT_CANVAS_SIZES)
})

test('stored sizes are read field by field, an unknown one taking its default', () => {
  assert.deepEqual(parseCanvasSizes('{"callout":"xl","calloutsFollowZoom":true,"agent":"s"}'), { callout: 'xl', calloutsFollowZoom: true, agent: 's' })
  assert.deepEqual(parseCanvasSizes('{"callout":"huge","agent":"l"}'), { ...DEFAULT_CANVAS_SIZES, agent: 'l' })
})

test('Large callouts and Large agents are the sizes the canvas has always used', () => {
  assert.equal(calloutUnits('l'), 22)
  assert.equal(agentScale('l'), 1)
  assert.ok(calloutUnits('s') < calloutUnits('m') && calloutUnits('m') < calloutUnits('l') && calloutUnits('l') < calloutUnits('xl'))
  assert.ok(agentScale('s') < agentScale('m') && agentScale('m') < agentScale('l'))
})
