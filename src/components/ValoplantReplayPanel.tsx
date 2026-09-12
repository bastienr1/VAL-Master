import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Map as MapIcon, Pencil } from 'lucide-react'
import { normalizeUrl, isSafeUrl, isEmbeddableValoplantUrl } from '../lib/url'

interface ValoplantReplayPanelProps {
  matchId: string
  url: string | null
  onSave: (url: string | null) => Promise<void>
}

// Tuned against Valoplant's Flutter UI — below this the round selector crowds
// the map. Raise here first if the panel ever feels cramped.
const IFRAME_HEIGHT = 480

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'external link'
  }
}

/**
 * Collapsible 2D replay panel for the VOD workstation.
 *
 * The iframe is mounted only while expanded — Valoplant ships a Flutter web app
 * with a realtime socket and an audio engine, so it must not load alongside the
 * YouTube player by default, and collapsing has to actually tear it down rather
 * than hide it. Open/closed is component state only; nothing is persisted.
 */
export default function ValoplantReplayPanel({ matchId, url, onSave }: ValoplantReplayPanelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(url ?? '')
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalid = !isSafeUrl(draft)
  const embeddable = !!url && isEmbeddableValoplantUrl(url)
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
      if (!next) setExpanded(false) // nothing left to show
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save link')
    } finally {
      setSaving(false)
    }
  }

  // --- Editing: also the entry point when nothing is linked yet ---
  if (editing) {
    const savesAsLinkOnly = !invalid && draft.trim() !== '' && !isEmbeddableValoplantUrl(draft)

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
        {savesAsLinkOnly && (
          <p className="mt-1 text-[10px] text-text-muted">
            Only valoplant.gg links can be embedded — this one saves as an external link.
          </p>
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

  // --- Linked: collapsed header, optionally the mounted frame ---
  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(v => !v)}
          disabled={!embeddable}
          title={embeddable ? (expanded ? 'Collapse 2D replay' : 'Expand 2D replay') : 'This link cannot be embedded'}
          className="flex items-center gap-2 min-w-0 flex-1 text-left text-text-secondary hover:text-text-primary disabled:hover:text-text-secondary disabled:cursor-default transition-colors"
        >
          {embeddable && (expanded
            ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-val-cyan" />
            : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-val-cyan" />
          )}
          <span className="text-xs font-medium shrink-0">2D Replay</span>
          <span className="text-[10px] text-text-muted truncate">{hostLabel(url)}</span>
        </button>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the replay in a new tab"
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan text-[10px] font-medium hover:bg-val-cyan/20 transition-colors"
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

      {!embeddable && (
        <p className="px-3 pb-2 text-[10px] text-text-muted">Only valoplant.gg links can be embedded.</p>
      )}

      {expanded && embeddable && (
        <div className="px-3 pb-3 space-y-1.5">
          <iframe
            src={url}
            title="Valoplant 2D replay"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            allow="fullscreen"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full rounded-lg"
            style={{ height: IFRAME_HEIGHT }}
          />
          <p className="text-[10px] text-text-muted">
            Not loading?{' '}
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
              Open in Valoplant ↗
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
