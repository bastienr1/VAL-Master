import { useCallback, useEffect, useState } from 'react'
import { COMMS_FILE, parseMatchComms, type MatchComms } from '../lib/matchComms'
import { getLinkedReplayFolder, readReplayFolderFile, reconnectReplayFolder, type LinkedReplayFolder } from '../lib/replayFolder'

export type MatchCommsState =
  /** No linked folder, no file for this match in it, or a browser that cannot link one. */
  | { status: 'none' }
  /** The folder is linked but the browser wants access confirmed again, which takes a click. */
  | { status: 'reconnect'; folderName: string; reconnect: () => void }
  | { status: 'ready'; comms: MatchComms }

/**
 * A match's communication file, read from the linked replay folder
 * (docs/match-report.md §6). It stays on this device: the file is parsed here
 * and kept in component state, and nothing writes it to Supabase.
 */
export function useMatchComms(matchId: string | undefined): MatchCommsState {
  const [found, setFound] = useState<{ matchId: string; folder: LinkedReplayFolder | null; comms: MatchComms | null } | null>(null)

  const read = useCallback(async (id: string, folder: LinkedReplayFolder | null) => {
    if (!folder || folder.permission !== 'granted') return { matchId: id, folder, comms: null }
    const file = await readReplayFolderFile(folder, id, COMMS_FILE)
    const comms = file ? parseMatchComms(JSON.parse(await file.text()), id) : null
    return { matchId: id, folder, comms }
  }, [])

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    getLinkedReplayFolder()
      .then(folder => read(matchId, folder))
      .then(
        result => { if (!cancelled) setFound(result) },
        err => {
          // A folder that moved, a file that is not JSON: the report simply has no communication section.
          console.warn('[report] could not read the communication file:', err)
          if (!cancelled) setFound({ matchId, folder: null, comms: null })
        },
      )
    return () => { cancelled = true }
  }, [matchId, read])

  const current = found && found.matchId === matchId ? found : null
  const folder = current?.folder ?? null
  const reconnect = useCallback(() => {
    if (!matchId || !folder) return
    reconnectReplayFolder(folder)
      .then(granted => read(matchId, granted))
      .then(setFound, err => console.warn('[report] could not reconnect the replay folder:', err))
  }, [matchId, folder, read])

  if (current?.comms) return { status: 'ready', comms: current.comms }
  if (folder && folder.permission === 'prompt') return { status: 'reconnect', folderName: folder.name, reconnect }
  return { status: 'none' }
}
