import { supabase } from './supabase'
import type { Resource } from './resourceStore'

/**
 * Ties shared fetch caches to the signed-in user.
 *
 * A cache created with `createResource` outlives the components that read it,
 * so without this a second account signing in on the same tab would be shown
 * the first one's matches until a reload.
 */

const scoped = new Set<Resource<unknown>>()

// undefined until the first auth event, so the initial session isn't a "change".
let lastUserId: string | null | undefined

supabase.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id ?? null
  // The same user is announced again on token refresh and tab focus; only a
  // different one empties the caches.
  if (lastUserId !== undefined && userId !== lastUserId) {
    for (const resource of scoped) resource.reset()
  }
  lastUserId = userId
})

/** Empties `resource` whenever the signed-in user changes. Returns it for chaining. */
export function scopeToUser<T>(resource: Resource<T>): Resource<T> {
  scoped.add(resource as Resource<unknown>)
  return resource
}

/**
 * The signed-in user's id, or null.
 *
 * Reads the stored session; `getUser()` would add a round trip to the auth
 * server before every load. RLS still decides what the user may read.
 */
export async function sessionUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}
