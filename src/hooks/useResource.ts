import { useSyncExternalStore } from 'react'
import type { Resource, ResourceState } from '../lib/resourceStore'

/** Subscribes a component to a shared fetch cache; the first subscriber triggers the fetch. */
export function useResource<T>(resource: Resource<T>): ResourceState<T> {
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot)
}
