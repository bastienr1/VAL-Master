/**
 * Deciding which bundles in a linked folder to attach — the pure half of
 * `replayFolder.ts`, kept apart so it runs under `npm test`.
 *
 * `scripts/replay/ingest.py` writes each bundle to
 * `<first 8 characters of the match id>-derived/minimap.v1.json.gz`. The folder
 * name is therefore enough to tell, without opening a 1.4 MB file, whether a
 * bundle belongs to a match in the library, and the file size whether the match
 * already has this very bundle. Only the bundles worth attaching are then read.
 */

/** Matches `minimap.v1.json.gz`, and any later schema's file. */
export const BUNDLE_FILE = /^minimap\.v\d+\.json\.gz$/

const PREFIX_LENGTH = 8

/** The match-id prefix a bundle folder is named after, or null for a folder that is not one. */
export function bundleFolderPrefix(folderName: string): string | null {
  const match = /^([0-9a-f]{8})-derived$/i.exec(folderName)
  return match ? match[1].toLowerCase() : null
}

/** A bundle file found in the folder. `item` is whatever the caller needs to read it later. */
export interface FolderBundle<T> {
  folderName: string
  size: number
  item: T
}

export interface FolderSyncPlan<T> {
  /**
   * Bundles to read and attach, each with the library match its folder points
   * at. `replaces` marks a match that has replay data already, from an older
   * conversion of the same replay.
   */
  attach: Array<{ matchId: string; item: T; replaces: boolean }>
  /** Bundles whose match already has this bundle. */
  linked: number
  /** Bundles for matches that are not in the library (never loaded into VAL Master). */
  notInLibrary: number
}

/**
 * Sorts the bundles found in a folder into attach / already linked / not in the
 * library. `attachedSizes` is the stored bundle's size per match that has one.
 *
 * A match that has replay data gets the folder's bundle again only when the
 * file's size differs from the stored one: the replay was converted again (a
 * vrfkit update, a reducer fix) and the result changed. Converting the same
 * replay with the same scripts gives the same bytes, so nothing is re-uploaded
 * for that. A changed bundle of exactly the same size would be missed; attach
 * it by hand on the review page.
 *
 * Two library matches sharing the same first eight characters would make a
 * folder ambiguous; such a bundle is left alone rather than guessed at (the
 * attach step also re-checks the match id inside the bundle).
 */
export function planFolderSync<T>(
  bundles: Array<FolderBundle<T>>,
  libraryMatchIds: Iterable<string>,
  attachedSizes: ReadonlyMap<string, number | null>,
): FolderSyncPlan<T> {
  const byPrefix = new Map<string, string[]>()
  for (const id of libraryMatchIds) {
    const prefix = id.slice(0, PREFIX_LENGTH).toLowerCase()
    const list = byPrefix.get(prefix)
    if (list) list.push(id)
    else byPrefix.set(prefix, [id])
  }

  const plan: FolderSyncPlan<T> = { attach: [], linked: 0, notInLibrary: 0 }
  const seen = new Set<string>()
  for (const { folderName, size, item } of bundles) {
    const prefix = bundleFolderPrefix(folderName)
    const candidates = prefix ? byPrefix.get(prefix) : undefined
    if (!candidates || candidates.length !== 1) {
      plan.notInLibrary += 1
      continue
    }
    const matchId = candidates[0]
    const storedSize = attachedSizes.get(matchId)
    // A row without a size says nothing either way; leave that match alone.
    const upToDate = attachedSizes.has(matchId) && (storedSize == null || storedSize === size)
    if (upToDate || seen.has(matchId)) {
      plan.linked += 1
      continue
    }
    seen.add(matchId)
    plan.attach.push({ matchId, item, replaces: attachedSizes.has(matchId) })
  }
  return plan
}
