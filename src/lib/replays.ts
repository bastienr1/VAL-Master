/**
 * Loading and attaching a match's minimap bundle.
 *
 * The file lives in the private `replays` Storage bucket; `match_replays` is the
 * index that says a match has one (migration `20261001_match_replays.sql`). The
 * decode/validate step is in `replayBundle.ts`, which stays free of Supabase so
 * it can be unit-tested.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import {
  REPLAY_BUNDLE_SCHEMA,
  ReplayBundleError,
  assertBundleForMatch,
  parseReplayBundle,
  replayStoragePath,
  summarizeReplayBundle,
  type ReplayBundle,
  type ReplayBundleSummary,
} from './replayBundle'

const BUCKET = 'replays'

// One load per match per session: the bundle is 5–6 MB once unzipped, and the
// minimap, the timeline and this panel all want the same object.
const loads = new Map<string, Promise<ReplayBundle | null>>()

async function loadReplayBundle(matchId: string): Promise<ReplayBundle | null> {
  const started = performance.now()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: row, error } = await supabase
    .from('match_replays')
    .select('storage_path, bundle_schema')
    .eq('match_id', matchId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw new Error(`match_replays read failed: ${error.message}`)
  if (!row) return null

  if (row.bundle_schema !== REPLAY_BUNDLE_SCHEMA) {
    throw new ReplayBundleError(
      `The stored replay is schema ${row.bundle_schema}; this app reads schema ${REPLAY_BUNDLE_SCHEMA}. Re-attach a fresh bundle.`,
    )
  }

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(row.storage_path)
  if (downloadError || !file) {
    throw new Error(`replay download failed: ${downloadError?.message ?? 'empty response'}`)
  }

  const bundle = await parseReplayBundle(file)
  assertBundleForMatch(bundle, matchId)

  if (import.meta.env.DEV) {
    const s = summarizeReplayBundle(bundle)
    console.info(
      `[replay] ${matchId.slice(0, 8)}: ${s.players} players, ${s.rounds} rounds, ${s.kills} kills ` +
      `(${(file.size / 1024).toFixed(0)} KB, ${Math.round(performance.now() - started)} ms)`,
    )
  }
  return bundle
}

/**
 * The match's bundle, or null when it has none. Concurrent callers share one
 * download; a failed load is forgotten so a later call can retry.
 */
export function getReplayBundle(matchId: string): Promise<ReplayBundle | null> {
  let load = loads.get(matchId)
  if (!load) {
    load = loadReplayBundle(matchId)
    loads.set(matchId, load)
    load.catch(() => {
      if (loads.get(matchId) === load) loads.delete(matchId)
    })
  }
  return load
}

/**
 * Validates a bundle file, stores it and indexes it. The file is parsed before
 * anything is uploaded, so a wrong file never reaches Storage. Attaching again
 * replaces the previous bundle for that match.
 */
export async function attachReplayBundle(matchId: string, file: Blob): Promise<ReplayBundle> {
  const bundle = await parseReplayBundle(file)
  assertBundleForMatch(bundle, matchId)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const path = replayStoragePath(user.id, matchId)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/gzip', upsert: true })
  if (uploadError) throw new Error(`replay upload failed: ${uploadError.message}`)

  const { error: rowError } = await supabase
    .from('match_replays')
    .upsert(
      {
        user_id: user.id,
        match_id: matchId,
        storage_path: path,
        bundle_schema: bundle.schema,
        vrfkit_ref: bundle.parser.vrfkit,
        game_build: bundle.match.build,
        map_uuid: bundle.match.mapUuid,
        size_bytes: file.size,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,match_id' },
    )
  if (rowError) throw new Error(`match_replays write failed: ${rowError.message}`)

  loads.set(matchId, Promise.resolve(bundle))
  return bundle
}

export type ReplayBundleStatus = 'loading' | 'none' | 'ready' | 'error'

export interface ReplayBundleState {
  status: ReplayBundleStatus
  bundle: ReplayBundle | null
  summary: ReplayBundleSummary | null
  error: string | null
  /** Rejects with a message fit to show next to the file picker. */
  attach: (file: Blob) => Promise<void>
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The bundle for a match, loaded once the match id is known. */
export function useReplayBundle(matchId: string | undefined): ReplayBundleState {
  const [loaded, setLoaded] = useState<{ matchId: string; bundle: ReplayBundle | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    getReplayBundle(matchId).then(
      (bundle) => { if (!cancelled) setLoaded({ matchId, bundle, error: null }) },
      (err) => {
        console.warn('[replay]', errorMessage(err))
        if (!cancelled) setLoaded({ matchId, bundle: null, error: errorMessage(err) })
      },
    )
    return () => { cancelled = true }
  }, [matchId])

  const attach = useCallback(async (file: Blob) => {
    if (!matchId) throw new Error('No match loaded')
    const bundle = await attachReplayBundle(matchId, file)
    setLoaded({ matchId, bundle, error: null })
  }, [matchId])

  // A result for another match is stale: the new match is still loading.
  const current = loaded && loaded.matchId === matchId ? loaded : null
  const bundle = current?.bundle ?? null
  const summary = useMemo(() => (bundle ? summarizeReplayBundle(bundle) : null), [bundle])

  let status: ReplayBundleStatus = 'loading'
  if (current) status = current.error ? 'error' : bundle ? 'ready' : 'none'

  return { status, bundle, summary, error: current?.error ?? null, attach }
}
