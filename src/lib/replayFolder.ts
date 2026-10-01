/**
 * A linked folder of replay bundles.
 *
 * `scripts/replay/ingest.py --all` turns every saved replay into a bundle on
 * disk. Linking that folder once lets the app find the bundles itself and
 * attach each one to its match, instead of the user picking 50 files by hand.
 *
 * Built on the File System Access API (Chrome and Edge): the browser hands over
 * a read-only directory handle, which is kept in IndexedDB so the link survives
 * a reload. The browser may ask the user to confirm access again in a new
 * session; that needs a click, so `syncReplayFolder` never prompts on its own.
 *
 * Deciding what to attach is in `replayFolderPlan.ts` (pure, unit-tested).
 */

import { supabase } from './supabase'
import { attachReplayBundle } from './replays'
import { BUNDLE_FILE, planFolderSync, type FolderBundle } from './replayFolderPlan'

// The slice of the File System Access API used here. TypeScript's DOM library
// does not carry the picker, the permission calls or directory iteration.
interface FileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}
interface DirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<FileHandle | DirectoryHandle>
  queryPermission: (options: { mode: 'read' }) => Promise<PermissionState>
  requestPermission: (options: { mode: 'read' }) => Promise<PermissionState>
}
type DirectoryPicker = (options: { id: string; mode: 'read' }) => Promise<DirectoryHandle>

const picker = (): DirectoryPicker | undefined =>
  (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker

/** False in Firefox and Safari, where a folder cannot be linked. */
export function canLinkReplayFolder(): boolean {
  return typeof window !== 'undefined' && typeof picker() === 'function'
}

// ── The stored handle ──────────────────────────────────────────────────────
// A directory handle cannot go in localStorage; IndexedDB stores it as is.

const DB_NAME = 'val-master'
const STORE = 'handles'
const KEY = 'replayFolder'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export interface LinkedReplayFolder {
  name: string
  /** 'granted' can be read now; 'prompt' needs a click to re-confirm; 'denied' needs re-linking. */
  permission: PermissionState
  handle: DirectoryHandle
}

/** The folder linked earlier, if any, and whether it can be read without asking. */
export async function getLinkedReplayFolder(): Promise<LinkedReplayFolder | null> {
  if (!canLinkReplayFolder()) return null
  const handle = await withStore<DirectoryHandle | undefined>('readonly', store => store.get(KEY))
  if (!handle) return null
  return { name: handle.name, permission: await handle.queryPermission({ mode: 'read' }), handle }
}

/** Opens the folder picker. Must be called from a click. Rejects if the user cancels. */
export async function linkReplayFolder(): Promise<LinkedReplayFolder> {
  const pick = picker()
  if (!pick) throw new Error('This browser cannot link a folder. Use Chrome or Edge.')
  const handle = await pick({ id: 'val-master-replays', mode: 'read' })
  await withStore('readwrite', store => store.put(handle, KEY))
  return { name: handle.name, permission: 'granted', handle }
}

/** Asks the browser to confirm access to an already linked folder. Must be called from a click. */
export async function reconnectReplayFolder(folder: LinkedReplayFolder): Promise<LinkedReplayFolder> {
  return { ...folder, permission: await folder.handle.requestPermission({ mode: 'read' }) }
}

export async function unlinkReplayFolder(): Promise<void> {
  await withStore('readwrite', store => store.delete(KEY))
}

// ── Finding and attaching ──────────────────────────────────────────────────

// The user may link the `exports` folder or the data folder above it.
const MAX_DEPTH = 3

async function findBundles(dir: DirectoryHandle, depth = 0): Promise<Array<FolderBundle<FileHandle>>> {
  const found: Array<FolderBundle<FileHandle>> = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      if (BUNDLE_FILE.test(entry.name)) {
        // getFile() gives the size without reading the contents.
        found.push({ folderName: dir.name, size: (await entry.getFile()).size, item: entry })
      }
    } else if (depth < MAX_DEPTH && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      found.push(...(await findBundles(entry, depth + 1)))
    }
  }
  return found
}

/** Every match of this user that has replay data, with the stored bundle's size. */
async function attachedReplays(): Promise<Map<string, number | null>> {
  const { data, error } = await supabase.from('match_replays').select('match_id, size_bytes')
  if (error) throw new Error(`match_replays read failed: ${error.message}`)
  return new Map((data ?? []).map(row => [row.match_id as string, row.size_bytes as number | null]))
}

/** Every match of this user that has replay data. */
export async function listReplayMatchIds(): Promise<Set<string>> {
  return new Set((await attachedReplays()).keys())
}

export interface ReplayFolderSync {
  /** Bundles found in the folder. */
  found: number
  /** Attached by this run: matches that had no replay data. */
  attached: string[]
  /** Replaced by this run: the folder held a newer conversion of the replay. */
  updated: string[]
  /** Already had the bundle that is in the folder. */
  linked: number
  /** Bundles for matches that are not in the library. */
  notInLibrary: number
  failed: Array<{ matchId: string; reason: string }>
  /** Every match with replay data after this run. */
  replayMatchIds: Set<string>
}

/**
 * Attaches every bundle in the folder whose match is in the library and has no
 * replay data yet, or has an older conversion of it. Reads only the bundles it
 * is about to attach. Safe to run on every visit: with nothing new it costs two
 * small queries and a folder listing.
 */
export async function syncReplayFolder(
  folder: LinkedReplayFolder,
  onProgress?: (done: number, total: number) => void,
): Promise<ReplayFolderSync> {
  if (folder.permission !== 'granted') throw new Error('The replay folder needs to be reconnected first.')

  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('Not signed in')

  const [{ data: library, error }, attached, bundles] = await Promise.all([
    supabase.from('matches').select('match_id').eq('user_id', user.id),
    attachedReplays(),
    findBundles(folder.handle),
  ])
  if (error) throw new Error(`matches read failed: ${error.message}`)

  const plan = planFolderSync(bundles, (library ?? []).map(row => row.match_id as string), attached)
  const result: ReplayFolderSync = {
    found: bundles.length,
    attached: [],
    updated: [],
    linked: plan.linked,
    notInLibrary: plan.notInLibrary,
    failed: [],
    replayMatchIds: new Set(attached.keys()),
  }

  // One at a time: each is a 1–1.5 MB upload, and order makes the progress honest.
  for (const [index, { matchId, item, replaces }] of plan.attach.entries()) {
    onProgress?.(index, plan.attach.length)
    try {
      await attachReplayBundle(matchId, await item.getFile())
      if (replaces) result.updated.push(matchId)
      else result.attached.push(matchId)
      result.replayMatchIds.add(matchId)
    } catch (err) {
      result.failed.push({ matchId, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  onProgress?.(plan.attach.length, plan.attach.length)
  return result
}
