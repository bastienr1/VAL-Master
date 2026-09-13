import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, X } from 'lucide-react'
import { importPlaybookFile, type PlaybookImportResult } from '../lib/playbookImport'

interface PlaybookImportButtonProps {
  onImportComplete: () => void
}

function feedbackFor(result: PlaybookImportResult): { tone: string; message: string } {
  const counts = [
    result.chapters_added ? `${result.chapters_added} added` : null,
    result.chapters_updated ? `${result.chapters_updated} updated` : null,
    result.chapters_removed ? `${result.chapters_removed} removed` : null,
  ].filter(Boolean).join(', ')

  switch (result.success ? result.action : 'failed') {
    case 'created':
      return { tone: 'text-val-green border-val-green/25 bg-val-green/10', message: `Playbook imported successfully${counts ? ` — ${counts} chapters` : ''}` }
    case 'updated':
      return { tone: 'text-val-cyan border-val-cyan/25 bg-val-cyan/10', message: `Playbook updated with latest content${counts ? ` — chapters ${counts}` : ''}` }
    case 'unchanged':
      return { tone: 'text-text-muted border-bg-elevated bg-bg-card', message: 'No changes detected' }
    default:
      return { tone: 'text-val-red border-val-red/25 bg-val-red/10', message: result.error ?? 'Import failed' }
  }
}

export default function PlaybookImportButton({ onImportComplete }: PlaybookImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<PlaybookImportResult | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const next = await importPlaybookFile(file)
      setResult(next)
      if (next.success) onImportComplete()
    } catch (err) {
      console.error('[PlaybookImportButton] import threw', err)
      setResult({ success: false, error: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setImporting(false)
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
        disabled={importing}
        className="bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-md px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        <Upload className={`w-4 h-4 ${importing ? 'animate-pulse' : ''}`} />
        {importing ? 'Importing…' : 'Import from vault'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />

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
