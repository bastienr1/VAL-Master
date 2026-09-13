import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, X } from 'lucide-react'
import { preparePlaybookImport, type PlaybookImportResult, type PreparedPlaybookImport } from '../lib/playbookImport'
import PlaybookSaveDialog from './PlaybookSaveDialog'

interface PlaybookImportButtonProps {
  onImportComplete: () => void
}

function feedbackFor(result: PlaybookImportResult): { tone: string; message: React.ReactNode } {
  const counts = [
    result.chapters_added ? `${result.chapters_added} added` : null,
    result.chapters_updated ? `${result.chapters_updated} updated` : null,
    result.chapters_removed ? `${result.chapters_removed} removed` : null,
  ].filter(Boolean).join(', ')
  const name = result.name ? <strong className="font-semibold">{result.name}</strong> : 'playbook'

  switch (result.success ? result.action : 'failed') {
    case 'created':
      return { tone: 'text-val-green border-val-green/25 bg-val-green/10', message: <>Saved {name}{counts ? ` — ${counts} chapters` : ''}</> }
    case 'updated':
      return { tone: 'text-val-cyan border-val-cyan/25 bg-val-cyan/10', message: <>Updated {name}{counts ? ` — chapters ${counts}` : ''}</> }
    case 'unchanged':
      return { tone: 'text-text-muted border-bg-elevated bg-bg-card', message: <>Saved {name} — no content changes</> }
    default:
      return { tone: 'text-val-red border-val-red/25 bg-val-red/10', message: result.error ?? 'Import failed' }
  }
}

export default function PlaybookImportButton({ onImportComplete }: PlaybookImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [prepared, setPrepared] = useState<PreparedPlaybookImport | null>(null)
  const [result, setResult] = useState<PlaybookImportResult | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setResult(null)
    try {
      const next = await preparePlaybookImport(file)
      if (next.ok) setPrepared(next.prepared)
      else setResult({ success: false, action: 'failed', error: next.error })
    } catch (err) {
      console.error('[PlaybookImportButton] prepare threw', err)
      setResult({ success: false, error: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setReading(false)
      // Clear so picking the same file again still fires onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const feedback = result ? feedbackFor(result) : null

  return (
    <div className="relative flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={reading || prepared !== null}
        className="bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-md px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        <Upload className={`w-4 h-4 ${reading ? 'animate-pulse' : ''}`} />
        {reading ? 'Reading…' : 'Import from vault'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {prepared && (
        <PlaybookSaveDialog
          prepared={prepared}
          onCancel={() => setPrepared(null)}
          onSaved={saved => {
            setPrepared(null)
            setResult(saved)
            onImportComplete()
          }}
        />
      )}

      {feedback && result && (
        <div className={`absolute top-full right-0 mt-2 z-20 w-80 max-w-[90vw] border rounded-md px-3 py-2 text-xs flex items-start gap-2 ${feedback.tone}`}>
          <div className="flex-1 leading-relaxed">
            {feedback.message}
            {result.success && result.slug && (
              <>
                {' · '}
                <Link to={`/playbook/${result.slug}`} className="underline hover:opacity-80">
                  Open
                </Link>
              </>
            )}
          </div>
          <button type="button" onClick={() => setResult(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
