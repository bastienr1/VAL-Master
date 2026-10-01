import { useCallback, useEffect, useState } from 'react'
import { FolderSearch, RefreshCw } from 'lucide-react'
import {
  canLinkReplayFolder,
  getLinkedReplayFolder,
  linkReplayFolder,
  listReplayMatchIds,
  reconnectReplayFolder,
  syncReplayFolder,
  unlinkReplayFolder,
  type LinkedReplayFolder,
  type ReplayFolderSync,
} from '../lib/replayFolder'

interface ReplayFolderLinkProps {
  /** Called with every match that has replay data, on load and after each sync. */
  onReplayMatches: (matchIds: Set<string>) => void
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Links the folder the replay scripts write bundles into, then attaches each
 * bundle to its match without being asked: on every visit to the library, any
 * new bundle whose match is here gets attached.
 *
 * It cannot convert replays itself (that needs vrfkit on the PC); it picks up
 * what `npm run replay:ingest -- --all` has produced.
 */
export default function ReplayFolderLink({ onReplayMatches }: ReplayFolderLinkProps) {
  const [folder, setFolder] = useState<LinkedReplayFolder | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ReplayFolderSync | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const sync = useCallback(async (target: LinkedReplayFolder) => {
    setProblem(null)
    setProgress({ done: 0, total: 0 })
    try {
      const outcome = await syncReplayFolder(target, (done, total) => setProgress({ done, total }))
      setResult(outcome)
      onReplayMatches(outcome.replayMatchIds)
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setProgress(null)
    }
  }, [onReplayMatches])

  // On arrival: show which matches already have replay data, then pick up
  // anything new from the folder if the browser still lets us read it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ids = await listReplayMatchIds()
        if (!cancelled) onReplayMatches(ids)
        const linked = await getLinkedReplayFolder()
        if (cancelled || !linked) return
        setFolder(linked)
        if (linked.permission === 'granted') await sync(linked)
      } catch (err) {
        if (!cancelled) setProblem(messageOf(err))
      }
    })()
    return () => { cancelled = true }
  }, [onReplayMatches, sync])

  const handleLink = async () => {
    try {
      const linked = await linkReplayFolder()
      setFolder(linked)
      setResult(null)
      await sync(linked)
    } catch (err) {
      // Closing the picker is not an error worth showing.
      if (!(err instanceof DOMException && err.name === 'AbortError')) setProblem(messageOf(err))
    }
  }

  const handleReconnect = async () => {
    if (!folder) return
    try {
      const reconnected = await reconnectReplayFolder(folder)
      setFolder(reconnected)
      if (reconnected.permission === 'granted') await sync(reconnected)
      else setProblem('The browser did not allow reading the folder.')
    } catch (err) {
      setProblem(messageOf(err))
    }
  }

  const handleUnlink = async () => {
    await unlinkReplayFolder()
    setFolder(null)
    setResult(null)
    setProblem(null)
  }

  if (!canLinkReplayFolder()) return null

  const button =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40'

  if (!folder) {
    return (
      <div className="text-right">
        <button
          onClick={handleLink}
          title="Pick the folder where the replay scripts write bundles (…\VAL-Master-Replays\exports). Bundles are then attached to their matches automatically."
          className={`${button} border-bg-elevated bg-bg-card text-text-secondary hover:text-val-cyan hover:border-val-cyan/30`}
        >
          <FolderSearch className="w-3.5 h-3.5" />
          Link replay folder
        </button>
        {problem && <p className="mt-1 text-[10px] text-val-red max-w-xs ml-auto">{problem}</p>}
      </div>
    )
  }

  if (folder.permission !== 'granted') {
    return (
      <div className="text-right">
        <button
          onClick={handleReconnect}
          title="The browser needs your OK again before it reads the folder"
          className={`${button} border-val-yellow/30 bg-val-yellow/10 text-val-yellow hover:bg-val-yellow/20`}
        >
          <FolderSearch className="w-3.5 h-3.5" />
          Reconnect replay folder
        </button>
        {problem && <p className="mt-1 text-[10px] text-val-red max-w-xs ml-auto">{problem}</p>}
      </div>
    )
  }

  const total = result ? result.replayMatchIds.size : null
  return (
    <div className="text-right text-xs text-text-muted space-y-1">
      <div className="flex items-center justify-end gap-2">
        <FolderSearch className="w-3.5 h-3.5 text-val-cyan" />
        <span>
          Replay folder <span className="text-text-secondary">{folder.name}</span>
        </span>
        <button
          onClick={() => sync(folder)}
          disabled={progress != null}
          title="Look for new bundles now"
          className="p-1 rounded hover:text-val-cyan disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${progress ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={handleUnlink} className="text-[10px] hover:text-val-red transition-colors">
          Unlink
        </button>
      </div>

      {progress && (
        <p>{progress.total > 0 ? `Attaching replays… ${progress.done}/${progress.total}` : 'Checking the folder…'}</p>
      )}

      {!progress && result && (
        <p>
          {result.attached.length > 0 && (
            <span className="text-val-green">{result.attached.length} new attached · </span>
          )}
          {result.updated.length > 0 && (
            <span className="text-val-green" title="The folder held a newer conversion of these replays">
              {result.updated.length} updated ·{' '}
            </span>
          )}
          {total} {total === 1 ? 'match has' : 'matches have'} replay data
          {result.notInLibrary > 0 && (
            <span title="Bundles in the folder whose match is not in your library. Load the match first, then check again.">
              {' '}· {result.notInLibrary} not in your library
            </span>
          )}
        </p>
      )}

      {!progress && result && result.failed.length > 0 && (
        <p className="text-val-red" title={result.failed.map(f => `${f.matchId.slice(0, 8)}: ${f.reason}`).join('\n')}>
          {result.failed.length} could not be attached (hover for why)
        </p>
      )}
      {problem && <p className="text-val-red max-w-xs ml-auto">{problem}</p>}
    </div>
  )
}
