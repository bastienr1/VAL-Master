import { memo, useState } from 'react'
import { ExternalLink, Map as MapIcon, Pencil } from 'lucide-react'
import { normalizeUrl, isSafeUrl } from '../lib/url'

interface ValoplantReplayPanelProps {
  matchId: string
  url: string | null
  onSave: (url: string | null) => Promise<void>
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'external link'
  }
}

/**
 * Match-level Valoplant replay link — one slim row in the VOD workstation.
 *
 * Link-only by necessity, not by preference: valoplant.gg serves
 * `frame-ancestors 'self' https://tracker2-ten.vercel.app`, a fixed partner
 * allowlist VAL Master is not on, so an embed can never render from any of our
 * origins. Investigation record and the revival path (ask them to allowlist the
 * production domain) live in the vault note
 * `2026-09-12-VAL-Master-Valoplant-Replay-Panel`.
 *
 * Memoized because the workstation re-renders on every player tick while this
 * panel depends on none of that state.
 */
function ValoplantReplayPanel({ matchId, url, onSave }: ValoplantReplayPanelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalid = !isSafeUrl(draft)
  const inputId = `valoplant-url-${matchId}`

  const openEditor = () => {
    setDraft(url ?? '')
    setError(null)
    setEditing(true)
  }

  const handleSave = async () => {
    if (invalid || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = normalizeUrl(draft) // null when the field was cleared
      await onSave(next)
      setDraft(next ?? '')
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save link')
    } finally {
      setSaving(false)
    }
  }

  // --- Editing: also the entry point when nothing is linked yet ---
  if (editing) {
    return (
      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
        <label htmlFor={inputId} className="text-[10px] text-text-muted uppercase tracking-wider">
          Valoplant replay
        </label>
        <div className="flex items-center gap-1.5 mt-1">
          <input
            id={inputId}
            type="url"
            inputMode="url"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const normalized = normalizeUrl(draft)
              if (normalized) setDraft(normalized)
            }}
            placeholder="https://valoplant.gg/..."
            className={`flex-1 min-w-0 bg-bg-elevated border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
              invalid
                ? 'border-val-red/50 focus:border-val-red/60'
                : 'border-bg-card focus:border-val-cyan/30'
            }`}
          />
          <button
            onClick={handleSave}
            disabled={invalid || saving}
            title="Save the replay link for this match"
            className="shrink-0 px-2 py-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan text-[10px] font-medium hover:bg-val-cyan/20 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(url ?? ''); setError(null) }}
            className="shrink-0 px-2 py-1.5 rounded-lg text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
        {invalid && (
          <p className="mt-1 text-[10px] text-val-red">Needs to be an http(s) link with a real domain.</p>
        )}
        {error && <p className="mt-1 text-[10px] text-val-red">{error}</p>}
      </div>
    )
  }

  // --- Nothing linked yet ---
  if (!url) {
    return (
      <button
        onClick={openEditor}
        className="w-full flex items-center gap-2 bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 text-left text-xs text-text-muted hover:text-val-cyan hover:border-val-cyan/30 transition-colors"
      >
        <MapIcon className="w-3.5 h-3.5 shrink-0" />
        Link Valoplant replay
      </button>
    )
  }

  // --- Linked: the slim row ---
  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg flex items-center gap-2 px-3 py-2">
      <MapIcon className="w-3.5 h-3.5 shrink-0 text-val-cyan" />
      <span className="text-xs font-medium text-text-secondary shrink-0">2D Replay</span>
      <span className="text-[10px] text-text-muted truncate">{hostLabel(url)}</span>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the replay in a new tab"
        className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan text-[10px] font-medium hover:bg-val-cyan/20 transition-colors"
      >
        Open in Valoplant
        <ExternalLink className="w-3 h-3" />
      </a>
      <button
        onClick={openEditor}
        title="Edit replay link"
        className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-val-cyan transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default memo(ValoplantReplayPanel)
