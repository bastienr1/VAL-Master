import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Check, Pencil, Trash2, X } from 'lucide-react'
import { deletePlaybook, renamePlaybook, PLAYBOOK_NAME_MAX } from '../lib/playbooks'
import type { PlaybookWithCount } from '../lib/types'

interface PlaybookLibraryProps {
  playbooks: PlaybookWithCount[]
  loading: boolean
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const iconButton = 'p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-elevated/60 transition-colors disabled:opacity-40'

function PlaybookRow({ playbook }: { playbook: PlaybookWithCount }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view')
  const [draft, setDraft] = useState(playbook.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startRename = () => {
    setDraft(playbook.name)
    setError(null)
    setMode('rename')
  }

  const commitRename = async () => {
    if (draft.trim() === playbook.name) {
      setMode('view')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renamePlaybook(playbook.id, draft)
      setMode('view')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      await deletePlaybook(playbook.id)
      // The row unmounts when the list reloads.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
      setMode('view')
    }
  }

  return (
    <div className="py-2.5 flex items-center gap-3">
      <BookOpen className="w-4 h-4 text-val-cyan shrink-0" />

      <div className="flex-1 min-w-0">
        {mode === 'rename' ? (
          <input
            autoFocus
            value={draft}
            maxLength={PLAYBOOK_NAME_MAX + 20}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setMode('view')
                setError(null)
              }
            }}
            disabled={busy}
            aria-label="Playbook name"
            className="w-full bg-bg-elevated border border-val-cyan/40 rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none"
          />
        ) : mode === 'confirm-delete' ? (
          <div className="text-sm text-val-red truncate">
            Delete <strong className="font-semibold">{playbook.name}</strong>?
          </div>
        ) : (
          <Link to={`/playbook/${playbook.slug}`} className="block text-sm text-text-primary truncate hover:text-val-cyan transition-colors">
            {playbook.name}
          </Link>
        )}
        {mode === 'view' && playbook.name !== playbook.title && (
          <div className="text-xs text-text-muted truncate" title={playbook.title}>
            {playbook.title}
          </div>
        )}
        {error && <div className="text-[11px] text-val-red mt-0.5">{error}</div>}
      </div>

      <div className="hidden sm:block w-28 text-xs text-text-secondary truncate">
        {playbook.map}
        {playbook.side && <span className="text-text-muted"> · {playbook.side}</span>}
      </div>
      <div className="hidden md:block w-24 text-xs font-stats text-text-muted text-right">
        {playbook.chapter_count} {playbook.chapter_count === 1 ? 'chapter' : 'chapters'}
      </div>
      <div className="hidden md:block w-20 text-xs text-text-muted text-right" title={playbook.source_last_synced_at ?? undefined}>
        {relativeTime(playbook.source_last_synced_at)}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {mode === 'rename' ? (
          <>
            <button type="button" onClick={commitRename} disabled={busy} className={iconButton} aria-label="Save name" title="Save (Enter)">
              <Check className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setMode('view')} disabled={busy} className={iconButton} aria-label="Cancel rename" title="Cancel (Esc)">
              <X className="w-4 h-4" />
            </button>
          </>
        ) : mode === 'confirm-delete' ? (
          <>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              className="px-2 py-1 rounded-md text-xs text-val-red border border-val-red/25 bg-val-red/10 hover:bg-val-red/20 disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Yes'}
            </button>
            <button type="button" onClick={() => setMode('view')} disabled={busy} className="px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-secondary">
              No
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={startRename} className={iconButton} aria-label={`Rename ${playbook.name}`} title="Rename">
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setMode('confirm-delete')
              }}
              className={`${iconButton} hover:text-val-red`}
              aria-label={`Delete ${playbook.name}`}
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function PlaybookLibrary({ playbooks, loading }: PlaybookLibraryProps) {
  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl px-4 py-3">
      <div className="flex items-center justify-between pb-2 border-b border-bg-elevated">
        <span className="text-[10px] uppercase tracking-widest text-text-muted">Your playbooks</span>
        {!loading && <span className="font-stats text-xs text-text-muted">{playbooks.length}</span>}
      </div>

      {loading && playbooks.length === 0 ? (
        <div className="py-3 space-y-2 animate-pulse">
          <div className="h-8 rounded-md bg-bg-elevated/50" />
        </div>
      ) : playbooks.length === 0 ? (
        <p className="py-4 text-sm text-text-muted">No saved playbooks yet — use Import from vault to add one.</p>
      ) : (
        <div className="divide-y divide-bg-elevated/60">
          {playbooks.map(p => (
            <PlaybookRow key={p.id} playbook={p} />
          ))}
        </div>
      )}
    </section>
  )
}
