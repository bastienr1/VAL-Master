import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, X } from 'lucide-react'
import { formatTimestamp } from '../lib/playbookParser'
import { PLAYBOOK_NAME_MAX, validatePlaybookName } from '../lib/playbooks'
import { savePlaybookImport, type PlaybookImportResult, type PreparedPlaybookImport } from '../lib/playbookImport'

interface PlaybookSaveDialogProps {
  prepared: PreparedPlaybookImport
  onCancel: () => void
  onSaved: (result: PlaybookImportResult) => void
}

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="text-sm text-text-primary mt-0.5">{children}</div>
    </div>
  )
}

/** Review & name step of Import from vault. Nothing is written until Save. */
export default function PlaybookSaveDialog({ prepared, onCancel, onSaved }: PlaybookSaveDialogProps) {
  const { playbook, chapters, existing } = prepared
  const [name, setName] = useState(existing?.name ?? playbook.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const checked = validatePlaybookName(name)
  const contentChanged = existing ? existing.contentHash !== prepared.contentHash : null

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const save = async () => {
    if (!checked.ok || saving) return
    setSaving(true)
    setError(null)
    const result = await savePlaybookImport(prepared, checked.name)
    setSaving(false)
    if (result.success) onSaved(result)
    else setError(result.error ?? 'Save failed')
  }

  const duration = playbook.video_duration_seconds ?? Math.max(...chapters.map(c => c.end_seconds))

  return (
    <div
      className="fixed inset-0 z-50 bg-bg-primary/80 flex items-center justify-center p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !saving) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-playbook-title"
        className="w-full max-w-lg bg-bg-card border border-bg-elevated rounded-xl p-5 space-y-4 shadow-2xl"
        onKeyDown={e => {
          if (e.key === 'Escape' && !saving) {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="save-playbook-title" className="font-heading text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-val-cyan" />
            Save playbook
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Cancel"
            className="text-text-muted hover:text-text-secondary disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {existing && (
          <div className="border border-val-cyan/25 bg-val-cyan/10 text-val-cyan text-xs rounded-md px-3 py-2 leading-relaxed">
            Updates your saved playbook <strong className="font-semibold">{existing.name}</strong>
            <span className="text-text-muted"> · {contentChanged ? 'Content changed' : 'No content changes'}</span>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="playbook-name" className="text-[10px] uppercase tracking-widest text-text-muted">
              Name
            </label>
            <span className={`font-stats text-[10px] ${name.trim().length > PLAYBOOK_NAME_MAX ? 'text-val-red' : 'text-text-muted'}`}>
              {name.trim().length} / {PLAYBOOK_NAME_MAX}
            </span>
          </div>
          <input
            id="playbook-name"
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
            disabled={saving}
            className={`w-full mt-1 bg-bg-elevated border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none ${
              checked.ok ? 'border-bg-card focus:border-val-cyan/40' : 'border-val-red/50'
            }`}
          />
          {!checked.ok && <p className="mt-1 text-[11px] text-val-red">{checked.error}</p>}
          {name.trim() !== playbook.title && (
            <p className="mt-1 text-[11px] text-text-muted truncate" title={playbook.title}>
              Note: {playbook.title}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 bg-bg-elevated/40 border border-bg-elevated rounded-lg p-3">
          <SummaryItem label="Map">{playbook.map}</SummaryItem>
          <SummaryItem label="Side">{playbook.side ?? '—'}</SummaryItem>
          <SummaryItem label="Chapters">
            <span className="font-stats">{chapters.length}</span>
          </SummaryItem>
          <SummaryItem label="Duration">
            <span className="font-stats">{formatTimestamp(duration)}</span>
          </SummaryItem>
          <SummaryItem label="Video">
            {playbook.video_url ? (
              <span className="text-val-green inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Linked
              </span>
            ) : (
              <span className="text-val-yellow/80">Not linked</span>
            )}
          </SummaryItem>
          <SummaryItem label="Takeaways">
            <span className="font-stats">{prepared.takeawayCount}</span>
          </SummaryItem>
        </div>

        {error && (
          <div className="border border-val-red/25 bg-val-red/10 text-val-red text-xs rounded-md px-3 py-2">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text-secondary disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!checked.ok || saving}
            className="bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-md px-3 py-1.5 text-sm hover:bg-val-cyan/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save playbook'}
          </button>
        </div>
      </div>
    </div>
  )
}
