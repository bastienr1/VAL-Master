/**
 * Unit tests for the canvas size options (`npm test`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CANVAS_SIZES, agentScale, calloutUnits, nameUnits, parseCanvasSizes } from './canvasSizes.ts'

test('nothing stored, or something broken, is the defaults', () => {
  assert.deepEqual(parseCanvasSizes(null), DEFAULT_CANVAS_SIZES)
  assert.deepEqual(parseCanvasSizes('not json'), DEFAULT_CANVAS_SIZES)
  assert.deepEqual(parseCanvasSizes('"text"'), DEFAULT_CANVAS_SIZES)
})

test('stored sizes are read field by field, an unknown one taking its default', () => {
  assert.deepEqual(parseCanvasSizes('{"callout":"xl","calloutsFollowZoom":true,"name":"s","namesFollowZoom":true,"agent":"s"}'), { callout: 'xl', calloutsFollowZoom: true, name: 's', namesFollowZoom: true, agent: 's' })
  assert.deepEqual(parseCanvasSizes('{"callout":"huge","name":"giant","agent":"l"}'), { ...DEFAULT_CANVAS_SIZES, agent: 'l' })
  // Sizes stored before names had options read as the defaults for them.
  assert.deepEqual(parseCanvasSizes('{"callout":"s","calloutsFollowZoom":true,"agent":"l"}'), { ...DEFAULT_CANVAS_SIZES, callout: 's', calloutsFollowZoom: true, agent: 'l' })
})

test('Large callouts, names and agents are the sizes the canvas has always used', () => {
  assert.equal(calloutUnits('l'), 22)
  assert.equal(nameUnits('l'), 20)
  assert.ok(nameUnits('s') < nameUnits('m') && nameUnits('m') < nameUnits('l') && nameUnits('l') < nameUnits('xl'))
  assert.equal(agentScale('l'), 1)
  assert.ok(calloutUnits('s') < calloutUnits('m') && calloutUnits('m') < calloutUnits('l') && calloutUnits('l') < calloutUnits('xl'))
  assert.ok(agentScale('s') < agentScale('m') && agentScale('m') < agentScale('l'))
})
