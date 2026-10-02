/**
 * Unit tests for the shared fetch cache.
 *
 * Runs on Node's built-in test runner with native TypeScript type stripping
 * (`npm test`) — no test framework dependency, per the no-new-deps guardrail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createResource } from './resourceStore.ts'

/** A fetcher whose calls are resolved by hand, in any order. */
function manualFetcher<T>() {
  const calls: { resolve: (value: T) => void; reject: (err: Error) => void }[] = []
  const fetcher = () =>
    new Promise<T>((resolve, reject) => {
      calls.push({ resolve, reject })
    })
  return { fetcher, calls }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('nothing is fetched until something subscribes', () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  assert.equal(calls.length, 0)
  assert.deepEqual(resource.getSnapshot(), { data: null, error: null, loading: true })
})

test('concurrent subscribers share one fetch', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  let notified = 0
  resource.subscribe(() => notified++)
  resource.subscribe(() => notified++)
  assert.equal(calls.length, 1)

  calls[0].resolve(7)
  await settle()
  assert.deepEqual(resource.getSnapshot(), { data: 7, error: null, loading: false })
  assert.equal(notified, 2)
})

test('a later subscriber reuses the cached result', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  const off = resource.subscribe(() => {})
  calls[0].resolve(1)
  await settle()
  off()

  resource.subscribe(() => {})
  assert.equal(calls.length, 1)
  assert.equal(resource.getSnapshot().data, 1)
})

test('invalidate refetches while keeping the old data on screen', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  resource.subscribe(() => {})
  calls[0].resolve(1)
  await settle()

  resource.invalidate()
  assert.equal(calls.length, 2)
  assert.deepEqual(resource.getSnapshot(), { data: 1, error: null, loading: true })

  calls[1].resolve(2)
  await settle()
  assert.deepEqual(resource.getSnapshot(), { data: 2, error: null, loading: false })
})

test('invalidate with nothing mounted waits for the next subscriber', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  const off = resource.subscribe(() => {})
  calls[0].resolve(1)
  await settle()
  off()

  resource.invalidate()
  assert.equal(calls.length, 1)
  resource.subscribe(() => {})
  assert.equal(calls.length, 2)
})

test('a superseded fetch cannot overwrite a newer one', async () => {
  const { fetcher, calls } = manualFetcher<string>()
  const resource = createResource(fetcher)
  resource.subscribe(() => {})
  resource.invalidate()
  assert.equal(calls.length, 2)

  calls[1].resolve('new')
  await settle()
  calls[0].resolve('old')
  await settle()
  assert.equal(resource.getSnapshot().data, 'new')
})

test('a failed fetch keeps the last data, reports the error, and retries on next mount', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  const off = resource.subscribe(() => {})
  calls[0].resolve(1)
  await settle()

  resource.invalidate()
  calls[1].reject(new Error('offline'))
  await settle()
  assert.deepEqual(resource.getSnapshot(), { data: 1, error: 'offline', loading: false })

  off()
  resource.subscribe(() => {})
  assert.equal(calls.length, 3)
})

test('a result older than maxAge is refreshed when something mounts', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher, { maxAgeMs: -1 }) // always stale
  const off = resource.subscribe(() => {})
  calls[0].resolve(1)
  await settle()
  off()

  resource.subscribe(() => {})
  assert.equal(calls.length, 2)
  // Cached data is shown while the refresh runs.
  assert.deepEqual(resource.getSnapshot(), { data: 1, error: null, loading: true })
})

test('reset drops the data and ignores a fetch that was in flight', async () => {
  const { fetcher, calls } = manualFetcher<number>()
  const resource = createResource(fetcher)
  const off = resource.subscribe(() => {})
  off()

  resource.reset()
  calls[0].resolve(1) // belongs to the previous user
  await settle()
  assert.deepEqual(resource.getSnapshot(), { data: null, error: null, loading: true })

  resource.subscribe(() => {})
  assert.equal(calls.length, 2)
})
