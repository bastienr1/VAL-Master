import { memo, useRef, useState } from 'react'
import { Radar, Upload } from 'lucide-react'
import type { ReplayBundleStatus } from '../lib/replays'
import type { ReplayBundleSummary } from '../lib/replayBundle'

interface ReplayBundlePanelProps {
  status: ReplayBundleStatus
  summary: ReplayBundleSummary | null
  error: string | null
  onAttach: (file: Blob) => Promise<void>
}

/**
 * Match-level replay data — one slim row under the Valoplant link.
 *
 * Says whether this match has a minimap bundle (reduced from the game's own
 * `.vrf` replay by `scripts/replay`) and lets you attach or replace one. The
 * minimap itself reads the same bundle; this row is only the way in.
 *
 * Memoized for the same reason as the Valoplant row: the workstation re-renders
 * on every player tick and none of this depends on it.
 */
function ReplayBundlePanel({ status, summary, error, onAttach }: ReplayBundlePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file || attaching) return
    setAttaching(true)
    setAttachError(null)
    try {
      await onAttach(file)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach the replay')
    } finally {
      setAttaching(false)
      // Same file picked again must fire onChange again.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // Nothing to say until we know whether a bundle exists.
  if (status === 'loading') return null

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept=".gz,application/gzip"
      className="hidden"
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
  )
  const problem = attachError ?? (status === 'error' ? error : null)

  if (status === 'ready' && summary) {
    return (
      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <Radar className="w-3.5 h-3.5 shrink-0 text-val-cyan" />
          <span className="text-xs font-medium text-text-secondary shrink-0">Replay data</span>
          <span className="text-[10px] text-text-muted truncate">
            {summary.score[0]}–{summary.score[1]} · {summary.rounds} rounds · {summary.kills} kills · {summary.build.replace('release-', '')}
          </span>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={attaching}
            title="Replace the replay data for this match"
            className="ml-auto shrink-0 px-2 py-1 rounded-lg text-[10px] text-text-muted hover:text-val-cyan disabled:opacity-40 transition-colors"
          >
            {attaching ? 'Reading…' : 'Replace'}
          </button>
          {picker}
        </div>
        {problem && <p className="mt-1 text-[10px] text-val-red">{problem}</p>}
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={attaching}
        title="Pick the minimap.v1.json.gz built from this match's replay"
        className="w-full flex items-center gap-2 bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 text-left text-xs text-text-muted hover:text-val-cyan hover:border-val-cyan/30 disabled:opacity-40 transition-colors"
      >
        <Upload className="w-3.5 h-3.5 shrink-0" />
        {attaching ? 'Reading replay data…' : 'Attach replay data'}
      </button>
      {picker}
      {problem && <p className="mt-1 text-[10px] text-val-red">{problem}</p>}
    </div>
  )
}

export default memo(ReplayBundlePanel)
